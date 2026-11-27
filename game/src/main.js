// Aurora Ridge — main loop, cameras, input, screens, mission flow.
// The game is a real playable sim: 6 sorties, fuel/hull/G rules, landing
// scoring, debriefs and a campaign map. ?shot=cover|cockpit|storm|map
// renders one deterministic dossier frame of the live game.
import * as THREE from 'three';
import { PALETTES, MISSIONS, RUNWAY, DROP_ZONES } from './config.js';
import { Sky } from './sky.js';
import { Terrain, groundHeight } from './terrain.js';
import { Clouds } from './clouds.js';
import { buildPlane } from './plane.js';
import { Flight, KT } from './flight.js';
import { MissionRunner } from './missions.js';
import { Weather } from './weather.js';
import { Lightning } from './lightning.js';
import { HUD } from './hud.js';
import { Cockpit } from './cockpit.js';
import { AudioEngine } from './audio.js';
import { applyShot } from './shots.js';
import { clamp } from './random.js';

const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.state = 'menu'; // menu | map | fly | debrief | crash | help | shot
    this.shotMode = false;
    this.shotName = '';
    this.cameraMode = 'chase';
    this.chaseOpts = { side: 0.3, dist: 26, height: 7 };
    this.selectedMission = 1;
    this.stars = {}; // mission id -> stars
    this.flown = 0;
    this.paused = false;
    this.time = 0;
    this.frameTimes = [];
    this.events = [];

    // --- renderer ---
    const canvas = $('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // r187: PCFSoftShadowMap removed

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 14000);
    this.camera.position.set(0, 300, 1600);

    // --- world ---
    this.sky = new Sky(this.scene, this.renderer);
    // Warm bounce fill from the cloud deck below: the key sun is ahead of
    // the plane, so without this the chase view reads as a black silhouette.
    this.fill = new THREE.DirectionalLight(0xffc890, 0.85);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);
    this.terrain = new Terrain(this.scene);
    this.sky.bindWater(this.terrain.waterMat);
    this.clouds = new Clouds(this.scene);
    this.weather = new Weather(this.scene);
    this.lightning = new Lightning(this.scene);

    // --- plane ---
    const built = buildPlane();
    this.planeGroup = built.group;
    this.planeGroup.rotation.order = 'YXZ';
    this.planeGroup.position.set(RUNWAY.x, 42, RUNWAY.z + 100);
    this.scene.add(this.planeGroup);
    this.props = built.props;
    // prop blur cross so the spinning disc reads as a rotor
    for (const disc of this.props) {
      for (const a of [0, Math.PI / 2]) {
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(4.1, 0.14, 0.05),
          new THREE.MeshBasicMaterial({ color: 0x8a949e, transparent: true, opacity: 0.35 }),
        );
        blade.rotation.z = a;
        disc.add(blade);
      }
    }

    // --- sim ---
    this.flight = new Flight();
    this.runner = new MissionRunner(this.scene);
    this.audio = new AudioEngine();

    // --- UI ---
    this.hud = new HUD($('hud'));
    this.cockpit = new Cockpit($('cockpit'));
    this.hud.root.style.display = 'none';

    this.buildMapScreen();
    this.bindUI();
    this.bindInput();
    window.addEventListener('resize', () => this.onResize());

    // --- shot mode? ---
    const params = new URLSearchParams(location.search);
    const shot = params.get('shot');
    if (shot) {
      this.state = 'shot';
      this.hideAllScreens();
      this.hud.root.style.display = 'block';
      $('hint').classList.add('hidden');
      if (applyShot(shot, this)) {
        this.renderOnce();
        this.hud.update(0.016, this.hudState());
        if (this.cameraMode === 'cockpit') this.cockpit.draw(this.flight, this.papiState());
      }
      window.__ready = true;
      window.__game = this;
      this.loop();
      return;
    }

    window.__game = this;
    this.showMenu();
    this.loop();
  }

  hudState() {
    return { flight: this.flight, mission: this.runner.mission || MISSIONS[0], runner: this.runner, camera: this.camera, renderer: this.renderer, papiState: this.papiState() };
  }

  // ---------- screens ----------
  hideAllScreens() {
    for (const id of ['menu-screen', 'map-screen', 'debrief-screen', 'crash-screen', 'help-screen']) $(id).classList.add('hidden');
  }

  showMenu() {
    this.state = 'menu';
    this.hideAllScreens();
    $('menu-screen').classList.remove('hidden');
    this.hud.root.style.display = 'none';
    $('hint').classList.add('hidden');
    this.updatePilotCards();
    // attract mode: plane parked on the runway, scenic camera
    this.flight.reset();
    this.flight.pos.set(RUNWAY.x, 42, RUNWAY.z + 100);
    this.flight.speed = 0;
    this.runner.start(1, this.flight);
    this.sky.apply('golden', 'golden');
    this.weather.setStorm(false);
    this.lightning.auto = false;
    this.setCameraMode('chase');
  }

  showMap(show) {
    if (show) {
      this.state = 'map';
      this.hideAllScreens();
      $('map-screen').classList.remove('hidden');
      this.drawMap();
      this.renderMissionList();
    } else {
      $('map-screen').classList.add('hidden');
    }
  }

  showDebrief(data, opts = {}) {
    this.state = 'debrief';
    $('debrief-title').textContent = data.title || 'TOUCHDOWN CONFIRMED — SORTIE COMPLETE';
    $('debrief-sub').textContent = `${data.missionName || ''} // AURORA-9`;
    $('debrief-grade').textContent = data.grade;
    $('debrief-stars').textContent = '★'.repeat(data.stars) + '☆'.repeat(3 - data.stars);
    const rows = [];
    if (data.sink !== null && data.sink !== undefined) rows.push(['TOUCHDOWN RATE', `${data.sink} FPM`]);
    rows.push(['GATES CLEARED', data.gates]);
    if (data.drops && data.drops !== '—') rows.push(['SUPPLY DROPS', data.drops]);
    rows.push(['FUEL / HULL', `${data.fuel}% / ${data.hull}%`]);
    rows.push(['FLIGHT TIME', data.time]);
    rows.push(['PEAK G', `${data.peakG} G`]);
    rows.push(['TOTAL SCORE', `${data.score.toLocaleString('en-US')} PTS`]);
    $('debrief-stats').innerHTML = rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');
    const screen = $('debrief-screen');
    screen.classList.remove('hidden');
    if (opts.side) screen.classList.add('side');
    else screen.classList.remove('side');
  }

  // Shot 4: map on the left, S debrief on the right, live dusk behind.
  showShot4(data) {
    this.showMap(true);
    $('map-screen').classList.add('shift-left');
    this.showDebrief(data, { side: true });
  }

  showCrash(reason, stats) {
    this.state = 'crash';
    $('crash-reason').textContent = reason;
    $('crash-stats').innerHTML = stats.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');
    this.hideAllScreens();
    $('crash-screen').classList.remove('hidden');
  }

  updatePilotCards() {
    const total = Object.values(this.stars).reduce((a, b) => a + b, 0);
    $('menu-stars').textContent = `${total} / 18`;
    $('menu-flown').textContent = String(this.flown);
    const ms = $('map-stars');
    if (ms) ms.textContent = `${total} / 18`;
  }

  // ---------- campaign map ----------
  buildMapScreen() {
    this.mapCanvas = $('map-canvas');
  }

  renderMissionList() {
    const list = $('mission-list');
    list.innerHTML = '';
    MISSIONS.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'mission-row' + (m.id === this.selectedMission ? ' selected' : '');
      const st = this.stars[m.id] || 0;
      row.innerHTML = `<div class="num">${String(m.id).padStart(2, '0')}</div>
        <div class="nm"><div class="t">${m.name}</div><div class="d">${m.brief}</div></div>
        <div class="stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</div>`;
      row.addEventListener('click', () => { this.selectedMission = m.id; this.renderMissionList(); });
      row.addEventListener('dblclick', () => this.startMission(m.id));
      list.appendChild(row);
    });
  }

  drawMap() {
    const x = this.mapCanvas.getContext('2d');
    const W = this.mapCanvas.width, H = this.mapCanvas.height;
    // valley base
    const grad = x.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#5a6a4a'); grad.addColorStop(0.5, '#7a8a52'); grad.addColorStop(1, '#3a5a6a');
    x.fillStyle = grad; x.fillRect(0, 0, W, H);
    // ridges
    x.fillStyle = '#6a5a48';
    x.beginPath(); x.moveTo(0, 0); x.lineTo(70, 0); x.lineTo(110, H); x.lineTo(0, H); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(W, 0); x.lineTo(W - 80, 0); x.lineTo(W - 120, H); x.lineTo(W, H); x.closePath(); x.fill();
    // snow caps north
    x.fillStyle = '#e8e8f0';
    x.beginPath(); x.moveTo(60, 0); x.lineTo(W - 70, 0); x.lineTo(W - 110, 46); x.lineTo(100, 46); x.closePath(); x.fill();
    // lake south
    x.fillStyle = '#2a6a7a';
    x.beginPath(); x.ellipse(W / 2, H - 26, 150, 34, 0, 0, Math.PI * 2); x.fill();
    // river
    x.strokeStyle = '#3a8ab0'; x.lineWidth = 5;
    x.beginPath(); x.moveTo(W / 2 - 40, 40); x.bezierCurveTo(W / 2 + 20, 180, W / 2 - 30, 300, W / 2, H - 30); x.stroke();
    // route line through the gates
    x.strokeStyle = '#ffb020'; x.lineWidth = 2; x.setLineDash([6, 4]);
    x.beginPath();
    const pts = [[-180, -1400], [-40, -1000], [140, -600], [-120, -200], [80, 200], [180, 600], [150, 1000]];
    pts.forEach(([wx, wz], i) => {
      const mx = ((wx + 2100) / 4200) * W;
      const my = ((wz + 2100) / 4200) * H;
      if (i === 0) x.moveTo(mx, my); else x.lineTo(mx, my);
    });
    x.stroke(); x.setLineDash([]);
    // runway
    const rx = ((RUNWAY.x + 2100) / 4200) * W;
    const rz = ((RUNWAY.z + 2100) / 4200) * H;
    x.fillStyle = '#23262c';
    x.fillRect(rx - 4, rz - 50, 8, 100);
    x.fillStyle = '#f2f2e8';
    x.fillRect(rx - 1, rz - 50, 2, 100);
    x.fillStyle = '#ffd76a'; x.font = 'bold 11px monospace'; x.textAlign = 'left';
    x.fillText('RWY 36', rx + 8, rz + 4);
    // mission markers: gate-1 positions
    const gate1 = [[-180, -1400], [150, 1500], [-220, -1300], [-500, -1200], [-260, -420], [-300, -1000]];
    MISSIONS.forEach((m, i) => {
      const [wx, wz] = gate1[i];
      const mx = ((wx + 2100) / 4200) * W;
      const my = ((wz + 2100) / 4200) * H;
      x.beginPath(); x.arc(mx, my, 11, 0, Math.PI * 2);
      x.fillStyle = m.id === this.selectedMission ? '#ffb020' : '#1e3a5f';
      x.fill();
      x.lineWidth = 2; x.strokeStyle = '#ffd76a'; x.stroke();
      x.fillStyle = '#fff'; x.font = 'bold 11px monospace'; x.textAlign = 'center';
      x.fillText(String(m.id), mx, my + 4);
    });
    // storm front band (north)
    x.fillStyle = 'rgba(20,24,36,0.55)';
    x.fillRect(0, 0, W, 18);
    x.fillStyle = '#ff6a50'; x.font = 'bold 10px monospace'; x.textAlign = 'center';
    x.fillText('STORM FRONT · 17 KM', W / 2, 13);
    x.fillStyle = '#e8e4d8'; x.font = 'bold 13px monospace'; x.textAlign = 'left';
    x.fillText('RIDGE VALLEY', 10, H - 10);
  }

  // ---------- mission flow ----------
  setMission(id, opts = {}) {
    const m = MISSIONS[id - 1];
    this.selectedMission = id;
    this.flight.reset();
    this.flight.fuel = m.fuel;
    // start positions per mission
    if (id === 2) { // Valley Landing: on the 6° STOL final, south of the runway
      this.flight.pos.set(RUNWAY.x, 42 + 121, RUNWAY.z + 1600);
      this.flight.heading = 0; this.flight.speed = 120 * KT; this.flight.throttle = 0.42; this.flight.flaps = 2; this.flight.gear = true;
    } else if (id === 4) { // Above the Clouds: below the deck, climbing north
      this.flight.pos.set(-100, 620, 1400);
      this.flight.heading = 0; this.flight.speed = 140 * KT; this.flight.throttle = 0.85;
    } else if (id === 5) { // Supply Drop: over the valley, storm light
      this.flight.pos.set(-260, 700, 600);
      this.flight.heading = 0; this.flight.speed = 110 * KT; this.flight.throttle = 0.6;
    } else if (id === 6) { // Night Patrol: dusk departure from the strip
      this.flight.pos.set(RUNWAY.x, 320, RUNWAY.z + 1200);
      this.flight.heading = 0; this.flight.speed = 130 * KT; this.flight.throttle = 0.7;
    } else { // Gate runs / storm: south end, heading north
      this.flight.pos.set(0, 420, 1600);
      this.flight.heading = 0; this.flight.speed = 140 * KT; this.flight.throttle = 0.75;
    }
    this.runner.start(id, this.flight);
    this.sky.apply(m.weather, m.weather === 'night' ? 'night' : m.weather === 'storm' ? 'storm' : 'golden');
    this.clouds.setStorm(m.weather === 'storm');
    this.weather.setStorm(m.weather === 'storm', 18, 2.5);
    this.lightning.auto = m.weather === 'storm';
    this.terrain.setPapi('active');
    if (!opts.silent) this.hud.setMission(m, this.flight);
    return m;
  }

  startMission(id) {
    this.setMission(id);
    this.flown += 1;
    this.state = 'fly';
    this.hideAllScreens();
    this.hud.root.style.display = 'block';
    $('hint').classList.remove('hidden');
    this.cockpit.show(this.cameraMode === 'cockpit');
    this.hud.showToast(`${MISSIONS[id - 1].name} — ${MISSIONS[id - 1].brief}`, 3000);
    this.audio.ensure();
  }

  finishMission() {
    const data = this.runner.debrief(this.flight);
    data.missionName = this.runner.mission.name;
    const prev = this.stars[this.runner.mission.id] || 0;
    this.stars[this.runner.mission.id] = Math.max(prev, data.stars);
    this.updatePilotCards();
    this.state = 'debrief';
    this.cockpit.show(false);
    this.showDebrief(data);
    this.audio.blip(1318, 0.2, 0.2);
  }

  failMission(reason) {
    const stats = [
      ['SORTIE', this.runner.mission.name],
      ['GATES', `${this.flight.gatesCleared}/${this.runner.gates.length}`],
      ['SCORE', this.flight.score.toLocaleString('en-US')],
      ['FUEL / HULL', `${Math.round(this.flight.fuel)}% / ${Math.round(this.flight.hull)}%`],
      ['FLIGHT TIME', `${Math.floor(this.flight.flightTime / 60)}:${String(Math.floor(this.flight.flightTime % 60)).padStart(2, '0')}`],
    ];
    this.state = 'crash';
    this.cockpit.show(false);
    this.showCrash(reason, stats);
  }

  papiState() {
    // PAPI only reads on the extended centreline, on final, below 800 ft
    // AGL. The Aurora-9 is a STOL tiltrotor: its glidepath is 6 degrees.
    if (!this.runner.mission) return 'ACTIVE';
    const f = this.flight;
    const dx = f.pos.x - RUNWAY.threshold.x;
    const dz = f.pos.z - RUNWAY.threshold.z;
    const along = dz; // approach comes from the south (positive z): along > 0 on final
    const aglFt = (f.pos.y - 42) * 3.28084;
    if (along < 0 || along > 3200 || Math.abs(dx) > 80 || aglFt > 800 || aglFt < 25 || along < 120) return 'ACTIVE';
    const glideDeg = THREE.MathUtils.radToDeg(Math.atan2(f.pos.y - 42, along));
    if (Math.abs(glideDeg - 6) < 1.2) return 'LOCK';
    if (glideDeg < 4.5) return 'LOW';
    if (glideDeg > 7.5) return 'HIGH';
    return 'ACTIVE';
  }

  setCameraMode(mode, opts = {}) {
    this.cameraMode = mode;
    if (opts.side !== undefined) this.chaseOpts.side = opts.side;
    if (opts.dist !== undefined) this.chaseOpts.dist = opts.dist;
    if (opts.height !== undefined) this.chaseOpts.height = opts.height;
    document.body.classList.toggle('cockpit-mode', mode === 'cockpit');
    this.cockpit.show(mode === 'cockpit' && (this.state === 'fly' || this.state === 'shot'));
    this.planeGroup.visible = mode !== 'cockpit';
  }

  // ---------- input ----------
  bindUI() {
    $('btn-fly').addEventListener('click', () => this.startMission(this.selectedMission));
    $('btn-map').addEventListener('click', () => this.showMap(true));
    $('btn-help').addEventListener('click', () => { this.hideAllScreens(); $('help-screen').classList.remove('hidden'); });
    $('btn-help-close').addEventListener('click', () => { this.hideAllScreens(); this.showMenu(); });
    $('btn-map-fly').addEventListener('click', () => this.startMission(this.selectedMission));
    $('btn-map-close').addEventListener('click', () => { this.hideAllScreens(); this.showMenu(); });
    $('btn-next').addEventListener('click', () => {
      const next = (this.selectedMission % MISSIONS.length) + 1;
      this.startMission(next);
    });
    $('btn-again').addEventListener('click', () => this.startMission(this.selectedMission));
    $('btn-debrief-map').addEventListener('click', () => this.showMap(true));
    $('btn-retry').addEventListener('click', () => this.startMission(this.selectedMission));
    $('btn-crash-map').addEventListener('click', () => this.showMap(true));
  }

  bindInput() {
    this.keys = {};
    this.mouse = { down: false, dx: 0, dy: 0 };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this.audio.ensure();
      if (e.code === 'KeyC' && (this.state === 'fly' || this.state === 'shot')) {
        this.setCameraMode(this.cameraMode === 'chase' ? 'cockpit' : 'chase');
      }
      if (e.code === 'KeyF' && this.state === 'fly') {
        this.flight.flaps = (this.flight.flaps + 1) % 3;
        this.hud.showToast(this.flight.flaps ? `FLAPS ${this.flight.flaps * 15}°` : 'FLAPS UP');
      }
      if (e.code === 'KeyG' && this.state === 'fly') {
        this.flight.gear = !this.flight.gear;
        this.hud.showToast(this.flight.gear ? 'GEAR DOWN' : 'GEAR UP');
      }
      if (e.code === 'KeyM') { const m = this.audio.toggleMute(); this.hud.showToast(m ? 'SOUND OFF' : 'SOUND ON'); }
      if (e.code === 'KeyH') {
        if (this.state === 'fly') { this.state = 'help'; $('help-screen').classList.remove('hidden'); }
        else if (this.state === 'help') { $('help-screen').classList.add('hidden'); this.state = 'fly'; }
      }
      if (e.code === 'KeyP' && this.state === 'fly') {
        this.paused = !this.paused;
        this.hud.showToast(this.paused ? 'PAUSED' : 'RESUMED');
      }
      if (e.code === 'Space' && this.state === 'fly') {
        e.preventDefault();
        this.tryDrop();
      }
      if (e.code === 'Enter' && this.state === 'menu') this.startMission(this.selectedMission);
      if (e.code === 'Escape' && (this.state === 'fly')) this.showMap(true);
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    const canvas = $('scene');
    canvas.addEventListener('pointerdown', (e) => {
      this.mouse.down = true; this.mouse.x0 = e.clientX; this.mouse.y0 = e.clientY;
      this.mouse.dx = 0; this.mouse.dy = 0;
      this.audio.ensure();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.mouse.down) return;
      this.mouse.dx = clamp((e.clientX - this.mouse.x0) / 160, -1, 1);
      this.mouse.dy = clamp((e.clientY - this.mouse.y0) / 160, -1, 1);
    });
    window.addEventListener('pointerup', () => { this.mouse.down = false; this.mouse.dx = 0; this.mouse.dy = 0; });
  }

  tryDrop() {
    // A drop only counts inside the runner's own check (slow + low + over
    // the ring); here we just give feedback and a crate visual if it lands.
    const dz = DROP_ZONES[this.runner.dropsDone];
    if (!dz || this.runner.mission.type !== 'drop') return;
    const dx = this.flight.pos.x - dz.x, dzz = this.flight.pos.z - dz.z;
    const agl = this.flight.pos.y - groundHeight(this.flight.pos.x, this.flight.pos.z);
    if (Math.hypot(dx, dzz) < 40 && agl < 160 && this.flight.speedKt < 115) {
      this.hud.showToast('SUPPLY AWAY — GOOD DROP', 1800);
    } else {
      this.hud.showToast('NO DROP — TOO FAST / HIGH / OFF THE RING', 1800);
    }
  }

  readInput() {
    const k = this.keys;
    const roll = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0) + this.mouse.dx;
    const pitch = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0) + this.mouse.dy;
    const throttleDelta = ((k.ShiftLeft || k.ShiftRight) ? 0.55 : 0) - ((k.ControlLeft || k.ControlRight) ? 0.55 : 0);
    return { roll: clamp(roll, -1, 1), pitch: clamp(pitch, -1, 1), throttleDelta };
  }

  // ---------- per-frame ----------
  step(dt) {
    this.time += dt;
    const f = this.flight;
    if (this.state === 'fly' && !this.paused) {
      const input = this.readInput();
      f.step(dt, input, { windKt: this.weather.windKt });
      this.events.length = 0;
      this.runner.update(dt, f, this.events);
      for (const ev of this.events) {
        if (ev.type === 'gate') { this.hud.showToast(`GATE ${ev.index} CLEARED  +${ev.points}`); this.audio.gate(); }
        if (ev.type === 'drop') { this.hud.showToast(`SUPPLY DROP ${ev.index}/3 DELIVERED  +500`); this.audio.gate(); }
      }
      // storm front closes the valley
      if (this.runner.mission.weather === 'storm' && this.runner.frontEtaSec <= 0 && !this.runner.isComplete(f)) {
        this.failMission('STORM FRONT CLOSED THE VALLEY');
      }
      if (f.crashed) this.failMission(f.crashReason);
      else if (this.runner.isComplete(f)) this.finishMission();
      else if (f.landed) this.finishMission();
      this.audio.update(f.throttle, f.speedKt, true);
      this.terrain.setPapi(this.papiState());
    } else if (this.state === 'menu' || this.state === 'map' || this.state === 'shot') {
      this.audio.update(0, 0, false);
    }
    // world always animates (frozen in shot mode)
    if (!this.shotMode) {
      this.clouds.update(dt);
      this.terrain.update(this.time, dt);
      this.weather.update(dt, f.pos.x, f.pos.y, f.pos.z);
      this.lightning.update(dt);
      for (const disc of this.props) disc.rotation.z += dt * (3 + f.throttle * 22);
    }
    this.sky.follow(f.pos.x, f.pos.z);
    // bounce fill: from behind-above the camera, onto the plane
    this.fill.position.set(this.camera.position.x, this.camera.position.y + 300, this.camera.position.z + 400);
    this.fill.target.position.copy(f.pos);
    // plane transform
    this.planeGroup.position.copy(f.pos);
    this.planeGroup.rotation.y = -f.heading;
    this.planeGroup.rotation.x = f.pitch;
    this.planeGroup.rotation.z = -f.roll;
    // cameras
    this.updateCamera(dt);
    // HUD + cockpit
    if (this.state === 'fly' || this.state === 'shot') {
      this.hud.update(dt, this.hudState());
      if (this.cameraMode === 'cockpit') this.cockpit.draw(f, this.papiState());
    }
  }

  updateCamera(dt) {
    const f = this.flight;
    const fwd = new THREE.Vector3(Math.sin(f.heading), 0, -Math.cos(f.heading));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (this.cameraMode === 'cockpit') {
      const eye = f.pos.clone().addScaledVector(fwd, 2.4).add(new THREE.Vector3(0, 1.35, 0));
      const look = f.pos.clone().addScaledVector(fwd, 120);
      look.y += Math.sin(f.pitch) * 120 + 1.35;
      if (this.shotMode) { this.camera.position.copy(eye); this.camera.lookAt(look); }
      else {
        this.camera.position.lerp(eye, Math.min(1, dt * 14));
        this.camera.lookAt(look);
      }
      this.camera.rotation.z = -f.roll * 0.55;
      return;
    }
    // chase: 3/4 rear, slightly to the side, banked with the plane
    const o = this.chaseOpts;
    const back = f.pos.clone()
      .addScaledVector(fwd, -o.dist)
      .addScaledVector(right, o.side * o.dist * 0.5)
      .add(new THREE.Vector3(0, o.height, 0));
    const look = f.pos.clone().addScaledVector(fwd, 34).add(new THREE.Vector3(0, 4, 0));
    if (this.shotMode || this.state === 'menu') {
      this.camera.position.copy(back);
    } else {
      this.camera.position.lerp(back, Math.min(1, dt * 5));
    }
    this.camera.lookAt(look);
    this.camera.rotation.z += -f.roll * 0.22;
  }

  renderOnce() {
    this.step(0.016);
    this.renderer.render(this.scene, this.camera);
  }

  loop() {
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      if (!this.shotMode) {
        this.frameTimes.push(dt * 1000);
        if (this.frameTimes.length > 240) this.frameTimes.shift();
      }
      this.step(dt);
      this.renderer.render(this.scene, this.camera);
      if (this.shotMode) {
        this.framesRendered = (this.framesRendered || 0) + 1;
        if (this.framesRendered === 30) {
          const sorted = [...this.frameTimes].sort((a, b) => a - b);
          console.log(`[shot:${this.shotName}] rendered ${this.framesRendered} frames`);
          window.__shotDone = true;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

new Game();
