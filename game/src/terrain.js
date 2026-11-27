// Terrain: one alpine valley — snow peaks north, ridges east/west, a river,
// a lake south, a village, a runway (RWY 36), turbines and a lighthouse.
// The height function IS the ground truth: the flight model queries the
// same function the mesh is built from. Flat-shaded vertex colours, Alpine
// low-poly look: sand -> grass -> rock -> snow, jittered per vertex.
import * as THREE from 'three';
import { WORLD, RUNWAY, SEED } from './config.js';
import { makeNoise, clamp, lerp, smoothstep } from './random.js';

const fbm = makeNoise(SEED);
const fbm2 = makeNoise(SEED + 77);

export function groundHeight(x, z) {
  const half = WORLD.size / 2;
  // valley floor along the z axis, ridges rising with |x|
  const ax = Math.abs(x);
  let h = 42;
  h += smoothstep(180, 900, ax) * 620;                    // side ridges
  h += smoothstep(900, 1500, ax) * 320;                   // high shoulders
  h += smoothstep(-600, -2100, z) * 420;                  // north peaks
  h += smoothstep(900, 2100, z) * -30;                    // south opens to the lake
  // rolling noise, stronger on the ridges
  const n = fbm(x * 0.0016 + 7.3, z * 0.0016 - 2.1, 4);
  h += n * (60 + smoothstep(180, 900, ax) * 220);
  const n2 = fbm2(x * 0.006, z * 0.006, 3);
  h += n2 * 14;
  // river channel carved down the valley (river line wanders with x)
  const riverX = -60 + 90 * Math.sin(z * 0.0009) + 30 * Math.sin(z * 0.0027);
  const dRiver = Math.abs(x - riverX);
  h = lerp(3.5, h, smoothstep(18, 90, dRiver));
  // lake basin in the south: blend DOWN to lake level south of z=1250,
  // keep the valley floor everywhere else
  h = lerp(h, 1.5, smoothstep(1250, 1650, z));
  // runway pad: flat, at 42 m
  const rx = Math.abs(x - RUNWAY.x), rz = Math.abs(z - RUNWAY.z);
  const pad = (1 - smoothstep(RUNWAY.width / 2 + 12, RUNWAY.width / 2 + 70, rx))
    * (1 - smoothstep(RUNWAY.length / 2 + 12, RUNWAY.length / 2 + 80, rz));
  h = lerp(h, 42, pad);
  // approach corridor: grade the final-approach path flat to the strip
  // (a real airfield grades its approach; it also keeps a 6-degree
  // glidepath clear of noise bumps that could clip a landing)
  const cx = Math.abs(x - RUNWAY.x);
  const cz2 = z - RUNWAY.z;
  if (cz2 > -100 && cz2 < 1500) {
    const corridor = (1 - smoothstep(60, 220, cx)) * (1 - smoothstep(900, 1500, cz2));
    h = lerp(h, 42, corridor);
  }
  // keep the far edge from falling off the map (only the outer 6%)
  const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
  h = lerp(h, 500 + 200 * Math.abs(n), smoothstep(0.94, 1.0, edge));
  return h;
}

function biomeColor(x, z, h, slope, out) {
  const n = fbm2(x * 0.02 + 3.1, z * 0.02 - 8.4, 2) * 0.5 + 0.5; // 0..1 jitter
  const jit = 0.86 + n * 0.28;
  // sand near the water
  if (h < 7) { out.setRGB(0.76 * jit, 0.68 * jit, 0.50 * jit); return out; }
  // valley grass (warm alpine meadow)
  if (h < 260 && slope < 0.42) { out.setRGB(0.42 * jit, 0.55 * jit, 0.26 * jit); return out; }
  // high meadow / flower tint patches
  if (h < 480 && slope < 0.5) { out.setRGB(0.48 * jit, 0.52 * jit, 0.30 * jit); return out; }
  // rock
  if (h < WORLD.snowLine || slope > 0.5) { out.setRGB(0.52 * jit, 0.44 * jit, 0.36 * jit); return out; }
  // snow
  out.setRGB(0.93 * jit, 0.93 * jit, 0.96 * jit); return out;
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    const SEG = 180;
    const size = WORLD.size;
    const geo = new THREE.PlaneGeometry(size, size, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const e = 14;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = groundHeight(x, z);
      pos.setY(i, h);
      const hx = groundHeight(x + e, z) - groundHeight(x - e, z);
      const hz = groundHeight(x, z + e) - groundHeight(x, z - e);
      const slope = Math.hypot(hx, hz) / (2 * e);
      biomeColor(x, z, h, slope, c);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // flat shading: non-indexed geometry gives the faceted Alpine look
    const flat = geo.toNonIndexed();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0.0,
    });
    this.mesh = new THREE.Mesh(flat, mat);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.buildWater(scene);
    this.buildRunway(scene);
    this.buildVillage(scene);
    this.buildTrees(scene);
    this.buildTurbines(scene);
    this.buildLighthouse(scene);
  }

  buildWater(scene) {
    const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(-0.55, 0.22, -0.80).normalize() },
        uDeep: { value: new THREE.Color(0x0e3a46) },
        uShallow: { value: new THREE.Color(0x1e6a72) },
        uSky: { value: new THREE.Color(0xff9a4d) },
        uGlitter: { value: new THREE.Color(0xffc27a) },
      },
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec3 vPos; varying vec3 vNor;
        void main() {
          vec3 p = position;
          float w1 = sin(p.x * 0.012 + uTime * 0.9) * cos(p.z * 0.010 - uTime * 0.7);
          float w2 = sin((p.x + p.z) * 0.02 - uTime * 1.3);
          p.y += w1 * 0.55 + w2 * 0.28;
          vNor = normalize(vec3(-0.012 * cos(p.x * 0.012 + uTime * 0.9) * 0.55, 1.0, -0.010 * cos(p.z * 0.010 - uTime * 0.7) * 0.55));
          vPos = p;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir; uniform vec3 uDeep; uniform vec3 uShallow;
        uniform vec3 uSky; uniform vec3 uGlitter;
        varying vec3 vPos; varying vec3 vNor;
        void main() {
          vec3 V = normalize(cameraPosition - vPos);
          vec3 N = normalize(vNor);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          vec3 col = mix(uDeep, uShallow, 0.35 + 0.3 * N.x);
          col = mix(col, uSky, fres * 0.55);
          vec3 R = reflect(-normalize(uSunDir), N);
          float spec = pow(max(dot(R, V), 0.0), 220.0);
          col += uGlitter * spec * 2.2;   // the sun-glitter path
          float sparkle = pow(max(dot(R, V), 0.0), 40.0);
          col += uGlitter * sparkle * 0.25;
          gl_FragColor = vec4(col, 0.92);
        }`,
    });
    this.waterMat = mat;
    const water = new THREE.Mesh(geo, mat);
    water.position.y = WORLD.waterY;
    scene.add(water);
  }

  buildRunway(scene) {
    const g = new THREE.Group();
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length),
      new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.9 }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(RUNWAY.x, 42.15, RUNWAY.z);
    strip.receiveShadow = true;
    g.add(strip);
    // centreline dashes + threshold bars
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2f2e8 });
    for (let dz = -RUNWAY.length / 2 + 40; dz < RUNWAY.length / 2 - 30; dz += 60) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 26), dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(RUNWAY.x, 42.3, RUNWAY.z + dz);
      g.add(d);
    }
    for (const side of [-1, 1]) {
      for (let k = -2; k <= 2; k++) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(3, 18), dashMat);
        bar.rotation.x = -Math.PI / 2;
        bar.position.set(RUNWAY.x + k * 5, 42.3, RUNWAY.z + side * (RUNWAY.length / 2 - 22));
        g.add(bar);
      }
    }
    // PAPI boxes (4 per side, red/white) at the threshold end
    this.papi = [];
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 1.2, 1.2),
          new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0.9 }),
        );
        box.position.set(RUNWAY.x + side * (RUNWAY.width / 2 + 8) + (side < 0 ? k * 3.4 : -k * 3.4), 42.8, RUNWAY.z + RUNWAY.length / 2 - 180);
        g.add(box);
        this.papi.push(box);
      }
    }
    // edge lights
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    for (let dz = -RUNWAY.length / 2 + 20; dz <= RUNWAY.length / 2 - 20; dz += 90) {
      for (const side of [-1, 1]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 6), edgeMat);
        dot.position.set(RUNWAY.x + side * (RUNWAY.width / 2 + 4), 42.6, RUNWAY.z + dz);
        g.add(dot);
      }
    }
    // control tower
    const tower = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, 34, 7), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }));
    shaft.position.y = 17;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(11, 5, 11), new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.3, metalness: 0.4 }));
    cab.position.y = 36;
    tower.add(shaft, cab);
    tower.position.set(RUNWAY.x + 42, 42, RUNWAY.z + 120);
    g.add(tower);
    // windsock
    const sock = new THREE.Mesh(new THREE.ConeGeometry(1.6, 7, 8), new THREE.MeshStandardMaterial({ color: 0xff7a2a, roughness: 0.7 }));
    sock.rotation.z = Math.PI / 2.3;
    sock.position.set(RUNWAY.x - 34, 50, RUNWAY.z - 260);
    g.add(sock);
    scene.add(g);
    this.runwayGroup = g;
  }

  // PAPI: 2 red + 2 white on glidepath, 4 red low, 4 white high.
  setPapi(state) { // 'lock' | 'active' | 'low' | 'high'
    const cols = { lock: [0xff2a2a, 0xff2a2a, 0xffffff, 0xffffff], active: [0xff2a2a, 0xff2a2a, 0xffffff, 0xffffff], low: [0xff2a2a, 0xff2a2a, 0xff2a2a, 0xff2a2a], high: [0xffffff, 0xffffff, 0xffffff, 0xffffff] }[state] || [0xff2a2a, 0xff2a2a, 0xffffff, 0xffffff];
    this.papi.forEach((box, i) => box.material.emissive.setHex(cols[i % 4]));
  }

  buildVillage(scene) {
    const rand = (function () { let s = 1234; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const spots = [];
    for (let i = 0; i < 46; i++) {
      const x = RUNWAY.x - 260 + rand() * 420;
      const z = RUNWAY.z + 620 + rand() * 320;
      if (Math.abs(x - RUNWAY.x) < 60) continue;
      spots.push([x, z, 6 + rand() * 6]);
    }
    for (let i = 0; i < 14; i++) {
      spots.push([-420 + rand() * 200, -1150 + rand() * 260, 5 + rand() * 5]);
    }
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const roofGeo = new THREE.ConeGeometry(0.85, 0.7, 4);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, spots.length);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const wallCols = [0xe8dcc8, 0xd8c8b8, 0xc8d8e8, 0xe8c8c0, 0xd0d0c8];
    const roofCols = [0xb04030, 0x38486a, 0x505050, 0x7a4a28, 0x904030];
    const col = new THREE.Color();
    spots.forEach(([x, z, w], i) => {
      const h = groundHeight(x, z);
      const rotY = rand() * Math.PI;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      pos.set(x, h + 2.6, z); sc.set(w, 5.2, w * 0.8);
      m.compose(pos, q, sc); walls.setMatrixAt(i, m);
      walls.setColorAt(i, col.setHex(wallCols[i % wallCols.length]));
      pos.set(x, h + 5.2 + 1.4, z); sc.set(w * 1.05, 2.8, w * 0.85);
      m.compose(pos, q, sc); roofs.setMatrixAt(i, m);
      roofs.setColorAt(i, col.setHex(roofCols[(i * 2 + 1) % roofCols.length]));
    });
    walls.castShadow = true; roofs.castShadow = true;
    scene.add(walls, roofs);
  }

  buildTrees(scene) {
    const rand = (function () { let s = 987; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const spots = [];
    let guard = 0;
    while (spots.length < 850 && guard++ < 20000) {
      const x = (rand() * 2 - 1) * 1950;
      const z = (rand() * 2 - 1) * 1950;
      const h = groundHeight(x, z);
      if (h < 60 || h > 700) continue;
      if (Math.abs(x - RUNWAY.x) < 90 && Math.abs(z - RUNWAY.z) < 560) continue; // keep the strip clear
      if (Math.abs(x + 60) < 80) continue; // keep the river clear
      spots.push([x, h, z, 7 + rand() * 9]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 4, 5);
    const canopyGeo = new THREE.ConeGeometry(3.4, 11, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 1 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2e5d33, roughness: 0.95, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = new THREE.Color();
    spots.forEach(([x, h, z, s], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      pos.set(x, h + 2, z); sc.set(s / 8, s / 8, s / 8);
      m.compose(pos, q, sc); trunks.setMatrixAt(i, m);
      pos.set(x, h + 2 + s * 0.55, z);
      m.compose(pos, q, sc); canopies.setMatrixAt(i, m);
      canopies.setColorAt(i, col.setHSL(0.33 + rand() * 0.05, 0.5, 0.24 + rand() * 0.1));
    });
    trunks.castShadow = true; canopies.castShadow = true;
    scene.add(trunks, canopies);
  }

  buildTurbines(scene) {
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.5 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.6 });
    const spots = [[-720, -300], [-780, -80], [-690, 140], [760, -620], [820, -420], [740, -820]];
    this.turbines = [];
    for (const [x, z] of spots) {
      const h = groundHeight(x, z);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 42, 8), poleMat);
      pole.position.y = 21; pole.castShadow = true;
      g.add(pole);
      const hub = new THREE.Group();
      hub.position.y = 43;
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.1, 15, 0.35), bladeMat);
        blade.position.y = 7.5;
        const pivot = new THREE.Group();
        pivot.rotation.z = (b / 3) * Math.PI * 2;
        pivot.add(blade);
        hub.add(pivot);
      }
      g.add(hub);
      g.position.set(x, h, z);
      scene.add(g);
      this.turbines.push(hub);
    }
  }

  buildLighthouse(scene) {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 4.4, 26, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.7 }),
    );
    tower.position.y = 13; tower.castShadow = true;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(3.5, 3.8, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.7 }),
    );
    band.position.y = 18;
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
    );
    lamp.position.y = 28;
    g.add(tower, band, lamp);
    g.position.set(-330, 4, 1520);
    scene.add(g);
    this.lighthouseLamp = lamp;
  }

  // Re-tint the water with the active palette (sky horizon for the
  // reflection, sun colour for the glitter path).
  setWaterPalette(p) {
    if (!this.waterMat) return;
    this.waterMat.uniforms.uDeep.value.setHex(p.water);
    this.waterMat.uniforms.uShallow.value.setHex(p.water);
    this.waterMat.uniforms.uSky.value.setHex(p.horizon);
    this.waterMat.uniforms.uGlitter.value.setHex(p.waterGlitter);
  }

  update(t, dt) {
    if (this.waterMat) this.waterMat.uniforms.uTime.value = t;
    if (this.turbines) for (const hub of this.turbines) hub.rotation.z += dt * 0.9;
    if (this.lighthouseLamp) {
      const p = 0.5 + 0.5 * Math.sin(t * 1.4);
      this.lighthouseLamp.material.color.setHex(p > 0.5 ? 0xffe9a8 : 0x554422);
    }
  }
}
