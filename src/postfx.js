/**
 * ============================================================
 *  postfx.js —— Lusion 绘本风后期滤镜
 *  ------------------------------------------------------------
 *  处理链：
 *   RenderPass → OutlinePass(卡通描边) → UnrealBloomPass(极弱高光)
 *            → PictureBookPass(暗角/色彩弥散/纸张颗粒/柔化高光/压对比度)
 *            → OutputPass
 * ============================================================
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { makePaperTexture } from './shaders.js';
/**
 * 绘本调色Pass：分层后期滤镜，复刻绘本朦胧温柔基调
 *  - uVignette 暗角：边缘压暗，聚拢视线
 *  - uChroma   色彩弥散：边缘 RGB 轻微错位，模拟纸质油墨
 *  - uGrain    纸张颗粒：叠加纸纤维噪点
 *  - uSoft     柔化高光：压住高光发白糊化
 *  - uContrast 压低对比度：整体更柔和
 */
const PictureBookShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.12 },       // 暗角强度（低多边形清新风：几乎无暗角）
    uChroma: { value: 0.0002 },       // 色彩弥散（像素偏移比例，近无）
    uGrain: { value: 0.006 },         // 纸张颗粒（更干净通透，接近写实质感）
    uSoft: { value: 0.04 },           // 柔化高光（极弱，保留清晰边缘）
    uContrast: { value: 0.012 },      // 对比度压缩量（保留更多对比，画面更扎实）
    uPaper: { value: makePaperTexture() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uChroma;
    uniform float uGrain;
    uniform float uSoft;
    uniform float uContrast;
    uniform sampler2D uPaper;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 center = vec2(0.5);
      vec2 dir = uv - center;
      float dist = length(dir);

      // ---- 1. 色彩弥散：离中心越远 RGB 偏移越大（油墨错位）----
      float ca = uChroma * dist * 3.0;
      float r = texture2D(tDiffuse, uv + dir * ca).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir * ca).b;
      vec3 col = vec3(r, g, b);

      // ---- 2. 柔化高光：把过亮区域往中间灰度压，去掉刺眼发白 ----
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float hot = smoothstep(0.72, 1.0, lum);
      vec3 softed = col / (1.0 + col);            // 柔和压缩映射
      col = mix(col, softed, hot * uSoft);

      // ---- 3. 压低对比度：整体向中灰靠拢，画面更柔和 ----
      col = mix(vec3(0.5), col, 1.0 - uContrast);

      // ---- 3.5 微分离色调：暗部偏冷、高光偏暖（极弱，保持画面干净）----
      float lum2 = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 coolTone = vec3(0.985, 0.992, 1.005);
      vec3 warmTone = vec3(1.008, 1.003, 0.995);
      col *= mix(coolTone, warmTone, clamp(lum2 * 1.7, 0.0, 1.0));

      // ---- 4. 暗角 ----
      float vig = 1.0 - uVignette * smoothstep(0.35, 0.95, dist);
      col *= vig;

      // ---- 5. 纸张颗粒：纸纤维纹理叠加 ----
      float grain = texture2D(uPaper, uv * 1.8).r;
      col += (grain - 0.5) * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
/**
 * 初始化后期处理链
 * @returns {object} { composer, bloomPass, outlinePass, picturePass }
 */
export function setupPostFX(renderer, scene, camera) {
  const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // 卡通描边：对场景中的主要物体描边
  const outlinePass = new OutlinePass(size, scene, camera);
  outlinePass.edgeStrength = 1.1;
  outlinePass.edgeGlow = 0.0;
  outlinePass.edgeThickness = 1.0;
  outlinePass.pulsePeriod = 0;
  outlinePass.visibleEdgeColor.set('#4a4038');
  outlinePass.hiddenEdgeColor.set('#4a4038');
  composer.addPass(outlinePass);
  // 柔化高光：压至极弱，几乎无泛光
  const bloomPass = new UnrealBloomPass(size, 0.04, 0.25, 0.97);
  composer.addPass(bloomPass);
  // 绘本调色（现在仅透传颜色）
  const picturePass = new ShaderPass(PictureBookShader);
  composer.addPass(picturePass);
  // 输出（色调映射 + sRGB 编码）
  composer.addPass(new OutputPass());
  return { composer, bloomPass, outlinePass, picturePass };
}
/** 设置需要描边的物体列表 */
export function setOutlineObjects(outlinePass, objects) {
  const meshes = [];
  function collect(obj) {
    if (obj.isMesh) meshes.push(obj);
    if (obj.children) obj.children.forEach(collect);
  }
  objects.forEach(collect);
  outlinePass.selectedObjects = meshes;
}
