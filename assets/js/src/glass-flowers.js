// Glass flowers: three procedural flowers (rose, daisy, tulip), loose petals
// and orbs in tinted glass.
//   mountFlowers(host)  - the /calls/ hero stage (refractive glass over a
//                         soft cobalt backdrop drawn in the scene);
//   mountOrnaments()    - one fixed, transparent canvas for the whole page
//                         that draws a flower into every visible .glass-3d
//                         element (scissored viewports, so one WebGL context).
// Built into assets/js/glass-flowers.js with (three@0.170.0):
//   npx esbuild assets/js/src/glass-flowers.js --bundle --minify --format=esm --outfile=assets/js/glass-flowers.js
// Pages keep working without it; nothing here is needed for content.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BufferGeometry, Float32BufferAttribute,
  SphereGeometry, IcosahedronGeometry, MeshPhysicalMaterial, Color, DoubleSide, CanvasTexture,
  SRGBColorSpace, ACESFilmicToneMapping, PMREMGenerator, DirectionalLight, MathUtils, Vector2,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const TAU = Math.PI * 2;

// A petal lying along +Z, bent upwards (Y) towards the tip and cupped across.
function petalGeometry({ length = 1, width = 0.4, cup = 0.3, cross = 0.25, round = 0.6, tipCurl = 0, segL = 26, segW = 14 }) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= segL; i++) {
    const v = i / segL;
    // width profile: rounded (rose) to pointed (daisy)
    const base = Math.sin(Math.PI * Math.min(1, v * 0.96 + 0.02));
    const w = width * Math.pow(base, round) * (0.35 + 0.65 * Math.sqrt(v));
    for (let j = 0; j <= segW; j++) {
      const u = j / segW - 0.5;
      const x = u * w;
      const z = v * length;
      const y = cup * v * v * length + cross * (4 * u * u) * w - tipCurl * Math.pow(v, 6) * length;
      pos.push(x, y, z);
    }
  }
  const row = segW + 1;
  for (let i = 0; i < segL; i++) {
    for (let j = 0; j < segW; j++) {
      const a = i * row + j;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const g = new BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function glass(opts = {}) {
  return new MeshPhysicalMaterial({
    color: new Color(opts.color ?? 0xdfe8ff),
    metalness: 0,
    roughness: opts.roughness ?? 0.06,
    transmission: 1,
    thickness: opts.thickness ?? 0.55,
    ior: 1.5,
    attenuationColor: new Color(opts.attenuation ?? 0x2f5fd0),
    attenuationDistance: opts.attDist ?? 1.4,
    iridescence: opts.iridescence ?? 0.55,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [120, 420],
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    specularIntensity: 1,
    envMapIntensity: opts.env ?? 1.25,
    side: DoubleSide,
    transparent: false,
  });
}

// Ring of petals around Y. tilt: angle from the horizontal plane (0 = flat).
function ring(group, geo, mat, count, tilt, offset = 0, lift = 0) {
  const list = [];
  for (let k = 0; k < count; k++) {
    const pivot = new Group();
    pivot.rotation.y = offset + (k / count) * TAU;
    const hinge = new Group();
    hinge.position.y = lift;
    hinge.rotation.x = -tilt;
    const m = new Mesh(geo, mat);
    hinge.add(m);
    pivot.add(hinge);
    group.add(pivot);
    list.push({ hinge, tilt });
  }
  return list;
}

function makeRose(mat, inner) {
  const g = new Group();
  const petals = [];
  const outer = petalGeometry({ length: 0.95, width: 0.95, cup: 0.55, cross: 0.32, round: 0.45, tipCurl: 0.12 });
  const mid = petalGeometry({ length: 0.78, width: 0.8, cup: 0.6, cross: 0.36, round: 0.45, tipCurl: 0.08 });
  const inn = petalGeometry({ length: 0.6, width: 0.62, cup: 0.7, cross: 0.42, round: 0.5 });
  petals.push(...ring(g, outer, mat, 5, 0.35, 0, 0));
  petals.push(...ring(g, mid, mat, 5, 0.82, TAU / 10, 0.05));
  petals.push(...ring(g, inn, inner, 5, 1.2, 0, 0.1));
  const bud = petalGeometry({ length: 0.42, width: 0.5, cup: 0.9, cross: 0.5, round: 0.5 });
  petals.push(...ring(g, bud, inner, 3, 1.42, 0.4, 0.14));
  return { g, petals };
}

function makeDaisy(mat, centerMat) {
  const g = new Group();
  const geo = petalGeometry({ length: 1.05, width: 0.26, cup: 0.22, cross: 0.35, round: 0.9, tipCurl: 0.05, segW: 8 });
  const petals = [
    ...ring(g, geo, mat, 14, 0.12, 0, 0),
    ...ring(g, petalGeometry({ length: 0.86, width: 0.24, cup: 0.3, cross: 0.35, round: 0.9, segW: 8 }), mat, 14, 0.32, TAU / 28, 0.04),
  ];
  const c = new Mesh(new SphereGeometry(0.24, 40, 24), centerMat);
  c.scale.set(1, 0.55, 1);
  c.position.y = 0.08;
  g.add(c);
  return { g, petals };
}

function makeTulip(mat, inner) {
  const g = new Group();
  const outer = petalGeometry({ length: 1.05, width: 0.82, cup: 0.18, cross: 0.34, round: 0.55, tipCurl: 0.22 });
  const inn = petalGeometry({ length: 0.98, width: 0.72, cup: 0.42, cross: 0.42, round: 0.55 });
  const petals = [...ring(g, outer, mat, 3, 0.98, 0, 0), ...ring(g, inn, inner, 3, 1.22, TAU / 6, 0.03)];
  const c = new Mesh(new SphereGeometry(0.13, 24, 16), inner);
  c.position.y = 0.12;
  g.add(c);
  return { g, petals };
}

// Soft cobalt backdrop drawn at the stage's aspect ratio; fx = bouquet centre (0..1).
function backdrop(aspect, fx) {
  const H = 640;
  const W = Math.round(Math.min(2048, Math.max(400, H * aspect)));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const lg = x.createLinearGradient(0, 0, W, H);
  lg.addColorStop(0, '#f5f8ff');
  lg.addColorStop(0.55, '#e4ecff');
  lg.addColorStop(1, '#cfdcfb');
  x.fillStyle = lg;
  x.fillRect(0, 0, W, H);
  const cx = W * fx;
  const blob = (bx, by, r, rgb, a) => {
    const rg = x.createRadialGradient(bx, by, 0, bx, by, r);
    rg.addColorStop(0, `rgba(${rgb},${a})`);
    rg.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = rg;
    x.fillRect(0, 0, W, H);
  };
  blob(cx + 40, H * 0.28, H * 0.55, '29,75,168', 0.5);
  blob(cx + H * 0.35, H * 0.85, H * 0.42, '63,115,209', 0.42);
  blob(cx - H * 0.45, H * 0.9, H * 0.45, '150,170,255', 0.38);
  blob(cx - H * 0.15, H * 0.45, H * 0.2, '255,255,255', 0.65);
  blob(W * 0.12, H * 0.15, H * 0.5, '255,255,255', 0.85);
  // fine porcelain rings, echoing the hand-painted flowers on the site
  x.strokeStyle = 'rgba(29,75,168,.09)';
  x.lineWidth = 1.2;
  for (let i = 0; i < 10; i++) {
    x.beginPath();
    x.arc(cx, H * 0.5, 80 + i * 44, 0, TAU);
    x.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function mountFlowers(host, { reduced = false } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-3, 5, 4);
  scene.add(sun);

  const camera = new PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 0.4, 7.2);

  const blue = glass({ color: 0xe6edff, attenuation: 0x2a5bd0, attDist: 2.4, iridescence: 0.7 });
  const pale = glass({ color: 0xf2f6ff, attenuation: 0x7ea0ec, attDist: 2.2, iridescence: 0.8 });
  const deep = glass({ color: 0xd2deff, attenuation: 0x1d4ba8, attDist: 1.5, iridescence: 0.5 });
  const pearl = glass({ color: 0xffffff, roughness: 0.28, attenuation: 0xc7d6ff, attDist: 3, iridescence: 1, thickness: 1.2 });

  const world = new Group();
  scene.add(world);

  const rose = makeRose(blue, deep);
  const daisy = makeDaisy(pale, pearl);
  const tulip = makeTulip(deep, blue);
  const flowers = [
    { ...rose, home: [0.75, 0.05, 0.4], rot: [0.95, 0.2, -0.25], scale: 1.15, spin: 0.12, phase: 0 },
    { ...daisy, home: [-0.85, 0.95, -0.5], rot: [1.05, 0, 0.35], scale: 0.95, spin: -0.09, phase: 2.1 },
    { ...tulip, home: [-0.6, -1.05, 0.25], rot: [0.55, 0, 0.42], scale: 0.95, spin: 0.07, phase: 4.2 },
  ];
  for (const f of flowers) {
    f.g.scale.setScalar(0.001);
    f.g.rotation.set(...f.rot);
    const holder = new Group();
    holder.position.set(...f.home);
    holder.add(f.g);
    world.add(holder);
    f.holder = holder;
  }

  // loose petals and glass orbs drifting around the bouquet
  const floaters = [];
  const loose = petalGeometry({ length: 0.42, width: 0.32, cup: 0.35, cross: 0.3, round: 0.5, segL: 14, segW: 8 });
  const orb = new IcosahedronGeometry(1, 6);
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 9; i++) {
    const isOrb = i % 3 === 0;
    const m = new Mesh(isOrb ? orb : loose, isOrb ? pearl : [blue, pale, deep][i % 3]);
    const s = isOrb ? rnd(0.08, 0.2) : rnd(0.7, 1.1);
    m.scale.setScalar(s);
    const a = (i / 9) * TAU + rnd(-0.3, 0.3);
    const r = rnd(1.7, 2.4);
    const p = { m, base: [Math.cos(a) * r * 1.15, Math.sin(a) * r * 0.75, rnd(-1.2, 0.6)], sp: rnd(0.3, 0.7), ph: rnd(0, TAU), rs: [rnd(-0.6, 0.6), rnd(-0.6, 0.6)] };
    m.position.set(...p.base);
    world.add(m);
    floaters.push(p);
  }

  // layout: bouquet on the right of wide stages, centred on narrow ones
  let bgKey = '';
  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const wide = camera.aspect > 1.3;
    camera.fov = wide ? 34 : 40;
    camera.updateProjectionMatrix();
    const hh = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const hw = hh * camera.aspect;
    const cx = wide ? hw * 0.42 : 0;
    world.position.set(cx, 0, 0);
    // bouquet spans about x -2.4..2.2, y -2.1..2.0 at scale 1
    world.scale.setScalar(Math.min(1.2, hh / 2.0, (wide ? hw * 0.58 : hw) / 2.4));
    const fx = 0.5 + cx / (2 * hw);
    const key = `${Math.round(camera.aspect * 10)}:${Math.round(fx * 20)}`;
    if (key !== bgKey) {
      bgKey = key;
      if (scene.background) scene.background.dispose();
      scene.background = backdrop(camera.aspect, fx);
    }
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const pointer = new Vector2();
  const look = new Vector2();
  const onMove = (e) => {
    const r = host.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  let visible = true;
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loop(); });
  io.observe(host);

  let celebrateAt = -10;
  const start = performance.now();
  let raf = 0;
  let last = start;

  function frame(now) {
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    look.lerp(pointer, 1 - Math.pow(0.002, dt));
    world.rotation.y = look.x * 0.22;
    world.rotation.x = look.y * 0.12;

    const party = Math.max(0, 1 - (t - celebrateAt) / 2.4);
    flowers.forEach((f, i) => {
      // bloom in: grow and open over ~1.6 s, one after another
      const k = reduced ? 1 : MathUtils.clamp((t - 0.15 - i * 0.22) / 1.6, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      f.g.scale.setScalar(Math.max(0.001, f.scale * (0.35 + 0.65 * e)) * (1 + party * 0.06 * Math.sin(t * 9 + i)));
      const breathe = reduced ? 0 : Math.sin(t * 0.9 + f.phase) * 0.05;
      for (const p of f.petals) p.hinge.rotation.x = -(p.tilt + (1 - e) * (1.45 - p.tilt) * 0.9 + breathe * (1.6 - p.tilt));
      if (!reduced) {
        f.holder.position.y = f.home[1] + Math.sin(t * 0.7 + f.phase) * 0.09;
        f.g.rotation.y += dt * (f.spin + party * 2.2 * Math.sign(f.spin));
      }
    });
    if (!reduced) {
      for (const p of floaters) {
        p.m.position.y = p.base[1] + Math.sin(t * p.sp + p.ph) * 0.22;
        p.m.position.x = p.base[0] + Math.cos(t * p.sp * 0.7 + p.ph) * 0.12;
        p.m.rotation.x += dt * p.rs[0];
        p.m.rotation.z += dt * p.rs[1];
      }
    }
    renderer.render(scene, camera);
  }

  function loop() {
    cancelAnimationFrame(raf);
    const step = (now) => {
      frame(now);
      const settling = (now - start) / 1000 < 3;
      if (visible && !document.hidden && (!reduced || settling)) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) loop(); });
  loop();

  return {
    celebrate() { celebrateAt = (performance.now() - start) / 1000; if (reduced) frame(performance.now()); else loop(); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); window.removeEventListener('pointermove', onMove); renderer.dispose(); },
  };
}


// ── page ornaments ──────────────────────────────────────────────────────
// Glass that reads over HTML (the canvas is transparent, so there is no
// scene behind the petals to refract): clear tinted petals with strong
// reflections, iridescent edges and some see-through.
function overlayGlass(opts = {}) {
  return new MeshPhysicalMaterial({
    color: new Color(opts.color ?? 0xcfdcff),
    metalness: 0,
    roughness: opts.roughness ?? 0.07,
    transparent: true,
    opacity: opts.opacity ?? 0.62,
    iridescence: opts.iridescence ?? 0.75,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [140, 460],
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    specularIntensity: 1,
    envMapIntensity: opts.env ?? 1.7,
    side: DoubleSide,
    depthWrite: opts.depthWrite ?? true,
  });
}

export function mountOrnaments({ selector = '.glass-3d', reduced = false } = {}) {
  const els = [...document.querySelectorAll(selector)];
  if (!els.length) return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'glass-3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:40';
  document.body.appendChild(canvas);
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.autoClear = false;
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const mats = {
    blue: overlayGlass({ color: 0x6f95ec, opacity: 0.8, iridescence: 0.8 }),
    deep: overlayGlass({ color: 0x2c5ccc, opacity: 0.86, iridescence: 0.55 }),
    pale: overlayGlass({ color: 0x9db7f6, opacity: 0.8, iridescence: 1 }),
    pearl: overlayGlass({ color: 0xe8efff, opacity: 0.92, roughness: 0.2, iridescence: 1 }),
  };
  const build = {
    rose: () => makeRose(mats.blue, mats.deep),
    daisy: () => makeDaisy(mats.pale, mats.pearl),
    tulip: () => makeTulip(mats.deep, mats.blue),
  };
  const loose = petalGeometry({ length: 0.42, width: 0.32, cup: 0.35, cross: 0.3, round: 0.5, segL: 14, segW: 8 });
  const orb = new IcosahedronGeometry(1, 5);
  const rnd = (a, b) => a + Math.random() * (b - a);

  const items = els.map((el, n) => {
    const kind = build[el.dataset.flower] ? el.dataset.flower : ['rose', 'daisy', 'tulip'][n % 3];
    const scene = new Scene();
    scene.environment = env;
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(-3, 5, 4);
    scene.add(sun);
    const camera = new PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0, 6.2);
    const holder = new Group();
    scene.add(holder);
    const f = build[kind]();
    const tilt = Number(el.dataset.tilt || 0.85);
    f.g.rotation.set(tilt, rnd(0, TAU), rnd(-0.3, 0.3));
    f.g.scale.setScalar(0.001);
    holder.add(f.g);
    const floaters = [];
    const extra = el.dataset.extra === '0' ? 0 : 3;
    for (let i = 0; i < extra; i++) {
      const isOrb = i !== 1;
      const m = new Mesh(isOrb ? orb : loose, isOrb ? mats.pearl : mats.blue);
      m.scale.setScalar(isOrb ? rnd(0.06, 0.11) : rnd(0.55, 0.75));
      const a = (i / extra) * TAU + rnd(-0.4, 0.4);
      const base = [Math.cos(a) * 1.0, Math.sin(a) * 0.9, rnd(-0.3, 0.3)];
      m.position.set(...base);
      holder.add(m);
      floaters.push({ m, base, sp: rnd(0.4, 0.8), ph: rnd(0, TAU), rs: [rnd(-0.6, 0.6), rnd(-0.6, 0.6)] });
    }
    return { el, scene, camera, holder, f, floaters, kind, born: -1, spin: (n % 2 ? -1 : 1) * rnd(0.08, 0.14), phase: rnd(0, TAU), visible: false };
  });

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const it = items.find((x) => x.el === en.target);
      if (it) it.visible = en.isIntersecting && en.boundingClientRect.width > 4;
    }
    kick();
  }, { rootMargin: '120px 0px' });
  items.forEach((it) => io.observe(it.el));

  const pointer = new Vector2();
  const look = new Vector2();
  const onMove = (e) => pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  window.addEventListener('pointermove', onMove, { passive: true });
  let lastScroll = window.scrollY;
  let scrollVel = 0;

  const start = performance.now();
  let last = start;
  let raf = 0;
  let running = false;
  let W = 0;
  let H = 0;

  function frame(now) {
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (innerWidth !== W || innerHeight !== H) { W = innerWidth; H = innerHeight; renderer.setSize(W, H, false); }
    const sy = window.scrollY;
    scrollVel += ((sy - lastScroll) - scrollVel) * 0.2;
    lastScroll = sy;
    look.lerp(pointer, 1 - Math.pow(0.003, dt));

    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    let any = false;
    for (const it of items) {
      if (!it.visible) continue;
      const r = it.el.getBoundingClientRect();
      if (r.width < 4 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
      any = true;
      if (it.born < 0) it.born = t;
      const k = reduced ? 1 : MathUtils.clamp((t - it.born) / 1.6, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      it.f.g.scale.setScalar(Math.max(0.001, 0.4 + 0.6 * e));
      const breathe = reduced ? 0 : Math.sin(t * 0.9 + it.phase) * 0.05;
      for (const p of it.f.petals) p.hinge.rotation.x = -(p.tilt + (1 - e) * (1.45 - p.tilt) * 0.9 + breathe * (1.6 - p.tilt));
      if (!reduced) {
        it.f.g.rotation.y += dt * it.spin + scrollVel * 0.0025;
        it.holder.position.y = Math.sin(t * 0.7 + it.phase) * 0.08;
        it.holder.rotation.y = look.x * 0.25;
        it.holder.rotation.x = look.y * 0.15;
        for (const p of it.floaters) {
          p.m.position.y = p.base[1] + Math.sin(t * p.sp + p.ph) * 0.15;
          p.m.rotation.x += dt * p.rs[0];
          p.m.rotation.z += dt * p.rs[1];
        }
      }
      it.camera.aspect = r.width / r.height;
      // the flower (radius ~1.2) fills the box; floaters may brush the edges
      const fit = 1.32 / Math.tan(MathUtils.degToRad(15)) / Math.min(1, it.camera.aspect);
      it.camera.position.z = fit;
      it.camera.updateProjectionMatrix();
      renderer.setViewport(r.left, H - r.bottom, r.width, r.height);
      renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
      renderer.render(it.scene, it.camera);
    }
    return any;
  }

  function step(now) {
    const any = frame(now);
    const settling = items.some((it) => it.visible && it.born >= 0 && (now - start) / 1000 - it.born < 2);
    if (!document.hidden && (any || settling) && (!reduced || settling)) raf = requestAnimationFrame(step);
    else running = false;
  }
  function kick() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(step);
  }
  // with reduced motion there is no loop: redraw on scroll so flowers stay in place
  window.addEventListener('scroll', () => { if (reduced) requestAnimationFrame(frame); else kick(); }, { passive: true });
  window.addEventListener('resize', () => requestAnimationFrame(frame), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  kick();

  return {
    destroy() { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('pointermove', onMove); renderer.dispose(); canvas.remove(); },
  };
}
