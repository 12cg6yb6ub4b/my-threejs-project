/**
 * ============================================================
 *  main.js —— 项目入口
 *  ------------------------------------------------------------
 *  职责：
 *   1. 初始化渲染器 / 场景 / 相机 / 天空
 *   2. 组装童话小镇场景 + 氛围粒子
 *   3. 接入后期滤镜与昼夜光照
 *   4. 绑定 UI（氛围切换 / 视角切换 / 截图导出）
 *   5. 启动动画循环
 * ============================================================
 */
import * as THREE from 'three';
import { skyMaterial, lightGradientMaterial, setArtStyle } from './shaders.js';
import { createWorld, makeArtCanvas } from './world.js';
import { createParticles } from './particles.js';
import { createAtmosphere, PRESETS } from './atmosphere.js';
import { setupPostFX, setOutlineObjects } from './postfx.js';
import { createControls } from './controls.js';
import { createInteraction } from './interaction.js';
import { createQuest } from './quest.js';
/* ----------------------------------------------------------
 * 1. 渲染器 / 场景 / 相机
 * ---------------------------------------------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ==========开启阴影==========
renderer.shadowMap.enabled = true;
// BasicShadowMap：阴影贴图使用 RGBA 深度打包格式，自定义着色器的
// SHADOW_BLOCK（3×3 高斯 PCF 软阴影）用 sampler2D 直接采样 .r 合法。
// 注意：不要切到 PCFSoftShadowMap——three r185 在该类型下改用 DepthTexture
// （深度/模板格式），与自定义材质的 sampler2D 采样类型不匹配，WebGL 会
// 拒绝绘制所有接收阴影的物体（建筑墙/屋顶消失），产生
// "Mismatch between texture format and sampler type" 错误。
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.shadowMap.width = 2048;
renderer.shadowMap.height = 2048;

document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#e4eedf', 34, 130);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(-7, 1.7, 7);   // 初始：小镇斜前方
camera.lookAt(0, 2, 0);
/* ----------------------------------------------------------
 * 2. 天空球（内表面渐变）
 * ---------------------------------------------------------- */
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 20), skyMaterial());
scene.add(skyMesh);

// ----------------【全局光源照射渐变罩层】----------------
const gradientGeo = new THREE.SphereGeometry(95, 64, 64);
const gradientMat = lightGradientMaterial();
const gradientMesh = new THREE.Mesh(gradientGeo, gradientMat);
gradientMesh.scale.set(1, 1.15, 1);
scene.add(gradientMesh);

/* ----------------------------------------------------------
 * 2.5 美术风格（默认低多边形清新风；?style=picturebook 切回绘本水彩风）
 * ---------------------------------------------------------- */
const ART_STYLE = new URLSearchParams(location.search).get('style') === 'picturebook' ? 'picturebook' : 'lowpoly';
setArtStyle(ART_STYLE);
/* ----------------------------------------------------------
 * 3. 童话小镇
 * ---------------------------------------------------------- */
const world = createWorld(scene);
/* ----------------------------------------------------------
 * 3.5 寻物任务（星光信物）· 支持 ?quest=off 关闭，保留纯观赏模式
 * ---------------------------------------------------------- */
let quest = null;
const questEnabled = new URLSearchParams(location.search).get('quest') !== 'off';
if (questEnabled) {
  quest = createQuest(scene, world, {
    camera,
    celebrate: (p, c) => { if (interaction) interaction.burstAt(p, c); },  // interaction 在下方创建，回调仅在胜利时调用
  });
}
/* ----------------------------------------------------------
 * 4. 氛围粒子
 * ---------------------------------------------------------- */
const particles = createParticles(scene);
/* ----------------------------------------------------------
 * 5. 后期滤镜（先建，因为氛围要控制辉光强度）
 * ---------------------------------------------------------- */
const postfx = setupPostFX(renderer, scene, camera);
setOutlineObjects(postfx.outlinePass, [world.group]);
postfx.outlinePass.enabled = ART_STYLE === 'picturebook';   // 低多边形风关闭卡通描边
/* ----------------------------------------------------------
 * 6. 昼夜光照氛围
 * ---------------------------------------------------------- */
const atmoButtons = document.querySelectorAll('[data-atmo]');
const atmoNames = ['day', 'dusk', 'night'];
// 收集所有可氛围染色的材质（一次遍历，之后每帧只改 uniform，不重复遍历场景）
const atmoTintMats = new Set();   // pictureBookMaterial：uTint 染色
const atmoWaterMats = new Set();  // waterMaterial：水色
scene.traverse((o) => {
  if (!o.isMesh || !o.material) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats) {
    if (m.uniforms && m.uniforms.uTint) atmoTintMats.add(m);
    if (m.uniforms && m.uniforms.uDeep && m.uniforms.uShallow && m.uniforms.uSparkle) atmoWaterMats.add(m);
  }
});
const atmosphere = createAtmosphere(scene, renderer, postfx.bloomPass, {  skyMesh,
  // p：预设或插值结果；index>=0 为手动切换，-1 为自动流转
  onAtmosphereChange(p, index){
    // 任务信物夜晚发光 + 面板亮度自适应（综合 glowWin 计算暗度）
    const darkness = THREE.MathUtils.clamp((p.glowWin - 0.85) / 0.95, 0, 1);
    if (quest) quest.setNightFactor(darkness);
    gradientMat.uniforms.uLightColor.value.set(p.sky.sunColor);
    gradientMat.uniforms.uShadowColor.value.set(p.sky.top);
    // 罩层强度：按天空顶色对三档预设做反距离加权，自动流转时平滑过渡（调低，减少画面朦胧）
    const tops = [PRESETS[0].sky.top, PRESETS[1].sky.top, PRESETS[2].sky.top];
    const ws = [0.03, 0.045, 0.04];   // 白天 / 黄昏 / 夜晚
    const pColor = new THREE.Color(p.sky.top);
    let total = 0, sum = 0;
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Color(tops[i]);
      const d = Math.abs(c.r - pColor.r) + Math.abs(c.g - pColor.g) + Math.abs(c.b - pColor.b);
      const w = 1 / (d + 0.02);
      total += w;
      sum += w * ws[i];
    }
    gradientMat.uniforms.uIntensity.value = sum / total;
    // 氛围染色：地面/建筑/植被乘 uTint（白天白/黄昏暖/夜晚冷暗），并同步高光/暗部色
    const tint = new THREE.Color(p.tint || '#ffffff');
    atmoTintMats.forEach((m) => {
      m.uniforms.uTint.value.copy(tint);
      // 高光/暗部随氛围切换（黄昏暖高光、夜晚冷蓝高光），让物体保持明暗层次
      if (m.uniforms.uLightTop && p.lightTop) m.uniforms.uLightTop.value.set(p.lightTop);
      if (m.uniforms.uLightBottom && p.lightBottom) m.uniforms.uLightBottom.value.set(p.lightBottom);
    });
    if (p.waterDeep) {
      const wDeep = new THREE.Color(p.waterDeep), wShallow = new THREE.Color(p.waterShallow), wSpark = new THREE.Color(p.waterSparkle);
      atmoWaterMats.forEach((m) => {
        m.uniforms.uDeep.value.copy(wDeep);
        m.uniforms.uShallow.value.copy(wShallow);
        m.uniforms.uSparkle.value.copy(wSpark);
      });
    }
    // 粒子透明度随氛围平滑变化
    particles.all.bugs.points.material.opacity = p.bugOpacity;
    particles.all.sparks.points.material.opacity = p.sparkOpacity;
    // 手动切换时同步按钮高亮
    if (index >= 0) {
      atmoButtons.forEach((b) => b.classList.toggle('active', b.dataset.atmo === p.name));
    }
  }
});
// 主光源固定方向（阴影窗口固定在世界中心，太阳方向保持不变）
const SUN_DIR = new THREE.Vector3().copy(PRESETS[0].sun.pos).normalize();
/* ----------------------------------------------------------
 * 6.5 射线拾取交互（先于控制器，供触屏轻点 / E 键回调）
 * ---------------------------------------------------------- */
/* ---- 展品详情面板（虚拟展厅/艺术馆：点击展品查看详细介绍） ---- */
const galleryPanel = document.getElementById('galleryPanel');
const gpArtEl = document.getElementById('gpArt');
const gpTitleEl = document.getElementById('gpTitle');
const gpDescEl = document.getElementById('gpDesc');
function openGallery(data) {
  gpArtEl.innerHTML = '';
  gpArtEl.appendChild(makeArtCanvas(data.key));        // 画作大图（重新生成，保证像素完整）
  gpTitleEl.textContent = data.title;
  gpDescEl.textContent = data.desc;
  galleryPanel.classList.add('show');
  // 解锁指针锁定，让用户可以点击"收起介绍"（双重保险覆盖 safeLock 异步请求）
  if (controls && controls.fps && controls.fps.isLocked) controls.fps.unlock();
  setTimeout(() => {
    if (controls && controls.fps && controls.fps.isLocked) controls.fps.unlock();
  }, 250);
}
function closeGallery() {
  galleryPanel.classList.remove('show');
  gpArtEl.innerHTML = '';                              // 清空画作，避免残留 canvas 干扰
}
document.getElementById('gpClose').addEventListener('click', closeGallery);
galleryPanel.addEventListener('click', (e) => {
  if (e.target === galleryPanel) closeGallery();   // 点击遮罩关闭
});
const interaction = createInteraction(scene, camera, renderer, world, {
  onGallery: openGallery,
  onQuest: (data, point) => { if (quest) quest.collect(data.itemId); },
  onNpc: () => { if (quest) quest.talkToNpc(); },
  onPanel: (data) => { if (quest) quest.showItemHint(data.itemId); },
});
/* ----------------------------------------------------------
 * 7. 交互控制
 * ---------------------------------------------------------- */
const controls = createControls(camera, renderer.domElement, world.terrainHeight, {
  colliders: world.colliders,                   // 物体碰撞体（树/建筑/NPC/面板，防穿模）
  onPick: (x, y) => interaction.pickAt(x, y),          // 移动端轻点拾取
  onInteract: () => {                                   // FPS 锁定时 E 键中心拾取
    if (quest && quest.isDialogOpen()) return;          // 对话中 E 只推进对话
    const r = interaction.pickCenter();
    if (!r && quest) quest.tryProximity();              // 没瞄中但靠近 NPC 时兜底
  },
  onProbe: (x, y) => interaction.probe(x, y),           // 光标/准星探测（只检测不触发）
});
/* ----------------------------------------------------------
 * 8. UI 绑定
 * ---------------------------------------------------------- */
const viewButtons = document.querySelectorAll('[data-view]');
// 支持 URL 参数直达氛围/视角：?atmo=night&view=orbit
(function applyUrlParams() {
  const params = new URLSearchParams(location.search);
  const a = params.get('atmo');
  const v = params.get('view');
  if (a && atmoNames.includes(a)) {
    const idx = atmoNames.indexOf(a);
    atmosphere.setAuto(false);
    document.getElementById('btnAuto').classList.remove('active');
    atmosphere.apply(idx);
  }
  if (v && ['fps', 'orbit'].includes(v)) {
    controls.setMode(v);
    viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    document.getElementById('hint').style.opacity = v === 'fps' ? 1 : 0.25;
  }
})();
function bindUI() {
  // 氛围切换（手动选择时暂停自动流转）
  atmoButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = atmoNames.indexOf(btn.dataset.atmo);
      atmosphere.setAuto(false);
      document.getElementById('btnAuto').classList.remove('active');
      atmosphere.apply(idx);
    });
  });
  // 自动流转开关（默认开启，环境随时间循环变化）
  const btnAuto = document.getElementById('btnAuto');
  btnAuto.classList.add('active');
  btnAuto.addEventListener('click', () => {
    const on = !btnAuto.classList.contains('active');
    btnAuto.classList.toggle('active', on);
    atmosphere.setAuto(on);
  });
  // 视角切换
  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.view;
      controls.setMode(m);
      viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === m));
      document.getElementById('hint').style.opacity = m === 'fps' ? 1 : 0.25;
    });
  });
  // 工具按钮已删除，相关事件监听一并移除
}
bindUI();
/* ----------------------------------------------------------
 * 9. 截图导出（绘本风效果图）
 * ---------------------------------------------------------- */
let pendingShot = false;
function captureShot() {
  pendingShot = true;
}
/* ----------------------------------------------------------
 * 10. 动画循环（THREE.Clock 已弃用，改用 performance.now 计时）
 * ---------------------------------------------------------- */
let lastTick = performance.now();
let elapsed = 0;
// 云朵浮动数据
const cloudGroups = world.clouds.children.map((c) => ({
  mesh: c,
  baseY: c.userData.baseY ?? c.position.y,
  phase: Math.random() * Math.PI * 2,
}));
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;
  elapsed += dt;
  // 更新所有自定义着色器的 uTime（水彩/纸张/水波动态）
  scene.traverse((obj) => {
    if (obj.isMesh && obj.material && obj.material.uniforms && obj.material.uniforms.uTime) {
      obj.material.uniforms.uTime.value = elapsed;
    }
  });

  // 全局渐变：跟随太阳光方向（固定方向，不随阴影窗口平移）
  gradientMat.uniforms.uLightDir.value.copy(SUN_DIR);

  // 环境随时间自动流转（白天→黄昏→夜晚→黎明）
  atmosphere.update(dt);

  // 阴影窗口固定在世界中心：太阳方向固定不变，阴影贴图始终覆盖整个场景圆盘（±100），不随相机视角移动
  if (atmosphere.sun) {
    const sun = atmosphere.sun;
    sun.target.position.set(0, 0, 0);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 100);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.shadow.camera.updateProjectionMatrix();
  }

  // 喷泉：水花粒子 + 水柱动画
  if (world.fountain && world.fountain.userData.update) {
    world.fountain.userData.update(dt);
  }
  // 风车叶片旋转
  world.spinners.forEach((s) => { s.obj.rotation.z += dt * s.speed; });

  // 云朵缓慢漂浮
  cloudGroups.forEach((c, i) => {
    c.mesh.position.y = c.baseY + Math.sin(elapsed * 0.15 + c.phase) * 0.5;
    c.mesh.position.x += Math.sin(elapsed * 0.08 + i * 2.1) * 0.002;
  });

  // 星星旋转 + 更新闪烁时间uniform
  atmosphere.stars.rotation.y = elapsed * 0.01;
  if(atmosphere.starMat){
    atmosphere.starMat.uniforms.uTime.value = elapsed;
  }

  // 粒子更新
  particles.update(dt, elapsed);
  // 寻物任务（NPC / 信物动画）
  if (quest) quest.update(dt, elapsed);
  // 交互系统（爆发粒子 + 摆动动画）
  interaction.update(dt);
  // 控制更新
  controls.update(dt, elapsed);
  // 同步手动阴影 uniform（接收阴影材质每帧从太阳拿最新深度贴图与矩阵）
  if (atmosphere.sun && atmosphere.sun.shadow.map) {
    const sun = atmosphere.sun;
    const depthTex = sun.shadow.map.depthTexture;
    const shadowMatrix = sun.shadow.matrix;
    const bias = sun.shadow.bias;
    const intensity = sun.shadow.intensity;
    scene.traverse((obj) => {
      if (obj.isMesh && obj.material && obj.material.uniforms && obj.material.uniforms.uShadowMap) {
        const u = obj.material.uniforms;
        u.uShadowMap.value = depthTex;
        u.uShadowMatrix.value = shadowMatrix;
        u.uShadowBias.value = bias;
        u.uShadowIntensity.value = intensity;
      }
    });
  }
  // 渲染（后期处理链）
  postfx.composer.render();
  // 截图：渲染完成后抓取画布
  if (pendingShot) {
    pendingShot = false;
    renderer.domElement.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lusion-fairy-${atmoNames[atmosphere.current]}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
  // 首帧后隐藏加载遮罩
  if (firstFrame) {
    firstFrame = false;
    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hide');
  }
}
let firstFrame = true;
animate();
/* ----------------------------------------------------------
 * 11. 窗口尺寸自适应
 * ---------------------------------------------------------- */
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  postfx.composer.setSize(w, h);
});
