/**
 * ============================================================
 *  interaction.js —— Raycaster 射线拾取交互系统
 *  ------------------------------------------------------------
 *  第4天需求：拾取花草 / 木屋 / 溪流 / 古树等道具，
 *  触发：粒子爆发 + 摆动动画 + 手绘文字弹窗。
 *  监听：桌面鼠标点击、FPS 锁定时 E 键中心拾取、移动端轻点。
 * ============================================================
 */
import * as THREE from 'three';
import { makeGlowTexture } from './shaders.js';

/** 每个交互道具的弹窗文案 */
const POPUP_MSG = {
  house: '吱呀～欢迎来到童话小屋！',
  pavilion: '凉亭里好凉快呀～',
  tree: '古树爷爷轻轻晃了晃…',
  stream: '哗啦啦～溪水在唱歌！',
  flower: '小草被风吹得直点头～',
};
/** 粒子爆发配色 */
const BURST_COLOR = {
  house: '#ffd9a0',
  pavilion: '#ffe1b8',
  tree: '#b8e08a',
  stream: '#a8d8f0',
  flower: '#a8e08a',
};

/**
 * 创建射线拾取交互系统
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} world 世界对象（含 group）
 * @param {object} handlers 额外回调 { onGallery(data, point) } 画廊展品点击
 */
export function createInteraction(scene, camera, renderer, world, handlers = {}) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /* ----------------------------------------------------------
   * 收集可交互对象：遍历世界，网格自身或父级带 userData.interactive 即加入
   * ---------------------------------------------------------- */
  const interactables = [];
  world.group.traverse((obj) => {
    if (!obj.isMesh) return;
    let node = obj;
    while (node) {
      if (node.userData && node.userData.interactive) break;
      node = node.parent;
    }
    if (node) interactables.push({ mesh: obj, root: node });
  });

  /* ----------------------------------------------------------
   * 粒子爆发系统（拾取时绽放一簇光点，Additive 叠加）
   * ---------------------------------------------------------- */
  const BURST_N = 26;
  const burstGeo = new THREE.BufferGeometry();
  const burstPos = new Float32Array(BURST_N * 3);
  const burstVel = new Float32Array(BURST_N * 3);
  burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
  const burstMat = new THREE.PointsMaterial({
    map: makeGlowTexture(),
    size: 0.30, sizeAttenuation: true,
    transparent: true, depthWrite: false,
    color: '#ffe9b0',
    blending: THREE.AdditiveBlending,
  });
  const burst = new THREE.Points(burstGeo, burstMat);
  burst.visible = false;
  burst.frustumCulled = false;
  scene.add(burst);
  let burstActive = false;
  let burstLife = 0;
  const BURST_DUR = 0.9;

  function spawnBurst(p, color) {
    for (let i = 0; i < BURST_N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      burstVel[i * 3]     = Math.cos(a) * (0.8 + r * 2.2);
      burstVel[i * 3 + 1] = 1.2 + r * 2.6;
      burstVel[i * 3 + 2] = Math.sin(a) * (0.8 + r * 2.2);
      burstPos[i * 3]     = p.x;
      burstPos[i * 3 + 1] = p.y;
      burstPos[i * 3 + 2] = p.z;
    }
    burstGeo.attributes.position.needsUpdate = true;
    burstMat.color.set(color);
    burstMat.opacity = 1;
    burst.visible = true;
    burstActive = true;
    burstLife = 0;
  }

  /* ----------------------------------------------------------
   * 摆动动画（被拾取道具轻轻摇晃后复位）
   * ---------------------------------------------------------- */
  let swing = null;   // { obj, time, dur }
  const SWING_DUR = 1.1;

  function startSwing(root) {
    swing = { obj: root, time: 0, dur: SWING_DUR };
  }

  /* ----------------------------------------------------------
   * 手绘文字弹窗（屏幕坐标，靠近被拾取道具）
   * ---------------------------------------------------------- */
  let popupEl = null;
  function showPopup(text, x, y) {
    if (!popupEl) {
      popupEl = document.createElement('div');
      popupEl.id = 'popup';
      document.body.appendChild(popupEl);
    }
    popupEl.textContent = text;
    const w = popupEl.offsetWidth || 150;
    popupEl.style.left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8) + 'px';
    popupEl.style.top = Math.max(8, y - 90) + 'px';
    popupEl.classList.remove('show');
    void popupEl.offsetWidth;              // 强制重绘，重启动画
    popupEl.classList.add('show');
    clearTimeout(popupEl._t);
    popupEl._t = setTimeout(() => popupEl.classList.remove('show'), 1800);
  }

  /** 世界坐标 → 屏幕坐标 */
  function worldToScreen(p) {
    const v = p.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  /* ----------------------------------------------------------
   * 拾取处理
   * ---------------------------------------------------------- */
  function handlePick(data, point, root) {
    // 画廊展品：粒子反馈 + 打开详细介绍面板
    if (data.type === 'gallery') {
      spawnBurst(point, '#f5e3a0');
      if (handlers.onGallery) handlers.onGallery(data);
      return;
    }
    // 寻物任务：信物拾取 / NPC 对话 / 目标面板提示
    if (data.type === 'quest') {
      spawnBurst(point, data.color || '#ffe9b0');
      if (handlers.onQuest) handlers.onQuest(data, point);
      return;
    }
    if (data.type === 'npc') {
      spawnBurst(point, '#e8f5d0');
      if (handlers.onNpc) handlers.onNpc(data, point);
      return;
    }
    if (data.type === 'panel') {
      spawnBurst(point, '#f5e3a0');
      if (handlers.onPanel) handlers.onPanel(data, point);
      return;
    }
    // 粒子爆发
    spawnBurst(point, BURST_COLOR[data.id] || '#ffe9b0');
    // 摆动动画（仅带 swing 类型的整体道具）
    if (data.type === 'swing' && root) startSwing(root);
    // 手绘文字弹窗（投影到屏幕，靠近道具）
    const scr = worldToScreen(point);
    const msg = POPUP_MSG[data.id] || '哇，好可爱！';
    showPopup(`${data.label}\n${msg}`, scr.x, scr.y);
  }

  /** 屏幕坐标 → NDC → 射线，返回命中信息（不执行交互） */
  function cast(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const meshes = interactables.map((i) => i.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const entry = interactables.find((i) => i.mesh === hit.object);
    if (!entry) return null;
    const data = entry.root.userData.interactive;

    // 命中点：实例化网格用实例矩阵求世界坐标，普通网格直接用交点
    let point;
    if (hit.instanceId !== undefined && hit.object.isInstancedMesh) {
      const m = new THREE.Matrix4();
      hit.object.getMatrixAt(hit.instanceId, m);
      point = new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(hit.object.matrixWorld);
    } else {
      point = hit.point;
    }
    return { data, point, root: entry.root };
  }

  /** 屏幕坐标 → 射线拾取 */
  function pickAt(clientX, clientY) {
    const r = cast(clientX, clientY);
    if (!r) return null;
    handlePick(r.data, r.point, r.root);
    return r.data;
  }

  /** 纯探测：只返回命中交互数据（用于光标/准星反馈），不触发任何交互 */
  function probe(clientX, clientY) {
    const r = cast(clientX, clientY);
    return r ? r.data : null;
  }

  /** FPS 锁定时 E 键：拾取屏幕中心 */
  function pickCenter() {
    return pickAt(window.innerWidth / 2, window.innerHeight / 2);
  }

  /** 每帧更新：爆发粒子物理 + 摆动动画 */
  function update(dt) {
    // 粒子爆发
    if (burstActive) {
      burstLife += dt;
      if (burstLife >= BURST_DUR) {
        burstActive = false;
        burst.visible = false;
      } else {
        const g = -5;
        for (let i = 0; i < BURST_N; i++) {
          burstVel[i * 3 + 1] += g * dt;
          burstPos[i * 3]     += burstVel[i * 3] * dt;
          burstPos[i * 3 + 1] += burstVel[i * 3 + 1] * dt;
          burstPos[i * 3 + 2] += burstVel[i * 3 + 2] * dt;
        }
        burstGeo.attributes.position.needsUpdate = true;
        burstMat.opacity = 1 - burstLife / BURST_DUR;
      }
    }
    // 摆动动画
    if (swing) {
      swing.time += dt;
      const t = swing.time / swing.dur;
      if (t >= 1) {
        swing.obj.rotation.z = 0;
        swing = null;
      } else {
        const decay = 1 - t;
        swing.obj.rotation.z = Math.sin(t * Math.PI * 6) * 0.12 * decay;
      }
    }
  }

  /** 清除交互状态（场景重置时调用） */
  function reset() {
    burstActive = false;
    burst.visible = false;
    if (swing) { swing.obj.rotation.z = 0; swing = null; }
    if (popupEl) popupEl.classList.remove('show');
  }

  return { pickAt, pickCenter, probe, update, reset, burstAt: spawnBurst };
}
