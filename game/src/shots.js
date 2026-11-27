// Shot presets: the 4 dossier frames, each a real render of the live game
// with a fixed, seeded state — no faked images. A shot sets the mission,
// the plane, the weather and the HUD numbers, then freezes the sim so the
// frame is the same on every load. ?shot=cover|cockpit|storm|map
import * as THREE from 'three';
import { groundHeight } from './terrain.js';
import { KT } from './flight.js';

// Place the plane and freeze the flight state for a shot.
function pose(game, { x, y, z, headingDeg, pitchDeg = 0, rollDeg = 0, speedKt = 150, throttle = 0.72, fuel = 75, score = 0, gates = 0, flaps = 0 }) {
  const f = game.flight;
  f.pos.set(x, y, z);
  f.heading = THREE.MathUtils.degToRad(headingDeg);
  f.pitch = THREE.MathUtils.degToRad(pitchDeg);
  f.roll = THREE.MathUtils.degToRad(rollDeg);
  f.speed = speedKt * KT;
  f.throttle = throttle;
  f.fuel = fuel;
  f.hull = 96;
  f.score = score;
  f.gatesCleared = gates;
  f.flaps = flaps;
  f.gear = false;
  f.vsi = -462 / 196.85;
  f.g = 1.0;
  f.aoa = 2;
  f.stallWarn = false;
  f.overG = false;
}

export const SHOTS = {
  // 1. COVER — sortie 04, above the cloud deck, sun big ahead, gold gate
  //    G-03 at 481 m, plane large + bright, banked, 3/4 rear chase.
  cover(game) {
    game.setMission(4, { silent: true });
    game.sky.apply('clouds', 'golden');
    game.clouds.tint(0xffe9c4, 0xffab7a);
    game.weather.setStorm(false);
    game.lightning.auto = false;
    // gate G-03 (index 2) exactly 481 m ahead of the plane
    const gate = game.runner.gates[2].pos;
    const dir = new THREE.Vector3(0, 0, -1); // flying north, toward the sun
    const px = gate.x - dir.x * 481, pz = gate.z - dir.z * 481;
    pose(game, {
      x: px, y: gate.y + 26, z: pz, headingDeg: 0, pitchDeg: -1, rollDeg: 16,
      speedKt: 148, throttle: 0.72, fuel: 75, score: 1480, gates: 2,
    });
    game.flight.gatesCleared = 2;
    game.runner.nextGate = 2;
    game.runner.gateMeshes.forEach((m, i) => { m.material = i < 2 ? game.runner.doneMat : i === 2 ? game.runner.nextMat : game.runner.ringMat; });
    // the next ring reads bigger at 481 m (Alpine cover scale), distance stays honest
    game.runner.gateMeshes[2].scale.setScalar(1.6);
    game.setCameraMode('chase', { side: 0.45, dist: 24, height: 9 });
    game.hud.setMission(game.runner.mission, game.flight);
  },

  // 2. COCKPIT — sortie 02 final approach, runway centred, PAPI LOCK,
  //    8 gauges lit, yoke + switches + levers visible.
  cockpit(game) {
    game.setMission(2, { silent: true });
    game.sky.apply('golden', 'golden');
    game.weather.setStorm(false);
    game.lightning.auto = false;
    pose(game, {
      x: 150, y: 42 + 121, z: 1950, headingDeg: 0, pitchDeg: -4, rollDeg: 0,
      speedKt: 120, throttle: 0.42, fuel: 57, score: 3210, gates: 0, flaps: 2,
    });
    game.flight.gear = true;
    game.flight.vsi = -1189 / 196.85;
    game.flight.gatesCleared = 0;
    game.runner.nextGate = 0;
    game.runner.gateMeshes.forEach((m, i) => { m.material = i === 0 ? game.runner.nextMat : game.runner.ringMat; });
    game.setCameraMode('cockpit');
    game.hud.setMission(game.runner.mission, game.flight);
    game.terrain.setPapi('lock');
  },

  // 3. STORM — sortie 05, black sky, branching lightning, slanted rain,
  //    fuel 14%, STORM FRONT ETA 2:48, LOW FUEL chip lit. Drop markers are
  //    ground-only (ring + crate + beacon + smoke) — no sky beam.
  storm(game) {
    game.setMission(5, { silent: true });
    game.sky.apply('storm', 'storm');
    game.clouds.setStorm(true);
    game.weather.setStorm(true, 18, 2.5);
    game.lightning.auto = false;
    pose(game, {
      x: -260, y: 480, z: -60, headingDeg: 0, pitchDeg: -2, rollDeg: -14,
      speedKt: 121, throttle: 0.64, fuel: 14, score: 3750, gates: 0, flaps: 0,
    });
    game.flight.gear = false;
    game.flight.hull = 72;
    game.runner.frontEtaSec = 168; // 2:48, consistent with the HUD chip
    game.runner.frontDistKm = 17;
    // one big branching bolt, fixed in the sky ahead-left of the plane
    game.lightning.strike(-420, -1050, 1150);
    // rain only fills its streak buffer in update(); one step places it
    // around the plane so the frozen shot still shows slanted rain
    game.weather.update(0.016, -260, 480, -60);
    game.setCameraMode('chase', { side: -0.4, dist: 26, height: 7 });
    game.hud.setMission(game.runner.mission, game.flight);
  },

  // 4. MAP + DEBRIEF — campaign map + S debrief over the live dusk scene.
  map(game) {
    game.setMission(1, { silent: true });
    game.sky.apply('golden', 'golden');
    game.weather.setStorm(false);
    game.lightning.auto = false;
    pose(game, {
      x: 150, y: 60, z: 900, headingDeg: 0, pitchDeg: 0, rollDeg: 0,
      speedKt: 93, throttle: 0.10, fuel: 34, score: 8140, gates: 7, flaps: 2,
    });
    game.flight.gear = true;
    game.flight.landed = false;
    game.setCameraMode('chase', { side: 0, dist: 30, height: 8 });
    // the debrief is real in this frame: mission 01 earned its S
    game.stars = { 1: 3 };
    game.updatePilotCards();
    game.hud.setMission(game.runner.mission, game.flight);
    game.showShot4({
      grade: 'S', stars: 3, score: 8140, sink: -187, centrelineM: 4,
      gates: '7/7', drops: '—', fuel: 34, hull: 91, time: '7:12', peakG: '1.4',
      missionName: 'RIDGE GATE RUN',
    });
  },
};

export function applyShot(name, game) {
  const fn = SHOTS[name];
  if (!fn) return false;
  fn(game);
  game.shotMode = true;
  game.shotName = name;
  return true;
}
