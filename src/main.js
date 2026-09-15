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
import { skyMaterial, lightGradientMaterial } from './shaders.js';
import { createWorld, makeArtCanvas } from './world.js';
import { createParticles } from './particles.js';
import { createAtmosphere, PRESETS } from './atmosphere.js';
import { setupPostFX, setOutlineObjects } from './postfx.js';
import { createControls } from './controls.js';
import { createInteraction } from './interaction.js';
/* ----------------------------------------------------------
 * 1. 渲染器 / 场景 / 相机
 * ---------------------------------------------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure =0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ==========开启阴影==========
renderer.shadowMap.enabled = true;
// BasicShadowMap：深度贴图无比较采样，配合自定义着色器手动深度比较，
// 规避 WebKit/SwiftShader 环境下 PCF 比较采样不可靠的问题
renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.shadowMap.width = 2048;
renderer.shadowMap.height = 2048;

document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#e4eedf', 22, 95);
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
 * 3. 童话小镇
 * ---------------------------------------------------------- */
const world = createWorld(scene);
/* ----------------------------------------------------------
 * 4. 氛围粒子
 * ---------------------------------------------------------- */
const particles = createParticles(scene);
/* ----------------------------------------------------------
 * 5. 后期滤镜（先建，因为氛围要控制辉光强度）
 * ---------------------------------------------------------- */
const postfx = setupPostFX(renderer, scene, camera);
setOutlineObjects(postfx.outlinePass, [world.group]);
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
const atmosphere = createAtmosphere(scene, renderer, postfx.bloomPass, {
  skyMesh,
  // p：预设或插值结果；index>=0 为手动切换，-1 为自动流转
  onAtmosphereChange(p, index){
    gradientMat.uniforms.uLightColor.value.set(p.sky.sunColor);
    gradientMat.uniforms.uShadowColor.value.set(p.sky.top);
    // 罩层强度：按天空顶色对三档预设做反距离加权，自动流转时平滑过渡
    const tops = [PRESETS[0].sky.top, PRESETS[1].sky.top, PRESETS[2].sky.top];
    const ws = [0.06, 0.08, 0.05];   // 白天 / 黄昏 / 夜晚
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
    // 氛围染色：地面/建筑/植被乘 uTint（白天白/黄昏暖/夜晚冷暗），水面换色
    const tint = new THREE.Color(p.tint || '#ffffff');
    atmoTintMats.forEach((m) => { m.uniforms.uTint.value.copy(tint); });
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
});
/* ----------------------------------------------------------
 * 7. 交互控制
 * ---------------------------------------------------------- */
const controls = createControls(camera, renderer.domElement, world.terrainHeight, {
  onPick: (x, y) => interaction.pickAt(x, y),          // 移动端轻点拾取
  onInteract: () => interaction.pickCenter(),          // FPS 锁定时 E 键中心拾取
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
  // 截图导出
  document.getElementById('btnShot').addEventListener('click', captureShot);
  // 场景重置：相机回初始位 + 恢复自动流转 + 清理交互状态
  document.getElementById('btnReset').addEventListener('click', () => {
    controls.reset();
    btnAuto.classList.add('active');
    atmosphere.setAuto(true);
    viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === 'fps'));
    document.getElementById('hint').style.opacity = 1;
    interaction.reset();
  });
  // 帮助：切换提示显隐
  let hintVisible = true;
  document.getElementById('btnHint').addEventListener('click', () => {
    hintVisible = !hintVisible;
    document.getElementById('hint').style.opacity = hintVisible ? 1 : 0;
  });
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

  // 全局渐变：跟随太阳光方向
  if(atmosphere.sun){
    gradientMat.uniforms.uLightDir.value.copy(atmosphere.sun.position).normalize();
  }

  // 环境随时间自动流转（白天→黄昏→夜晚→黎明）
  atmosphere.update(dt);

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
