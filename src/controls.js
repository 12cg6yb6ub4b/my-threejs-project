/**
 * ============================================================
 *  controls.js —— 双视角交互控制
 *  ------------------------------------------------------------
 *  漫游视角：PointerLock 第一人称
 *    - WASD / 方向键平面移动（摄像机朝向相对）
 *    - Shift 加速、滚轮缩放（FOV）
 *    - 空格重力跳跃（帧时间联动重力公式）+ 地表碰撞检测防穿模
 *    - 移动插值平滑操作手感
 *    - E 键触发中心射线互动（配合 interaction.js）
 *  移动端触屏：
 *    - 左半屏虚拟摇杆移动，右半屏拖拽转视角，跳跃按钮，轻点拾取
 *  俯视视角：围绕小镇中心的环绕镜头，缓慢自动旋转，滚轮拉近拉远
 * ============================================================
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/**
 * 创建视角控制器
 * @param {THREE.Camera} camera
 * @param {HTMLElement} dom 渲染容器
 * @param {function} terrainHeight 地面高度函数
 * @param {object} opts { onPick(x,y), onInteract() } 拾取回调
 * @returns 控制器对象
 */
export function createControls(camera, dom, terrainHeight, opts = {}) {
  // PointerLock 第一人称控制（three 0.185 直接操作 camera.quaternion）
  const fps = new PointerLockControls(camera, dom);

  // 按键状态
  const keys = {};
  const speed = { walk: 6, sprint: 12 };

  // ---- 重力与跳跃物理（第3天：帧时间联动重力公式 + 空格跳跃 + 地表碰撞）----
  const GRAVITY = -16;          // 重力加速度（m/s²）
  const JUMP_SPEED = 6.4;       // 起跳初速度（m/s）
  const EYE_HEIGHT = 1.7;       // 视点高度
  let vy = 0;                   // 垂直方向速度
  let onGround = true;          // 是否站在地面上
  let jumpQueued = false;       // 跳跃请求（空格 / 跳跃按钮）

  // ---- 平滑移动（移动插值平滑操作手感）----
  const smoothVel = new THREE.Vector3();
  const moveDir = new THREE.Vector3();

  // ---- 物体碰撞（防穿模）：圆柱碰撞体 + 身体半径 + 高度豁免可跨越 ----
  const BODY_R = 0.45;                       // 玩家身体半径
  const colliders = opts.colliders || [];    // [{ x, z, r, h }]
  function collideWithObjects() {
    for (let iter = 0; iter < 2; iter++) {   // 两次迭代，避免多物体夹缝卡住
      let hit = false;
      for (const c of colliders) {
        const dx = camera.position.x - c.x;
        const dz = camera.position.z - c.z;
        const rr = c.r + BODY_R;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-9) {
          // 高度豁免：玩家脚底高于障碍顶（站在坡上/跳过矮物）→ 允许穿过
          const footY = camera.position.y - EYE_HEIGHT;
          if (footY > terrainHeight(c.x, c.z) + c.h) continue;
          const d = Math.sqrt(d2);
          camera.position.x = c.x + dx / d * rr;
          camera.position.z = c.z + dz / d * rr;
          hit = true;
        }
      }
      if (!hit) break;
    }
  }

  // ---- 俯视视角（小镇中心环绕）----
  const orbitCenter = new THREE.Vector3(0, 6, 0);
  let orbitAngle = 0;
  let orbitRadius = 22;
  const orbitHeight = 14;

  // 当前模式
  let mode = 'fps';        // 'fps' | 'orbit'

  // 场景重置的"家"位置
  const homePos = camera.position.clone();
  const homeQuat = camera.quaternion.clone();
  const homeFov = camera.fov;

  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  /** 安全请求指针锁定（three 0.185 的 lock() 不返回 Promise，需直接调用并捕获拒绝） */
  function safeLock() {
    try {
      const p = dom.requestPointerLock({ unadjustedMovement: false });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (err) { /* 指针锁定被浏览器拒绝时静默降级 */ }
  }

  /* ==========================================================
   * 鼠标光标 & 准星（FPS 锁定后显示，命中可交互物时高亮）
   * ========================================================== */
  let crosshairEl = null;
  let crosshairLabel = null;
  function buildCrosshair() {
    if (document.getElementById('crosshair')) return;
    crosshairEl = document.createElement('div');
    crosshairEl.id = 'crosshair';
    crosshairEl.innerHTML = '<span class="ch-dot"></span>';
    document.body.appendChild(crosshairEl);
    crosshairLabel = document.createElement('div');
    crosshairLabel.id = 'crosshairLabel';
    document.body.appendChild(crosshairLabel);
  }
  buildCrosshair();

  function setCrosshair(visible) {
    if (crosshairEl) crosshairEl.classList.toggle('show', visible);
    if (crosshairLabel) crosshairLabel.classList.toggle('show', visible);
  }
  function setCrosshairHit(data) {
    if (!crosshairEl) return;
    crosshairEl.classList.toggle('hit', !!data);
    if (crosshairLabel) {
      crosshairLabel.textContent = data && data.label ? data.label : '';
      crosshairLabel.classList.toggle('show', !!(data && data.label));
    }
  }

  // 光标/准星探测（80ms 节流，避免每帧射线开销）
  let lastProbe = 0;
  function probeAt(clientX, clientY) {
    const now = performance.now();
    if (now - lastProbe < 80) return null;
    lastProbe = now;
    if (!opts.onProbe) return null;
    return opts.onProbe(clientX, clientY);
  }

  // 桌面鼠标移动：非锁定 → 指针样式；锁定 → 准星命中反馈
  dom.addEventListener('mousemove', (e) => {
    if (mode === 'orbit') {
      const data = probeAt(e.clientX, e.clientY);
      dom.style.cursor = data ? 'pointer' : 'default';
      return;
    }
    if (fps.isLocked) {
      setCrosshairHit(probeAt(window.innerWidth / 2, window.innerHeight / 2));
    } else {
      const data = probeAt(e.clientX, e.clientY);
      dom.style.cursor = data ? 'pointer' : 'default';
    }
  });
  // 指针锁定状态变化：锁定后显示准星，解锁隐藏并复位光标
  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    setCrosshair(locked && mode === 'fps');
    if (!locked) {
      setCrosshairHit(null);
      dom.style.cursor = '';
    }
  });

  /* ==========================================================
   * 移动端触屏控件（虚拟摇杆 + 跳跃键）
   * ========================================================== */
  const joy = { active: false, id: -1, baseX: 0, baseY: 0, dx: 0, dy: 0 };
  const look = { active: false, id: -1, lastX: 0, lastY: 0, moved: 0 };
  let tapCandidate = null;    // 轻点拾取候选 { x, y, t0 }

  function buildMobileUI() {
    if (!isTouch) return;
    if (document.getElementById('joyBase')) return;
    const base = document.createElement('div');
    base.id = 'joyBase';
    base.appendChild(document.createElement('div')).id = 'joyKnob';
    document.body.appendChild(base);

    const jump = document.createElement('button');
    jump.id = 'jumpBtn';
    jump.textContent = '⤒';
    document.body.appendChild(jump);
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      jumpQueued = true;
    });
  }
  buildMobileUI();

  function setJoyVisible(v) {
    const base = document.getElementById('joyBase');
    if (base) base.style.display = v ? 'flex' : 'none';
  }

  function onTouchStart(e) {
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      const isLeft = x < window.innerWidth * 0.45;
      if (isLeft && !joy.active) {
        joy.active = true; joy.id = t.identifier;
        joy.baseX = x; joy.baseY = y; joy.dx = 0; joy.dy = 0;
        const base = document.getElementById('joyBase');
        if (base) { base.style.left = x + 'px'; base.style.top = y + 'px'; }
        setJoyVisible(true);
      } else if (!isLeft && !look.active) {
        look.active = true; look.id = t.identifier;
        look.lastX = x; look.lastY = y; look.moved = 0;
        tapCandidate = { x, y, t0: performance.now() };
      }
    }
  }
  function onTouchMove(e) {
    for (const t of e.changedTouches) {
      if (joy.active && t.identifier === joy.id) {
        let dx = t.clientX - joy.baseX, dy = t.clientY - joy.baseY;
        const len = Math.hypot(dx, dy);
        const R = 52;
        if (len > R) { dx = dx / len * R; dy = dy / len * R; }
        joy.dx = dx / R; joy.dy = dy / R;
        const knob = document.getElementById('joyKnob');
        if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      if (look.active && t.identifier === look.id) {
        const dx = t.clientX - look.lastX, dy = t.clientY - look.lastY;
        look.lastX = t.clientX; look.lastY = t.clientY;
        look.moved += Math.abs(dx) + Math.abs(dy);
        if (tapCandidate && look.moved > 14) tapCandidate = null;   // 拖动不是轻点
        // 拖拽旋转视角（与 PointerLock 相同的 YXZ 欧拉算法）
        const eul = new THREE.Euler(0, 0, 0, 'YXZ');
        eul.setFromQuaternion(camera.quaternion);
        eul.y -= dx * 0.005;
        eul.x -= dy * 0.005;
        eul.x = THREE.MathUtils.clamp(eul.x, -1.45, 1.45);
        camera.quaternion.setFromEuler(eul);
      }
    }
  }
  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (joy.active && t.identifier === joy.id) {
        joy.active = false; joy.dx = 0; joy.dy = 0;
        setJoyVisible(false);
      }
      if (look.active && t.identifier === look.id) {
        look.active = false;
        // 轻点（未拖动、时间短）→ 射线拾取
        if (tapCandidate) {
          const dur = performance.now() - tapCandidate.t0;
          if (dur < 320 && opts.onPick) opts.onPick(tapCandidate.x, tapCandidate.y);
        }
        tapCandidate = null;
      }
    }
  }
  dom.addEventListener('touchstart', onTouchStart, { passive: false });
  dom.addEventListener('touchmove', onTouchMove, { passive: false });
  dom.addEventListener('touchend', onTouchEnd, { passive: false });

  /* ==========================================================
   * 键盘监听
   * ========================================================== */
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) jumpQueued = true;      // 空格跳跃
    if (e.code === 'KeyE' && !e.repeat) {                        // E 键中心射线互动
      if (mode === 'fps' && fps.isLocked && opts.onInteract) opts.onInteract();
    }
    keys[e.code] = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE'].includes(e.code)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // 滚轮：漫游模式缩放 FOV，俯视模式拉近拉远
  window.addEventListener('wheel', (e) => {
    const d = e.deltaY > 0 ? 1 : -1;
    if (mode === 'fps') {
      camera.fov = THREE.MathUtils.clamp(camera.fov + d * 3.5, 34, 70);
      camera.updateProjectionMatrix();
    } else {
      orbitRadius = THREE.MathUtils.clamp(orbitRadius + d * 2, 10, 45);
    }
  }, { passive: true });

  // 鼠标点击：FPS 未锁定时 = 射线拾取 + 锁定指针；俯视模式 = 射线拾取
  dom.addEventListener('click', (e) => {
    if (e.pointerType === 'touch') return;
    if (mode === 'fps' && !fps.isLocked) {
      if (opts.onPick) opts.onPick(e.clientX, e.clientY);
      safeLock();
    } else if (mode === 'orbit') {
      if (opts.onPick) opts.onPick(e.clientX, e.clientY);
    }
  });

  /** 切换模式：'fps' 或 'orbit' */
  function setMode(m) {
    mode = m;
    // 切换模式时清空垂直速度，避免残留
    vy = 0; onGround = true; jumpQueued = false;
    if (m === 'fps') {
      if (!isTouch) safeLock();
    } else {
      fps.unlock();
      dom.style.cursor = '';
    }
  }

  function getMode() { return mode; }

  /** 场景重置：回到初始位置/朝向/白天视角 */
  function reset() {
    mode = 'fps';
    camera.position.copy(homePos);
    camera.quaternion.copy(homeQuat);
    camera.fov = homeFov;
    camera.updateProjectionMatrix();
    vy = 0; onGround = true; jumpQueued = false;
    smoothVel.set(0, 0, 0);
    orbitAngle = 0;
    try { fps.unlock(); } catch (err) { /* 忽略解锁异常 */ }
    if (!isTouch) safeLock();
    joy.active = false; joy.dx = joy.dy = 0; look.active = false; tapCandidate = null;
    setJoyVisible(false);
  }

  /**
   * 每帧更新
   * @param {number} dt 帧间隔（秒）
   * @param {number} time 累计时间
   */
  function update(dt, time) {
    if (mode === 'fps') {
      // 朝向相对方向（three 0.185 的 PointerLockControls 直接写入 camera.quaternion）
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      forward.y = 0; forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      right.y = 0; right.normalize();

      // 输入向量：键盘 + 虚拟摇杆
      moveDir.set(0, 0, 0);
      const s = (keys.ShiftLeft || keys.ShiftRight) ? speed.sprint : speed.walk;
      if (keys.KeyW || keys.ArrowUp) moveDir.add(forward);
      if (keys.KeyS || keys.ArrowDown) moveDir.sub(forward);
      if (keys.KeyD || keys.ArrowRight) moveDir.add(right);
      if (keys.KeyA || keys.ArrowLeft) moveDir.sub(right);
      if (joy.active) {                                   // 摇杆：dy 上推为前进
        moveDir.addScaledVector(forward, -joy.dy);
        moveDir.addScaledVector(right, joy.dx);
      }
      if (moveDir.lengthSq() > 1) moveDir.normalize();
      moveDir.multiplyScalar(s);

      // 移动插值平滑：速度指数趋近目标，避免急停急转
      const k = 1 - Math.exp(-dt * 10);
      smoothVel.x += (moveDir.x - smoothVel.x) * k;
      smoothVel.z += (moveDir.z - smoothVel.z) * k;
      camera.position.x += smoothVel.x * dt;
      camera.position.z += smoothVel.z * dt;

      // ---- 物体碰撞（树 / 建筑 / NPC / 面板等，防穿模）----
      collideWithObjects();

      // ---- 重力跳跃物理（帧时间联动）----
      if (onGround && jumpQueued) { vy = JUMP_SPEED; onGround = false; jumpQueued = false; }
      vy += GRAVITY * dt;                                  // 重力加速度累积
      camera.position.y += vy * dt;                        // 垂直位移

      // ---- 地表碰撞检测（防止穿模）----
      const groundY = terrainHeight(camera.position.x, camera.position.z) + EYE_HEIGHT;
      if (camera.position.y <= groundY) {
        camera.position.y = groundY;
        if (vy < 0) vy = 0;
        onGround = true;
      } else if (vy === 0) {
        // 静止悬空（如从俯视视角切回漫游）时缓慢落地，保证地形跟随手感
        camera.position.y = Math.max(groundY, THREE.MathUtils.lerp(camera.position.y, groundY, Math.min(1, dt * 4)));
        if (Math.abs(camera.position.y - groundY) < 0.02) onGround = true;
      }

      // 限制活动范围（不走出场景圆盘）
      const r = Math.hypot(camera.position.x, camera.position.z);
      if (r > 70) camera.position.set(camera.position.x / r * 70, camera.position.y, camera.position.z / r * 70);
    } else {
      // 俯视：环绕旋转
      orbitAngle += dt * 0.12;
      const target = new THREE.Vector3(
        orbitCenter.x + Math.cos(orbitAngle) * orbitRadius,
        orbitHeight,
        orbitCenter.z + Math.sin(orbitAngle) * orbitRadius
      );
      camera.position.lerp(target, 0.04);
      camera.lookAt(orbitCenter);
    }
  }

  return { update, setMode, getMode, reset, fps };
}
