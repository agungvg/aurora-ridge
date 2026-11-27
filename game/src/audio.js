// Procedural audio, no assets: engine hum (saw + lowpass, pitch follows
// throttle), wind noise (filtered noise, louder with speed), gate chime,
// thunder rumble. Everything starts on the first user gesture.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineGain = null;
    this.windGain = null;
    this.osc = null;
    this.osc2 = null;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // engine: two detuned saws through a lowpass
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sawtooth'; this.osc.frequency.value = 62;
      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'sawtooth'; this.osc2.frequency.value = 93;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0.0;
      this.osc.connect(lp); this.osc2.connect(lp);
      lp.connect(this.engineGain); this.engineGain.connect(this.ctx.destination);
      this.osc.start(); this.osc2.start();
      // wind: looping noise buffer through a bandpass
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
      this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.0;
      noise.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.ctx.destination);
      noise.start();
    } catch (e) { this.ctx = null; }
  }

  update(throttle, speedKt, flying) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const eng = flying ? 0.05 + throttle * 0.10 : 0.0;
    this.engineGain.gain.setTargetAtTime(eng, t, 0.15);
    this.osc.frequency.setTargetAtTime(52 + throttle * 68, t, 0.1);
    this.osc2.frequency.setTargetAtTime(78 + throttle * 102, t, 0.1);
    const wind = flying ? Math.min(0.12, speedKt / 1600) : 0;
    this.windGain.gain.setTargetAtTime(wind, t, 0.2);
  }

  blip(freq = 880, dur = 0.12, vol = 0.15) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur);
  }

  gate() { this.blip(880, 0.1, 0.18); setTimeout(() => this.blip(1318, 0.16, 0.18), 90); }

  thunder() {
    if (!this.ctx || this.muted) return;
    const len = this.ctx.sampleRate * 1.6;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(lp); lp.connect(g); g.connect(this.ctx.destination);
    src.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && this.engineGain) {
      this.engineGain.gain.value = 0;
      this.windGain.gain.value = 0;
    }
    return this.muted;
  }
}
