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
  pictureBookMaterial, waterMaterial, fountainWaterMaterial,
} from './shaders.js';
/** 便捷：把一段噪声函数作为地面高度查询（供第一人称落脚用） */
/** 地面高度函数：与大地几何顶点起伏共用同一公式（视觉地面 = groundHeight - 0.21） */
function groundHeight(x, z) {
  return (Math.sin(x * 0.14) * Math.cos(z * 0.12) * 0.35 + Math.sin(x * 0.05 + z * 0.07) * 0.5) * 0.6;
}
/** 视觉地面高度（含视觉层 -0.21 下沉） */
function visGround(x, z) {
  return groundHeight(x, z) - 0.21;
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
   * ---------------------------------------------------------- */
  const groundGeo = new THREE.CircleGeometry(90, 64);
  groundGeo.rotateX(-Math.PI / 2);

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

  // 地面顶点起伏，两套几何体共享同一套顶点数据
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = Math.sin(x * 0.14) * Math.cos(z * 0.12) * 0.35
            + Math.sin(x * 0.05 + z * 0.07) * 0.5;
    pos.setY(i, h * 0.6);
  }
  groundGeo.computeVertexNormals();

  groundVisual.position.y = -0.21; // 和底层错开0.01，避免z-fighting闪烁
  groundVisual.renderOrder = 1;
  group.add(groundVisual);

  /* ----------------------------------------------------------
   * 2. 溪流（蜿蜒水面 + 河岸沙石）
   * ---------------------------------------------------------- */
  const stream = buildStream();
  group.add(stream);
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

  const pavilion = buildPavilion(-2.0, 4.8, 0.85, 0);
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

//====新增丰富树木花草装饰====
  group.add(buildDecorVegetation());
  
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
   * 8. 石径（从木屋通向溪边木桥）
   * ---------------------------------------------------------- */
  group.add(buildPath());
  group.add(buildBridge());
  group.add(buildSurroundMountains());

  // 草丛
  group.add(buildGrass());

  // ===== 新增：彩色花簇（点缀草地） =====
  group.add(buildFlowerClusters());

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

  scene.add(group);

  // 只开启物体【投射阴影】！！！不要 receiveShadow（ShaderMaterial不支持接收系统阴影）
  group.traverse(obj => {
    if (obj.isMesh) {
      obj.castShadow = true;
    }
  });

  return {
    group,
    clouds,
    stream,
    fountain,
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
    // 跳过溪流带 / 低洼水面 / 喷泉区域（i-- 重试，避免空实例堆积在原点）
    if (Math.abs(x) < 5.2 && Math.abs(z) < 11) { i--; continue; }
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
      // 随机分布在一侧草田，避开溪流区域
      const x = (Math.random() - 0.5) * 76;
      const z = (Math.random() - 0.5) * 76;
      if (Math.abs(x - 2.2) < 3.2 && Math.abs(z) < 10) { i--; continue; } // 溪流区
      if (visGround(x, z) < DRY_GROUND) { i--; continue; }               // 低洼水面
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
  return bush;
}

/* ============================================================
 * 松树（针叶树）
 * ============================================================ */
function buildPineTree(x,z,size){
  const t = new THREE.Group();
  const barkMat = pictureBookMaterial({
    colorA:'#69503c',
    colorB:'#82644a',
    uSmooth:0.45,
    receiveShadow: true,
  });
  const pineMat = pictureBookMaterial({
    colorA:'#477037',
    colorB:'#5b8845',
    uSmooth:0.75,
    receiveShadow: true,
  });
  //树干
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35*size,0.55*size,3.2*size,6),barkMat);
  trunk.position.y = 1.6*size;
  t.add(trunk);
  //多层圆锥树冠
  for(let i=0;i<4;i++){
    const r = (1.3 - i*0.28)*size;
    const h = (1.4 - i*0.22)*size;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r,h,8),pineMat);
    cone.position.y = (2.2 + i*0.95)*size;
    t.add(cone);
  }
  t.position.set(x,0,z);
  return t;
}

/* ============================================================
 * 小型野草簇（原"野花簇"：球形小花 → 细长草叶）
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
    [-6.8,-5.2,1.0],[-3.2,-8.0,0.9],[-0.5,-6.2,1.0],
    [5.0,-5.0,0.95],[7.5,-1.5,1.0],[1.2,7.0,0.9],
    [-7.0,3.2,0.9],[-4.2,4.8,1.0],[3.8,4.2,0.95],
    //溪流岸边增加花簇
    [-2.5,-3.0,1.0],[4.8,2.2,0.95],[-1.0,2.5,1.0],
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
    const hill = new THREE.Mesh(new THREE.SphereGeometry(d.s, 20, 14), hillMat);
    hill.scale.y = 0.3;
    hill.position.set(d.x, -d.s * 0.3 + d.y, d.z);
    h.add(hill);
  }
  return h;
}
/* ============================================================
 * 远景树林（THREE.LOD 三级细节：近景完整 / 中景合并 / 远景简模）
 * ============================================================ */
function buildForest() {
  const f = new THREE.Group();
  const trunkMat = pictureBookMaterial({
    colorA: '#7a5a3c', colorB: '#96724e', uSmooth: 0.4,
  });
  const leafMat = pictureBookMaterial({
    colorA: '#6f9960', colorB: '#94b57d', uSmooth: 0.8,
  });
  /** 单棵树三套 LOD 网格 */
  function makeLODTree(s) {
    const lod = new THREE.LOD();
    // ---- 近景高模：树干 + 锥形树冠（细节最多）----
    const high = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.32 * s, 2.2 * s, 7), trunkMat);
    trunk.position.y = 1.1 * s;
    high.add(trunk);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.1 * s, 2.6 * s, 8), leafMat);
    leaf.position.y = 2.8 * s;
    leaf.rotation.y = Math.random() * Math.PI;
    high.add(leaf);
    // ---- 中景中模：单网格合并版，段数减半（减少 draw call）----
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * s, 0.62 * s, 3.6 * s, 5), leafMat);
    mid.position.y = 1.8 * s;
    // ---- 远景简模：最低细节单锥 ----
    const low = new THREE.Mesh(new THREE.ConeGeometry(0.55 * s, 3.4 * s, 4), leafMat);
    low.position.y = 1.7 * s;

    lod.addLevel(high, 0);    // 0 ~ 30 米：高模
    lod.addLevel(mid, 32);    // 32 ~ 62 米：中模
    lod.addLevel(low, 64);    // 64 米以外：简模
    return lod;
  }
  for (let i = 0; i < 60; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 34 + Math.random() * 22;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const s = 0.6 + Math.random() * 1.4;
    const tree = makeLODTree(s);
    tree.position.set(x, visGround(x, z), z);
    tree.rotation.y = Math.random() * Math.PI;
    f.add(tree);
  }
  return f;
}
/* ============================================================
 * 石径 + 木桥
 * ============================================================ */
function buildPath() {
  const p = new THREE.Group();
  const stoneMat = pictureBookMaterial({
    colorA: '#c8bfa2', colorB: '#ded6ba', uSmooth: 0.5,
    receiveShadow: true,
  });
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    // ========= 修改石径起点，对齐新房子坐标 =========
    const x = 3.0 + (0.0 - 3.0) * t;
    const z = -8.5 + 10.5 * t;
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
function buildSurroundMountains() {
  const g = new THREE.Group();
  // 群山环形半径：放在场景圆盘外面，远处
  const ringRadius = 86;
  const mountainCount = 15;
  for(let i = 0; i < mountainCount; i++){
    const angle = (i / mountainCount) * Math.PI * 2;
    // 每座山位置
    const x = Math.cos(angle) * ringRadius;
    const z = Math.sin(angle) * ringRadius;
    // 随机高度大小，错落
    const baseHeight = 10 + Math.random() * 20;
    const scaleXZ = 5 + Math.random() * 7;
    // 山几何体：Icosahedron 低多边，绘本感，不是生硬圆锥
    const geo = new THREE.IcosahedronGeometry(scaleXZ, 1);
    const mat = pictureBookMaterial({
      colorA: '#7d8f70',
      colorB: '#93a880',
      lightTop: '#d2ddc8',
      lightBottom: '#5f7056',
      uSmooth: 0.85
    });
    const mountain = new THREE.Mesh(geo, mat);
    mountain.position.set(x, baseHeight * 0.4, z);
    mountain.scale.y = baseHeight / scaleXZ;
    mountain.rotation.y = Math.random() * Math.PI;
    g.add(mountain);
  }
  return g;
}

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
  const headMat = new THREE.MeshLambertMaterial({ color: '#ffffff' }); // 与 instanceColor 相乘
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
    if (visGround(px, pz) < DRY_GROUND) return true;                       // 低洼水面
    if (Math.abs(px - 2.2) < 4.5 && Math.abs(pz) < 13) return true;        // 溪流带
    if (Math.hypot(px - 3, pz + 8.5) < 3.5) return true;                   // 大木屋
    if (Math.hypot(px + 2, pz - 4.8) < 2.8) return true;                   // 凉亭
    if (Math.hypot(px + 4.8, pz + 11.2) < 2.5) return true;                // 古树
    if (Math.hypot(px - FOUNTAIN_X, pz - FOUNTAIN_Z) < 4.5) return true;   // 喷泉
    if (pz > 21 && pz < 29 && px > -15 && px < -3.5) return true;          // 画廊展区
    if (Math.hypot(px - 15.5, pz + 7.5) < 3.2) return true;                // 风车
    if (Math.hypot(px + 14.5, pz - 9.5) < 3.2) return true;                // 钟楼
    if (Math.hypot(px + 13.5, pz + 4.5) < 3.0) return true;                // 小民居1
    if (Math.hypot(px - 12.5, pz - 13.5) < 3.0) return true;               // 小民居2
    if (Math.abs(px - 2.2) < 2.2 && Math.abs(pz) < 2.6) return true;       // 木桥
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
  t.position.set(x, visGround(x, z), z);
  t.rotation.y = rotY;
  return t;
}
