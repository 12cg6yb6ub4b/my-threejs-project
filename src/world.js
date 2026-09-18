/**
 * ============================================================
 *  world.js —— 林间童话小镇场景搭建
 *  ------------------------------------------------------------
 *  包含：大地/草地、花海、溪流、木屋、古树、云朵、山丘、
 *        石径、木桥、栅栏、远景树林、草丛等全套环境道具。
 * ============================================================
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  pictureBookMaterial, waterMaterial, fountainWaterMaterial, flowerHeadMaterial,
} from './shaders.js';
/** 便捷：把一段噪声函数作为地面高度查询（供第一人称落脚用） */
/**
 * 山坡：中心区外的大尺度高斯丘陵（可攀爬，坡度约 15°~22°）
 *  —— 中心小镇区被 PLATFORMS 拉平，外围出现明显起伏
 */
const HILLS = [
  { x: 33,  z: -31, r: 15, h: 3.2 },   // 东南山丘（避开蘑菇屋平台 23,-21）
  { x: -26, z: 26,  r: 14, h: 2.9 },   // 西北山丘
  { x: -32, z: -16, r: 12, h: 2.5 },   // 东北山丘
  { x: 22,  z: 30,  r: 13, h: 2.7 },   // 西南山丘
  { x: -4,  z: -34, r: 11, h: 2.2 },   // 北部小丘
  { x: 8,   z: 38,  r: 12, h: 2.4 },   // 南部小丘
];
/**
 * 平台：建筑 / 重要设施所在地，半径内山丘贡献衰减为 0（地形拉平，保证贴地不倾斜）
 */
const PLATFORMS = [
  { x: 3.0,   z: -8.5, r: 8.0 },   // 主屋 + 石径 + 桥头
  { x: -2.2,  z: 4.2,  r: 6.5 },   // NPC 老橡 + 4 面板
  { x: -4.8,  z: -11.2, r: 6.0 },  // 古树
  { x: 2.0,   z: 6.0,  r: 4.0 },   // 凉亭（由 (-2,4.8) 移来，原处遮挡守林人与面板）
  { x: 13,    z: 4,    r: 6.5 },   // 喷泉
  { x: 15.5,  z: -7.5, r: 6.0 },   // 风车磨坊
  { x: -14.5, z: 9.5,  r: 6.0 },   // 钟楼
  { x: -13.5, z: -4.5, r: 5.0 },   // 小民居 1
  { x: 12.5,  z: 13.5, r: 5.0 },   // 小民居 2
  { x: -7,    z: 7,    r: 5.0 },   // 出生点
  { x: -9.5,  z: 25,   r: 5.5 },   // 画廊
  { x: -19,   z: -23,  r: 6.5 },   // 谷仓
  { x: 23,    z: -21,  r: 6.5 },   // 蘑菇屋
];
/** 溪流中心线：与 buildStream 的水面蜿蜒公式一致（x ≈ 2.2 + sin(z*0.22)*20） */
function streamCenterX(z) {
  return 2.2 + Math.sin(z * 0.22) * 20;
}

/** 地面高度函数：与大地几何顶点起伏共用同一公式（视觉地面 = groundHeight - 0.21） */
function groundHeight(x, z) {
  // 1) 大尺度山坡：多个高斯丘陵叠加（中心区外的主要起伏）
  let h = 0;
  for (const m of HILLS) {
    const dx = x - m.x, dz = z - m.z;
    h += Math.exp(-(dx * dx + dz * dz) / (2 * m.r * m.r)) * m.h;
  }
  // 2) 平台拉平：建筑/设施周围山丘贡献平滑衰减为 0
  for (const p of PLATFORMS) {
    const dx = x - p.x, dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < p.r * p.r) {
      const k = THREE.MathUtils.smoothstep(0, 1, Math.sqrt(d2) / p.r);
      h *= k;
    }
  }
  // 3) 溪流走廊已移除：地形保持平整
  // 4) 微细节：原小草起伏保留（幅度收窄，不扰动平台与河床）
  h += (Math.sin(x * 0.14) * Math.cos(z * 0.12) * 0.35 + Math.sin(x * 0.05 + z * 0.07) * 0.5) * 0.35;
  return h;
}
/* ============================================================
 * 地形网格高度采样器
 * ------------------------------------------------------------
 * 物体放置 / 玩家落脚统一查询“渲染网格”的实际高度（双三角重心插值），
 * 与光栅化地面完全一致，彻底消除悬空（解析函数在溪流陡坡带与网格有偏差）。
 * ============================================================ */
let _terrainVerts = null;                     // Float32Array（每顶点 3 分量）
const _T_RADIUS = 90, _T_RS = 90, _T_TS = 128;
function initTerrainSampler(geo) {
  _terrainVerts = geo.attributes.position.array;
}
function _triHeight(pos, i0, i1, i2, x, z) {
  const ax = pos[i0 * 3], ay = pos[i0 * 3 + 2];
  const bx = pos[i1 * 3], by = pos[i1 * 3 + 2];
  const cx = pos[i2 * 3], cy = pos[i2 * 3 + 2];
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(d) < 1e-12) return null;
  const w0 = ((by - cy) * (x - cx) + (cx - bx) * (z - cy)) / d;
  const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (z - cy)) / d;
  const w2 = 1 - w0 - w1;
  if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) return null;
  return w0 * pos[i0 * 3 + 1] + w1 * pos[i1 * 3 + 1] + w2 * pos[i2 * 3 + 1];
}
function terrainMeshHeight(x, z) {
  const pos = _terrainVerts;
  if (!pos) return groundHeight(x, z);        // 理论不会发生：几何构建后即初始化
  const cols = _T_TS + 1;
  const step = _T_RADIUS / _T_RS;
  const r = Math.hypot(x, z);
  let rFloor = Math.floor(r / step);
  if (rFloor < 0) rFloor = 0;
  if (rFloor > _T_RS - 1) rFloor = _T_RS - 1;
  const th = Math.atan2(z, x);
  let seg = th / (Math.PI * 2 / _T_TS);
  if (seg < 0) seg += _T_TS;
  const t0 = Math.floor(seg) % _T_TS, t1 = (t0 + 1) % _T_TS;
  const row = (rr) => (rr === 0 ? 0 : 1 + (rr - 1) * cols);
  if (rFloor === 0) {
    const h = _triHeight(pos, 0, row(1) + t0, row(1) + t1, x, z);
    return h !== null ? h : groundHeight(x, z);
  }
  const a = row(rFloor), b = row(rFloor + 1);
  const h1 = _triHeight(pos, a + t0, a + t1, b + t1, x, z);
  if (h1 !== null) return h1;
  const h2 = _triHeight(pos, a + t0, b + t1, b + t0, x, z);
  return h2 !== null ? h2 : groundHeight(x, z);
}
/** 视觉地面高度（含视觉层 -0.21 下沉）：查询渲染网格，与地面零缝隙 */
function visGround(x, z) {
  return terrainMeshHeight(x, z) - 0.21;
}
/**
 * 高分辨率圆形地形网格：径向 × 环向逐点采样 groundHeight。
 * —— 修复悬空根因 ——
 * 原 CircleGeometry(90,64) 只有一圈径向分段（三角扇），仅圆心与 64 个外环顶点
 * 被抬升，山丘/溪流/微起伏在渲染网格上几乎不体现；而物体按解析 groundHeight 放置，
 * 导致外围树丛、孤树、远景林等大面积悬空（实测偏差最高 3.7 单位）。
 * 改为密网格后，渲染地面与解析高度一致，所有按 visGround 放置的物体自动贴地。
 */
function buildTerrainGeometry(radius = 90, radialSegs = 90, thetaSegs = 128) {
  const positions = [0, groundHeight(0, 0), 0];          // 圆心顶点（index 0）
  const cols = thetaSegs + 1;                             // 环向顶点数（末列与首列重合，法线无缝）
  for (let r = 1; r <= radialSegs; r++) {
    const rr = radius * r / radialSegs;
    for (let t = 0; t <= thetaSegs; t++) {
      const th = (t % thetaSegs) / thetaSegs * Math.PI * 2;
      const x = rr * Math.cos(th);
      const z = rr * Math.sin(th);
      positions.push(x, groundHeight(x, z), z);
    }
  }
  const row = (r) => (r === 0 ? 0 : 1 + (r - 1) * cols);
  const indices = [];
  for (let t = 0; t < thetaSegs; t++) {                   // 圆心扇（第一环）
    indices.push(0, row(1) + t, row(1) + t + 1);
  }
  for (let r = 1; r < radialSegs; r++) {                  // 环间四边形（两个三角形）
    const a = row(r), b = row(r + 1);
    for (let t = 0; t < thetaSegs; t++) {
      const a0 = a + t, a1 = a + t + 1, b0 = b + t, b1 = b + t + 1;
      indices.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
/** 干地阈值：高于此值的地面不会被水面覆盖（水面约 y=0.07 + 波纹裕度） */
const DRY_GROUND = 0.12;
/** 喷泉安全落点（已按地形高度筛选，周边 5 单位内全部高于水面） */
const FOUNTAIN_X = 13, FOUNTAIN_Z = 4;
export function createWorld(scene) {
  const group = new THREE.Group();
  group.name = '童话小镇';
  /* ----------------------------------------------------------
   * 1. 大地【双层：底层接收阴影；上层绘本着色器视觉层，轻微透明透阴影】
   *    高分辨率网格：顶点逐点采样 groundHeight，与物体放置用的解析高度一致
   * ---------------------------------------------------------- */
  const groundGeo = buildTerrainGeometry();
  initTerrainSampler(groundGeo);   // 让 visGround 查询渲染网格，物体放置与地面零缝隙

  // 底层：专门接收系统阴影，标准Lambert材质
  const groundShadowReceiver = new THREE.Mesh(
    groundGeo,
    new THREE.MeshLambertMaterial({ color: 0x8fb573 })
  );
  groundShadowReceiver.position.y = -0.22;
  groundShadowReceiver.receiveShadow = true;
  group.add(groundShadowReceiver);

  // 上层：绘本草地视觉层，半透明透出底层阴影，自身也接收阴影（增强树影/房影可见度）
  const groundVisual = new THREE.Mesh(
    groundGeo,
    pictureBookMaterial({
      colorA: '#8aa871', colorB: '#aac494',
      lightTop: '#fffdf2', lightBottom: '#9db292',
      uSmooth: 0.75,
      alpha: 0.94, // 关键：透明度，越小阴影越明显，地面会略微发灰
      receiveShadow: true, // 视觉层直接接收阴影，让树影/房影清晰可见
    })
  );

  groundVisual.position.y = -0.21; // 和底层错开0.01，避免z-fighting闪烁
  groundVisual.renderOrder = 1;
  group.add(groundVisual);

  /* ----------------------------------------------------------
   * 2. 溪流已移除
   * ---------------------------------------------------------- */
  /* ----------------------------------------------------------
   * 3. 花海（InstancedMesh 批量渲染，性能好）
   *    每朵花 = 茎 + 双层花瓣，颜色随机取自柔色板
   * ---------------------------------------------------------- */
  group.add(buildFlowerField());
  /* ----------------------------------------------------------
   * 4. 木屋（绘本小屋：墙体 / 斜屋顶 / 烟囱 / 门窗 / 栅栏）
   * ---------------------------------------------------------- */
  const house = buildHouse();
  house.name = 'house';
  house.userData.interactive = { id: 'house', label: '童话小屋', type: 'swing' };
  group.add(house);

  const pavilion = buildPavilion(2.0, 6.0, 0.85, 0.6);   // 由 (-2,4.8) 移到东侧草地，不再压住守林人
  pavilion.name = 'pavilion';
  pavilion.userData.interactive = { id: 'pavilion', label: '小凉亭', type: 'swing' };
  group.add(pavilion);

  /* ----------------------------------------------------------
   * 5. 古树（树干 + 多层圆形树冠）—— 交互道具
   * ---------------------------------------------------------- */
  const ancientTree = buildTree(-4.8, -11.2, 1.4, 1.15);
  ancientTree.name = 'ancientTree';
  ancientTree.userData.interactive = { id: 'tree', label: '古树爷爷', type: 'swing' };
  group.add(ancientTree);

  // 中心区植被由下方"结构化布局"统一打理（buildDecorVegetation 手摆点位已移除，避免与建筑拥挤）
  
  /* ----------------------------------------------------------
   * 6. 云朵（多层椭球，漂浮，材质半透明）
   * ---------------------------------------------------------- */
  const clouds = buildClouds();
  group.add(clouds);
  /* ----------------------------------------------------------
   * 7. 远处山丘 + 远景小树林（氛围远景）
   * ---------------------------------------------------------- */
  group.add(buildHills());
  group.add(buildForest());
  /* ----------------------------------------------------------
   * 8. 石径网络（连接各主要建筑物）
   * ---------------------------------------------------------- */
  // 主屋 → 古树
  group.add(buildPath(3.0, -8.5, -4.8, -11.2));
  // 主屋 → NPC/钟楼方向（主路）
  group.add(buildPath(3.0, -8.5, -5.5, 2.4));
  // 主路 → 钟楼
  group.add(buildPath(-5.5, 2.4, -14.5, 9.5));
  // 钟楼 → 小民居1
  group.add(buildPath(-14.5, 9.5, -13.5, -4.5));
  // 主路 → 喷泉
  group.add(buildPath(-5.5, 2.4, 13.0, 4.0));
  // 喷泉 → 风车
  group.add(buildPath(13.0, 4.0, 15.5, -7.5));
  // 喷泉 → 小民居2
  group.add(buildPath(13.0, 4.0, 12.5, 13.5));
  // 主路 → 凉亭
  group.add(buildPath(-5.5, 2.4, 2.0, 6.0));

  // 草丛
  group.add(buildGrass());

  // ===== 新增：彩色花簇（点缀草地） =====
  const flowerClusters = buildFlowerClusters();
  group.add(flowerClusters);

  // ===== 新增：喷泉（水柱 + 飞溅粒子） =====
  const fountain = buildFountain(FOUNTAIN_X, FOUNTAIN_Z);
  // ===== 新增：虚拟展厅/艺术馆（绘本画廊，点击展品查看详情） =====
  const gallery = buildGallery();
  fountain.name = 'fountain';
  fountain.userData.interactive = { id: 'fountain', label: '咕嘟咕嘟喷泉', type: 'ripple' };
  group.add(fountain);
  // 画廊（画架自带 interactive，无需额外挂载）
  group.add(gallery);

  // ===== 新增：多种建筑物（风车磨坊 + 钟楼 + 小民居×2） =====
  const windmill = buildWindmill(15.5, -7.5, -0.65);
  windmill.name = 'windmill';
  windmill.userData.interactive = { id: 'windmill', label: '吱呀转的风车', type: 'swing' };
  group.add(windmill);

  const clockTower = buildClockTower(-14.5, 9.5, 0.45);
  clockTower.name = 'clockTower';
  clockTower.userData.interactive = { id: 'clockTower', label: '当当钟楼', type: 'swing' };
  group.add(clockTower);

  group.add(buildSmallHouse(-13.5, -4.5, 1.0, 0.85));
  group.add(buildSmallHouse(12.5, 13.5, 0.92, -0.5));

  // ===== 新增：谷仓 + 童话蘑菇屋（山坡边缘，配合平台拉平） =====
  const barn = buildBarn(-19, -23, 1.0, 0.7);
  barn.name = 'barn';
  barn.userData.interactive = { id: 'barn', label: '红顶谷仓', type: 'swing' };
  group.add(barn);
  const mushHouse = buildMushroomHouse(23, -21, 1.0, -0.9);
  mushHouse.name = 'mushHouse';
  mushHouse.userData.interactive = { id: 'mushHouse', label: '蘑菇小屋', type: 'swing' };
  group.add(mushHouse);

  // ===== 新增：结构化植被布局（树成林 / 灌木伴树丛 / 蘑菇藏树荫 / 草甸开阔 / 溪边点缀） =====
  const rand = mulberry32(20260916);                 // 固定种子：每次加载布局一致
  group.add(buildClusterForest(rand));               // 树丛带：外环 12 处树丛（树+灌木+石头+蘑菇）
  group.add(buildMeadow(rand));                      // 开阔草甸：花簇稀疏点缀
  group.add(buildSolitaryTrees(rand));               // 孤树：开阔处点缀 3-4 棵

  scene.add(group);

  // 只开启物体【投射阴影】！！！不要 receiveShadow（ShaderMaterial不支持接收系统阴影）
  group.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
    }
  });
  // 以下成员关闭投射阴影（阴影优化）：
  //  - 云朵：漂浮物会投出随云移动的硬边阴影，视觉噪声大
  //  - 花簇：花头/花茎过小，投影只是噪声且浪费阴影贴图
  [clouds, flowerClusters].forEach((g) => {
    if (g) g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  });

  /* ---------- 碰撞体收集：建筑（显式圆柱） + 植被（userData.collider） ---------- */
  const colliders = [];
  const addC = (x, z, r, h) => colliders.push({ x, z, r, h });
  addC(3.0, -8.5, 2.3, 3.5);        // 主屋
  addC(2.0, 6.0, 1.8, 3.0);            // 凉亭（已随建筑移至 (2,6)）
  addC(-4.8, -11.2, 1.25, 4.5);     // 古树
  addC(13, 4, 2.4, 3.0);            // 喷泉
  addC(15.5, -7.5, 1.55, 4.0);      // 风车塔
  addC(-14.5, 9.5, 1.4, 4.6);       // 钟楼
  addC(-13.5, -4.5, 1.6, 3.0);      // 小民居 1
  addC(12.5, 13.5, 1.5, 3.0);       // 小民居 2
  addC(-19, -23, 2.1, 3.6);         // 谷仓
  addC(23, -21, 1.9, 3.2);          // 蘑菇屋
  for (const gx of [-13, -10.5, -8, -5.5]) addC(gx, 25, 1.15, 1.7);  // 画廊画架×4
  // 植被：组上带 userData.collider 的，取世界坐标收集
  const _tmpV = new THREE.Vector3();
  group.traverse(obj => {
    if (obj.userData && obj.userData.collider) {
      obj.getWorldPosition(_tmpV);
      colliders.push({ x: _tmpV.x, z: _tmpV.z, r: obj.userData.collider.r, h: obj.userData.collider.h });
    }
  });

  return {
    group,
    clouds,
    fountain,
    colliders,                       // 物体碰撞体（供 controls 防穿模）
    spinners: [
      { obj: windmill.userData.spin, speed: 1.3 },   // 风车叶片
    ],
    // 第一人称落脚高度查询：与视觉地面一致（含视觉层 -0.21 下沉）
    terrainHeight(x, z) {
      return visGround(x, z);
    },
  };
}

/* ============================================================
 * 固定种子伪随机（mulberry32）：保证每次加载植被布局一致
 * ============================================================ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 四件信物落点（植被需避开） */
const ITEM_SPOTS = [[17.0, -6.5], [-13.5, 11.0], [13.5, 6.5], [-3.5, -11.0]];

/** 区域避让：建筑平台 / 信物 / 低洼地面（margin 为物体安全半径） */
function skipArea(x, z, margin = 0) {
  for (const p of PLATFORMS) {
    if (Math.hypot(x - p.x, z - p.z) < p.r + 1.2 + margin) return true;
  }
  for (const [ix, iz] of ITEM_SPOTS) {
    if (Math.hypot(x - ix, z - iz) < 3.0 + margin) return true;
  }
  if (visGround(x, z) < DRY_GROUND) return true;
  return false;
}

/** 已生成的树丛中心（供孤树避让，避免两处重叠） */
const _clusterCenters = [];
/** 已放置的全部树坐标（供孤树避让，避免与树丛内树木过近） */
const _placedTrees = [];

/* ============================================================
 * 树丛带：外环均匀分布 12 处树丛，每丛 = 3~5 树 + 1~2 灌木 + 石头 + 蘑菇
 *   —— 树成群、矮植伴生，避免东一棵西一棵的凌乱感
 * ============================================================ */
function buildClusterForest(rand) {
  const g = new THREE.Group();
  const CLUSTERS = 12;
  for (let i = 0; i < CLUSTERS; i++) {
    // 均匀角度 + 抖动，半径 18~40（平台区外）；找合适中心最多试 20 次
    let cx = 0, cz = 0, cOk = false;
    for (let t = 0; t < 20; t++) {
      const ang = (i / CLUSTERS) * Math.PI * 2 + (rand() - 0.5) * 0.55;
      const r = 18 + rand() * 22;
      cx = Math.cos(ang) * r;
      cz = Math.sin(ang) * r;
      if (skipArea(cx, cz, 4.0)) continue;
      if (_clusterCenters.some(q => Math.hypot(q[0] - cx, q[1] - cz) < 10)) continue;  // 树丛间不重叠
      cOk = true;
      break;
    }
    if (!cOk) continue;
    _clusterCenters.push([cx, cz]);
    // 3~5 棵树（统一多圆树冠），丛内错落、互不重叠
    const placed = [];
    const nTrees = 3 + Math.floor(rand() * 3);
    let tries = 0;
    while (placed.length < nTrees && tries < 30) {
      tries++;
      const a = rand() * Math.PI * 2;
      const rr = 1.6 + rand() * 4.2;
      const tx = cx + Math.cos(a) * rr;
      const tz = cz + Math.sin(a) * rr;
      if (skipArea(tx, tz, 1.6)) continue;
      if (placed.some(q => Math.hypot(q[0] - tx, q[1] - tz) < 2.4)) continue;
      placed.push([tx, tz]);
      _placedTrees.push([tx, tz]);
      const s = 0.7 + rand() * 0.9;
      g.add(buildTree(tx, tz, 0.7 + s * 0.5, 0.7 + s * 0.5));
    }
    // 1~2 丛灌木，树丛边缘
    const nBush = 1 + Math.floor(rand() * 2);
    for (let b = 0; b < nBush; b++) {
      const a = rand() * Math.PI * 2;
      const rr = 2.2 + rand() * 4.0;
      const bx = cx + Math.cos(a) * rr;
      const bz = cz + Math.sin(a) * rr;
      if (skipArea(bx, bz, 1.4)) continue;
      if (placed.some(q => Math.hypot(q[0] - bx, q[1] - bz) < 1.6)) continue;
      g.add(buildBush(bx, bz, 0.7 + rand() * 0.8));
    }
    // 0~1 块石头
    if (rand() < 0.65) {
      const a = rand() * Math.PI * 2;
      const rr = 1.0 + rand() * 3.2;
      const rx = cx + Math.cos(a) * rr;
      const rz = cz + Math.sin(a) * rr;
      if (!skipArea(rx, rz, 1.4)) g.add(buildRock(rx, rz, 0.6 + rand() * 0.9));
    }
    // 2~4 丛蘑菇（树荫下）
    const nMush = 2 + Math.floor(rand() * 3);
    for (let m = 0; m < nMush; m++) {
      const a = rand() * Math.PI * 2;
      const rr = rand() * 3.6;
      const mx = cx + Math.cos(a) * rr;
      const mz = cz + Math.sin(a) * rr;
      if (skipArea(mx, mz, 1.0)) continue;
      g.add(buildMushroom(mx, mz, 0.7 + rand() * 0.6));
    }
  }
  return g;
}

/* ============================================================
 * 孤树：开阔处零星点缀 4 棵大树（视觉焦点，避免全在树丛里）
 * ============================================================ */
function buildSolitaryTrees(rand) {
  const g = new THREE.Group();
  const SPOTS = 4;
  for (let i = 0; i < SPOTS; i++) {
    const ang = (i / SPOTS) * Math.PI * 2 + (rand() - 0.5) * 0.7;
    const r = 14 + rand() * 18;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    if (skipArea(x, z, 3.0)) { i--; continue; }
    if (_clusterCenters.some(q => Math.hypot(q[0] - x, q[1] - z) < 7)) { i--; continue; }
    if (_placedTrees.some(q => Math.hypot(q[0] - x, q[1] - z) < 2.8)) { i--; continue; }
    _placedTrees.push([x, z]);
    const s = 1.1 + rand() * 0.7;                 // 孤树更大
    g.add(buildTree(x, z, 0.7 + s * 0.5, 0.7 + s * 0.5));
  }
  return g;
}

/* ============================================================
 * 开阔草甸：花簇稀疏点缀在平台之间的草地上（保持开阔，不密植）
 * ============================================================ */
function buildMeadow(rand) {
  const g = new THREE.Group();
  const SPOTS = 9;
  for (let i = 0; i < SPOTS; i++) {
    const ang = (i / SPOTS) * Math.PI * 2 + (rand() - 0.5) * 0.9;
    const r = 12 + rand() * 16;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    if (skipArea(x, z, 1.5)) { i--; continue; }
    if (_clusterCenters.some(q => Math.hypot(q[0] - x, q[1] - z) < 5)) { i--; continue; }
    g.add(buildFlowerCluster(x, z, 0.8 + rand() * 0.6));
  }
  return g;
}

/* ============================================================
 * 溪流两岸：灌木 / 石头沿河错落（不种大树，保持河岸视线通透）
 *   —— 河床 5m 内保持空，岸坡 5~8m 处点缀
 * ============================================================ */
function buildStreamside(rand) {
  const g = new THREE.Group();
  for (let z = -32; z <= 32; z += 11) {
    for (const side of [-1, 1]) {
      const sx = streamCenterX(z) + side * (5.2 + rand() * 2.6);
      // 独立避让：河床内不放；平台/信物/水面沿用常规检查（但不再要求离河 6.2m）
      if (Math.abs(sx - streamCenterX(z)) < 5.0) continue;
      let bad = false;
      for (const p of PLATFORMS) {
        if (Math.hypot(sx - p.x, z - p.z) < p.r + 1.2) { bad = true; break; }
      }
      if (bad) continue;
      for (const [ix, iz] of ITEM_SPOTS) {
        if (Math.hypot(sx - ix, z - iz) < 3.0) { bad = true; break; }
      }
      if (bad) continue;
      if (visGround(sx, z) < DRY_GROUND) continue;
      if (rand() < 0.55) g.add(buildBush(sx, z, 0.6 + rand() * 0.6));
      else g.add(buildRock(sx, z, 0.55 + rand() * 0.7));
    }
  }
  return g;
}

/* ============================================================
 * 草丛【修复版】 修复实例不渲染问题，提高草高度，缩小排除区域
 * ============================================================ */
/* ============================================================
 * 草丛【扩大数量与分布范围 + 支持随风摆动】
 * ============================================================ */
/* ============================================================
 * 草丛【扩大数量与分布范围 + 支持随风摆动｜修复几何体共用BUG】
 * ============================================================ */
function buildGrass() {
  const grassGroup = new THREE.Group();
  // 草丛材质
  const grassMat = pictureBookMaterial({
    colorA: '#6ba458',
    colorB: '#82b46e',
    lightTop: '#a6d08c',
    lightBottom: '#4a7738',
    uSmooth: 0.4,
    side: THREE.DoubleSide,
    isGrassBlade: true,
    wind: true,
    receiveShadow: true,
  });

  // ----------------【第一组：全域草丛，独立几何体】----------------
  const bladeGeoMain = new THREE.PlaneGeometry(0.22, 0.85);
  const totalGrass = 1150;
  const instGrass = new THREE.InstancedMesh(bladeGeoMain, grassMat, totalGrass);

  const aWindPhase = new Float32Array(totalGrass);
  const aWindStrength = new Float32Array(totalGrass);
  const dummy = new THREE.Object3D();

  for(let i = 0; i < totalGrass; i++){
    const x = (Math.random() - 0.5) * 120;
    const z = (Math.random() - 0.5) * 120;
    // 跳过低洼地面 / 喷泉区域（i-- 重试，避免空实例堆积在原点）
    if (visGround(x, z) < DRY_GROUND) { i--; continue; }
    if (Math.hypot(x - FOUNTAIN_X, z - FOUNTAIN_Z) < 4.2) { i--; continue; }

    dummy.position.set(x, visGround(x, z), z);
    dummy.rotation.z = Math.random() * Math.PI * 2;
    dummy.scale.set(
      0.65 + Math.random() * 0.65,
      0.8 + Math.random() * 1.1,
      0.65 + Math.random() * 0.65
    );
    dummy.updateMatrix();
    instGrass.setMatrixAt(i, dummy.matrix);

    aWindPhase[i] = Math.random() * Math.PI * 2;
    aWindStrength[i] = 0.25 + Math.random() * 0.35;
  }
  instGrass.instanceMatrix.needsUpdate = true;
  // ✅给【主草丛专属几何体】添加实例属性
  bladeGeoMain.setAttribute('aWindPhase', new THREE.InstancedBufferAttribute(aWindPhase,1));
  bladeGeoMain.setAttribute('aWindStrength', new THREE.InstancedBufferAttribute(aWindStrength,1));
  grassGroup.add(instGrass);


  // ----------------【第二组：岸边草丛，⚠️全新独立几何体！！不能共用】----------------
  const bladeGeoBank = new THREE.PlaneGeometry(0.22, 0.85);
  const bankGrassCount = 320;
  const bankInst = new THREE.InstancedMesh(bladeGeoBank, grassMat, bankGrassCount);

  const bank_aWindPhase = new Float32Array(bankGrassCount);
  const bank_aWindStrength = new Float32Array(bankGrassCount);

  for(let i = 0; i < bankGrassCount; i++){
    const z = (Math.random() - 0.5) * 60;
    const side = Math.random() > 0.5 ? 1 : -1;
    const xOff = side * (2.6 + Math.random() * 3.2);
    if (visGround(xOff, z) < DRY_GROUND) { i--; continue; }
    if (Math.hypot(xOff - FOUNTAIN_X, z - FOUNTAIN_Z) < 4.2) { i--; continue; }
    dummy.position.set(xOff, visGround(xOff, z), z);
    dummy.rotation.z = Math.random() * Math.PI;
    dummy.scale.set(0.75, 0.9 + Math.random() * 1.0, 0.75);
    dummy.updateMatrix();
    bankInst.setMatrixAt(i, dummy.matrix);

    bank_aWindPhase[i] = Math.random() * Math.PI * 2;
    bank_aWindStrength[i] = 0.3 + Math.random() * 0.4;
  }
  bankInst.instanceMatrix.needsUpdate = true;
  // ✅岸边草丛自己的几何体挂载实例属性
  bladeGeoBank.setAttribute('aWindPhase', new THREE.InstancedBufferAttribute(bank_aWindPhase,1));
  bladeGeoBank.setAttribute('aWindStrength', new THREE.InstancedBufferAttribute(bank_aWindStrength,1));

  grassGroup.add(bankInst);

  return grassGroup;
}

/* ============================================================
 * 溪流
 * ============================================================ */
function buildStream() {
  const s = new THREE.Group();
  // 水面：细长弯曲平面
  const wGeo = new THREE.PlaneGeometry(100, 200, 24, 48);
  const water = new THREE.Mesh(wGeo, waterMaterial());
  water.name = 'stream';
  water.userData.interactive = { id: 'stream', label: '哗啦啦小溪', type: 'ripple' };
  water.rotation.x = -Math.PI / 2;
  // 让水面沿 z 轴蜿蜒（S 形）
  const wp = wGeo.attributes.position;
  for (let i = 0; i < wp.count; i++) {
    const x = wp.getX(i);
    const z = wp.getY(i);
    const bend = Math.sin(z * 0.22) * 20;         // 蜿蜒偏移
    wp.setX(i, x + bend);
    wp.setY(i, Math.sin(z * 0.3) * 1);          // 纵向起伏
  }
  wGeo.computeVertexNormals();
  water.position.y = 0.12;
  s.add(water);
  // 河岸沙石：左右两侧半透明的浅色长条
  const bankGeo = new THREE.PlaneGeometry(1.1, 34, 1, 24);
  bankGeo.rotateZ(-Math.PI / 2);
  bankGeo.rotateX(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const bank = new THREE.Mesh(
      bankGeo,
      pictureBookMaterial({
        colorA: '#d8cfae', colorB: '#efe6c8',
        lightTop: '#fffdf2', lightBottom: '#cfc6a8', uSmooth: 0.5,
        receiveShadow: true,
      })
    );
    bank.position.set(side * 2.4, 0.05, 0);
    s.add(bank);
  }
  s.position.set(2.2, -0.05, 0);
  s.rotation.y = 0.12;
  return s;
}
/* ============================================================
 * 草丛（原"花海"）—— 把蘑菇形小花改成细长小草
 * 每株 = 3 片细长草叶围成一丛 + 1 片中央矮叶，绿色系，随风摆动
 * ============================================================ */
function buildFlowerField() {
  const g = new THREE.Group();
  // ---- 组装"一丛草"几何体：4 片草叶绕原点排布 ----
  const leafW = 0.075, leafH = 0.55;
  const leaves = [];
  // 外围 3 片：绕 Y 轴 120° 分布，各自向外倾斜
  for (let i = 0; i < 3; i++) {
    const bg = new THREE.PlaneGeometry(leafW, leafH, 1, 2);
    bg.translate(0, leafH * 0.5, 0);              // 底部在原点
    bg.rotateY(i * Math.PI * 2 / 3);              // 120° 分布
    bg.rotateZ((i % 2 ? 1 : -1) * 0.38);          // 向外倾斜
    bg.rotateY((Math.random() - 0.5) * 0.5);      // 微随机扭转
    leaves.push(bg);
  }
  // 中央 1 片矮叶：直立略倾
  const mid = new THREE.PlaneGeometry(leafW * 0.9, leafH * 0.65, 1, 2);
  mid.translate(0, leafH * 0.65 * 0.5, 0);
  mid.rotateZ((Math.random() - 0.5) * 0.5);
  leaves.push(mid);
  const clumpGeo = mergeGeometries(leaves, false);

  // 深绿 / 浅绿两套色，交错摆放避免单调
  const mats = [
    pictureBookMaterial({
      colorA: '#63984f', colorB: '#7db365',
      lightTop: '#b2d992', lightBottom: '#477a37',
      uSmooth: 0.5, wind: true, receiveShadow: true,
    }),
    pictureBookMaterial({
      colorA: '#548a45', colorB: '#70aa5d',
      lightTop: '#a6d184', lightBottom: '#3c6e32',
      uSmooth: 0.5, wind: true, receiveShadow: true,
    }),
  ];

  const COUNT = 520;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const aWindPhase = new Float32Array(COUNT);
  const aWindStrength = new Float32Array(COUNT);

  for (let m = 0; m < 2; m++) {
    const inst = new THREE.InstancedMesh(clumpGeo, mats[m], COUNT);
    const half = Math.floor(COUNT / 2);
    const base = m === 0 ? 0 : half;
    const n = m === 0 ? half : COUNT - half;
    for (let i = 0; i < n; i++) {
      // 随机分布在草田
      const x = (Math.random() - 0.5) * 76;
      const z = (Math.random() - 0.5) * 76;
      if (visGround(x, z) < DRY_GROUND) { i--; continue; }               // 低洼地面
      if (Math.hypot(x - FOUNTAIN_X, z - FOUNTAIN_Z) < 4.2) { i--; continue; } // 喷泉区
      const k = base + i;
      euler.set(0, Math.random() * Math.PI * 2, 0);
      q.setFromEuler(euler);
      const s = 0.8 + Math.random() * 0.9;
      m4.compose(
        new THREE.Vector3(x, visGround(x, z), z), q,
        new THREE.Vector3(s, s, s)
      );
      inst.setMatrixAt(i, m4);   // 每套实例从 0 开始填充（原 base+i 导致第二套堆在原点）
      aWindPhase[k] = Math.random() * Math.PI * 2;
      aWindStrength[k] = 0.2 + Math.random() * 0.35;
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    clumpGeo.setAttribute('aWindPhase', new THREE.InstancedBufferAttribute(aWindPhase, 1));
    clumpGeo.setAttribute('aWindStrength', new THREE.InstancedBufferAttribute(aWindStrength, 1));
    inst.name = 'flowerField';
    inst.userData.interactive = { id: 'flower', label: '小草', type: 'flower' };
    g.add(inst);
  }
  return g;
}
/* ============================================================
 * 木屋
 * ============================================================ */
function buildHouse() {
  const h = new THREE.Group();
  const wallMat = pictureBookMaterial({
    colorA: '#f3e6cf', colorB: '#ead9bd', uSmooth: 0.5,
    receiveShadow: true,
  });
  const roofMat = pictureBookMaterial({
    colorA: '#c9806f', colorB: '#dda99a', uSmooth: 0.55,
    receiveShadow: true,
  });
  const woodMat = pictureBookMaterial({
    colorA: '#a9775a', colorB: '#c69a7c', uSmooth: 0.45,
    receiveShadow: true,
  });
  const darkWoodMat = pictureBookMaterial({
    colorA: '#8a5a3c', colorB: '#a97a58', uSmooth: 0.4,
    receiveShadow: true,
  });
  // 墙体
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 3.6), wallMat);
  body.position.y = 1.3;
  h.add(body);
  // 斜屋顶：三棱柱（三角形截面 ExtrudeGeometry 挤出），脊线沿 X 轴
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-1.8, 0);
  roofShape.lineTo(1.8, 0);
  roofShape.lineTo(0, 1.4);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 5.0, bevelEnabled: false });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.rotation.y = Math.PI / 2;   // 让挤出方向（原Z轴）转到X轴，脊线沿屋长方向
  roof.position.set(-2.45, 2.6, 0);    // 底边贴合墙体顶部
  h.add(roof);
  // 烟囱
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, 0.6), darkWoodMat);
  chimney.position.set(1.2, 3.4, -0.7);
  h.add(chimney);
  // 门
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.15), darkWoodMat);
  door.position.set(0, 0.75, 1.82);
  h.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: '#e7c87a' }));
  knob.position.set(0.3, 0.8, 1.9);
  h.add(knob);
  // 窗户（可发光：夜晚点亮）
  const winMat = new THREE.MeshBasicMaterial({ color: '#fff2c0' });
  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.12), winMat);
  winFrame.position.set(-1.3, 1.6, 1.82);
  h.add(winFrame);
  const winFrame2 = winFrame.clone();
  winFrame2.position.set(1.35, 1.6, 1.82);
  h.add(winFrame2);
  // 窗棂
  const latticeMat = new THREE.MeshBasicMaterial({ color: '#6b442a' });
  for (const wx of [-1.3, 1.35]) {
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.14), latticeMat);
    barV.position.set(wx, 1.6, 1.82);
    h.add(barV);
    const barH = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.14), latticeMat);
    barH.position.set(wx, 1.6, 1.82);
    h.add(barH);
  }
  // 屋檐下的木头横梁
  const beam = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, 3.9), woodMat);
  beam.position.y = 2.55;
  h.add(beam);
  // 栅栏
  const fenceMat = woodMat;
  for (let i = -2; i <= 2; i += 1) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), fenceMat);
    post.position.set(i * 1.0, 0.45, 3.3);
    h.add(post);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 0.1), fenceMat);
  rail.position.set(0, 0.7, 3.3);
  h.add(rail);
  // 底座（草色地台，让建筑与地形无缝贴合，消除浮空缝隙）
  const baseMat = pictureBookMaterial({ colorA: '#8aa871', colorB: '#aac494', uSmooth: 0.75, receiveShadow: true });
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.24, 4.0), baseMat);
  base.position.y = 0.12;
  h.add(base);
  // ========= 修改：房子位置、旋转、整体缩放（贴地：y 取地面高度） =========
  h.position.set(3.0, visGround(3.0, -8.5), -8.5);
  h.rotation.y = 0.25;
  h.scale.set(0.82, 0.82, 0.82);
  return h;
}
/* ============================================================
 * 古树
 * ============================================================ */
function buildTree(x, z, trunkScale, size) {
  const t = new THREE.Group();
  const barkMat = pictureBookMaterial({
    colorA: '#8a6240', colorB: '#a97f56', uSmooth: 0.5,
    receiveShadow: true,
  });
  const leafMat = pictureBookMaterial({
    colorA: '#63894f', colorB: '#7dab63', uSmooth: 0.8,
    receiveShadow: true,
  });
  // 树干：下粗上细，略微弯曲
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5 * size, 0.9 * size, 4.5 * size, 7),
    barkMat
  );
  trunk.position.y = 2.2 * size;
  t.add(trunk);
  // 树冠：多个球体叠成圆润树冠
  const blobs = [
    [0, 4.4, 0, 1.6],
    [-1.1, 4.0, 0.6, 1.1],
    [1.1, 4.0, -0.4, 1.1],
    [0.2, 5.4, 0.1, 1.2],
    [-0.6, 3.6, -1.0, 1.0],
  ];
  for (const [bx, by, bz, br] of blobs) {
    const blob = new THREE.Mesh(
      new THREE.IcosahedronGeometry(br * size, 1),
      leafMat
    );
    blob.position.set(bx * size, by * size, bz * size);
    blob.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    t.add(blob);
  }
  t.position.set(x, visGround(x, z), z);
  t.scale.setScalar(1);
  t.userData.collider = { r: 0.85 * size, h: 4.2 };   // 树干碰撞
  return t;
}
/* ============================================================
 * 附属：小民居木屋
 * ============================================================ */
function buildSmallHouse(x,z,scale,rotY) {
  const h = new THREE.Group();
  const wallMat = pictureBookMaterial({
    colorA: '#e8ddcf', colorB: '#d9c9b8', uSmooth:0.5,
    receiveShadow: true,
  });
  const roofMat = pictureBookMaterial({
    colorA:'#bc7466',colorB:'#d18e7f',uSmooth:0.55,
    receiveShadow: true,
  });
  const woodMat = pictureBookMaterial({
    colorA:'#966b50',colorB:'#b4886a',uSmooth:0.45,
    receiveShadow: true,
  });

  //墙体
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.8,2.0,2.4),wallMat);
  body.position.y=1.0;
  h.add(body);

  //三角屋顶
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-1.3,0);
  roofShape.lineTo(1.3,0);
  roofShape.lineTo(0,1.1);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape,{depth:3.2,bevelEnabled:false});
  const roof = new THREE.Mesh(roofGeo,roofMat);
  roof.rotation.y = Math.PI/2;
  roof.position.set(-1.6,2.0,0);
  h.add(roof);

  //小门
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.6,1.2,0.12),woodMat);
  door.position.set(0,0.6,1.22);
  h.add(door);

  //底座（草色地台）
  const baseMat = pictureBookMaterial({ colorA:'#8aa871',colorB:'#aac494',uSmooth:0.75, receiveShadow: true });
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.1,0.2,2.7),baseMat);
  base.position.y=0.1;
  h.add(base);

  h.position.set(x, visGround(x, z), z);
  h.rotation.y = rotY;
  h.scale.setScalar(scale);
  return h;
}
/* ============================================================
 * 附属：林间小凉亭
 * ============================================================ */
function buildPavilion(x,z,scale,rotY){
  const pav = new THREE.Group();
  const woodMat = pictureBookMaterial({
    colorA:'#a07456',colorB:'#bb8e6e',uSmooth:0.45,
    receiveShadow: true,
  });
  //四根柱子
  for(let i of [[-1.3,0,-1.3],[1.3,0,-1.3],[-1.3,0,1.3],[1.3,0,1.3]]){
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.16,2.8,6),woodMat);
    col.position.set(i[0],1.4,i[2]);
    pav.add(col);
  }
  //四角锥形屋顶
  const roofGeo = new THREE.ConeGeometry(2.2,1.4,4);
  const roof = new THREE.Mesh(roofGeo,woodMat);
  roof.position.y=3.1;
  roof.rotation.y=Math.PI*0.25;
  pav.add(roof);

  //底座（草色圆台）
  const baseMat = pictureBookMaterial({ colorA:'#8aa871',colorB:'#aac494',uSmooth:0.75, receiveShadow: true });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.85,2.0,0.2,14),baseMat);
  base.position.y=0.1;
  pav.add(base);

  pav.position.set(x, visGround(x, z), z);
  pav.rotation.y=rotY;
  pav.scale.setScalar(scale);
  return pav;
}

/* ============================================================
 * 云朵（漂浮）
 * ============================================================ */
/* ============================================================
 * 矮灌木丛
 * ============================================================ */
function buildBush(x,z,scale){
  const bush = new THREE.Group();
  const leafMat = pictureBookMaterial({
    colorA:'#679954',
    colorB:'#86b86e',
    uSmooth:0.7,
    receiveShadow: true,
  });
  //多颗球体拼出灌木丛
  const blobs = [
    [0,0.4,0,0.7],
    [0.45,0.25,0.2,0.55],
    [-0.4,0.3,-0.3,0.6],
    [0.3,0.5,-0.4,0.45],
    [-0.25,0.45,0.35,0.5]
  ];
  for(const [bx,by,bz,br] of blobs){
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(br*scale,1),leafMat);
    mesh.position.set(bx*scale,by*scale,bz*scale);
    mesh.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,0);
    bush.add(mesh);
  }
  bush.position.set(x, visGround(x, z), z);
  bush.userData.collider = { r: 0.75 * scale, h: 1.1 };   // 灌木碰撞（矮障碍可望越过）
  return bush;
}

/* ============================================================
 * 松树（针叶树）
 * ============================================================ */
function buildFlowerCluster(x,z,scale){
  const cluster = new THREE.Group();
  const stemMat = pictureBookMaterial({
    colorA:'#739958',
    colorB:'#8cb86e',
    uSmooth:0.4,
    receiveShadow: true,
  });
  const leafColors = ['#7cb96a', '#93cf7d', '#69a858', '#85c475', '#6db25e'];
  for(let i=0;i<7;i++){
    const stemH = (0.35 + Math.random()*0.45)*scale;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,stemH,5),stemMat);
    stem.position.set(
      (Math.random()-0.5)*0.45*scale,
      stemH*0.5,
      (Math.random()-0.5)*0.45*scale
    );
    cluster.add(stem);

    //草叶：细长尖叶（代替原来的球形花朵）
    const c = leafColors[Math.floor(Math.random()*leafColors.length)];
    const leafMat = pictureBookMaterial({
      colorA:c,
      colorB:c,
      uSmooth:0.35,
      receiveShadow: true,
    });
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.055*scale, 0.38*scale, 3), leafMat);
    leaf.position.y = stemH + 0.19*scale;
    leaf.position.x = stem.position.x;
    leaf.position.z = stem.position.z;
    leaf.rotation.z = (Math.random()-0.5)*0.5;   // 微倾
    leaf.rotation.y = Math.random()*Math.PI;
    cluster.add(leaf);
  }
  cluster.position.set(x, visGround(x, z), z);
  return cluster;
}

/* ============================================================
 * 批量生成装饰植被组
 * ============================================================ */
function buildDecorVegetation(){
  const group = new THREE.Group();
  //灌木丛
  const bushPositions = [
    [-7.5,-6.2,0.9],[-5.2,-7.0,0.75],[-1.2,-9.2,0.8],
    [6.2,-6.0,0.85],[8.0,-1.0,0.7],[0.0,6.5,0.9],
    [-8.2,2.0,0.72],[4.5,5.2,0.8],
    [-10,-4,0.85],[9,2,0.8],[-3,-2,0.9] //新增灌木丛点位
  ];
  for(let [x,z,s] of bushPositions){
    group.add(buildBush(x,z,s));
  }
  //野花簇【大量增加点位，扩大场景四周分布】
  const flowerClusterPos = [
    [-6.8,-5.2,1.0],[-3.2,-8.0,0.9],
    [5.0,-5.0,0.95],[7.5,-1.5,1.0],[1.2,7.0,0.9],
    [-7.0,3.2,0.9],[-4.2,4.8,1.0],[3.8,4.2,0.95],
        [4.8,2.2,0.95],
    // ===新增大量外围花簇点位 ===
    [-12,-6,1.0],[-10,7,0.95],[10,-7,1.0],[12,4,0.95],
    [-8,-10,0.9],[8,-11,1.0],[-11,-1,0.9],[11,6,1.0],
    [-5,-12,0.95],[6,-13,1.0],[-0.5,10,0.95],[9,9,1.0]
  ];
  for(let [x,z,s] of flowerClusterPos){
    group.add(buildFlowerCluster(x,z,s));
  }

  return group;
}
function buildClouds() {
  const c = new THREE.Group();
  const cloudMat = pictureBookMaterial({
    colorA: '#ffffff', colorB: '#eef3ee', uSmooth: 0.7, alpha: 0.92,
    lightTop: '#ffffff', lightBottom: '#e8ecf0',
  });
  const defs = [
    { x: -18, y: 24, z: -14, s: 1.0 },
    { x: 8, y: 26, z: -20, s: 1.3 },
    { x: 22, y: 23, z: 6, s: 0.9 },
    { x: -6, y: 28, z: 20, s: 1.1 },
    { x: -28, y: 25, z: 10, s: 1.2 },
    { x: -28, y: 26, z: 8, s: 1.4 },
    { x: -20, y: 23, z: 10, s: 1.1 },
  ];
  for (const d of defs) {
    const cloud = new THREE.Group();
    const blobs = [
      [0, 0, 0, 1.6], [1.3, 0.2, 0.2, 1.1], [-1.4, 0.3, -0.2, 1.0],
      [0.3, 0.9, 0.1, 1.2], [-0.5, 0.7, 0.8, 0.9],
    ];
    for (const [bx, by, bz, br] of blobs) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(br, 12, 10), cloudMat);
      b.position.set(bx, by, bz);
      cloud.add(b);
    }
    cloud.position.set(d.x, d.y, d.z);
    cloud.scale.setScalar(d.s);
    cloud.userData.baseY = d.y;
    c.add(cloud);
  }
  return c;
}
/* ============================================================
 * 远景山丘 + 树林
 * ============================================================ */
function buildHills() {
  const h = new THREE.Group();
  const hillMat = pictureBookMaterial({
    colorA: '#93ad78', colorB: '#b4c993', uSmooth: 0.85,
    lightTop: '#f6fbef', lightBottom: '#90a684',
  });
  const hillDefs = [
    { x: -45, z: -40, s: 26, y: 2 },
    { x: 40, z: -48, s: 30, y: 3 },
    { x: -50, z: 30, s: 22, y: 2 },
    { x: 30, z: 46, s: 24, y: 2.5 },
  ];
  for (const d of hillDefs) {
    // 低多边形扁平着色：球体降段 + 非索引面法线（与群山风格统一）
    const hillGeo = new THREE.SphereGeometry(d.s, 9, 6).toNonIndexed();
    hillGeo.computeVertexNormals();
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.scale.y = 0.3;
    hill.position.set(d.x, -d.s * 0.3 + d.y, d.z);
    h.add(hill);
  }
  return h;
}
/* ============================================================
 * 远景树林：统一"多圆树冠"风格（树干 + 3 个圆球简化版，控制 draw call）
 * ============================================================ */
function buildForest() {
  const f = new THREE.Group();
  const trunkMat = pictureBookMaterial({
    colorA: '#7a5a3c', colorB: '#96724e', uSmooth: 0.4,
  });
  const leafMat = pictureBookMaterial({
    colorA: '#6f9960', colorB: '#94b57d', uSmooth: 0.8,
  });
  /** 远景简化树：树干 + 3 个圆球叠成树冠（与近景 buildTree 同风格） */
  function makeBallTree(s) {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 1.9 * s, 6), trunkMat);
    trunk.position.y = 0.95 * s;
    t.add(trunk);
    const balls = [
      [0, 2.2, 0, 0.85],
      [-0.5, 1.85, 0.35, 0.6],
      [0.5, 1.85, -0.25, 0.6],
    ];
    for (const [bx, by, bz, br] of balls) {
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(br * s, 1), leafMat);
      ball.position.set(bx * s, by * s, bz * s);
      ball.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      t.add(ball);
    }
    t.userData.collider = { r: 0.4 * s, h: 2.0 };   // 森林树碰撞
    return t;
  }
  for (let i = 0; i < 50; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 34 + Math.random() * 22;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const s = 0.9 + Math.random() * 1.5;
    const tree = makeBallTree(s);
    tree.position.set(x, visGround(x, z), z);
    tree.rotation.y = Math.random() * Math.PI;
    f.add(tree);
  }
  return f;
}
/* ============================================================
 * 石径 + 木桥
 * ============================================================ */
function buildPath(x1, z1, x2, z2, stoneCount = 20) {
  const p = new THREE.Group();
  const stoneMat = pictureBookMaterial({
    colorA: '#c8bfa2', colorB: '#ded6ba', uSmooth: 0.5,
    receiveShadow: true,
  });
  const dist = Math.hypot(x2 - x1, z2 - z1);
  const count = Math.max(8, Math.round(dist / 0.8));
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    const stone = new THREE.Mesh(new THREE.CircleGeometry(0.45 + Math.random() * 0.2, 7), stoneMat);
    stone.rotation.x = -Math.PI / 2;
    stone.rotation.z = Math.random() * Math.PI;
    stone.position.set(x + (Math.random() - 0.5) * 0.5, visGround(x, z) + 0.03, z);
    stone.scale.y = 0.6;
    p.add(stone);
  }
  return p;
}
function buildBridge() {
  const b = new THREE.Group();
  const plankMat = pictureBookMaterial({
    colorA: '#a9775a', colorB: '#c19577', uSmooth: 0.45,
    receiveShadow: true,
  });
  // 桥板
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.45), plankMat);
    plank.position.set(2.2, 0.25, i * 0.5);
    plank.rotation.z = Math.sin(i * 1.2) * 0.02;
    b.add(plank);
  }
  // 桥栏
  const railMat = plankMat;
  for (const side of [-1.3, 3.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 3.2), railMat);
    rail.position.set(side, 0.6, 0);
    b.add(rail);
  }
  b.position.set(0, -0.1, 0);
  return b;
}
/* ============================================================
 * 环绕远景群山（四周环形群山，绘本远景）
 * ============================================================ */
/* ============================================================
 * 喷泉：石质底座 + 中央柱 + 顶碗 + 半透明水柱 + 飞溅水花粒子
 * ============================================================ */
function buildFountain(x, z) {
  const f = new THREE.Group();
  const stoneMat = pictureBookMaterial({
    colorA: '#cfc4a8', colorB: '#e2d8c0', uSmooth: 0.5,
    receiveShadow: true,
  });
  const darkStone = pictureBookMaterial({
    colorA: '#b3a688', colorB: '#c9bc9e', uSmooth: 0.45,
    receiveShadow: true,
  });
  // 底座圆台
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.6, 0.55, 20), stoneMat);
  base.position.y = 0.28;
  f.add(base);
  // 池壁环
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.22, 10, 24), stoneMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.62;
  f.add(rim);
  // 内池底
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.95, 0.14, 20), darkStone);
  basin.position.y = 0.52;
  f.add(basin);
  // 中央柱
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.42, 1.35, 12), stoneMat);
  pillar.position.y = 1.32;
  f.add(pillar);
  // 顶碗（开口朝上）
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.48, 0.34, 16), stoneMat);
  bowl.position.y = 2.15;
  f.add(bowl);
  // 水柱（顶碗上方，半透明）
  const jet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.6, 2.5, 12, 1, true),
    fountainWaterMaterial()
  );
  jet.position.y = 3.35;
  f.add(jet);
  // 顶部水花球
  const foam = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), fountainWaterMaterial());
  foam.position.y = 4.55;
  f.add(foam);
  // 飞溅水花粒子（抛物线，落到池面重置）
  const N = 160;
  const pGeo = new THREE.BufferGeometry();
  const posArr = new Float32Array(N * 3);
  const velArr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.15 + Math.random() * 0.55;
    posArr[i * 3] = Math.cos(a) * r;
    posArr[i * 3 + 1] = 4.1 + Math.random() * 0.7;
    posArr[i * 3 + 2] = Math.sin(a) * r;
    velArr[i * 3] = (Math.random() - 0.5) * 1.6;
    velArr[i * 3 + 1] = 1.2 + Math.random() * 1.7;
    velArr[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  const dropMat = new THREE.PointsMaterial({
    color: '#dff2ff', size: 0.09, transparent: true, opacity: 0.9,
    depthWrite: false, sizeAttenuation: true,
  });
  const drops = new THREE.Points(pGeo, dropMat);
  f.add(drops);

  f.position.set(x, visGround(x, z), z);

  // 动画更新（由 main.js 每帧调用）
  f.userData.update = (dt) => {
    const p = pGeo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      p[i * 3] += velArr[i * 3] * dt;
      p[i * 3 + 1] += velArr[i * 3 + 1] * dt;
      p[i * 3 + 2] += velArr[i * 3 + 2] * dt;
      velArr[i * 3 + 1] -= 4.4 * dt;          // 重力
      if (p[i * 3 + 1] < 0.7) {               // 落回池面 → 重置到喷口
        const a = Math.random() * Math.PI * 2;
        const r = 0.15 + Math.random() * 0.55;
        p[i * 3] = Math.cos(a) * r;
        p[i * 3 + 2] = Math.sin(a) * r;
        p[i * 3 + 1] = 4.1 + Math.random() * 0.7;
        velArr[i * 3] = (Math.random() - 0.5) * 1.6;
        velArr[i * 3 + 1] = 1.2 + Math.random() * 1.7;
        velArr[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    jet.material.uniforms.uTime.value += dt;
    foam.material.uniforms.uTime.value += dt;
  };
  return f;
}

/* ============================================================
 * 虚拟展厅/艺术馆：绘本画廊（程序化画作 + 木画架，点击查看详情）
 * 四幅主题小画全部用 Canvas 2D 程序化绘制，零外部图片
 * ============================================================ */
/** 主题调色板 */
const ART_THEMES = {
  dawn:   { sky1: '#a8cfe0', sky2: '#f6eeda', sun: '#ffd9a0', hill1: '#9dbd8f', hill2: '#b8d0a4', ground: '#8fb573', accent: '#7fb0c4' },
  meadow: { sky1: '#bfe0cf', sky2: '#f4ecd2', sun: '#f8c877', hill1: '#a8c48c', hill2: '#c2d8a4', ground: '#a3c17e', accent: '#c98f5f' },
  night:  { sky1: '#2c3a5e', sky2: '#5a6f96', sun: '#f2e6c0', hill1: '#3d4f6e', hill2: '#4a5f82', ground: '#37475f', accent: '#e8d9a8' },
  tree:   { sky1: '#cde4cf', sky2: '#f7efd8', sun: '#f6d9a0', hill1: '#9dbd8f', hill2: '#bcd3a0', ground: '#8aa871', accent: '#7a5a3c' },
};
/** 绘制一幅绘本风小画 */
export function makeArtCanvas(key) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 224;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  const t = ART_THEMES[key] || ART_THEMES.dawn;
  // 天空渐变
  const sky = g.createLinearGradient(0, 0, 0, H * 0.6);
  sky.addColorStop(0, t.sky1); sky.addColorStop(1, t.sky2);
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  // 太阳 / 月亮
  g.fillStyle = t.sun;
  g.beginPath(); g.arc(W * 0.8, H * 0.2, 20, 0, Math.PI * 2); g.fill();
  if (key === 'night') {
    g.fillStyle = '#fff6d8';
    for (let i = 0; i < 22; i++) {
      const sx = Math.random() * W, sy = Math.random() * H * 0.5;
      g.fillRect(sx, sy, 2, 2);
    }
  }
  // 双层远山
  const hills = (baseY, amp, col) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, baseY - Math.sin(x * 0.02 + amp) * 26 - Math.sin(x * 0.05) * 12);
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  hills(H * 0.52, 0, t.hill2);
  hills(H * 0.44, 2, t.hill1);
  // 地面
  g.fillStyle = t.ground; g.fillRect(0, H * 0.62, W, H - H * 0.62);
  // 主体
  if (key === 'dawn') {
    // 溪流晨光：蜿蜒溪水 + 木桥 + 两岸小花
    g.strokeStyle = t.accent; g.lineWidth = 14; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-10, H * 0.86); g.quadraticCurveTo(W * 0.5, H * 0.66, W + 10, H * 0.9); g.stroke();
    g.strokeStyle = '#cfe6ee'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(-10, H * 0.86); g.quadraticCurveTo(W * 0.5, H * 0.66, W + 10, H * 0.9); g.stroke();
    g.fillStyle = '#9c6b48'; g.fillRect(W * 0.42, H * 0.7, 52, 8);          // 桥面
    g.fillStyle = '#7a5a3c';
    g.fillRect(W * 0.42 + 6, H * 0.72, 5, 22); g.fillRect(W * 0.42 + 41, H * 0.72, 5, 22);
    for (let i = 0; i < 6; i++) {                                           // 岸上小花
      g.fillStyle = i % 2 ? '#f0b7c0' : '#f5e3a0';
      g.beginPath(); g.arc(W * (0.1 + i * 0.16), H * (0.72 + (i % 3) * 0.05), 4, 0, Math.PI * 2); g.fill();
    }
  } else if (key === 'meadow') {
    // 风车与麦浪
    g.fillStyle = '#d9cdb4'; g.fillRect(W * 0.42, H * 0.42, 46, 52);       // 塔身
    g.fillStyle = '#b5654f';
    g.beginPath(); g.moveTo(W * 0.42 - 6, H * 0.42); g.lineTo(W * 0.42 + 52, H * 0.42); g.lineTo(W * 0.42 + 23, H * 0.28); g.closePath(); g.fill();
    g.fillStyle = '#6b4a2e';                                               // 叶片
    for (let i = 0; i < 4; i++) {
      g.save(); g.translate(W * 0.42 + 23, H * 0.4); g.rotate(i * Math.PI / 2);
      g.fillRect(-2.5, 0, 5, 34); g.restore();
    }
    g.fillStyle = '#e8d48a';                                               // 麦浪
    for (let x = 10; x < W; x += 16) {
      g.beginPath(); g.moveTo(x, H * 0.98); g.lineTo(x + 4, H * 0.72); g.lineTo(x + 8, H * 0.98); g.fill();
    }
  } else if (key === 'night') {
    // 星光钟楼
    g.fillStyle = '#d9cdb4'; g.fillRect(W * 0.44, H * 0.44, 40, 50);
    g.fillStyle = '#8a5a3c'; g.fillRect(W * 0.44 - 4, H * 0.44 - 4, 48, 7);
    g.fillStyle = '#b5654f';
    g.beginPath(); g.moveTo(W * 0.44 - 5, H * 0.44 - 4); g.lineTo(W * 0.44 + 45, H * 0.44 - 4); g.lineTo(W * 0.44 + 20, H * 0.22); g.closePath(); g.fill();
    g.fillStyle = t.sun; g.fillRect(W * 0.44 + 14, H * 0.52, 13, 17);      // 钟窗
    g.strokeStyle = '#5a6f96'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(W * 0.44 + 14, H * 0.44); g.lineTo(W * 0.44 + 14, H * 0.94); g.stroke();
    g.beginPath(); g.moveTo(W * 0.44 + 54, H * 0.44); g.lineTo(W * 0.44 + 54, H * 0.94); g.stroke();
  } else {
    // 古树爷爷：粗树干 + 圆树冠 + 蘑菇
    g.fillStyle = '#7a5a3c';
    g.beginPath(); g.moveTo(W * 0.46, H * 0.98); g.lineTo(W * 0.53, H * 0.98);
    g.lineTo(W * 0.5, H * 0.5); g.lineTo(W * 0.43, H * 0.5); g.closePath(); g.fill();
    g.fillStyle = '#5e8f52';
    g.beginPath(); g.arc(W * 0.47, H * 0.36, 34, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(W * 0.34, H * 0.46, 22, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(W * 0.6, H * 0.46, 20, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a64f3c';                                              // 蘑菇
    g.beginPath(); g.arc(W * 0.3, H * 0.78, 8, Math.PI, 0); g.fill();
    g.fillStyle = '#f5e8d8'; g.fillRect(W * 0.28, H * 0.78, 5, 10);
    g.beginPath(); g.arc(W * 0.72, H * 0.82, 6, Math.PI, 0); g.fill();
    g.fillStyle = '#f5e8d8'; g.fillRect(W * 0.705, H * 0.82, 4, 8);
  }
  return c;
}

/** 画架标题小牌（Canvas 文字） */
function makeTitleSign(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.fillStyle = '#f7efdc';
  g.fillRect(0, 0, 256, 56);
  g.strokeStyle = '#b8a678'; g.lineWidth = 3;
  g.strokeRect(4, 4, 248, 48);
  g.fillStyle = '#6b5b3f';
  g.font = '700 30px "Kaiti SC","KaiTi","STKaiti",serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 30);
  return c;
}

/** 绘本画廊：一排 4 个画架，每个都是可交互展品 */
function buildGallery() {
  const g = new THREE.Group();
  const woodMat = pictureBookMaterial({ colorA: '#9c6b48', colorB: '#b9895f', uSmooth: 0.45, receiveShadow: true });
  const darkWoodMat = pictureBookMaterial({ colorA: '#7a5a3c', colorB: '#96724e', uSmooth: 0.4, receiveShadow: true });
  const ARTS = [
    { id: 'art1', x: -13.0, z: 25, title: '溪流晨光', key: 'dawn',
      desc: '蜿蜒的溪水穿过草甸，晨光在水面洒下碎金。桥下的水声，是小镇醒来时的第一首歌。' },
    { id: 'art2', x: -10.5, z: 25, title: '风车与麦浪', key: 'meadow',
      desc: '风车迎着南风缓缓转动，麦田泛起金色的波浪。这是小镇最安静的角落，也是时光走得最慢的地方。' },
    { id: 'art3', x: -8.0, z: 25, title: '星光钟楼', key: 'night',
      desc: '入夜后，钟楼的钟声顺着星光洒满小镇，为晚归的人点亮回家的路。' },
    { id: 'art4', x: -5.5, z: 25, title: '古树爷爷的夏天', key: 'tree',
      desc: '小镇最年长的居民。树荫下藏着蘑菇、蝉鸣，和讲不完的童话。' },
  ];
  ARTS.forEach((item) => {
    const root = new THREE.Group();
    // 画作
    const canvas = makeArtCanvas(item.key);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 1.4),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    art.position.y = 1.62;
    root.add(art);
    // 木画框（上/下/左/右四条）
    const frame = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), woodMat);
      m.position.set(x, y, 0);
      root.add(m);
    };
    frame(2.32, 0.14, 0, 2.29);
    frame(2.32, 0.14, 0, 0.95);
    frame(0.14, 1.5, -1.16, 1.62);
    frame(0.14, 1.5, 1.16, 1.62);
    // 标题牌
    const signTex = new THREE.CanvasTexture(makeTitleSign(item.title));
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.3),
      new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false })
    );
    sign.position.y = 0.62;
    root.add(sign);
    // 画架支架（两条斜腿 + 顶部横梁 + 底座）
    const leg = (rx, ry) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 0.1), darkWoodMat);
      l.position.set(rx, 0.75, ry);
      l.rotation.x = rx > 0 ? -0.3 : 0.3;
      root.add(l);
    };
    leg(0.7, 0.35); leg(-0.7, 0.35);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.6), darkWoodMat);
    base.position.y = 0.06;
    root.add(base);
    // 展品交互信息
    root.position.set(item.x, visGround(item.x, item.z), item.z);
    root.rotation.y = Math.atan2(-item.x, -item.z);   // 画架正面朝小镇中心
    root.userData.interactive = {
      id: item.id, label: item.title, type: 'gallery',
      title: item.title, desc: item.desc, art: canvas,
    };
    g.add(root);
  });
  return g;
}

/* ============================================================
 * 彩色花簇：茎（InstancedMesh）+ 球状花头（InstancedMesh + instanceColor）
 * 粉色 / 黄色 / 白色 / 紫色 / 橙色 随机点缀草地
 * ============================================================ */
function buildFlowerClusters() {
  const g = new THREE.Group();
  const stemMat = new THREE.MeshLambertMaterial({ color: '#5e9a4e' });
  // 花头：自定义 SSS 半透光材质（背光透光 + 菲涅尔边缘 + 微扰），消除塑料感
  const headMat = flowerHeadMaterial();
  const CLUSTERS = 110;                 // 花簇数
  const PER = 4;                       // 每簇朵数
  const N = CLUSTERS * PER;            // 总朵数
  const stemGeo = new THREE.CylinderGeometry(0.02, 0.035, 0.55, 5);
  const headGeo = new THREE.IcosahedronGeometry(0.14, 0);
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, N);
  const heads = new THREE.InstancedMesh(headGeo, headMat, N);
  const colors = new Float32Array(N * 3);
  const palette = ['#e8a7b5', '#e5cf8f', '#efe6d8', '#b9a6c9', '#e0ad82', '#a4c3cc'];
  const dummy = new THREE.Object3D();
  const cColor = new THREE.Color();

  const blocked = (px, pz) => {
    if (visGround(px, pz) < DRY_GROUND) return true;                       // 低洼地面
    if (Math.hypot(px - 3, pz + 8.5) < 3.5) return true;                   // 大木屋
    if (Math.hypot(px - 2, pz - 6) < 2.8) return true;                    // 凉亭（已移至 (2,6)）
    if (Math.hypot(px + 4.8, pz + 11.2) < 2.5) return true;                // 古树
    if (Math.hypot(px - FOUNTAIN_X, pz - FOUNTAIN_Z) < 4.5) return true;   // 喷泉
    if (pz > 21 && pz < 29 && px > -15 && px < -3.5) return true;          // 画廊展区
    if (Math.hypot(px - 15.5, pz + 7.5) < 3.2) return true;                // 风车
    if (Math.hypot(px + 14.5, pz - 9.5) < 3.2) return true;                // 钟楼
    if (Math.hypot(px + 13.5, pz + 4.5) < 3.0) return true;                // 小民居1
    if (Math.hypot(px - 12.5, pz - 13.5) < 3.0) return true;               // 小民居2
    return false;
  };

  let idx = 0;
  let attempts = 0;
  while (idx < N && attempts < 5000) {
    attempts++;
    const ang = Math.random() * Math.PI * 2;
    const r = 4.5 + Math.random() * 62;
    const cx = Math.cos(ang) * r;
    const cz = Math.sin(ang) * r;
    if (blocked(cx, cz)) continue;
    // 每簇 PER 朵，在簇中心附近小范围散开
    for (let k = 0; k < PER && idx < N; k++) {
      const ox = (Math.random() - 0.5) * 0.85;
      const oz = (Math.random() - 0.5) * 0.85;
      const x = cx + ox, z = cz + oz;
      if (visGround(x, z) < DRY_GROUND) continue;   // 单朵落到低洼处则跳过
      const hgt = 0.4 + Math.random() * 0.35;
      dummy.position.set(x, visGround(x, z), z);
      dummy.scale.setScalar(0.75 + Math.random() * 0.6);
      dummy.updateMatrix();
      stems.setMatrixAt(idx, dummy.matrix);
      dummy.position.y = visGround(x, z) + hgt;
      dummy.updateMatrix();
      heads.setMatrixAt(idx, dummy.matrix);
      const col = palette[Math.floor(Math.random() * palette.length)];
      cColor.set(col);
      colors[idx * 3] = cColor.r;
      colors[idx * 3 + 1] = cColor.g;
      colors[idx * 3 + 2] = cColor.b;
      idx++;
    }
  }
  stems.count = idx;
  heads.count = idx;
  stems.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(colors), 3);
  g.add(stems);
  g.add(heads);
  return g;
}

/* ============================================================
 * 风车磨坊：石塔身 + 锥顶 + 十字风车叶片（旋转动画由 main.js 驱动）
 * ============================================================ */
function buildWindmill(x, z, rotY) {
  const w = new THREE.Group();
  const stoneMat = pictureBookMaterial({
    colorA: '#d9cdb4', colorB: '#e8dec8', uSmooth: 0.5,
    receiveShadow: true,
  });
  const roofMat = pictureBookMaterial({
    colorA: '#b5654f', colorB: '#cf7e64', uSmooth: 0.55,
    receiveShadow: true,
  });
  const woodMat = pictureBookMaterial({
    colorA: '#9c6b48', colorB: '#b9895f', uSmooth: 0.45,
    receiveShadow: true,
  });
  // 塔身（圆台）
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.45, 3.4, 12), stoneMat);
  tower.position.y = 1.7;
  w.add(tower);
  // 塔顶锥
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1.0, 12), roofMat);
  roof.position.y = 3.9;
  w.add(roof);
  // 门
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.12), woodMat);
  door.position.set(0, 0.55, 1.1);
  w.add(door);
  // 圆窗
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.28, 10), new THREE.MeshBasicMaterial({ color: '#ffe9b0' }));
  win.position.set(0.62, 2.15, 1.0);
  w.add(win);
  // 叶片组（绕叶片面法线旋转）
  const blades = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.45, 0.07), woodMat);
    blade.position.y = 1.4;
    arm.add(blade);
    arm.rotation.z = i * Math.PI / 2;
    blades.add(arm);
  }
  blades.position.set(0, 3.65, 0.98);
  w.add(blades);
  // 底座（草色圆台，塔底与地形无缝衔接）
  const baseMat = pictureBookMaterial({ colorA: '#8aa871', colorB: '#aac494', uSmooth: 0.75, receiveShadow: true });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.85, 0.24, 14), baseMat);
  base.position.y = 0.12;
  w.add(base);
  w.position.set(x, visGround(x, z), z);
  w.rotation.y = rotY;
  w.userData.spin = blades;   // main.js 旋转 blades.rotation.z
  return w;
}

/* ============================================================
 * 钟楼：方塔身 + 檐 + 上层钟面（四面）+ 蓝灰尖顶
 * ============================================================ */
function buildClockTower(x, z, rotY) {
  const t = new THREE.Group();
  const wallMat = pictureBookMaterial({
    colorA: '#ece0cd', colorB: '#dccbb2', uSmooth: 0.5,
    receiveShadow: true,
  });
  const roofMat = pictureBookMaterial({
    colorA: '#7d94b5', colorB: '#96aac8', uSmooth: 0.55,
    receiveShadow: true,
  });
  const woodMat = pictureBookMaterial({
    colorA: '#8a6142', colorB: '#a87d58', uSmooth: 0.45,
    receiveShadow: true,
  });
  // 塔身
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.6, 1.9), wallMat);
  body.position.y = 1.8;
  t.add(body);
  // 檐
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.35, 2.35), woodMat);
  ledge.position.y = 3.72;
  t.add(ledge);
  // 钟楼上层
  const upper = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.6), wallMat);
  upper.position.y = 4.38;
  t.add(upper);
  // 尖顶（四棱锥）
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1.7, 4), roofMat);
  spire.position.y = 5.65;
  spire.rotation.y = Math.PI / 4;
  t.add(spire);
  // 四面钟面 + 指针
  const faceMat = new THREE.MeshBasicMaterial({ color: '#fff6dd' });
  const handMat = new THREE.MeshBasicMaterial({ color: '#5a4632' });
  const faces = [[0.81, 0, 0], [-0.81, 0, Math.PI], [0, 0.81, Math.PI / 2], [0, -0.81, -Math.PI / 2]];
  for (const [fx, fz, ry] of faces) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), faceMat);
    face.position.set(fx, 4.38, fz);
    face.rotation.y = ry;
    t.add(face);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.04), handMat);
    hand.position.set(fx, 4.38, fz);
    hand.rotation.y = ry;
    t.add(hand);
  }
  // 门
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.14), woodMat);
  door.position.set(0, 0.7, 0.96);
  t.add(door);
  // 底座（草色方台）
  const baseMat = pictureBookMaterial({ colorA: '#8aa871', colorB: '#aac494', uSmooth: 0.75, receiveShadow: true });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.22, 2.25), baseMat);
  base.position.y = 0.11;
  t.add(base);
  t.position.set(x, visGround(x, z), z);
  t.rotation.y = rotY;
  return t;
}

/* ============================================================
 * 谷仓：红顶大木屋 + 双开门 + 阁楼圆窗 + 草色底座
 * ============================================================ */
function buildBarn(x, z, scale, rotY) {
  const b = new THREE.Group();
  const wallMat = pictureBookMaterial({ colorA: '#e8d5b0', colorB: '#dcc494', uSmooth: 0.55, receiveShadow: true });
  const roofMat = pictureBookMaterial({ colorA: '#b34d3f', colorB: '#cf6a55', uSmooth: 0.6, receiveShadow: true });
  const woodMat = pictureBookMaterial({ colorA: '#8a5a3c', colorB: '#a97a58', uSmooth: 0.45, receiveShadow: true });
  const grassMat = pictureBookMaterial({ colorA: '#8aa871', colorB: '#aac494', uSmooth: 0.75, receiveShadow: true });
  // 底座
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.22, 3.3), grassMat);
  base.position.y = 0.11;
  b.add(base);
  // 墙体
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 2.8), wallMat);
  body.position.y = 1.5;
  b.add(body);
  // 大屋顶（三棱柱，脊线沿 X）
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-1.9, 0); roofShape.lineTo(1.9, 0); roofShape.lineTo(0, 1.6); roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 4.4, bevelEnabled: false });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.rotation.y = Math.PI / 2;
  roof.position.set(-2.2, 2.6, 0);
  b.add(roof);
  // 谷仓大门（两扇斜开）
  const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.6, 0.1), woodMat);
  doorL.position.set(-0.45, 0.8, 1.42);
  doorL.rotation.y = -0.28;
  b.add(doorL);
  const doorR = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.6, 0.1), woodMat);
  doorR.position.set(0.45, 0.8, 1.42);
  doorR.rotation.y = 0.28;
  b.add(doorR);
  // 阁楼圆窗
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.3, 10), new THREE.MeshBasicMaterial({ color: '#ffe9b0' }));
  win.position.set(0, 2.25, 1.42);
  b.add(win);
  // 门楣木梁
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.22, 0.14), woodMat);
  beam.position.set(0, 1.75, 1.42);
  b.add(beam);

  b.position.set(x, visGround(x, z), z);
  b.rotation.y = rotY;
  b.scale.setScalar(scale);
  return b;
}

/* ============================================================
 * 童话蘑菇屋：菌柄墙体 + 大红伞盖 + 白斑点 + 木门
 * ============================================================ */
function buildMushroomHouse(x, z, scale, rotY) {
  const m = new THREE.Group();
  const stemMat = pictureBookMaterial({ colorA: '#f5ead2', colorB: '#e9d9b8', uSmooth: 0.6, receiveShadow: true });
  const capMat = pictureBookMaterial({ colorA: '#c9574a', colorB: '#e0705f', uSmooth: 0.65, receiveShadow: true });
  const spotMat = pictureBookMaterial({ colorA: '#fdf3e0', colorB: '#fdf3e0', uSmooth: 0.7, receiveShadow: true });
  const woodMat = pictureBookMaterial({ colorA: '#8a5a3c', colorB: '#a97a58', uSmooth: 0.45, receiveShadow: true });
  const grassMat = pictureBookMaterial({ colorA: '#8aa871', colorB: '#aac494', uSmooth: 0.75, receiveShadow: true });
  // 底座
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.95, 0.22, 14), grassMat);
  base.position.y = 0.11;
  m.add(base);
  // 菌柄（墙体）
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.35, 2.0, 12), stemMat);
  stem.position.y = 1.1;
  m.add(stem);
  // 大红伞盖（上半球）
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.position.y = 2.3;
  m.add(cap);
  // 白斑点
  for (const [sx, sz] of [[0.7, 0.3], [-0.6, 0.5], [0.2, -0.8], [-0.3, -0.2], [0.9, -0.4]]) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), spotMat);
    spot.position.set(sx, 2.95, sz);
    spot.scale.y = 0.5;
    m.add(spot);
  }
  // 木门
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.15, 0.12), woodMat);
  door.position.set(0, 0.58, 1.1);
  m.add(door);
  // 小圆窗
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.24, 10), new THREE.MeshBasicMaterial({ color: '#ffe9b0' }));
  win.position.set(0.72, 1.5, 0.98);
  win.rotation.y = -0.7;
  m.add(win);

  m.position.set(x, visGround(x, z), z);
  m.rotation.y = rotY;
  m.scale.setScalar(scale);
  return m;
}

/* ============================================================
 * 低多边形石块（主石 + 副石，浅灰暖色）
 * ============================================================ */
function buildRock(x, z, scale) {
  const rock = new THREE.Group();
  const mat = pictureBookMaterial({ colorA: '#b9b09a', colorB: '#d0c7b0', uSmooth: 0.6, receiveShadow: true });
  const main = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 * scale, 0), mat);
  main.scale.y = 0.62;
  main.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  rock.add(main);
  const sub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 * scale, 0), mat);
  sub.position.set(0.45 * scale, -0.05, 0.3 * scale);
  sub.scale.y = 0.6;
  sub.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  rock.add(sub);
  rock.position.set(x, visGround(x, z), z);
  return rock;
}

/* ============================================================
 * 小蘑菇（柄 + 彩伞，点缀草地）
 * ============================================================ */
function buildMushroom(x, z, scale) {
  const m = new THREE.Group();
  const stemMat = pictureBookMaterial({ colorA: '#f0e6cd', colorB: '#e4d6b8', uSmooth: 0.55, receiveShadow: true });
  const capColors = ['#c9574a', '#d98a3e', '#b56a8f', '#c98f3e'];
  const capMat = pictureBookMaterial({
    colorA: capColors[Math.floor(Math.random() * capColors.length)], colorB: '#e8a06a',
    uSmooth: 0.65, receiveShadow: true,
  });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.4, 7), stemMat);
  stem.position.y = 0.2;
  m.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.position.y = 0.42;
  m.add(cap);
  m.position.set(x, visGround(x, z), z);
  m.rotation.y = Math.random() * Math.PI;
  m.scale.setScalar(scale);
  return m;
}
