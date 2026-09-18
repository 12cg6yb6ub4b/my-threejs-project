/**
 * 验证新地形网格：随机采样点处，网格线性插值高度 vs 解析 groundHeight 的残差。
 * 直接从 src/world.js 提取 groundHeight / HILLS / PLATFORMS / streamCenterX，
 * 保证与渲染代码同源、永不漂移。网格 = buildTerrainGeometry(90, 90, 128)。
 */
import { readFileSync } from 'node:fs';

const worldSrc = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
function grab(pattern, name) {
  const m = worldSrc.match(new RegExp(pattern, 's'));
  if (!m) throw new Error('未找到 ' + name);
  return m[0];
}
const hillBlock = grab(/const HILLS = \[[\s\S]*?\n\];/, 'HILLS');
const platformBlock = grab(/const PLATFORMS = \[[\s\S]*?\n\];/, 'PLATFORMS');
const streamFn = grab(/function streamCenterX\(z\) \{[\s\S]*?\n\}/, 'streamCenterX');
const groundFn = grab(/function groundHeight\(x, z\) \{[\s\S]*?\n\}/, 'groundHeight');

const smoothstepShim = `const THREE = { MathUtils: { smoothstep: (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); } } };`;

// 生成自包含验证模块：提取的源码 + 网格构建 + 采样 + 评估
const moduleSrc = `
${smoothstepShim}
${hillBlock}
${platformBlock}
${streamFn}
${groundFn}

const RADIUS = 90, RS = 90, TS = 128, COLS = TS + 1;
const verts = [[0, groundHeight(0, 0), 0]];
for (let r = 1; r <= RS; r++) {
  const rr = RADIUS * r / RS;
  for (let t = 0; t <= TS; t++) {
    const th = (t % TS) / TS * Math.PI * 2;
    const x = rr * Math.cos(th), z = rr * Math.sin(th);
    verts.push([x, groundHeight(x, z), z]);
  }
}
const rowOf = (r) => (r === 0 ? 0 : 1 + (r - 1) * COLS);
function baryHeight(tri, x, z) {
  const [i0, i1, i2] = tri;
  const [ax, ay] = [verts[i0][0], verts[i0][2]];
  const [bx, by] = [verts[i1][0], verts[i1][2]];
  const [cx, cy] = [verts[i2][0], verts[i2][2]];
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(d) < 1e-12) return null;
  const w0 = ((by - cy) * (x - cx) + (cx - bx) * (z - cy)) / d;
  const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (z - cy)) / d;
  const w2 = 1 - w0 - w1;
  const eps = 1e-6;
  if (w0 < -eps || w1 < -eps || w2 < -eps) return null;
  return w0 * verts[i0][1] + w1 * verts[i1][1] + w2 * verts[i2][1];
}
function sampleMesh(x, z) {
  const r = Math.hypot(x, z);
  const step = RADIUS / RS;
  let rFloor = Math.floor(r / step);
  if (rFloor < 0) rFloor = 0;
  if (rFloor > RS - 1) rFloor = RS - 1;
  const th = Math.atan2(z, x);
  let seg = th / (Math.PI * 2 / TS);
  if (seg < 0) seg += TS;
  const t0 = Math.floor(seg) % TS, t1 = (t0 + 1) % TS;
  if (rFloor === 0) {
    const b = rowOf(1);
    return baryHeight([0, b + t0, b + t1], x, z);
  }
  const a = rowOf(rFloor), b = rowOf(rFloor + 1);
  const h1 = baryHeight([a + t0, a + t1, b + t1], x, z);
  if (h1 !== null) return h1;
  return baryHeight([a + t0, b + t1, b + t0], x, z);
}

let maxErr = 0, sumErr = 0, over = 0, nulls = 0, overStream = 0;
let wx = 0, wz = 0, worst = 0;
const N = 20000;
for (let i = 0; i < N; i++) {
  let x, z, r;
  do { x = (Math.random() - 0.5) * 180; z = (Math.random() - 0.5) * 180; r = Math.hypot(x, z); } while (r > 88);
  const a = groundHeight(x, z);
  const m = sampleMesh(x, z);
  if (m === null) { nulls++; continue; }
  const e = Math.abs(a - m);
  if (e > maxErr) maxErr = e;
  sumErr += e;
  if (e > 0.06) {
    over++;
    if (Math.abs(x - streamCenterX(z)) < 9) overStream++;
    if (e > worst) { worst = e; wx = x; wz = z; }
  }
}
console.log(\`圆盘内随机采样 \${N} 点：最大残差 \${maxErr.toFixed(4)}，平均残差 \${(sumErr / N).toFixed(4)}，残差>0.06 的点 \${over} (\${(over / N * 100).toFixed(2)}%)，其中溪流带内 \${overStream}，未命中三角形 \${nulls}\`);
console.log(\`最差点 (\${wx.toFixed(3)}, \${wz.toFixed(3)}) 残差 \${worst.toFixed(4)}，距溪流中心 \${Math.abs(wx - streamCenterX(wz)).toFixed(2)}\`);
console.log('（修复前扇面网格在部分山丘点偏差达 3.7 单位）');
`;
await import('data:text/javascript;base64,' + Buffer.from(moduleSrc).toString('base64'));
