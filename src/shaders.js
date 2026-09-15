/**
 * ============================================================
 *  shaders.js —— Lusion 绘本风核心着色器 & 程序化纹理
 *  ------------------------------------------------------------
 *  复刻目标：水彩晕染 + 彩铅噪点 + 纸张肌理 + 卡通柔和光影
 *  全部纹理由 Canvas 程序化生成，零外部贴图依赖。
 * ============================================================
 */
import * as THREE from 'three';

/* ============================================================
 * 一、GLSL 通用工具（值噪声，供各着色器复用）
 * ============================================================ */
export const GLSL_NOISE = /* glsl */ `
  // 2D 值噪声：输入坐标，输出 [0,1] 连续噪声
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);            // 平滑插值
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // 分形噪声：多层叠加得到更自然的水彩斑块
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * valueNoise(p);
      p = p * 2.03 + vec2(7.7, 3.1);
      amp *= 0.5;
    }
    return v;
  }
`;

/* ============================================================
 * 二、绘本主材质（PictureBookMaterial）
 *  ------------------------------------------------------------
 *  适用于：草地、泥土、树干、云朵、墙体等大部分场景物体。
 *  特性：
 *   - 水彩晕染：低频噪声在 A/B 两个颜色间柔和过渡
 *   - 半兰伯特卡通光照：高光柔和、无写实金属反光
 *   - 彩铅噪点：高频细颗粒叠加，模拟彩铅笔触
 *   - 纸张肌理：程序化纸张纹理相乘，还原纸质绘本质感
 * ============================================================ */
export function pictureBookMaterial(opts = {}) {
  const {
    colorA = '#8fb56f',   // 主色（如草绿）
    colorB = '#b8d49a',   // 副色（水彩晕染的浅色）
    lightTop = '#fff8e8', // 顶部光照色（暖白）
    lightBottom = '#9db8a0', // 底部光照色（清冷绿灰）
    alpha = 1.0,          // 透明度（云朵用）
    uSmooth = 0.6,        // 水彩晕染强度
    receiveShadow = false,// 是否接收方向光阴影（近景物体开启）
    wind = false,         // 是否启用草叶风摆动（几何体需带 aWindPhase/aWindStrength 实例属性）
  } = opts;

  const uniforms = {
    uTime: { value: 0 },
    uColorA: { value: new THREE.Color(colorA) },
    uColorB: { value: new THREE.Color(colorB) },
    uLightTop: { value: new THREE.Color(lightTop) },
    uLightBottom: { value: new THREE.Color(lightBottom) },
    uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uSmooth: { value: uSmooth },
    uAlpha: { value: alpha },
    uTint: { value: new THREE.Color('#ffffff') },
    uPaper: { value: makePaperTexture() },
    uPencil: { value: makePencilTexture() },
    // 风参数
    uWindSpeed:{value:1.8},
  };
  if (receiveShadow) {
    // 手动阴影 uniform：不依赖 three 的 lights 自动赋值（lights 机制在部分环境会因
    // GLSL 未声明全部灯光 uniform 而抛错），改为每帧由 main.js 从太阳同步最新值。
    Object.assign(uniforms, {
      uShadowMap: { value: null },        // BasicShadowMap 深度贴图（无 compare 采样）
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowBias: { value: -0.0005 },
      uShadowIntensity: { value: 0.55 },
      uShadowMapSize: { value: new THREE.Vector2(2048, 2048) },
    });
  }
  const defines = {};
  if (receiveShadow) { defines.RECEIVE_SHADOW = ''; }
  if (wind) { defines.HAS_WIND = ''; }

  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    #ifdef RECEIVE_SHADOW
      uniform mat4 uShadowMatrix;
      varying vec4 vShadowCoord;
    #endif
    #ifdef HAS_WIND
      uniform float uTime;
      uniform float uWindSpeed;
      attribute float aWindPhase;
      attribute float aWindStrength;
    #endif
    void main() {
      vUv = uv;
      vec3 transformedNormal = normalize(normalMatrix * normal);
      vNormal = transformedNormal;
      vec3 p = position;
      #ifdef HAS_WIND
        // 草叶风摆动：幅度随草叶高度增大，叶尖摆幅最大
        float wind = sin(uTime * uWindSpeed + aWindPhase) * aWindStrength;
        p.x += wind * position.y * 0.35;
        p.z += wind * position.y * 0.22;
      #endif
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vWorldPos = wp.xyz;
      #ifdef RECEIVE_SHADOW
        vShadowCoord = uShadowMatrix * wp;
      #endif
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uLightTop;
    uniform vec3 uLightBottom;
    uniform vec3 uLightDir;
    uniform float uSmooth;
    uniform float uAlpha;
    uniform vec3 uTint;
    uniform sampler2D uPaper;
    uniform sampler2D uPencil;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    #ifdef RECEIVE_SHADOW
      uniform sampler2D uShadowMap;
      uniform float uShadowBias;
      uniform float uShadowIntensity;
      uniform vec2 uShadowMapSize;
      varying vec4 vShadowCoord;
    #endif

    ${GLSL_NOISE}

    void main() {
      // ---- 1. 水彩晕染：用分形噪声在 A/B 色间过渡 ----
      float n  = fbm(vUv * 4.0 + vWorldPos.xz * 0.12 + vec2(0.0, uTime * 0.02));
      float n2 = valueNoise(vUv * 1.5 + 7.3);
      float t  = clamp(n * 0.65 + n2 * 0.35, 0.0, 1.0);
      vec3 base = mix(uColorA, uColorB, t * uSmooth);

      // ---- 2. 卡通柔和光影（半兰伯特）----
      vec3 N = normalize(vNormal);
      float ndl = dot(N, normalize(uLightDir)) * 0.5 + 0.5;
      ndl = pow(ndl, 1.45);                          // 压暗过渡，避免死黑
      vec3 lightCol = mix(uLightBottom, uLightTop, ndl);
      vec3 col = base * lightCol;
      // 轻度去饱和：压住高饱和荧光色，让绘本色更沉稳
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, 0.90);

      // ---- 3. 彩铅噪点：高频颗粒，模拟笔触 ----
      float grain = valueNoise(vUv * 160.0 + vec2(11.0, uTime * 0.1));
      col = mix(col, col * (0.9 + grain * 0.2), 0.62);

      // ---- 4. 纸张肌理：乘算纸张亮度，还原纸质质感 ----
      vec3 paper = texture2D(uPaper, vUv * 2.2).rgb;
      col = col * (0.86 + 0.28 * paper);

      // ---- 5. 菲涅尔 + step 柔和手绘边缘（水彩积色）----
      vec3 V = normalize(cameraPosition - vWorldPos);
      float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);
      float edge = step(0.48, fres) * smoothstep(0.48, 0.92, fres);
      col = mix(col, col * 0.80, edge * 0.42);

      // ---- 6. 接收方向光阴影（手动 3×3 软阴影，BasicShadowMap）----
      #ifdef RECEIVE_SHADOW
        vec3 proj = vShadowCoord.xyz / vShadowCoord.w;
        if (proj.x >= 0.0 && proj.x <= 1.0 && proj.y >= 0.0 && proj.y <= 1.0 && proj.z <= 1.0) {
          float shadow = 0.0;
          vec2 texel = 1.0 / uShadowMapSize;
          for (int i = -1; i <= 1; i++) {
            for (int j = -1; j <= 1; j++) {
              vec2 off = vec2(float(i), float(j)) * texel * 3.5;
              float d = texture2D(uShadowMap, proj.xy + off).r;
              shadow += (proj.z - uShadowBias > d) ? 1.0 : 0.0;
            }
          }
          col *= 1.0 - shadow * (1.0 / 9.0) * uShadowIntensity;
        }
      #endif

      // ---- 7. 氛围染色（白天白/黄昏暖/夜晚冷暗，由 main.js 每帧同步 uTint）----
      col *= uTint;

      gl_FragColor = vec4(col, uAlpha);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, defines,
    transparent: alpha < 1.0,
    side: THREE.DoubleSide,
    toneMapped: false,   // 自定义着色器手动控色，关闭自动色调映射
  });
  mat.receiveShadow = receiveShadow;   // 语义标记：是否启用自定义手动阴影
  return mat;
}

/* ============================================================
 * 三、天空渐变着色器（大球体内表面）
 *  ------------------------------------------------------------
 *  三种氛围共用同一材质，仅切换 uniform 配色。
 * ============================================================ */
export function skyMaterial() {
  const uniforms = {
    uTop: { value: new THREE.Color('#a8d8ea') },      // 天顶色
    uHorizon: { value: new THREE.Color('#eaf4ea') },  // 地平线色
    uSunDir: { value: new THREE.Vector3(0.5, 0.4, 0.3).normalize() },
    uSunColor: { value: new THREE.Color('#fff6d8') },
    uSunStrength: { value: 0.35 },
  };
  const vertexShader = /* glsl */ `
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform vec3 uTop;
    uniform vec3 uHorizon;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uSunStrength;
    varying vec3 vWorldPos;

    void main() {
      vec3 dir = normalize(vWorldPos);
      float h = clamp(dir.y * 1.6, 0.0, 1.0);          // 高度因子
      vec3 col = mix(uHorizon, uTop, pow(h, 0.8));
      // 柔和太阳光斑
      float sun = max(dot(dir, normalize(uSunDir)), 0.0);
      float glow = pow(sun, 24.0) + pow(sun, 4.0) * 0.25;
      col += uSunColor * glow * uSunStrength;
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
}

/* ============================================================
 * 四、溪流波光着色器
 *  ------------------------------------------------------------
 *  顶点轻微起伏 + 片元移动波光带 + 高频闪光（模拟水面波光）
 * ============================================================ */
export function waterMaterial(opts = {}) {
  const {
    deep = '#7fb4c9', shallow = '#cfe6ee', sparkle = '#ffffff',
  } = opts;
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(deep) },
    uShallow: { value: new THREE.Color(shallow) },
    uSparkle: { value: new THREE.Color(sparkle) },
  };
  const vertexShader = /* glsl */ `
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vec3 pos = position;
      // 顶点轻微起伏（流水涟漪）
      pos.y += sin(pos.x * 1.8 + uTime * 0.9) * 0.05
             + cos(pos.z * 1.4 + uTime * 0.7) * 0.05;
      vec4 wp = modelMatrix * vec4(pos, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform float uTime;
    uniform vec3 uDeep;
    uniform vec3 uShallow;
    uniform vec3 uSparkle;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    ${GLSL_NOISE}

    void main() {
      // 深浅过渡
      vec2 p = vWorldPos.xz * 0.5;
      float d = valueNoise(p * 1.2 + vec2(3.0, 1.0));
      vec3 col = mix(uDeep, uShallow, smoothstep(0.35, 0.75, d));
      // 移动波光带
      float wave = sin((vUv.x * 8.0 - uTime * 1.1) + sin(vUv.y * 14.0 + uTime * 1.4) * 0.6);
      float band = smoothstep(0.6, 1.0, wave);
      col = mix(col, uShallow, band * 0.45);
      // 高频闪光（波光粼粼）
      float s = valueNoise(p * 12.0 + vec2(uTime * 1.2, -uTime * 0.8));
      float glint = smoothstep(0.82, 1.0, s);
      col = mix(col, uSparkle, glint * 0.8);
      gl_FragColor = vec4(col, 0.92);
    }
  `;
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, side: THREE.DoubleSide, toneMapped: false,
  });
}

/* ============================================================
 * 五、程序化纹理生成（Canvas 绘制，零外部图片）
 * ============================================================ */

/** 纸张肌理：米白底 + 细微纤维噪点 */
export function makePaperTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f5f2e8';
  g.fillRect(0, 0, 256, 256);
  // 随机细纤维
  for (let i = 0; i < 2600; i++) {
    const v = 235 + Math.random() * 20;
    g.strokeStyle = `rgba(${v},${v},${v - 8},${0.03 + Math.random() * 0.05})`;
    g.lineWidth = 0.5 + Math.random();
    g.beginPath();
    const x = Math.random() * 256, y = Math.random() * 256;
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 彩铅噪点：细颗粒点阵 */
export function makePencilTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.random() * 225;
    g.fillStyle = `rgba(${v},${v},${v},0.12)`;
    const x = Math.random() * 128, y = Math.random() * 128;
    g.fillRect(x, y, 1 + Math.random(), 1 + Math.random());
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 柔光圆斑（雾、萤火虫通用） */
export function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** 花瓣贴图：手绘水滴形花瓣 */
export function makePetalTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  // 花瓣：圆弧形
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(32, 2);
  g.bezierCurveTo(58, 18, 58, 48, 32, 62);
  g.bezierCurveTo(6, 48, 6, 18, 32, 2);
  g.fill();
  // 中部浅色纹路
  g.fillStyle = 'rgba(255,182,193,0.5)';
  g.beginPath();
  g.moveTo(32, 10);
  g.bezierCurveTo(44, 22, 44, 44, 32, 56);
  g.bezierCurveTo(20, 44, 20, 22, 32, 10);
  g.fill();
  return new THREE.CanvasTexture(c);
}

/** 星空贴图（夜晚用，Canvas 随机星点） */
export function makeStarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 260; i++) {
    const b = 140 + Math.random() * 115;
    g.fillStyle = `rgba(${b},${b + 30},255,${0.4 + Math.random() * 0.6})`;
    const r = Math.random() * 1.6 + 0.4;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 卡通渐变图（MeshToonMaterial 用）：3 阶明暗 */
export function makeToonGradient() {
  const data = new Uint8Array([140, 190, 255]); // 3 个灰阶
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
export function lightGradientMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: { value: new THREE.Vector3(0.45, 0.55, 0.35).normalize() },
      uLightColor: { value: new THREE.Color('#fff4cf') },
      uShadowColor: { value: new THREE.Color('#0e1733') },
      uIntensity: { value: 0.15 },
      uTime: { value: 0 },
    },
    vertexShader: /*glsl*/`
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /*glsl*/`
      precision highp float;
      uniform vec3 uLightDir;
      uniform vec3 uLightColor;
      uniform vec3 uShadowColor;
      uniform float uIntensity;
      uniform float uTime;

      varying vec3 vWorldPos;
      varying vec3 vNormal;

      void main() {
        float ndl = dot(vNormal, normalize(uLightDir));
        float lightFactor = ndl * 0.5 + 0.5;
        float mask = smoothstep(0.02, 0.35, lightFactor);
        vec3 color = mix(uShadowColor, uLightColor, mask);
        gl_FragColor = vec4(color, uIntensity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/* ============================================================
 * 六、喷泉水材质（半透明水柱：垂直渐变 + 菲涅尔 + 流动）
 * ============================================================ */
export function fountainWaterMaterial(opts = {}) {
  const { deep = '#8ccde4', shallow = '#e8f7ff' } = opts;
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(deep) },
    uShallow: { value: new THREE.Color(shallow) },
  };
  const vertexShader = /* glsl */ `
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const fragmentShader = /* glsl */ `
    precision highp float;
    uniform float uTime;
    uniform vec3 uDeep;
    uniform vec3 uShallow;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      // 高度渐变：喷口附近浅、高处偏深
      float h = clamp((vWorldPos.y - 0.6) / 4.4, 0.0, 1.0);
      vec3 col = mix(uShallow, uDeep, h * 0.55);
      // 菲涅尔：边缘更亮，水感
      vec3 V = normalize(cameraPosition - vWorldPos);
      float fres = pow(1.0 - clamp(dot(normalize(vNormal), V), 0.0, 1.0), 2.0);
      col = mix(col, uShallow, fres * 0.7);
      // 轻微流动波纹
      col += uShallow * 0.05 * sin(vWorldPos.y * 5.0 - uTime * 2.2);
      gl_FragColor = vec4(col, 0.5);
    }
  `;
  return new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
}

