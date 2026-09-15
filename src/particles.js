/**
 * ============================================================
 *  particles.js —— 童话氛围粒子系统
 *  ------------------------------------------------------------
 *  四种粒子：
 *   - 花瓣   ：粉色花瓣缓慢飘落 + 旋转
 *   - 水雾   ：溪流上方低空漂浮的白色雾团
 *   - 萤火虫 ：暖黄色光点，夜晚更亮、无规律游动
 *   - 波光   ：溪流表面高频闪光点（独立于水面shader）
 *  全部使用 THREE.Points + BufferGeometry，CPU 更新位置。
 * ============================================================
 */
import * as THREE from 'three';
import { makeGlowTexture, makePetalTexture } from './shaders.js';

/** 随机数工具 */
const rand = (a, b) => a + Math.random() * (b - a);

/**
 * 创建全部粒子系统
 * @returns {object} { update(dt, time, atmoIndex) } —— 每帧更新
 */
export function createParticles(scene) {
  const all = {};

  /* ----------------------------------------------------------
   * 1. 花瓣飘落
   * ---------------------------------------------------------- */
  const petalCount = 90;
  const petalGeo = new THREE.BufferGeometry();
  const petalPos = new Float32Array(petalCount * 3);
  const petalSeed = new Float32Array(petalCount * 3); // 每片花瓣随机参数
  const petalSizes = new Float32Array(petalCount);
  for (let i = 0; i < petalCount; i++) {
    petalPos[i * 3] = rand(-20, 20);
    petalPos[i * 3 + 1] = rand(2, 12);
    petalPos[i * 3 + 2] = rand(-20, 20);
    petalSeed[i * 3] = rand(0, Math.PI * 2);      // 摆动相位
    petalSeed[i * 3 + 1] = rand(0.4, 1.4);        // 摆动幅度
    petalSeed[i * 3 + 2] = rand(0.3, 0.9);        // 下落速度
    petalSizes[i] = rand(0.14, 0.32);
  }
  petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  petalGeo.setAttribute('aSeed', new THREE.BufferAttribute(petalSeed, 3));
  petalGeo.setAttribute('aSize', new THREE.BufferAttribute(petalSizes, 1));
  const petalMat = new THREE.PointsMaterial({
    map: makePetalTexture(),
    size: 0.35, sizeAttenuation: true,
    transparent: true, depthWrite: false,
    opacity: 0.95, color: '#f2a7bb',
    blending: THREE.NormalBlending,
  });
  const petals = new THREE.Points(petalGeo, petalMat);
  scene.add(petals);
  all.petals = { points: petals, pos: petalPos, seed: petalSeed, n: petalCount };

  /* ----------------------------------------------------------
   * 2. 水雾（溪流附近）
   * ---------------------------------------------------------- */
  const mistCount = 46;
  const mistGeo = new THREE.BufferGeometry();
  const mistPos = new Float32Array(mistCount * 3);
  for (let i = 0; i < mistCount; i++) {
    mistPos[i * 3] = rand(0, 4);       // 溪流 x 附近
    mistPos[i * 3 + 1] = rand(0.2, 1.4);
    mistPos[i * 3 + 2] = rand(-17, 17);
  }
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
  const mistMat = new THREE.PointsMaterial({
    map: makeGlowTexture(),
    size: 1.6, sizeAttenuation: true,
    transparent: true, depthWrite: false,
    opacity: 0.18, color: '#ffffff',
    blending: THREE.NormalBlending,
  });
  const mist = new THREE.Points(mistGeo, mistMat);
  mist.position.set(2.2, 0, 0);
  scene.add(mist);
  all.mist = { points: mist, pos: mistPos, n: mistCount };

  /* ----------------------------------------------------------
   * 3. 萤火虫（夜晚最亮）
   * ---------------------------------------------------------- */
  const bugCount = 70;
  const bugGeo = new THREE.BufferGeometry();
  const bugPos = new Float32Array(bugCount * 3);
  const bugBase = new Float32Array(bugCount * 3);  // 围绕的中心位置
  const bugSeed = new Float32Array(bugCount * 3);  // 游动参数
  for (let i = 0; i < bugCount; i++) {
    const bx = rand(-16, 16), by = rand(0.6, 3.2), bz = rand(-16, 16);
    bugBase[i * 3] = bx; bugBase[i * 3 + 1] = by; bugBase[i * 3 + 2] = bz;
    bugPos[i * 3] = bx; bugPos[i * 3 + 1] = by; bugPos[i * 3 + 2] = bz;
    bugSeed[i * 3] = rand(0, Math.PI * 2);
    bugSeed[i * 3 + 1] = rand(0.5, 1.5);
    bugSeed[i * 3 + 2] = rand(0, Math.PI * 2);
  }
  bugGeo.setAttribute('position', new THREE.BufferAttribute(bugPos, 3));
  const bugMat = new THREE.PointsMaterial({
    map: makeGlowTexture(),
    size: 0.42, sizeAttenuation: true,
    transparent: true, depthWrite: false,
    color: '#f6e58d',
    blending: THREE.AdditiveBlending,
  });
  const bugs = new THREE.Points(bugGeo, bugMat);
  scene.add(bugs);
  all.bugs = { points: bugs, pos: bugPos, base: bugBase, seed: bugSeed, n: bugCount };

  /* ----------------------------------------------------------
   * 4. 溪流波光（闪亮小点）
   * ---------------------------------------------------------- */
  const sparkCount = 120;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(sparkCount * 3);
  for (let i = 0; i < sparkCount; i++) {
    sparkPos[i * 3] = rand(-1.4, 1.4);
    sparkPos[i * 3 + 1] = 0.25;
    sparkPos[i * 3 + 2] = rand(-17, 17);
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    map: makeGlowTexture(),
    size: 0.3, sizeAttenuation: true,
    transparent: true, depthWrite: false,
    color: '#ffffff',
    blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.position.set(2.2, 0, 0);
  scene.add(sparks);
  all.sparks = { points: sparks, pos: sparkPos, n: sparkCount };

  /* ----------------------------------------------------------
   * 每帧更新
   * ---------------------------------------------------------- */
  function update(dt, time) {
    // 花瓣：下落 + 水平摆动，触地重生
    const p = all.petals;
    for (let i = 0; i < p.n; i++) {
      const j = i * 3;
      p.pos[j + 1] -= p.seed[j + 2] * dt * 0.8;                       // 下落
      p.pos[j] += Math.sin(time * 1.2 + p.seed[j]) * p.seed[j + 1] * dt * 0.5; // 水平摆动
      p.pos[j + 2] += Math.cos(time * 0.9 + p.seed[j] * 2) * p.seed[j + 1] * dt * 0.3;
      if (p.pos[j + 1] < 0.05) {
        p.pos[j + 1] = rand(8, 12);
        p.pos[j] = rand(-20, 20);
        p.pos[j + 2] = rand(-20, 20);
      }
    }
    p.points.geometry.attributes.position.needsUpdate = true;

    // 水雾：缓慢横向漂移
    const m = all.mist;
    for (let i = 0; i < m.n; i++) {
      m.pos[i * 3] += dt * 0.15 * Math.sin(i);
      if (m.pos[i * 3] > 4.5) m.pos[i * 3] = 0;
    }
    m.points.geometry.attributes.position.needsUpdate = true;

    // 萤火虫：围绕基点做 Lissajous 式游动
    const b = all.bugs;
    for (let i = 0; i < b.n; i++) {
      const j = i * 3;
      b.pos[j]     = b.base[j]     + Math.sin(time * b.seed[j + 1] * 0.6 + b.seed[j]) * 1.2;
      b.pos[j + 1] = b.base[j + 1] + Math.sin(time * b.seed[j + 1] * 0.8 + b.seed[j] * 2) * 0.4;
      b.pos[j + 2] = b.base[j + 2] + Math.cos(time * b.seed[j + 1] * 0.5 + b.seed[j + 2]) * 1.2;
    }
    b.points.geometry.attributes.position.needsUpdate = true;
  }

  return { update, all };
}
