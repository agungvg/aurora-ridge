// HUD: the sim-style overlay — mission panel, heading/speed/alt tapes,
// flight-path vector, gate rings + distances, G/AOA, PAPI state, warning
// chips, storm-front timer, radar. All DOM + small canvases, updated every
// frame from the flight state. Numbers must stay legible at 768 px wide.
import * as THREE from 'three';
import { fmtEta } from './missions.js';
import { clamp } from './random.js';

function el(tag, cls, parent, text = '') {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text) d.textContent = text;
  if (parent) parent.appendChild(d);
  return d;
}

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = '';
    this.root.classList.add('hud');

    // top-left: mission panel
    this.missionPanel = el('div', 'hud-panel hud-mission', root);
    this.missionTitle = el('div', 'hud-title', this.missionPanel, 'AURORA RIDGE // AURORA-9');
    this.missionName = el('div', 'hud-mission-name', this.missionPanel, 'SORTIE: —');
    this.missionSub = el('div', 'hud-sub', this.missionPanel, 'GATES 0/0 · SCORE 0');
    this.missionAircraft = el('div', 'hud-sub', this.missionPanel, 'AURORA-9 STOL · FLAPS OFF · BRK OFF');

    // top-centre: heading tape
    this.hdgWrap = el('div', 'hud-hdg', root);
    this.hdgCanvas = el('canvas', '', this.hdgWrap);
    this.hdgCanvas.width = 460; this.hdgCanvas.height = 46;
    this.hdgBox = el('div', 'hud-hdg-box', this.hdgWrap, 'HDG 000');

    // top-right: state chip
    this.stateChip = el('div', 'hud-panel hud-state', root, 'THR 72% · CRUISE');

    // storm panel (top-centre-right, hidden unless storm)
    this.stormPanel = el('div', 'hud-panel hud-storm', root);
    el('div', 'hud-storm-title', this.stormPanel, 'STORM FRONT');
    this.stormEta = el('div', 'hud-storm-eta', this.stormPanel, '2:48');
    this.stormBar = el('div', 'hud-storm-bar', this.stormPanel);
    this.stormBarFill = el('div', 'hud-storm-fill', this.stormBar);
    this.stormDist = el('div', 'hud-storm-dist', this.stormPanel, 'FRONT 17 KM');
    this.stormPanel.style.display = 'none';

    // warning chips (centre, under the heading tape)
    this.chips = el('div', 'hud-chips', root);
    this.chipEls = {};
    for (const [key, label] of [['STALL', 'STALL'], ['LOWFUEL', 'LOW FUEL'], ['OVERG', 'OVER G'], ['GUST', 'GUST'], ['FRONT', 'FRONT'], ['PAPI', 'PAPI LOCK']]) {
      const c = el('div', 'hud-chip', this.chips, label);
      c.style.display = 'none';
      this.chipEls[key] = c;
    }

    // left: speed tape
    this.spdWrap = el('div', 'hud-tape hud-spd', root);
    el('div', 'hud-tape-label', this.spdWrap, 'AIRSPEED');
    this.spdCanvas = el('canvas', '', this.spdWrap);
    this.spdCanvas.width = 96; this.spdCanvas.height = 240;
    this.spdBox = el('div', 'hud-tape-box', this.spdWrap, '150 KT');

    // right: altitude tape
    this.altWrap = el('div', 'hud-tape hud-alt', root);
    el('div', 'hud-tape-label', this.altWrap, 'ALTITUDE');
    this.altCanvas = el('canvas', '', this.altWrap);
    this.altCanvas.width = 96; this.altCanvas.height = 240;
    this.altBox = el('div', 'hud-tape-box', this.altWrap, '900 FT');
    this.vsiBox = el('div', 'hud-vsi', root, 'VSI +0\nG 1.0  AOA 2°');

    // bottom-left: systems bars
    this.sysPanel = el('div', 'hud-panel hud-sys', root);
    this.sysBars = {};
    for (const [key, label] of [['THR', 'THROTTLE'], ['FUEL', 'FUEL'], ['HULL', 'AIRFRAME']]) {
      const row = el('div', 'hud-bar-row', this.sysPanel);
      el('span', 'hud-bar-label', row, label);
      const bar = el('div', 'hud-bar', row);
      const fill = el('div', 'hud-bar-fill', bar);
      const val = el('span', 'hud-bar-val', row, '0%');
      this.sysBars[key] = { fill, val };
    }
    this.gearRow = el('div', 'hud-gear-row', this.sysPanel);
    this.gearChip = el('span', 'hud-mini-chip', this.gearRow, 'GEAR DOWN');
    this.flapChip = el('span', 'hud-mini-chip', this.gearRow, 'FLP 0°');
    this.gChip = el('span', 'hud-mini-chip', this.gearRow, '1.0G');

    // bottom-right: radar
    this.radarWrap = el('div', 'hud-radar', root);
    this.radar = el('canvas', '', this.radarWrap);
    this.radar.width = 150; this.radar.height = 150;
    el('div', 'hud-radar-label', this.radarWrap, 'RADAR 2KM');

    // centre: flight-path vector + pitch ladder
    this.fpv = el('canvas', 'hud-fpv', root);
    this.fpv.width = 460; this.fpv.height = 300;

    // gate labels (projected from 3D)
    this.gateLabels = [];
    for (let i = 0; i < 8; i++) {
      const d = el('div', 'hud-gate-label', root);
      d.style.display = 'none';
      this.gateLabels.push(d);
    }
    this.toast = el('div', 'hud-toast', root);
    this.toastTimer = 0;

    this.proj = new THREE.Vector3();
  }

  showToast(text, ms = 2200) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    this.toastTimer = ms / 1000;
  }

  setMission(mission, flight) {
    this.missionName.textContent = `SORTIE: ${mission.name}`;
    this.missionTitle.textContent = 'AURORA RIDGE // AURORA-9';
    this.missionAircraft.textContent = `AURORA-9 STOL · FLAPS ${flight.flaps ? 'SET' : 'OFF'} · BRK ${flight.landed ? 'ON' : 'OFF'}`;
  }

  drawTape(canvas, value, min, max, step, unit, majorEvery = 4) {
    const x = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(8,10,16,0.72)';
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,190,90,0.9)';
    x.lineWidth = 2;
    x.strokeRect(1, 1, W - 2, H - 2);
    const range = max - min;
    const pxPerUnit = H / range;
    const centre = H / 2;
    x.font = 'bold 13px monospace';
    x.textAlign = 'left';
    const first = Math.ceil((value - range / 2) / step) * step;
    for (let v = first; v <= value + range / 2; v += step) {
      const y = centre - (v - value) * pxPerUnit;
      if (y < 6 || y > H - 6) continue;
      const major = Math.round(v / step) % majorEvery === 0;
      x.strokeStyle = major ? 'rgba(255,220,140,0.95)' : 'rgba(255,220,140,0.45)';
      x.lineWidth = major ? 2 : 1;
      x.beginPath(); x.moveTo(W - 26, y); x.lineTo(W - (major ? 12 : 18), y); x.stroke();
      if (major) { x.fillStyle = '#ffd98a'; x.fillText(String(Math.round(v)), 6, y + 4); }
    }
    // centre marker
    x.fillStyle = '#ffd76a';
    x.beginPath(); x.moveTo(W - 30, centre - 7); x.lineTo(W - 16, centre); x.lineTo(W - 30, centre + 7); x.closePath(); x.fill();
  }

  drawHeading(hdgDeg) {
    const x = this.hdgCanvas.getContext('2d');
    const W = this.hdgCanvas.width, H = this.hdgCanvas.height;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(8,10,16,0.72)';
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,190,90,0.9)'; x.lineWidth = 2;
    x.strokeRect(1, 1, W - 2, H - 2);
    const span = 90; // degrees visible
    const pxPerDeg = W / span;
    x.font = 'bold 12px monospace'; x.textAlign = 'center';
    const start = Math.floor((hdgDeg - span / 2) / 10) * 10;
    for (let d = start; d <= hdgDeg + span / 2; d += 10) {
      const dd = ((d % 360) + 360) % 360;
      let dx = (d - hdgDeg) * pxPerDeg + W / 2;
      if (dx < 0 || dx > W) continue;
      const major = dd % 30 === 0;
      x.strokeStyle = major ? '#ffd98a' : 'rgba(255,220,140,0.5)';
      x.lineWidth = major ? 2 : 1;
      x.beginPath(); x.moveTo(dx, H - 8); x.lineTo(dx, H - (major ? 24 : 16)); x.stroke();
      if (major) {
        const label = dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd).padStart(3, '0');
        x.fillStyle = '#ffd98a'; x.fillText(label, dx, 16);
      }
    }
    // centre caret
    x.fillStyle = '#ffd76a';
    x.beginPath(); x.moveTo(W / 2 - 7, 22); x.lineTo(W / 2 + 7, 22); x.lineTo(W / 2, 32); x.closePath(); x.fill();
    this.hdgBox.textContent = `HDG ${String(Math.round(hdgDeg)).padStart(3, '0')}`;
  }

  drawRadar(flight, gates, nextGate, runway) {
    const x = this.radar.getContext('2d');
    const W = 150, H = 150, cx = W / 2, cy = H / 2;
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(8,10,16,0.78)';
    x.beginPath(); x.arc(cx, cy, 72, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#ffb020'; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, 72, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(255,176,32,0.4)'; x.lineWidth = 1;
    x.beginPath(); x.arc(cx, cy, 36, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(cx, cy - 72); x.lineTo(cx, cy + 72); x.moveTo(cx - 72, cy); x.lineTo(cx + 72, cy); x.stroke();
    const scale = 72 / 2000; // 2 km radius
    const rot = -flight.heading;
    const plot = (wx, wz, color, r = 4) => {
      const dx = (wx - flight.pos.x) * scale, dz = (wz - flight.pos.z) * scale;
      const rx = dx * Math.cos(rot) - dz * Math.sin(rot);
      const rz = dx * Math.sin(rot) + dz * Math.cos(rot);
      if (Math.hypot(rx, rz) > 70) return;
      x.fillStyle = color;
      x.beginPath(); x.arc(cx + rx, cy + rz, r, 0, Math.PI * 2); x.fill();
    };
    // runway
    x.strokeStyle = '#f2f2e8'; x.lineWidth = 2;
    x.beginPath();
    const r1x = (runway.x - flight.pos.x) * scale, r1z = (runway.z - 450 - flight.pos.z) * scale;
    const r2x = (runway.x - flight.pos.x) * scale, r2z = (runway.z + 450 - flight.pos.z) * scale;
    const rotPt = (px, pz) => [px * Math.cos(rot) - pz * Math.sin(rot), px * Math.sin(rot) + pz * Math.cos(rot)];
    const [a1, b1] = rotPt(r1x, r1z), [a2, b2] = rotPt(r2x, r2z);
    x.moveTo(cx + a1, cy + b1); x.lineTo(cx + a2, cy + b2); x.stroke();
    gates.forEach((g, i) => {
      if (i < nextGate) return;
      plot(g.pos.x, g.pos.z, i === nextGate ? '#ffd76a' : '#ffb020', i === nextGate ? 5 : 3);
    });
    // own ship
    x.fillStyle = '#ffffff';
    x.beginPath(); x.moveTo(cx, cy - 8); x.lineTo(cx + 5, cy + 6); x.lineTo(cx - 5, cy + 6); x.closePath(); x.fill();
  }

  drawFpv(flight, camera) {
    const x = this.fpv.getContext('2d');
    const W = this.fpv.width, H = this.fpv.height;
    x.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    x.strokeStyle = 'rgba(255,215,106,0.95)';
    x.lineWidth = 2;
    // pitch ladder: lines tilt with roll, shift with pitch
    const rollPx = flight.roll * 120;
    x.save();
    x.translate(cx, cy);
    x.rotate(-flight.roll);
    const pitchPx = flight.pitch * 260;
    for (const deg of [-20, -10, 10, 20]) {
      const y = -deg * 6 + pitchPx;
      if (Math.abs(y) > 130) continue;
      x.beginPath();
      x.moveTo(-46, y); x.lineTo(-14, y);
      x.moveTo(14, y); x.lineTo(46, y);
      x.stroke();
      x.font = 'bold 11px monospace'; x.fillStyle = '#ffd98a'; x.textAlign = 'right';
      x.fillText(String(Math.abs(deg)), -52, y + 4);
      x.textAlign = 'left'; x.fillText(String(Math.abs(deg)), 52, y + 4);
    }
    x.restore();
    // flight-path vector: circle + wings + dot
    x.beginPath(); x.arc(cx, cy, 26, 0, Math.PI * 2); x.stroke();
    x.beginPath();
    x.moveTo(cx - 42, cy); x.lineTo(cx - 28, cy);
    x.moveTo(cx + 28, cy); x.lineTo(cx + 42, cy);
    x.moveTo(cx, cy - 42); x.lineTo(cx, cy - 30);
    x.stroke();
    x.fillStyle = '#ffd76a';
    x.beginPath(); x.arc(cx, cy, 3.5, 0, Math.PI * 2); x.fill();
    void camera;
  }

  update(dt, state) {
    const { flight, mission, runner, camera, renderer, papiState } = state;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.style.opacity = '0';
    }
    const totalGates = runner.gates.length;
    const gatesDone = flight.gatesCleared;
    const gatesText = mission.type === 'drop'
      ? `DROPS ${runner.dropsDone}/${3}`
      : mission.type === 'landing'
        ? `GATES ${gatesDone}/${totalGates} · LAND RWY 36`
        : `GATES ${gatesDone}/${totalGates}`;
    this.missionSub.textContent = `${gatesText} · SCORE ${flight.score.toLocaleString('en-US')}`;
    this.missionAircraft.textContent = `AURORA-9 STOL · FLAPS ${flight.flaps ? 'SET' : 'OFF'} · BRK ${flight.landed ? 'ON' : 'OFF'}`;

    const papi = papiState || 'ACTIVE';
    const thrState = flight.throttle > 0.92 ? 'MAX' : flight.throttle > 0.6 ? 'CRUISE' : flight.throttle > 0.25 ? 'APPROACH' : 'IDLE';
    this.stateChip.textContent = `THR ${Math.round(flight.throttle * 100)}% · ${thrState}   RWY 36 PAPI ${papi}`;
    if (mission.weather === 'storm') {
      this.stormPanel.style.display = 'block';
      this.stormEta.textContent = fmtEta(runner.frontEtaSec);
      this.stormDist.textContent = `FRONT ${runner.frontDistKm.toFixed(0)} KM`;
      this.stormBarFill.style.width = `${clamp(runner.frontDistKm / 17 * 100, 0, 100)}%`;
    } else {
      this.stormPanel.style.display = 'none';
    }

    // chips
    const show = (key, on, cls = '') => {
      const c = this.chipEls[key];
      c.style.display = on ? 'inline-block' : 'none';
      c.className = 'hud-chip' + (cls ? ' ' + cls : '');
    };
    show('STALL', flight.stallWarn, 'warn');
    show('LOWFUEL', flight.fuel < 20, 'danger');
    show('OVERG', flight.overG, 'danger');
    show('GUST', Math.abs(flight.gust) > 1.6, '');
    show('FRONT', mission.weather === 'storm' && runner.frontEtaSec < 120, 'warn');
    show('PAPI', papi === 'LOCK', 'ok');

    this.drawHeading(flight.hdgDeg);
    this.drawTape(this.spdCanvas, flight.speedKt, 40, 320, 10, 'KT');
    this.spdBox.textContent = `${Math.round(flight.speedKt)} KT`;
    this.drawTape(this.altCanvas, flight.altMslFt, 0, 2600, 100, 'FT');
    this.altBox.textContent = `${Math.round(flight.altMslFt)} FT`;
    const vsiFpm = Math.round(flight.vsi * 196.85);
    this.vsiBox.textContent = `VSI ${vsiFpm >= 0 ? '+' : ''}${vsiFpm}\nG ${flight.g.toFixed(1)}  AOA ${flight.aoa}°\nAGL ${Math.round(flight.altFt)} FT`;

    const setBar = (key, pct, color) => {
      this.sysBars[key].fill.style.width = `${clamp(pct, 0, 100)}%`;
      this.sysBars[key].fill.style.background = color;
      this.sysBars[key].val.textContent = `${Math.round(pct)}%`;
    };
    setBar('THR', flight.throttle * 100, '#ffd76a');
    setBar('FUEL', flight.fuel, flight.fuel < 20 ? '#ff5040' : '#ffb020');
    setBar('HULL', flight.hull, flight.hull < 50 ? '#ff5040' : '#3ddc84');
    this.gearChip.textContent = flight.gear ? 'GEAR DOWN' : 'GEAR UP';
    this.gearChip.className = 'hud-mini-chip ' + (flight.gear ? 'ok' : '');
    this.flapChip.textContent = `FLP ${flight.flaps * 15}°`;
    this.flapChip.className = 'hud-mini-chip ' + (flight.flaps ? 'ok' : '');
    this.gChip.textContent = `${flight.g.toFixed(1)}G`;
    this.gChip.className = 'hud-mini-chip ' + (flight.overG ? 'danger' : '');

    this.drawRadar(flight, runner.gates, runner.nextGate, { x: 150, z: 350 });
    this.drawFpv(flight, camera);

    // gate labels: project the next 2 gates (3 labels crowd the centre ring)
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    for (let i = 0; i < this.gateLabels.length; i++) {
      const gi = runner.nextGate + i;
      const lab = this.gateLabels[i];
      if (gi >= runner.gates.length || i > 1) { lab.style.display = 'none'; continue; }
      this.proj.copy(runner.gates[gi].pos).project(camera);
      if (this.proj.z > 1) { lab.style.display = 'none'; continue; }
      const sx = (this.proj.x * 0.5 + 0.5) * W;
      const sy = (-this.proj.y * 0.5 + 0.5) * H;
      const dist = flight.pos.distanceTo(runner.gates[gi].pos);
      lab.style.display = 'block';
      lab.style.left = `${sx}px`;
      lab.style.top = `${sy}px`;
      lab.textContent = `G-${String(gi + 1).padStart(2, '0')}  ${Math.round(dist)}m`;
    }
  }
}
