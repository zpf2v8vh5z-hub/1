/* Procedural WebAudio: engine, gunshots, siren, horn. No audio files needed. */

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.engine = null;
    this.sirenNodes = null;
    this.sirenLevel = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // --- engine: two detuned saws through a lowpass
    const g = ctx.createGain();
    g.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.Q.value = 3;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc2.type = "square";
    osc1.frequency.value = 55;
    osc2.frequency.value = 55.6;
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.25;
    osc1.connect(filter);
    osc2.connect(filter);
    sub.connect(subGain).connect(g);
    filter.connect(g).connect(this.master);
    osc1.start();
    osc2.start();
    sub.start();
    this.engine = { osc1, osc2, sub, gain: g, filter };

    // --- siren: two alternating tones
    const sGain = ctx.createGain();
    sGain.gain.value = 0;
    const sOsc = ctx.createOscillator();
    sOsc.type = "triangle";
    sOsc.frequency.value = 620;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 1.4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 240;
    lfo.connect(lfoGain).connect(sOsc.frequency);
    sOsc.connect(sGain).connect(this.master);
    sOsc.start();
    lfo.start();
    this.sirenNodes = { gain: sGain, osc: sOsc, lfo };
  }

  setEngine(active, ratio = 0, throttle = 0) {
    if (!this.engine || !this.ctx) return;
    const target = active ? 0.06 + throttle * 0.05 : 0;
    const t = this.ctx.currentTime;
    this.engine.gain.gain.setTargetAtTime(target, t, 0.1);
    const freq = 42 + ratio * 190;
    this.engine.osc1.frequency.setTargetAtTime(freq, t, 0.06);
    this.engine.osc2.frequency.setTargetAtTime(freq * 1.007, t, 0.06);
    this.engine.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(320 + ratio * 2100, t, 0.08);
  }

  gunshot(volume = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.22);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.5 * volume;
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);

    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = "square";
    click.frequency.setValueAtTime(180, now);
    click.frequency.exponentialRampToValueAtTime(60, now + 0.08);
    cg.gain.setValueAtTime(0.16 * volume, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    click.connect(cg).connect(this.master);
    click.start(now);
    click.stop(now + 0.1);
  }

  impact() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.14);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    src.connect(f).connect(g).connect(this.master);
    src.start(now);
  }

  reloadClick() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    for (const [delay, freq] of [[0, 1400], [0.16, 900]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.05, now + delay);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.05);
      o.connect(g).connect(this.master);
      o.start(now + delay);
      o.stop(now + delay + 0.06);
    }
  }

  horn() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    for (const f of [392, 466]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0, now);
      g.gain.linearRampToValueAtTime(0.09, now + 0.02);
      g.gain.linearRampToValueAtTime(0.0, now + 0.35);
      o.connect(g).connect(this.master);
      o.start(now);
      o.stop(now + 0.4);
    }
  }

  sirenPing() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(900, now);
    o.frequency.exponentialRampToValueAtTime(1500, now + 0.18);
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.32);
  }

  siren(level) {
    if (!this.sirenNodes || !this.ctx) return;
    const target = Math.max(0, Math.min(1, level)) * 0.12;
    this.sirenNodes.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  setMuted(muted) {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }
}
