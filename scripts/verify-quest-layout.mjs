/**
 * verify-quest-layout.mjs
 * ------------------------------------------------------------------
 * 校验新的“守林人 NPC + 4 块目标面板”布局：
 *  1) 全部元素避开凉亭（(-2,4.8), 碰撞 r=1.8 + 0.75 安全边距）及其它建筑碰撞体
 *  2) 全部元素落在植被避让平台内（NPC 平台：以 NPC_POS 为中心 r=6.5，避免树/灌木穿模）
 *  3) 溪流走廊外、干地
 *  4) 从出生点相机 (-7,1.7,7) 看向 (0,2,0) 时，所有元素在水平视锥内且互不遮挡
 * 用法：node scripts/verify-quest-layout.mjs
 */
import * as THREE from 'three';

// ---- 与 quest.js 一致的常量 ----
const ITEMS_N = 4;
const SPAWN = { x: -7, z: 7 };
const CAM = new THREE.Vector3(-7, 1.7, 7);
const CAM_TARGET = new THREE.Vector3(0, 2, 0);

// ---- 建筑碰撞体（world.js） ----
const COLLIDERS = [
  { x: 3.0, z: -8.5, r: 2.3 },   // 主屋
  { x: -2.0, z: 4.8, r: 1.8 },   // 凉亭
  { x: -4.8, z: -11.2, r: 1.25 },// 古树
  { x: 13, z: 4, r: 2.4 },       // 喷泉
  { x: 15.5, z: -7.5, r: 1.55 }, // 风车塔
  { x: -14.5, z: 9.5, r: 1.4 },  // 钟楼
  { x: -13.5, z: -4.5, r: 1.6 }, // 小民居1
  { x: 12.5, z: 13.5, r: 1.5 },  // 小民居2
  { x: -19, z: -23, r: 2.1 },    // 谷仓
  { x: 23, z: -21, r: 1.9 },     // 蘑菇屋
];
for (const gx of [-13, -10.5, -8, -5.5]) COLLIDERS.push({ x: gx, z: 25, r: 1.15 }); // 画廊画架
const PAVILION = COLLIDERS.find(c => c.x === -2.0 && c.z === 4.8);

function streamX(z) { return 2.2 + Math.sin(z * 0.22) * 20; }

// 面板弧线计算（与 quest.js 同式：f 从 NPC 指向出生点）
function panelPositions(npc, forward, spacing) {
  const fx = SPAWN.x - npc.x, fz = SPAWN.z - npc.z;   // NPC → 出生点
  const fl = Math.hypot(fx, fz);
  const ux = fx / fl, uz = fz / fl;                    // 朝向出生点
  const px = uz, pz = -ux;                             // 垂直方向
  const out = [];
  for (let idx = 0; idx < ITEMS_N; idx++) {
    out.push({
      x: npc.x + ux * forward + px * (idx - 1.5) * spacing,
      z: npc.z + uz * forward + pz * (idx - 1.5) * spacing,
    });
  }
  return out;
}

// 屏幕投影：返回 screenX（右侧为正，以水平半 FOV 归一化 -1..1）与深度
// 相机 FOV=60°（垂直），按 16:9 折算水平半角
const H_ASPECT = 16 / 9;
const H_HALF_TAN = Math.tan(THREE.MathUtils.degToRad(30)) * H_ASPECT;
function project(x, z) {
  const d = CAM_TARGET.clone().sub(CAM).normalize();
  const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  const p = new THREE.Vector3(x, 0, z).sub(CAM);
  const depth = p.dot(d);
  const sx = p.dot(right) / (depth * H_HALF_TAN);
  return { sx, depth };
}

function check(npcPos, { forward, spacing, label }) {
  const issues = [];
  const npc = { x: npcPos.x, z: npcPos.z };
  const panels = panelPositions(npc, forward, spacing);

  // 1) 建筑碰撞体（NPC 额外 +0.6，面板 +0.75 安全边距）
  for (const c of COLLIDERS) {
    const dn = Math.hypot(npc.x - c.x, npc.z - c.z);
    if (dn < c.r + 0.6) issues.push(`NPC 与建筑(${c.x},${c.z})距离 ${dn.toFixed(2)} < ${(c.r + 0.6).toFixed(2)}`);
    panels.forEach((p, i) => {
      const dp = Math.hypot(p.x - c.x, p.z - c.z);
      if (dp < c.r + 0.75) issues.push(`面板${i} 与建筑(${c.x},${c.z})距离 ${dp.toFixed(2)} < ${(c.r + 0.75).toFixed(2)}`);
    });
  }

  // 2) 植被平台：以新 NPC 位置为圆心 r6.5（对应 world.js PLATFORMS）
  for (const p of [npc, ...panels]) {
    const d = Math.hypot(p.x - npc.x, p.z - npc.z);
    if (d > 6.5) issues.push(`(${p.x.toFixed(1)},${p.z.toFixed(1)}) 超出植被平台 ${d.toFixed(1)}`);
  }

  // 3) 溪流走廊（|x - streamX| < 5 为水面走廊）
  for (const p of [npc, ...panels]) {
    if (Math.abs(p.x - streamX(p.z)) < 5.0) issues.push(`(${p.x.toFixed(1)},${p.z.toFixed(1)}) 落入溪流走廊`);
  }

  // 4) 视锥内 + 互不遮挡（屏幕 x 归一化；面板板面宽 1.02 → 半宽 0.51 世界单位投影）
  const proj = [npc, ...panels].map(p => ({ ...p, ...project(p.x, p.z) }));
  for (const p of proj) {
    if (Math.abs(p.sx) > 1.0) issues.push(`(${p.x.toFixed(1)},${p.z.toFixed(1)}) 出屏 sx=${p.sx.toFixed(2)}`);
  }
  // 面板间水平重叠（同深度近似；面板半宽 0.51+0.51=1.02 世界宽）
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const d = Math.hypot(panels[i].x - panels[j].x, panels[i].z - panels[j].z);
      if (d < 0.7) issues.push(`面板${i}/${j} 距离过近 ${d.toFixed(2)}`);
    }
  }
  // NPC 与面板屏幕重叠（NPC 半宽 ~0.7，面板半宽 0.51）
  for (let i = 0; i < panels.length; i++) {
    const d = Math.hypot(npc.x - panels[i].x, npc.z - panels[i].z);
    if (d < 1.25) issues.push(`NPC 与面板${i} 距离过近 ${d.toFixed(2)}`);
  }

  console.log(`\n[${label}] NPC=(${npcPos.x},${npcPos.z}) forward=${forward} spacing=${spacing}`);
  console.log(`  NPC   → (${npc.x.toFixed(2)}, ${npc.z.toFixed(2)})  sx=${proj[0].sx.toFixed(2)} depth=${proj[0].depth.toFixed(1)}`);
  panels.forEach((p, i) => {
    const pr = proj[i + 1];
    console.log(`  面板${i} → (${p.x.toFixed(2)}, ${p.z.toFixed(2)})  sx=${pr.sx.toFixed(2)} depth=${pr.depth.toFixed(1)}`);
  });
  if (issues.length) {
    console.log('  ✗ 问题:'); issues.slice(0, 10).forEach(s => console.log('    - ' + s));
    return false;
  }
  console.log('  ✓ 全部通过');
  return true;
}

console.log('凉亭已移至 (2,6)。最终方案（守林人站面板排西端，面板锚点固定于原舞台中心）：');
const NPC_FINAL = { x: -5.5, z: 2.4 };
const PANEL_ANCHOR = { x: -2.2, z: 4.2 };
// 面板排：以锚点 + 朝向出生点，forward 1.55 / spacing 1.0（与 quest.js 将采用的公式一致）
{
  const afx = -7 - PANEL_ANCHOR.x, afz = 7 - PANEL_ANCHOR.z;
  const afl = Math.hypot(afx, afz);
  const ux = afx / afl, uz = afz / afl;
  const px = uz, pz = -ux;
  const positions = [NPC_FINAL];
  for (let i = 0; i < 4; i++) positions.push({
    x: PANEL_ANCHOR.x + ux * 1.55 + px * (i - 1.5) * 1.0,
    z: PANEL_ANCHOR.z + uz * 1.55 + pz * (i - 1.5) * 1.0,
  });
  // 用修正后的凉亭位置重查全部约束
  const oldPav = COLLIDERS.find(c => c.x === -2.0 && c.z === 4.8);
  oldPav.x = 2.0; oldPav.z = 6.0;   // 凉亭移到 (2,6)
  const issues = [];
  for (const [i, p] of positions.entries()) {
    for (const c of COLLIDERS) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      const need = c.r + (i === 0 ? 0.6 : 0.75);
      if (d < need) issues.push(`元素${i}(${p.x.toFixed(1)},${p.z.toFixed(1)}) 距建筑(${c.x},${c.z}) ${d.toFixed(2)} < ${need.toFixed(2)}`);
    }
    if (Math.abs(p.x - streamX(p.z)) < 5) issues.push(`元素${i}(${p.x.toFixed(1)},${p.z.toFixed(1)}) 落入溪流`);
    const pr = project(p.x, p.z);
    if (Math.abs(pr.sx) > 1.0) issues.push(`元素${i}(${p.x.toFixed(1)},${p.z.toFixed(1)}) 出屏 sx=${pr.sx.toFixed(2)}`);
  }
  // NPC 与各面板的屏幕间距（近似：半宽 0.7 / 0.51 世界单位投影到归一化 sx）
  const pr = (x, z) => {
    const q = project(x, z);
    return q.sx;
  };
  const npcSx = pr(NPC_FINAL.x, NPC_FINAL.z), npcD = project(NPC_FINAL.x, NPC_FINAL.z).depth;
  for (let i = 1; i < positions.length; i++) {
    const pSx = pr(positions[i].x, positions[i].z);
    const half = 0.51 / (project(positions[i].x, positions[i].z).depth * H_HALF_TAN);
    const nhalf = 0.7 / (npcD * H_HALF_TAN);
    if (Math.abs(npcSx - pSx) < half + nhalf) issues.push(`守林人与面板${i - 1} 屏幕重叠 (sx差 ${Math.abs(npcSx - pSx).toFixed(2)})`);
  }
  const names = ['守林人', '面板0', '面板1', '面板2', '面板3'];
  positions.forEach((p, i) => {
    const q = project(p.x, p.z);
    console.log(`  ${names[i]} (${p.x.toFixed(2)}, ${p.z.toFixed(2)})  sx=${q.sx.toFixed(2)} depth=${q.depth.toFixed(1)}`);
  });
  if (issues.length) { console.log('  ✗ 问题:'); issues.forEach(s => console.log('    - ' + s)); process.exit(1); }
  console.log('  ✓ 全部通过（建筑/溪流/视锥/互不遮挡）');
}
