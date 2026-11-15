// SI disclosure (NASA Space Apps 2026): this file was generated with Claude (Anthropic), a large language model, directed by the team.
// The 3D Earth. This is the only module that touches three.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EARTH_VERT, EARTH_FRAG, ATMO_VERT, ATMO_FRAG, ATMO_SCALE, earthUniformDefaults, EARTH_SAMPLERS, SIM_VERT, SIM_FRAG, SIM_W, SIM_H } from './shaders.js';
import { createSimDriver, physUniforms } from './simdriver.js';
import { EBM } from './ebm.js';
import { latLonToVec3, vec3ToLatLon } from './geo.js';

export function createGlobe(canvas, { onPick, onInteract } = {}) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  camera.position.set(...latLonToVec3(8, -72));
  camera.lookAt(0, 0, 0);

  // ---- uniforms: plain values wrapped as { value } ----
  const defaults = earthUniformDefaults();
  const uniforms = {};
  for (const [k, v] of Object.entries(defaults)) uniforms[k] = { value: v };
  for (const k of EARTH_SAMPLERS) uniforms[k] = { value: null };

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 80),
    new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }),
  );
  scene.add(earth);

  const atmoUniforms = { uAtmo: { value: 1 }, uSunDir: { value: [1, 0.4, 0.6] } };
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(ATMO_SCALE, 96, 48),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  scene.add(atmo);

  // ---- a sparse, flat star field ----
  {
    const n = 700;
    const pos = new Float32Array(n * 3);
    let seed = 20261114;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      pos.set([r * Math.cos(a) * 40, z * 40, r * Math.sin(a) * 40], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8d949e, size: 1.4, sizeAttenuation: false })));
  }

  // ---- camera controls ----
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.35;
  controls.maxDistance = 9;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.35;
  const stopSpin = () => { controls.autoRotate = false; };
  controls.addEventListener('start', () => { stopSpin(); fly = null; onInteract?.(); });

  // ---- picking: a click that is not a drag ----
  const raycaster = new THREE.Raycaster();
  const unit = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
  const hit = new THREE.Vector3();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved > 6 || !quick) return;
    const ll = pick(e.clientX, e.clientY);
    if (ll) onPick?.(ll);
  });

  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectSphere(unit, hit) ? vec3ToLatLon([hit.x, hit.y, hit.z]) : null;
  }

  // ---- textures ----
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  function setImage(name, url, { repeatX = false, mipmaps = true, accept } = {}) {
    return new Promise((resolve, reject) => {
      loader.load(url, (tex) => {
        if (accept && !accept()) { tex.dispose(); resolve(null); return; }
        tex.wrapS = repeatX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = mipmaps;
        tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = mipmaps ? maxAniso : 1;
        tex.needsUpdate = true;
        uniforms[name].value?.dispose?.();
        uniforms[name].value = tex;
        resolve(tex);
      }, undefined, () => reject(new Error(`image failed: ${url}`)));
    });
  }

  function setData(name, width, height, bytes) {
    const tex = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    uniforms[name].value?.dispose?.();
    uniforms[name].value = tex;
  }

  function set(name, value) {
    if (name === 'uAtmo') { atmoUniforms.uAtmo.value = value; uniforms.uAtmoMix.value = value; }
    else if (uniforms[name]) uniforms[name].value = value;
  }

  // ---- prediction engine: the energy balance model, stepped on the GPU ----
  // Two floating-point render targets hold the state; every pass is one time step.
  function createSim() {
    if (!renderer.extensions.has('EXT_color_buffer_float')) return null; // cannot render to float textures
    const opts = {
      type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    };
    let front = new THREE.WebGLRenderTarget(SIM_W, SIM_H, opts);
    let back = new THREE.WebGLRenderTarget(SIM_W, SIM_H, opts);
    const u = {
      uState: { value: null }, uOcean: { value: null }, uRes: { value: [SIM_W, SIM_H] },
      uInit: { value: 0 }, uDt: { value: 0 }, uF: { value: 0 },
      uLam: { value: new Float32Array(SIM_H) }, uGam: { value: new Float32Array(SIM_H).fill(EBM.GAMMA) }, uT0: { value: new Float32Array(SIM_H) },
      uTd0: { value: new Float32Array(SIM_H) }, uPi: { value: new Float32Array(SIM_H) },
    };
    for (const [k, v] of Object.entries(physUniforms(EBM))) u[k] = { value: v };
    const simScene = new THREE.Scene();
    const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: u, vertexShader: SIM_VERT, fragmentShader: SIM_FRAG, depthTest: false, depthWrite: false }),
    );
    quad.frustumCulled = false;
    simScene.add(quad);

    const pass = () => {
      u.uState.value = front.texture;
      renderer.setRenderTarget(back);
      renderer.render(simScene, simCamera);
      [front, back] = [back, front];
    };
    const driver = createSimDriver({
      load(c) {
        u.uLam.value = c.lam; u.uGam.value = c.gam; u.uT0.value = c.T0; u.uTd0.value = c.Td0; u.uPi.value = c.pi;
        const tex = new THREE.DataTexture(c.oceanBytes, SIM_W, SIM_H, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.minFilter = tex.magFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
        u.uOcean.value?.dispose?.();
        u.uOcean.value = tex;
      },
      init() { u.uInit.value = 1; pass(); u.uInit.value = 0; },
      steps(n, dt, F) { u.uDt.value = dt; u.uF.value = F; for (let i = 0; i < n; i++) pass(); },
    });
    return { driver, texture: () => front.texture };
  }

  let sim = null;
  try { sim = createSim(); } catch (e) { console.warn('GPU solver unavailable, using the CPU model', e); sim = null; }
  const simApi = {
    supported: !!sim,
    configure(c) { if (sim) { sim.driver.configure(c); renderer.setRenderTarget(null); uniforms.uSim.value = sim.texture(); } },
    setTarget(y) { sim?.driver.setTarget(y); },
    get year() { return sim ? sim.driver.year : null; },
  };

  // ---- camera flight ----
  let fly = null;
  function flyTo(lat, lon, distance) {
    stopSpin();
    const target = new THREE.Vector3(...latLonToVec3(lat, lon));
    const d1 = distance ?? camera.position.length();
    if (reduceMotion) {
      camera.position.copy(target.multiplyScalar(d1));
      camera.lookAt(0, 0, 0);
      return;
    }
    fly = { from: camera.position.clone().normalize(), to: target, d0: camera.position.length(), d1, t0: performance.now(), dur: 1100 };
  }

  // ---- size ----
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole globe in view on tall, narrow screens
    camera.fov = w / h < 0.9 ? 44 : 32;
    camera.updateProjectionMatrix();
  }
  // distance at which the whole globe fits the smaller side of the canvas
  function fitDistance() {
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    const lim = Math.atan(Math.tan(half) * Math.min(1, camera.aspect));
    return 1 / Math.sin(lim * 0.84);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  camera.position.setLength(fitDistance());
  const zoomOut = () => {
    const ll = vec3ToLatLon(camera.position.toArray());
    flyTo(ll.lat, ll.lon, fitDistance());
  };

  // ---- frame loop ----
  const right = new THREE.Vector3(), up = new THREE.Vector3(), sun = new THREE.Vector3(), tmp = new THREE.Vector3();
  let sunSide = 0.8;
  const t0 = performance.now();
  function frame(now) {
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      tmp.copy(fly.from).lerp(fly.to, e);
      if (tmp.lengthSq() < 1e-6) tmp.set(0, 1, 0);
      tmp.normalize().multiplyScalar(fly.d0 + (fly.d1 - fly.d0) * e);
      camera.position.copy(tmp);
      camera.lookAt(0, 0, 0);
      if (k >= 1) fly = null;
    }
    controls.rotateSpeed = Math.min(1, (camera.position.length() - 1) * 0.45);
    controls.update();

    // The sun stays over the viewer's shoulder so the visible side is always lit. In the
    // natural view it sits further to the side, so night shows along one edge of the globe.
    camera.matrixWorld.extractBasis(right, up, tmp);
    const side = uniforms.uMode.value < 0.5 ? 1.5 : 0.8;
    sunSide = reduceMotion ? side : sunSide + (side - sunSide) * 0.06;
    sun.copy(camera.position).normalize().addScaledVector(right, sunSide).addScaledVector(up, 0.35).normalize();
    uniforms.uSunDir.value = [sun.x, sun.y, sun.z];
    atmoUniforms.uSunDir.value = uniforms.uSunDir.value;
    uniforms.uTime.value = reduceMotion ? 0 : (now - t0) / 1000;
    uniforms.uPx.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / renderer.domElement.height;
    // clouds thin out as you approach, so the surface and the data stay readable
    uniforms.uCloudAmt.value = Math.max(0.12, Math.min(0.85, (camera.position.length() - 1.5) / 1.6));

    // let the model run towards the selected year, a couple of model years per frame
    if (sim && sim.driver.ready) {
      try {
        if (sim.driver.tick(2)) uniforms.uSim.value = sim.texture();
      } catch (e) { console.warn('GPU solver stopped', e); sim = null; uniforms.uSimOn.value = 0; }
      renderer.setRenderTarget(null);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { set, setImage, setData, flyTo, zoomOut, pick, stopSpin, sim: simApi };
}
