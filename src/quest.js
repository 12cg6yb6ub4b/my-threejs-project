/**
 * ============================================================
 *  quest.js —— 寻物任务系统「星光信物」
 *  ------------------------------------------------------------
 *  玩法闭环：
 *    出生点 NPC（守林人老橡）+ 4 块目标面板
 *      → 对话获知目标 → 场景探索拾取（E / 点击 / 轻点）
 *      → 物品收入工具栏（Minecraft 式热键栏）
 *      → 返回交付 NPC → 胜利结算（可再玩一次）
 *  复用：pictureBookMaterial / makeGlowTexture /
 *        现有射线拾取（userData.interactive）/ OutlinePass 描边 / 昼夜氛围
 * ============================================================
 */
import * as THREE from 'three';
import { pictureBookMaterial, makeGlowTexture } from './shaders.js';

/* ----------------------------------------------------------
 * 四件星光信物配置（位置取自各地标建筑附近）
 * ---------------------------------------------------------- */
const ITEMS = [
  {
    id: 'wheat', name: '风车麦穗', color: '#ffd76a',
    hint: '大风把它吹到了风车脚下，麦穗泛着暖暖的金光。',
    x: 17.0, z: -6.5,
  },
  {
    id: 'bell', name: '钟楼星铃', color: '#8fd0de',
    hint: '它挂在钟楼的檐角下，入夜后会轻轻作响。',
    x: -13.5, z: 11.0,
  },
  {
    id: 'pearl', name: '喷泉珍珠', color: '#bfe4ff',
    hint: '小珍珠掉进了喷泉池边的草丛里，波光粼粼。',
    x: 13.5, z: 6.5,
  },
  {
    id: 'mushroom', name: '古树蘑菇', color: '#ff9a76',
    hint: '古树爷爷的树根旁，长着一颗会发光的红蘑菇。',
    x: -3.5, z: -11.0,
  },
];
const NPC_POS = { x: -5.5, z: 2.4 };           // 守林人：面板排西端，出生点正前方可见（原位置与凉亭重叠被遮挡）
const PANEL_ANCHOR = { x: -2.2, z: 4.2 };      // 4 块目标面板弧线中心（固定，不随守林人移动）
const SPAWN_POS = { x: -7, z: 7 };            // 相机初始位（NPC 面朝这里）

const INTRO_LINES = [
  '欢迎来到童话小镇，远方的旅人。我是守林人老橡。',
  '前些日子刮了一场大风，镇上的四件「星光信物」被吹散到了四处。',
  '没有它们，小镇的星光会一天天变淡。能请你帮我找回来吗？',
  '看到旁边的小木牌了吗？上面画着要找的东西——风车麦穗、钟楼星铃、喷泉珍珠、古树蘑菇。',
  '找到后用 E 键拾取，它们会收进你脚下的工具栏。找齐了就回来找我。',
];
const DELIVER_LINES = [
  '你找齐了！让我看看——风车麦穗、钟楼星铃、喷泉珍珠、古树蘑菇……一件不差！',
  '太好了，小镇的星光又有归处了。谢谢你，旅人。',
];
const WON_LINES = [
  '星光已经回到小镇啦。想再逛一圈就四处走走，想重新开始就点「再玩一次」。',
];

/* ============================================================
 * 程序化图标绘制（面板 / 工具栏 / 结算共用，零外部图片）
 * ============================================================ */
function drawStar(g, cx, cy, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}
export function drawItemIcon(id) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  if (id === 'wheat') {
    // 茎
    g.strokeStyle = '#7a8f4a'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(64, 118); g.quadraticCurveTo(58, 70, 64, 32); g.stroke();
    // 麦粒（左右交错）
    g.fillStyle = '#f0c75e';
    for (let i = 0; i < 6; i++) {
      const y = 94 - i * 12;
      g.save(); g.translate(64, y); g.rotate(i % 2 ? 0.14 : -0.14);
      g.beginPath(); g.ellipse(0, -7, 5, 11, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    // 麦芒 + 叶
    g.strokeStyle = '#e8c15a'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(64, 32); g.lineTo(64, 14); g.stroke();
    g.fillStyle = '#8fae5c';
    g.beginPath(); g.ellipse(43, 88, 6, 16, -0.5, 0, Math.PI * 2); g.fill();
  } else if (id === 'bell') {
    // 铃身
    g.fillStyle = '#8fd0de';
    g.beginPath();
    g.moveTo(46, 46); g.quadraticCurveTo(44, 94, 46, 100);
    g.lineTo(82, 100); g.quadraticCurveTo(84, 94, 82, 46);
    g.quadraticCurveTo(64, 34, 46, 46);
    g.closePath(); g.fill();
    // 钟沿 + 铃舌
    g.fillStyle = '#5aa8b8'; g.fillRect(44, 96, 40, 8);
    g.fillStyle = '#3f7f8f'; g.beginPath(); g.arc(64, 108, 5, 0, Math.PI * 2); g.fill();
    // 顶部星
    g.fillStyle = '#ffe9a8'; drawStar(g, 64, 22, 13);
  } else if (id === 'pearl') {
    const grad = g.createRadialGradient(54, 52, 4, 64, 64, 40);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, '#cfe9ff'); grad.addColorStop(1, '#7fb4d8');
    g.fillStyle = grad;
    g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(50, 48, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(96, 30); g.lineTo(104, 38); g.moveTo(104, 30); g.lineTo(96, 38); g.stroke();
  } else {
    // mushroom
    g.fillStyle = '#f5e8d8';
    g.beginPath(); g.moveTo(54, 100); g.quadraticCurveTo(52, 70, 58, 64);
    g.lineTo(70, 64); g.quadraticCurveTo(76, 72, 74, 100); g.closePath(); g.fill();
    g.fillStyle = '#e0785e';
    g.beginPath(); g.arc(64, 66, 30, Math.PI, 0); g.quadraticCurveTo(64, 92, 34, 66); g.closePath(); g.fill();
    g.fillStyle = '#fff7ec';
    for (const [px, py, pr] of [[50, 50, 5], [66, 44, 4], [78, 58, 3.5], [56, 62, 3]]) {
      g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    }
  }
  return c;
}

/** NPC 名牌（手绘风小木牌） */
function makeNameSign(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f7efdc'; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#b8a678'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#6b5b3f';
  g.font = '700 30px "Kaiti SC","KaiTi","STKaiti",serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  return c;
}

/** 目标面板贴图：图标 + 名字 +（已找到时盖章） */
function drawPanel(def, idx, collected) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#f7efdc'; g.fillRect(0, 0, 256, 192);
  g.strokeStyle = '#b8a678'; g.lineWidth = 5; g.strokeRect(8, 8, 240, 176);
  g.strokeStyle = '#cbb98e'; g.lineWidth = 2; g.strokeRect(15, 15, 226, 162);
  // 图标
  g.drawImage(drawItemIcon(def.id), 73, 20, 110, 110);
  // 名字 + 序号
  g.fillStyle = '#3d3220';
  g.font = '700 32px "Kaiti SC","KaiTi","STKaiti",serif';
  g.textAlign = 'center';
  g.fillText(def.name, 128, 160);
  g.font = '16px "Kaiti SC","KaiTi",serif';
  g.fillStyle = '#6b5b3f';
  g.fillText('第 ' + (idx + 1) + ' 件', 128, 24);
  if (collected) {
    g.save();
    g.translate(128, 96); g.rotate(-0.2);
    g.fillStyle = 'rgba(125,154,114,0.88)';
    g.font = '700 40px "Kaiti SC","KaiTi",serif';
    g.fillText('✓ 已找回', 0, 8);
    g.restore();
  }
  return c;
}

/* ============================================================
 * 3D 物件构建
 * ============================================================ */
/** 四件信物的 3D 小模型（绘本风） */
function buildItemMesh(id) {
  const g = new THREE.Group();
  if (id === 'wheat') {
    const green = pictureBookMaterial({ colorA: '#7a9a4a', colorB: '#93b25e', uSmooth: 0.6, receiveShadow: true });
    const gold = pictureBookMaterial({ colorA: '#e8c15a', colorB: '#f6dc90', uSmooth: 0.7, receiveShadow: true });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.95, 6), green);
    stem.position.y = 0.48; g.add(stem);
    for (let i = 0; i < 6; i++) {
      const grain = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), gold);
      grain.scale.y = 1.5;
      grain.position.set(i % 2 ? 0.07 : -0.07, 0.72 + i * 0.11, 0);
      grain.rotation.z = i % 2 ? 0.3 : -0.3;
      g.add(grain);
    }
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 6), green);
    leaf.position.set(-0.1, 0.22, 0); leaf.rotation.z = 1.9; g.add(leaf);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.24, 6), gold);
    tip.position.y = 1.06; g.add(tip);
  } else if (id === 'bell') {
    const bellMat = pictureBookMaterial({ colorA: '#8fd0de', colorB: '#b8e4ee', uSmooth: 0.7, receiveShadow: true });
    const gold = pictureBookMaterial({ colorA: '#e8c15a', colorB: '#f6dc90', uSmooth: 0.7, receiveShadow: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), bellMat);
    body.scale.y = 1.2; body.position.y = 0.5; g.add(body);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.07, 12), bellMat);
    lip.position.y = 0.28; g.add(lip);
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), gold);
    clapper.position.y = 0.31; g.add(clapper);
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), gold);
    star.position.y = 0.86; g.add(star);
  } else if (id === 'pearl') {
    const pearl = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshPhongMaterial({ color: '#eaf6ff', shininess: 90, emissive: '#7fa8c8', emissiveIntensity: 0.35 })
    );
    pearl.position.y = 0.32; g.add(pearl);
    const shellMat = pictureBookMaterial({ colorA: '#e8d9b8', colorB: '#f2e8d0', uSmooth: 0.7, receiveShadow: true });
    const shell = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.1, 10), shellMat);
    shell.rotation.x = Math.PI; shell.position.y = 0.1; g.add(shell);
  } else {
    // mushroom
    const stemMat = pictureBookMaterial({ colorA: '#f5e8d8', colorB: '#fdf6e8', uSmooth: 0.5, receiveShadow: true });
    const capMat = pictureBookMaterial({ colorA: '#e0785e', colorB: '#f09a80', uSmooth: 0.7, receiveShadow: true });
    const whiteMat = pictureBookMaterial({ colorA: '#fff7ec', colorB: '#fffdf6', uSmooth: 0.5, receiveShadow: true });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.42, 8), stemMat);
    stem.position.y = 0.21; g.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    cap.position.y = 0.45; g.add(cap);
    for (const [dx, dz] of [[-0.08, 0.05], [0.1, -0.02], [0.02, 0.14]]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), whiteMat);
      dot.position.set(dx, 0.62, dz); g.add(dot);
    }
  }
  return g;
}

/** 守林人 NPC（绘本风：长袍 + 白胡子 + 尖帽 + 提灯手杖） */
function buildNpc() {
  const g = new THREE.Group();
  const robeMat = pictureBookMaterial({ colorA: '#7d9a72', colorB: '#93ad82', uSmooth: 0.6, receiveShadow: true });
  const skinMat = pictureBookMaterial({ colorA: '#e8c9a8', colorB: '#d9b48f', uSmooth: 0.5, receiveShadow: true });
  const hatMat = pictureBookMaterial({ colorA: '#8a6240', colorB: '#a97f56', uSmooth: 0.55, receiveShadow: true });
  const woodMat = pictureBookMaterial({ colorA: '#9c6b48', colorB: '#b9895f', uSmooth: 0.45, receiveShadow: true });
  // 长袍
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 1.5, 10), robeMat);
  robe.position.y = 0.75; g.add(robe);
  // 头
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), skinMat);
  head.position.y = 1.72; g.add(head);
  // 白胡子（半球）
  const beard = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
  beard.position.set(0, 1.48, 0.24); beard.scale.set(1, 1.25, 0.85); g.add(beard);
  // 尖帽（帽檐 + 锥顶）
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 12), hatMat);
  brim.position.y = 2.06; g.add(brim);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.55, 10), hatMat);
  cone.position.y = 2.36; g.add(cone);
  // 手臂
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.85, 8), robeMat);
    arm.position.set(s * 0.62, 1.25, 0); arm.rotation.z = s * 0.25; g.add(arm);
  }
  // 提灯手杖
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 8), woodMat);
  staff.position.set(0.85, 1.05, 0.15); staff.rotation.z = -0.12; g.add(staff);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe9b0' }));
  lantern.position.set(0.95, 2.1, 0.18); g.add(lantern);
  const lanternGlowMat = new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: '#ffd98a', transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const lanternGlow = new THREE.Sprite(lanternGlowMat);
  lanternGlow.scale.setScalar(0.95); lanternGlow.position.copy(lantern.position); g.add(lanternGlow);
  // 名牌
  const signTex = new THREE.CanvasTexture(makeNameSign('守林人 · 老橡'));
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.3),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide, toneMapped: false })
  );
  sign.position.y = 2.78; g.add(sign);
  g.userData.interactive = { id: 'npc', type: 'npc', label: '守林人老橡' };
  g.userData.lanternGlowMat = lanternGlowMat;
  return g;
}

/** 目标面板（木桩 + 手绘贴图） */
function buildPanel(def, idx, terrain) {
  const root = new THREE.Group();
  const woodMat = pictureBookMaterial({ colorA: '#9c6b48', colorB: '#b9895f', uSmooth: 0.45, receiveShadow: true });
  // 木桩（缩短到 1.2，顶端低于牌板下缘，不再遮挡牌面文字；牌板前移 0.1 盖住接缝）
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.2, 8), woodMat);
  post.position.y = 0.6; root.add(post);
  const tex = new THREE.CanvasTexture(drawPanel(def, idx, false));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 0.77),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false })
  );
  board.userData.isPanel = true;
  board.position.y = 1.62; board.position.z = 0.1; root.add(board);
  root.userData.interactive = { id: 'panel:' + def.id, type: 'panel', itemId: def.id };
  root.userData.panelTex = tex;
  root.userData.panelIdx = idx;
  root.userData.panelDef = def;
  return root;
}

/* ============================================================
 * 任务控制器
 * ============================================================ */
export function createQuest(scene, world, opts = {}) {
  const camera = opts.camera;
  const celebrate = typeof opts.celebrate === 'function' ? opts.celebrate : () => {};
  const terrain = (x, z) => world.terrainHeight(x, z);

  /* ---------- DOM ---------- */
  const toastEl = document.getElementById('questToast');
  const questCard = document.getElementById('questCard');
  const qcCount = document.getElementById('qcCount');
  const hotbarEl = document.getElementById('hotbar');
  const slots = Array.from(document.querySelectorAll('#hotbar .slot'));
  const dialogEl = document.getElementById('dialog');
  const dlgText = document.getElementById('dlgText');
  const dlgNext = document.getElementById('dlgNext');
  const winOverlay = document.getElementById('winOverlay');
  const winList = document.getElementById('winList');
  const winTime = document.getElementById('winTime');
  document.getElementById('btnRestart').addEventListener('click', reset);

  /* ---------- 场景组（加入 world.group，自动参与射线拾取与描边） ---------- */
  const group = new THREE.Group();
  group.name = '寻物任务（星光信物）';

  // NPC
  const npcBaseY = terrain(NPC_POS.x, NPC_POS.z);
  const npc = buildNpc();
  npc.position.set(NPC_POS.x, npcBaseY, NPC_POS.z);
  const npcBaseRot = Math.atan2(SPAWN_POS.x - NPC_POS.x, SPAWN_POS.z - NPC_POS.z);
  npc.rotation.y = npcBaseRot;
  const lanternGlowMat = npc.userData.lanternGlowMat;
  group.add(npc);
  if (world.colliders) world.colliders.push({ x: NPC_POS.x, z: NPC_POS.z, r: 0.6, h: 1.8 });  // NPC 碰撞

  // 4 块目标面板（以固定锚点排成弧线，面向出生点；守林人站在排的西端，互不遮挡）
  const afx = SPAWN_POS.x - PANEL_ANCHOR.x, afz = SPAWN_POS.z - PANEL_ANCHOR.z;
  const afl = Math.hypot(afx, afz);
  const fux = afx / afl, fuz = afz / afl;       // 面朝方向（面板正面朝出生点）
  const pux = fuz, puz = -fux;                  // 垂直方向
  const panelFacingRot = Math.atan2(afx, afz);
  const panels = ITEMS.map((def, idx) => {
    const px = PANEL_ANCHOR.x + fux * 1.55 + pux * (idx - 1.5) * 1.0;
    const pz = PANEL_ANCHOR.z + fuz * 1.55 + puz * (idx - 1.5) * 1.0;
    const panel = buildPanel(def, idx, terrain);
    panel.position.set(px, terrain(px, pz) + 0.05, pz);
    panel.rotation.y = panelFacingRot;
    group.add(panel);
    if (world.colliders) world.colliders.push({ x: px, z: pz, r: 0.75, h: 1.3 });  // 面板碰撞
    return panel;
  });

  // 4 件信物
  const items = ITEMS.map((def) => {
    const root = new THREE.Group();
    root.add(buildItemMesh(def.id));
    const glowMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: def.color, transparent: true, opacity: 0.4,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(1.6); glow.position.y = 0.4;
    root.add(glow);
    const light = new THREE.PointLight(def.color, 0, 6, 1.8);
    light.position.y = 0.6;
    root.add(light);
    const baseY = terrain(def.x, def.z) + 0.25;
    root.position.set(def.x, baseY, def.z);
    root.userData.interactive = { id: 'quest:' + def.id, type: 'quest', itemId: def.id, color: def.color };
    group.add(root);
    return { def, root, baseY, phase: Math.random() * Math.PI * 2, glowMat, light, collected: false };
  });

  // 阴影与描边
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  world.group.add(group);

  /* ---------- 任务状态 ---------- */
  let phase = 'idle';            // idle → search → won
  let collected = 0;
  let nightFactor = 0;           // 0 白天 ~ 1 夜晚（由氛围联动）
  let questStartTime = 0;
  let dialogOpen = false;
  let dialogLines = [];
  let dialogIdx = 0;
  let dialogOnDone = null;
  let lastAdvance = 0;

  /* ---------- 提示气泡 ---------- */
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /* ---------- 对话框 ---------- */
  function openDialog(lines, onDone) {
    dialogLines = lines;
    dialogIdx = 0;
    dialogOnDone = onDone || null;
    dialogOpen = true;
    dialogEl.classList.remove('hidden');
    renderLine();
  }
  function renderLine() {
    dlgText.textContent = dialogLines[dialogIdx];
    dlgNext.textContent = dialogIdx < dialogLines.length - 1 ? '按 E / 点击 继续' : '按 E / 点击 结束';
  }
  function closeDialog() {
    dialogOpen = false;
    dialogEl.classList.add('hidden');
  }
  function advanceDialog() {
    const now = performance.now();
    if (now - lastAdvance < 320) return;
    lastAdvance = now;
    if (!dialogOpen) return;
    if (dialogIdx < dialogLines.length - 1) {
      dialogIdx++;
      renderLine();
    } else {
      closeDialog();
      if (dialogOnDone) {
        const cb = dialogOnDone;
        dialogOnDone = null;
        cb();
      }
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyE' && !e.repeat && dialogOpen) advanceDialog();
  });
  dialogEl.addEventListener('click', advanceDialog);
  dialogEl.addEventListener('touchstart', (e) => { e.preventDefault(); advanceDialog(); }, { passive: false });

  /* ---------- 任务流程 ---------- */
  function talkToNpc() {
    if (dialogOpen) return;
    if (phase === 'won') {
      openDialog(WON_LINES);
      return;
    }
    if (phase === 'idle') {
      openDialog(INTRO_LINES, () => {
        phase = 'search';
        questStartTime = performance.now();
        questCard.classList.remove('hidden');
        hotbarEl.classList.add('show');
        updateQuestCard();
        toast('任务开始：找回 4 件星光信物！');
      });
    } else if (collected >= ITEMS.length) {
      openDialog(DELIVER_LINES, () => win());
    } else {
      openDialog([
        '辛苦啦，已经找回 ' + collected + ' 件了。',
        '剩下的信物在风车、钟楼、喷泉和古树附近。夜晚它们会发出微光，好找一些。',
      ]);
    }
  }

  function collect(itemId) {
    const item = items.find((it) => it.def.id === itemId);
    if (!item || item.collected) return;
    if (phase !== 'search') {
      toast('这是…？先去问问守林人吧。');
      return;
    }
    item.collected = true;
    item.root.visible = false;
    collected++;
    fillSlot(item.def);
    markPanel(item.def, true);
    updateQuestCard();
    toast('获得：' + item.def.name + '！');
    if (collected >= ITEMS.length) {
      setTimeout(() => toast('4 件都找齐了！回去找守林人吧'), 1200);
    }
  }

  function fillSlot(def) {
    const idx = ITEMS.findIndex((i) => i.id === def.id);
    if (idx < 0 || !slots[idx]) return;
    const slot = slots[idx];
    slot.classList.add('filled');
    slot.appendChild(drawItemIcon(def.id));
  }

  function markPanel(def, collectedFlag) {
    const panel = panels.find((p) => p.userData.panelDef.id === def.id);
    if (!panel) return;
    panel.userData.panelTex.image = drawPanel(def, panel.userData.panelIdx, collectedFlag);
    panel.userData.panelTex.needsUpdate = true;
  }

  function updateQuestCard() {
    if (qcCount) qcCount.textContent = collected + '/' + ITEMS.length;
  }

  function showItemHint(itemId) {
    const def = ITEMS.find((i) => i.id === itemId);
    if (def) toast(def.hint);
  }

  function win() {
    phase = 'won';
    closeDialog();
    // 庆祝粒子（多次爆发）
    const base = npc.position.clone(); base.y += 1.5;
    const colors = ['#ffd76a', '#ff9a76', '#8fd0de', '#bfe4ff', '#e8c15a'];
    colors.forEach((c, i) => {
      setTimeout(() => {
        celebrate(
          new THREE.Vector3(
            base.x + (Math.random() - 0.5) * 2.2,
            base.y + Math.random() * 1.2,
            base.z + (Math.random() - 0.5) * 2.2
          ),
          c
        );
      }, i * 240);
    });
    // 结算面板
    winList.innerHTML = '';
    ITEMS.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'win-item';
      div.appendChild(drawItemIcon(it.id));
      const span = document.createElement('span');
      span.textContent = it.name;
      div.appendChild(span);
      winList.appendChild(div);
    });
    const secs = Math.max(0, Math.round((performance.now() - questStartTime) / 1000));
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    winTime.textContent = '用时 ' + mm + ':' + ss + ' · 4 件星光信物全部找回';
    winOverlay.classList.add('show');
    toast('小镇的星光回来了！');
  }

  function reset() {
    phase = 'idle';
    collected = 0;
    questStartTime = 0;
    items.forEach((it) => {
      it.collected = false;
      it.root.visible = true;
    });
    ITEMS.forEach((def) => markPanel(def, false));
    slots.forEach((s) => {
      s.classList.remove('filled');
      s.innerHTML = '<span class="key">' + (slots.indexOf(s) + 1) + '</span>';
    });
    questCard.classList.add('hidden');
    hotbarEl.classList.remove('show');
    winOverlay.classList.remove('show');
    closeDialog();
    toast('新的旅程开始啦，去和守林人聊聊吧');
  }

  function tryProximity() {
    if (!camera || dialogOpen) return false;
    if (camera.position.distanceTo(npc.position) < 5.5) {
      talkToNpc();
      return true;
    }
    return false;
  }

  /* ---------- 每帧更新 ---------- */
  function update(dt, time) {
    // NPC 待机：轻微起伏 + 摇摆 + 提灯闪烁
    npc.position.y = npcBaseY + Math.sin(time * 1.2) * 0.025;
    npc.rotation.y = npcBaseRot + Math.sin(time * 0.5) * 0.03;
    if (lanternGlowMat) lanternGlowMat.opacity = 0.5 + Math.sin(time * 6) * 0.12;
    // 信物：漂浮旋转 + 光晕脉动（夜晚更亮）
    items.forEach((it) => {
      if (!it.root.visible) return;
      it.root.position.y = it.baseY + Math.sin(time * 1.4 + it.phase) * 0.13;
      it.root.rotation.y += dt * 0.7;
      const pulse = 0.78 + 0.22 * Math.sin(time * 2.4 + it.phase);
      it.glowMat.opacity = (0.3 + nightFactor * 0.55) * pulse;
      it.light.intensity = nightFactor * 1.6;
    });
    // 对话时走远自动关闭
    if (dialogOpen && camera && camera.position.distanceTo(npc.position) > 14) closeDialog();
  }

  // 收集所有面板材质（用于昼夜亮度自适应）
  const panelMats = [];
  panels.forEach(p => p.traverse(o => { if (o.isMesh && o.material && o.material.color) panelMats.push(o.material); }));
  // NPC 名牌材质
  npc.traverse(o => { if (o.isMesh && o.material && o.material.map && o.material.color) panelMats.push(o.material); });

  function setNightFactor(f) {
    nightFactor = Math.max(0, Math.min(1, f || 0));
    // 夜晚面板稍微变暗，避免过曝；白天保持全亮
    const brightness = 1.0 - nightFactor * 0.35;
    const c = new THREE.Color(brightness, brightness, brightness);
    panelMats.forEach(m => { m.color.copy(c); });
  }

  function isDialogOpen() { return dialogOpen; }

  // 开场提示
  setTimeout(() => toast('前方有位守林人，去和他聊聊吧'), 1500);

  return {
    group, update, setNightFactor, collect, talkToNpc, showItemHint,
    tryProximity, reset, isDialogOpen,
  };
}
