/**
 * verify-shadow-coverage.mjs
 * ------------------------------------------------------------------
 * 校验"阴影窗口固定在世界中心"的修复：场景圆盘（半径90）上所有点，
 * 无论相机/玩家站在哪里，都必须落在方向光阴影相机的视锥内（NDC ∈ [-1,1]³）。
 * 算法与 three.js LightShadow.updateMatrices + WebGLShadowMap 完全一致：
 *   shadowCamera.position = light.position（= target + SUN_DIR*100）
 *   shadowCamera.lookAt(light.target)
 *   proj = shadowCamera.projectionMatrix * shadowCamera.matrixWorldInverse
 * 用法：node scripts/verify-shadow-coverage.mjs
 */
import * as THREE from 'three';

const SUN_DIR = new THREE.Vector3(10, 16, 6).normalize();
const DISC_R = 90;                       // 场景圆盘半径（buildTerrainGeometry 默认）
const SAMPLE_YS = [-0.4, 0, 0.5, 2, 4, 8, 12];  // 地面最低点 ~ 高物（树/屋/山丘）顶点
const LIGHT_DIST = 100;                  // 太阳到目标点的距离（main.js 固定值）

function makeShadowMatrices({ left, right, top, bottom, near, far, targetX, targetZ }) {
  const sun = new THREE.DirectionalLight();
  sun.target = new THREE.Object3D();
  sun.target.position.set(targetX, 0, targetZ);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, LIGHT_DIST);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();

  const cam = sun.shadow.camera;
  cam.left = left; cam.right = right; cam.top = top; cam.bottom = bottom;
  cam.near = near; cam.far = far;
  cam.updateProjectionMatrix();
  cam.position.copy(sun.position);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld();

  const view = new THREE.Matrix4().copy(cam.matrixWorld).invert();
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, view);
}

/** 统计圆盘上超出阴影视锥的点 */
function coverage(proj, label) {
  let outside = 0, total = 0, worst = null;
  const steps = 40; // 径向
  for (let i = 0; i <= steps; i++) {
    const r = DISC_R * i / steps;
    const nTheta = Math.max(8, Math.round(2 * Math.PI * r / 4));
    for (let t = 0; t < nTheta; t++) {
      const th = t / nTheta * Math.PI * 2;
      const x = r * Math.cos(th), z = r * Math.sin(th);
      for (const y of SAMPLE_YS) {
        const q = new THREE.Vector3(x, y, z).applyMatrix4(proj);
        total++;
        if (q.x < -1 || q.x > 1 || q.y < -1 || q.y > 1 || q.z < -1 || q.z > 1) {
          outside++;
          if (!worst) worst = { x: +x.toFixed(1), y, z: +z.toFixed(1), ndc: q.toArray().map(v => +v.toFixed(3)) };
        }
      }
    }
  }
  console.log(`${label.padEnd(46)} 视锥外点数: ${outside}/${total}${worst ? '   例: ' + JSON.stringify(worst) : ''}`);
  return outside;
}

console.log('SUN_DIR =', SUN_DIR.toArray().map(v => v.toFixed(3)).join(', '));
console.log('--- 修复后：窗口 ±100 / far 200 / 目标固定在世界中心(0,0,0) ---');
coverage(makeShadowMatrices({ left: -100, right: 100, top: 100, bottom: -100, near: 0.5, far: 200, targetX: 0, targetZ: 0 }), '相机在世界任意位置');

console.log('--- 修复前对照：窗口 ±90 / far 100 / 目标固定(0,0,0)：仅 far 过紧的影响 ---');
coverage(makeShadowMatrices({ left: -90, right: 90, top: 90, bottom: -90, near: 0.5, far: 100, targetX: 0, targetZ: 0 }), '窗口居中但 far=100');

console.log('--- 修复前对照：窗口 ±90 / far 100 / 目标跟随玩家到 (40,0)：窗口跟随的后果 ---');
coverage(makeShadowMatrices({ left: -90, right: 90, top: 90, bottom: -90, near: 0.5, far: 100, targetX: 40, targetZ: 0 }), '玩家走到 (40,0) 时');
coverage(makeShadowMatrices({ left: -90, right: 90, top: 90, bottom: -90, near: 0.5, far: 100, targetX: -40, targetZ: 0 }), '玩家走到 (-40,0) 时');
