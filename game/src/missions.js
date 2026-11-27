// Missions: 6 sorties, gate rings, drop zones, scoring and debrief.
// A gate is a gold ring in the sky; flying through it (within the ring
// radius, close to its centre) clears it and scores. Drops need slow,
// low, steady flight over the ground ring. Landings are scored on sink
// rate and centreline.
import * as THREE from 'three';
import { MISSIONS, RUNWAY, DROP_ZONES } from './config.js';
import { groundHeight } from './terrain.js';
import { clamp } from './random.js';

export class MissionRunner {
  constructor(scene) {
    this.scene = scene;
    this.ringGeo = new THREE.TorusGeometry(30, 1.8, 10, 40);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.95 });
    this.nextMat = new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 1 });
    this.doneMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.5 });
    this.gateMeshes = [];
    this.dropMeshes = [];
    this.mission = null;
    this.gates = [];
    this.nextGate = 0;
    this.dropsDone = 0;
    this.dropCooldown = 0;
    this.frontDistKm = 17;
    this.frontEtaSec = 168;
  }

  clearWorld() {
    for (const m of this.gateMeshes) this.scene.remove(m);
    for (const m of this.dropMeshes) this.scene.remove(m);
    this.gateMeshes = [];
    this.dropMeshes = [];
  }

  // Lay out gates for a mission. Ring positions follow the valley so the
  // flight path reads as a route, not a random scatter.
  start(missionId, flight) {
    this.clearWorld();
    this.mission = MISSIONS[missionId - 1];
    this.nextGate = 0;
    this.dropsDone = 0;
    this.dropCooldown = 0;
    this.frontEtaSec = this.mission.frontEtaSec || 168;
    this.frontDistKm = 17;
    this.gates = this.buildGates(this.mission);
    this.gates.forEach((g, i) => {
      const mesh = new THREE.Mesh(this.ringGeo, i === 0 ? this.nextMat : this.ringMat);
      mesh.position.copy(g.pos);
      mesh.lookAt(g.pos.x, g.pos.y, g.pos.z + 100);
      this.scene.add(mesh);
      this.gateMeshes.push(mesh);
    });
    if (this.mission.type === 'drop') {
      for (const dz of DROP_ZONES) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(22, 1.4, 8, 36),
          new THREE.MeshBasicMaterial({ color: 0xffb020 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(dz.x, groundHeight(dz.x, dz.z) + 1.5, dz.z);
        this.scene.add(ring);
        this.dropMeshes.push(ring);
        // crate + beacon + smoke column mark the zone from the air
        const crate = new THREE.Mesh(
          new THREE.BoxGeometry(4, 4, 4),
          new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.9 }),
        );
        crate.position.set(dz.x + 8, groundHeight(dz.x, dz.z) + 2, dz.z + 6);
        this.scene.add(crate); this.dropMeshes.push(crate);
        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(3.0, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xff5040 }),
        );
        beacon.position.set(dz.x - 10, groundHeight(dz.x, dz.z) + 6, dz.z - 8);
        this.scene.add(beacon); this.dropMeshes.push(beacon);
        // thin smoke column so the zone reads from altitude
        const smokeMat = new THREE.SpriteMaterial({
          color: 0x9aa0a8, transparent: true, opacity: 0.5, depthWrite: false,
        });
        for (let s = 0; s < 3; s++) {
          const puff = new THREE.Sprite(smokeMat);
          puff.position.set(dz.x + 8 + s * 3, groundHeight(dz.x, dz.z) + 14 + s * 12, dz.z + 6);
          const w = 14 + s * 8;
          puff.scale.set(w, w * 0.7, 1);
          this.scene.add(puff);
          this.dropMeshes.push(puff);
        }
      }
    }
    return this.mission;
  }

  buildGates(m) {
    const gates = [];
    const at = (x, z, altAgl) => new THREE.Vector3(x, groundHeight(x, z) + altAgl, z);
    if (m.id === 1) { // Ridge Gate Run — south to north, gentle S-curves
      // down the valley centre (max ~80 m lateral swing per gate so the
      // turns are fun, not a slalom; a human at 120 kt has ~7 s per gate)
      const pts = [[150, 1000, 220], [130, 550, 300], [90, 100, 260], [20, -350, 300], [-60, -800, 260], [-90, -1250, 300], [-120, -1650, 300]];
      pts.forEach(([x, z, a]) => gates.push({ pos: at(x, z, a) }));
    } else if (m.id === 2) { // Valley Landing — two gates ON the 6° STOL final
      // (absolute heights from the threshold, not ground-relative: the
      // ground south of the strip dips to the lake, so AGL would be wrong)
      gates.push({ pos: new THREE.Vector3(150, 163, 1700) });
      gates.push({ pos: new THREE.Vector3(150, 89, 1250) });
    } else if (m.id === 3) { // Storm Window — south to north through the valley
      const pts = [[120, 900, 160], [60, 450, 190], [0, 0, 170], [-60, -450, 200], [-20, -900, 180], [-80, -1300, 200]];
      pts.forEach(([x, z, a]) => gates.push({ pos: at(x, z, a) }));
    } else if (m.id === 4) { // Above the Clouds — south to north over the deck
      const pts = [[-100, 1000, 0], [500, 400, 0], [-300, -100, 0], [200, -700, 0], [-500, -1200, 0]];
      pts.forEach(([x, z]) => gates.push({ pos: new THREE.Vector3(x, 1080, z) }));
    } else if (m.id === 5) { // Supply Drop — south to north: Tarn, Bravo, Glacier
      gates.push({ pos: at(-120, 1150, 200) });
      gates.push({ pos: at(-260, -420, 200) });
      gates.push({ pos: at(420, -900, 200) });
    } else { // Night Patrol — south to north beacon circuit
      const pts = [[150, 1700, 220], [80, 1300, 240], [120, 700, 280], [-40, 100, 260], [60, -500, 280], [-60, -1000, 260]];
      pts.forEach(([x, z, a]) => gates.push({ pos: at(x, z, a) }));
    }
    return gates;
  }

  nextGatePos() {
    if (this.nextGate >= this.gates.length) return null;
    return this.gates[this.nextGate].pos;
  }

  gateDistance(flight) {
    const p = this.nextGatePos();
    if (!p) return null;
    return flight.pos.distanceTo(p);
  }

  update(dt, flight, events) {
    if (!this.mission) return;
    this.dropCooldown = Math.max(0, this.dropCooldown - dt);
    // storm front closes in on storm missions
    if (this.mission.weather === 'storm' && this.frontEtaSec > 0) {
      this.frontEtaSec -= dt;
      this.frontDistKm = Math.max(0, (this.frontEtaSec / 168) * 17);
    }
    // gate pass check (32 m: the ring reads 30 m, the pass is forgiving)
    const p = this.nextGatePos();
    if (p) {
      const d = flight.pos.distanceTo(p);
      if (d < 32) {
        const pts = flight.gateScore();
        flight.score += pts;
        flight.gatesCleared += 1;
        this.gateMeshes[this.nextGate].material = this.doneMat;
        this.nextGate += 1;
        if (this.nextGate < this.gateMeshes.length) this.gateMeshes[this.nextGate].material = this.nextMat;
        events.push({ type: 'gate', points: pts, index: this.nextGate });
      }
    }
    // drop check: over a drop zone, slow + low + steady
    if (this.mission.type === 'drop' && this.dropCooldown <= 0) {
      const dz = DROP_ZONES[this.dropsDone];
      if (dz) {
        const dx = flight.pos.x - dz.x, dz2 = flight.pos.z - dz.z;
        const agl = flight.pos.y - groundHeight(flight.pos.x, flight.pos.z);
        if (Math.hypot(dx, dz2) < 24 && agl < 130 && flight.speedKt < 105) {
          this.dropsDone += 1;
          this.dropCooldown = 3;
          flight.score += 500;
          events.push({ type: 'drop', index: this.dropsDone });
        }
      }
    }
  }

  isComplete(flight) {
    if (!this.mission) return false;
    if (this.mission.type === 'landing') return flight.landed;
    if (this.mission.type === 'drop') return this.dropsDone >= DROP_ZONES.length;
    return this.nextGate >= this.gates.length;
  }

  // Debrief grade + stats, mirroring the refs' S-grade panels.
  debrief(flight) {
    const m = this.mission;
    const sink = flight.landed ? flight.touchdownFpm : null;
    let grade = 'B';
    let stars = 2;
    const gateFrac = m.type === 'drop' ? this.dropsDone / DROP_ZONES.length
      : m.type === 'landing' ? (flight.landed ? 1 : 0)
      : flight.gatesCleared / Math.max(1, this.gates.length);
    const fuelLeft = flight.fuel;
    const hull = flight.hull;
    let score = flight.score;
    if (flight.landed) {
      const sinkScore = sink <= 150 ? 900 : sink <= 300 ? 600 : sink <= 500 ? 300 : 100;
      const centreScore = flight.centrelineM <= 3 ? 600 : flight.centrelineM <= 8 ? 350 : 100;
      score += sinkScore + centreScore;
      if (sink <= 200 && flight.centrelineM <= 5 && fuelLeft > 20) { grade = 'S'; stars = 3; }
      else if (sink <= 400 && flight.centrelineM <= 10) { grade = 'A'; stars = 3; }
      else if (sink <= 600) { grade = 'B'; stars = 2; }
      else { grade = 'C'; stars = 1; }
    } else if (gateFrac >= 1 && fuelLeft > 25 && hull > 90) { grade = 'S'; stars = 3; }
    else if (gateFrac >= 1 && hull > 75) { grade = 'A'; stars = 3; }
    else if (gateFrac >= 0.6) { grade = 'B'; stars = 2; }
    else { grade = 'C'; stars = 1; }
    score += Math.round(fuelLeft * 8) + Math.round(hull * 2);
    const mm = Math.floor(flight.flightTime / 60);
    const ss = Math.floor(flight.flightTime % 60);
    return {
      grade, stars, score,
      sink, centrelineM: flight.centrelineM,
      gates: `${flight.gatesCleared}/${this.gates.length}`,
      drops: `${this.dropsDone}/${DROP_ZONES.length}`,
      fuel: Math.round(fuelLeft), hull: Math.round(hull),
      time: `${mm}:${String(ss).padStart(2, '0')}`,
      peakG: flight.peakG.toFixed(1),
    };
  }
}

export function fmtEta(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
