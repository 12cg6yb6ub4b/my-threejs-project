/**
 * ============================================================
 *  atmosphere.js —— 昼夜氛围切换（白天 / 黄昏 / 夜晚）
 *  ------------------------------------------------------------
 *  每套氛围统一设置：太阳光、半球光、环境光、天空配色、
 *  雾色、辉光强度、萤火虫/波光透明度、星星显隐。
 * ============================================================
 */
import * as THREE from 'three';
import { makeStarTexture } from './shaders.js';
/** 三个氛围预设（数值均为经调试的经验值） */
export const PRESETS = [
  {
    name: 'day',   label: '☀ 白天',
    sun: { color: '#fff6e0', intensity: 2.0, pos: new THREE.Vector3(10, 16, 6) },
    hemi: { sky: '#cfe8ff', ground: '#9db88a', intensity: 0.85 },
    ambient: { color: '#ffffff', intensity: 0.18 },
    sky: { top: '#a8d9ef', horizon: '#eef7ec', sunDir: new THREE.Vector3(0.45, 0.55, 0.35).normalize(), sunColor: '#fff8e0', sunStrength: 0.16 },
    fog: { color: '#e8f0e4', near: 42, far: 160 },
    bloom: { strength: 0.16, radius: 0.5, threshold: 0.9 },
    bugOpacity: 0.25, sparkOpacity: 0.5, stars: 0.0, glowWin: 0.85,
    // ===== 新增：地面/植物/水体颜色预设 =====
    tint: '#ffffff',                   // 全局染色（纯白=无变化）
    lightTop: '#fff8e8',               // 材质高光部色（暖白）
    lightBottom: '#9db8a0',            // 材质暗部色（清冷绿灰）
    waterDeep: '#7fb4c9',              // 溪流深处色
    waterShallow: '#cfe6ee',           // 溪流浅处色
    waterSparkle: '#ffffff',           // 波光颜色
    fill: { color: '#9dbdd8', intensity: 0.30 },   // 相机侧冷色补光
  },
  {
    name: 'dusk',  label: '🌇 黄昏',
    sun: { color: '#ffd9a8', intensity: 1.6, pos: new THREE.Vector3(-12, 3.5, 8) },
    hemi: { sky: '#ffd9b8', ground: '#b08a7a', intensity: 0.75 },
    ambient: { color: '#ffd6ad', intensity: 0.22 },
    sky: { top: '#f0ae8e', horizon: '#ffe9cf', sunDir: new THREE.Vector3(-0.5, 0.12, 0.4).normalize(), sunColor: '#ffb36b', sunStrength: 0.32 },
    fog: { color: '#efc8ae', near: 40, far: 150 },
    bloom: { strength: 0.28, radius: 0.55, threshold: 0.86 },
    bugOpacity: 0.6, sparkOpacity: 0.75, stars: 0.0, glowWin: 1.1,
    // ===== 黄昏暖色调 =====
    tint: '#f7d6a8',                   // 暖金色染色（草地/树冠变暖黄）
    lightTop: '#ffddaa',               // 高光暖橙
    lightBottom: '#b08060',            // 暗部暖棕
    waterDeep: '#b8846a',              // 溪流变暖绿
    waterShallow: '#e6c8a8',           // 浅水暖黄
    waterSparkle: '#ffe0b0',           // 波光泛金
    fill: { color: '#e8b98a', intensity: 0.22 },   // 暖橙补光
  },
  {
    name: 'night', label: '🌙 夜晚',
    sun: { color: '#7f97d6', intensity: 0.7, pos: new THREE.Vector3(-8, 10, -6) },
    hemi: { sky: '#0c1430', ground: '#1a2440', intensity: 0.38 },
    ambient: { color: '#28365c', intensity: 0.16 },
    sky: { top: '#0e1733', horizon: '#3a4a6a', sunDir: new THREE.Vector3(-0.3, 0.5, -0.3).normalize(), sunColor: '#cfe0ff', sunStrength: 0.3 },
    fog: { color: '#3a4c72', near: 30, far: 130 },
    bloom: { strength: 0.45, radius: 0.6, threshold: 0.75 },
    bugOpacity: 1.0, sparkOpacity: 1.0, stars: 1.0, glowWin: 1.8,
    // ===== 夜晚冷色调（提亮染色，保证树木/建筑/花朵仍可见轮廓） =====
    tint: '#98a8c4',                   // 冷蓝灰染色：压暗但保留可见度，树/花/屋轮廓清晰
    lightTop: '#c8d8ee',               // 高光冷蓝（保持亮度，物体明暗层次可见）
    lightBottom: '#788aa8',            // 暗部亮蓝灰
    waterDeep: '#12203a',              // 深水静蓝
    waterShallow: '#2a4660',           // 浅水蓝灰
    waterSparkle: '#5f87b0',           // 波光冷白带蓝
    fill: { color: '#3a4a72', intensity: 0.42 },   // 深蓝补光增强，暗部可见
  },
];
/**
 * 创建并返回氛围控制器
 * @returns {object} { apply(index), current }
 */
export function createAtmosphere(scene, renderer, bloomPass, opts = {}) {
  // 灯光
  const sun = new THREE.DirectionalLight(PRESETS[0].sun.color, PRESETS[0].sun.intensity);
  sun.position.copy(PRESETS[0].sun.pos);
  scene.add(sun);

  // 太阳光阴影设置，仅初始化执行一次
  sun.castShadow = true;
  sun.shadow.mapSize.set(6144, 6144);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;     // 远平面必须大于“太阳→场景最远点”的深度（约153），否则远离太阳一侧收不到阴影
  sun.shadow.camera.left = -100;   // 阴影窗口固定在世界中心（main.js 不再跟随相机），±100 完整覆盖半径90的场景圆盘并留边
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.radius = 4.5;
  sun.shadow.bias = -0.00035;    // 阴影深度偏置：配合法线偏移消条纹；数值过大会让阴影与物体脱开（peter-panning）
  sun.shadow.normalBias = 0.04;  // 底层 Lambert 地面（标准材质路径）沿法线偏移，避免密网格自阴影条纹
  sun.shadow.intensity = 0.85;    // 阴影更实：覆盖全场景后强度提升，体积感更强

  const hemi = new THREE.HemisphereLight(PRESETS[0].hemi.sky, PRESETS[0].hemi.ground, PRESETS[0].hemi.intensity);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(PRESETS[0].ambient.color, PRESETS[0].ambient.intensity);
  scene.add(ambient);
  // 相机侧补光（fill）：为暗部注入冷暖层次，消除"塑料悬浮感"
  const fill = new THREE.DirectionalLight('#9dbdd8', 0.30);
  fill.position.set(-6, 5, -8);
  scene.add(fill);
  // 天空球
  const skyMesh = opts.skyMesh;

  // --------------------------星星【天空球外层，独立闪烁】--------------------------
  const starVertexShader = /*glsl*/`
attribute float aPhase;
attribute float aTwinkle;
varying float vTwinkle;
uniform float uTime;
void main(){
  vec4 mvPos = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mvPos;
  float blink = sin(uTime*1.3 + aPhase) * 0.5 + 0.5;
  vTwinkle = mix(0.35,1.0, blink * aTwinkle);
  gl_PointSize = (1.2) * vTwinkle * (350.0 / -mvPos.z);
}
`;
  const starFragmentShader = /*glsl*/`
precision highp float;
varying float vTwinkle;
uniform sampler2D map;
void main(){
  vec4 col = texture2D(map, gl_PointCoord);
  col.a *= vTwinkle;
  gl_FragColor = col;
}
`;

  const starMat = new THREE.ShaderMaterial({
    uniforms:{
      map:{value:makeStarTexture()},
      uTime:{value:0},
    },
    vertexShader:starVertexShader,
    fragmentShader:starFragmentShader,
    transparent:true,
    depthWrite:false,
    blending:THREE.AdditiveBlending,
  });

  const starGeo = new THREE.BufferGeometry();
  const starCount = 1200;
  const starPos = new Float32Array(starCount * 3);
  const starPhase = new Float32Array(starCount);
  const starTwinkle = new Float32Array(starCount);

  for(let i=0;i<starCount;i++){
    const phi = Math.acos(1 - 2 * Math.random() * 0.58);
    const theta = Math.random() * Math.PI * 2;
    // 天空球半径120，星星放在130‑150外层，不会被天空球遮挡
    const r = 130 + Math.random() * 20;
    starPos[i*3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i*3 + 1] = Math.abs(r * Math.cos(phi));
    starPos[i*3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    starPhase[i] = Math.random() * Math.PI * 2;
    starTwinkle[i] = 0.45 + Math.random() * 0.55;
  }

  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos,3));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhase,1));
  starGeo.setAttribute('aTwinkle', new THREE.BufferAttribute(starTwinkle,1));

  const stars = new THREE.Points(starGeo, starMat);
  stars.visible = false;
  scene.add(stars);
  // --------------------------------------------------------------------------------

  let current = 0;

  /** 把一份“预设对象”（PRESETS 条目或插值结果）统一应用到场景 */
  function applyPreset(p, index) {
    if (index !== undefined && index >= 0) current = index;
    // 灯光
    sun.color.set(p.sun.color);
    sun.intensity = p.sun.intensity;
    sun.position.copy(p.sun.pos);
    hemi.color.set(p.hemi.sky);
    hemi.groundColor.set(p.hemi.ground);
    hemi.intensity = p.hemi.intensity;
    ambient.color.set(p.ambient.color);
    ambient.intensity = p.ambient.intensity;
    // 补光随氛围渐变
    fill.color.set(p.fill.color);
    fill.intensity = p.fill.intensity;
    // 天空
    if (skyMesh && skyMesh.material.uniforms) {
      skyMesh.material.uniforms.uTop.value.set(p.sky.top);
      skyMesh.material.uniforms.uHorizon.value.set(p.sky.horizon);
      skyMesh.material.uniforms.uSunDir.value.copy(p.sky.sunDir);
      skyMesh.material.uniforms.uSunColor.value.set(p.sky.sunColor);
      skyMesh.material.uniforms.uSunStrength.value = p.sky.sunStrength;
    }
    // 雾（就地修改，避免每帧新建对象）
    if (scene.fog) {
      scene.fog.color.set(p.fog.color);
      scene.fog.near = p.fog.near;
      scene.fog.far = p.fog.far;
    } else {
      scene.fog = new THREE.Fog(p.fog.color, p.fog.near, p.fog.far);
    }
    // 辉光
    bloomPass.strength = p.bloom.strength;
    bloomPass.radius = p.bloom.radius;
    bloomPass.threshold = p.bloom.threshold;
    // 星星
    stars.visible = p.stars > 0.5;
    // 窗口发光（夜晚更亮）
    if (opts.windows) {
      opts.windows.forEach((w) => { w.material.opacity = Math.min(1, p.glowWin); });
    }
    // 回调，通知 main 同步渐变罩层 / 粒子透明度 / 按钮状态
    if (opts.onAtmosphereChange) {
      opts.onAtmosphereChange(p, index);
    }
  }

  function apply(index) {
    applyPreset(PRESETS[index], index);
  }

  /* ----------------------------------------------------------
   * 自动时间流转：白天 → 黄昏 → 夜晚 → 黎明 → 白天 循环插值
   * ---------------------------------------------------------- */
  const CYCLE_SECONDS = 110;   // 一个完整昼夜周期时长
  let autoCycle = true;        // 默认开启自动流转
  let autoPhase = 0;           // 相位 [0,1)

  /** 按相位返回需要插值的两个预设与混合系数 */
  function evalPhase(phase) {
    if (phase < 0.32) return { a: PRESETS[0], b: PRESETS[0], t: 0 };          // 白天
    if (phase < 0.50) return { a: PRESETS[0], b: PRESETS[1], t: (phase - 0.32) / 0.18 };  // 白→昏
    if (phase < 0.60) return { a: PRESETS[1], b: PRESETS[1], t: 0 };          // 黄昏
    if (phase < 0.80) return { a: PRESETS[1], b: PRESETS[2], t: (phase - 0.60) / 0.20 };  // 昏→夜
    return { a: PRESETS[2], b: PRESETS[0], t: (phase - 0.80) / 0.20 };        // 夜→黎明
  }

  function update(dt) {
    if (!autoCycle) return;
    autoPhase = (autoPhase + dt / CYCLE_SECONDS) % 1;
    const { a, b, t } = evalPhase(autoPhase);
    applyPreset(lerpPreset(a, b, t), -1);
  }

  function setAuto(on) {
    autoCycle = on;
  }

  // 初始应用白天
  apply(0);
  return { apply, setAuto, update, get current() { return current; }, sun, hemi, ambient, stars, starMat };
}

/* ----------------------------------------------------------
 * 插值工具：把两个 PRESETS 条目按 t∈[0,1] 混合成新预设对象
 * ---------------------------------------------------------- */
function lerp(a, b, t) { return a + (b - a) * t; }
function cLerp(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }
function lerpPreset(a, b, t) {
  return {
    name: 'auto',
    sun: {
      color: cLerp(a.sun.color, b.sun.color, t),
      intensity: lerp(a.sun.intensity, b.sun.intensity, t),
      pos: new THREE.Vector3().lerpVectors(a.sun.pos, b.sun.pos, t),
    },
    hemi: {
      sky: cLerp(a.hemi.sky, b.hemi.sky, t),
      ground: cLerp(a.hemi.ground, b.hemi.ground, t),
      intensity: lerp(a.hemi.intensity, b.hemi.intensity, t),
    },
    ambient: {
      color: cLerp(a.ambient.color, b.ambient.color, t),
      intensity: lerp(a.ambient.intensity, b.ambient.intensity, t),
    },
    fill: {
      color: cLerp(a.fill.color, b.fill.color, t),
      intensity: lerp(a.fill.intensity, b.fill.intensity, t),
    },
    sky: {
      top: cLerp(a.sky.top, b.sky.top, t),
      horizon: cLerp(a.sky.horizon, b.sky.horizon, t),
      sunDir: new THREE.Vector3().lerpVectors(a.sky.sunDir, b.sky.sunDir, t).normalize(),
      sunColor: cLerp(a.sky.sunColor, b.sky.sunColor, t),
      sunStrength: lerp(a.sky.sunStrength, b.sky.sunStrength, t),
    },
    fog: {
      color: cLerp(a.fog.color, b.fog.color, t),
      near: lerp(a.fog.near, b.fog.near, t),
      far: lerp(a.fog.far, b.fog.far, t),
    },
    bloom: {
      strength: lerp(a.bloom.strength, b.bloom.strength, t),
      radius: lerp(a.bloom.radius, b.bloom.radius, t),
      threshold: lerp(a.bloom.threshold, b.bloom.threshold, t),
    },
    bugOpacity: lerp(a.bugOpacity, b.bugOpacity, t),
    sparkOpacity: lerp(a.sparkOpacity, b.sparkOpacity, t),
    stars: lerp(a.stars, b.stars, t),
    glowWin: lerp(a.glowWin, b.glowWin, t),
    // 染色与水色也随氛围平滑过渡（自动流转时生效）
    tint: cLerp(a.tint, b.tint, t),
    lightTop: cLerp(a.lightTop, b.lightTop, t),
    lightBottom: cLerp(a.lightBottom, b.lightBottom, t),
    waterDeep: cLerp(a.waterDeep, b.waterDeep, t),
    waterShallow: cLerp(a.waterShallow, b.waterShallow, t),
    waterSparkle: cLerp(a.waterSparkle, b.waterSparkle, t),
  };
}
/** 供 main.js 读取粒子透明度配置 */
export function particleVisibility(atmoIndex) {
  const p = PRESETS[atmoIndex];
  return { bugOpacity: p.bugOpacity, sparkOpacity: p.sparkOpacity };
}
