// Small synthesized sound set (no audio files needed).
export class Sfx {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = .55; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.engineInit();
    this.clackBufs = [0, 1, 2].map(k => this.makeClack(k));
    this.trackState = new Map();
  }

  // V-12 diesel: 6 firings per crank turn (pulse wave), a half-order rumble, and combustion clatter
  // (band-passed noise chopped at the firing rate); everything through a soft clipper and a load-dependent low-pass
  engineInit() {
    const ctx = this.ctx, osc = (type, f) => { const o = ctx.createOscillator(); if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type); o.frequency.value = f; o.start(); return o; };
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.eng = gain(0); this.eng.connect(this.master);
    this.engLp = filt('lowpass', 400, .9); this.engLp.connect(this.eng);
    const shaper = ctx.createWaveShaper(), n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve; shaper.connect(this.engLp);
    const H = 28, re = new Float32Array(H), im = new Float32Array(H);
    for (let h = 1; h < H; h++) im[h] = Math.pow(h, -.85) * (h % 2 ? 1 : .6) * (h % 3 ? 1 : 1.3);
    this.fireOsc = osc(ctx.createPeriodicWave(re, im), 60);
    const fg = gain(.45); this.fireOsc.connect(fg); fg.connect(shaper);
    this.halfOsc = osc('triangle', 30);
    const hg = gain(.55); this.halfOsc.connect(hg); hg.connect(shaper);
    // clatter
    const nz = ctx.createBufferSource(); nz.buffer = this.noiseBuf; nz.loop = true; nz.start();
    this.clatBp = filt('bandpass', 1400, 1.1);
    const am = gain(.5); this.chopOsc = osc('square', 60); const depth = gain(.5); this.chopOsc.connect(depth); depth.connect(am.gain);
    this.clat = gain(0); nz.connect(this.clatBp); this.clatBp.connect(am); am.connect(this.clat); this.clat.connect(this.eng);
    // track noise while rolling: low grind + a skid squeal when turning
    const nz2 = ctx.createBufferSource(); nz2.buffer = this.noiseBuf; nz2.loop = true; nz2.loopStart = .5; nz2.start(0, .5);
    this.grind = gain(0); const glp = filt('lowpass', 520, .7); nz2.connect(glp); glp.connect(this.grind); this.grind.connect(this.master);
    this.squeal = gain(0); this.squealBp = filt('bandpass', 2300, 9); nz2.connect(this.squealBp); this.squealBp.connect(this.squeal); this.squeal.connect(this.master);
    this.rpm = 650;
  }

  // one track link hitting the sprocket / road wheel: a metallic knock with a few short resonances
  makeClack(seed) {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * .11), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    const modes = [[620, .5], [1180, .7], [2050, .45], [3300, .3], [4700, .15]].map(([f, a]) => [f * (1 + (seed - 1) * .07) * (.96 + Math.random() * .08), a, Math.random() * 6.28]);
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let v = (Math.random() * 2 - 1) * Math.exp(-t / .006) * .9;
      for (const [f, a, ph] of modes) v += a * Math.sin(6.283 * f * t + ph) * Math.exp(-t / (.012 + 18 / f));
      v += .6 * Math.sin(6.283 * 140 * t) * Math.exp(-t / .02);           // dull thump of the link pin
      d[i] = v; peak = Math.max(peak, Math.abs(v));
    }
    for (let i = 0; i < len; i++) d[i] /= peak;
    return buf;
  }

  noise(vol, dur, freq, q = .7, type = 'lowpass', attack = .002) {
    if (!this.ctx || vol <= .01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = .7 + Math.random() * .6;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + dur + .05);
  }

  tone(vol, f0, f1, dur, type = 'sine') {
    if (!this.ctx || vol <= .01) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
  }

  shot(v, mine) { this.noise(v * (mine ? 1 : .8), .9, 900); this.noise(v * .6, .25, 3000, .5, 'bandpass'); this.tone(v * .9, 90, 35, .5); }
  boom(v, big) { this.noise(v * (big ? 1.2 : .8), big ? 2.4 : 1.2, big ? 400 : 700); this.tone(v, 60, 25, big ? 1.4 : .7); }
  pen(v) { this.noise(v * .8, .35, 1800, 1.5, 'bandpass'); this.tone(v * .4, 400, 120, .3, 'square'); }
  rico(v) { this.tone(v * .35, 2400 + Math.random() * 1500, 600, .45, 'triangle'); this.noise(v * .3, .15, 4000, 2, 'bandpass'); }
  brick(v) { this.noise(v * .8, .7, 700); this.noise(v * .4, .3, 2500, 1, 'bandpass', .01); }
  thud(v) { this.noise(v * .5, .5, 500); }
  rustle(v) { this.noise(v * .3, .45, 2600, .7, 'bandpass', .06); this.noise(v * .2, .3, 900, .5, 'bandpass', .04); }
  bump() { this.noise(.3, .2, 300); }
  kill() { this.tone(.35, 520, 780, .18, 'triangle'); setTimeout(() => this.tone(.35, 780, 1040, .3, 'triangle'), 140); }
  click() { this.tone(.15, 900, 600, .05, 'square'); }
  // player's engine: rpm follows speed and throttle with some inertia; load opens the filter and adds clatter
  engine(throttle, speed, trackV = Math.abs(speed), turnW = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = Math.min(1, Math.abs(speed) / 8), load = Math.abs(throttle);
    const target = 620 + 1250 * Math.min(1, .75 * k + .35 * load);
    this.rpm += (target - this.rpm) * (target > this.rpm ? .05 : .03);
    const f = this.rpm / 10;                                   // 12 cylinders, 4-stroke: rpm / 60 * 6
    this.fireOsc.frequency.setTargetAtTime(f, t, .05); this.chopOsc.frequency.setTargetAtTime(f, t, .05);
    this.halfOsc.frequency.setTargetAtTime(f / 2 * 1.003, t, .05);
    this.eng.gain.setTargetAtTime(.075 + .07 * load + .04 * k, t, .15);
    this.engLp.frequency.setTargetAtTime(260 + 4.5 * f + 700 * load, t, .1);
    this.clat.gain.setTargetAtTime(.05 + .12 * load, t, .1);
    this.clatBp.frequency.setTargetAtTime(1100 + 4 * f, t, .1);
    const tv = Math.min(1, trackV / 8);
    this.grind.gain.setTargetAtTime(.1 * tv, t, .12);
    this.squeal.gain.setTargetAtTime(Math.min(.05, .045 * turnW * (.3 + tv)), t, .15);
    this.squealBp.frequency.setTargetAtTime(2100 + 500 * Math.sin(t * 3.1) + 300 * Math.sin(t * 7.3), t, .05);
  }
  stopEngine() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.eng, this.grind, this.squeal]) g.gain.setTargetAtTime(0, t, .3);
  }

  // track clatter of any tank: link knocks scheduled ahead on the audio clock, faster with track speed
  tracks(key, trackV, vol) {
    if (!this.ctx) return;
    let st = this.trackState.get(key);
    if (!st) this.trackState.set(key, st = { next: 0 });
    if (!(trackV >= .3) || !(vol >= .02)) { st.next = 0; return; }
    const ctx = this.ctx, now = ctx.currentTime, rate = Math.min(30, trackV / .3);
    if (st.next < now) st.next = now + .01;
    while (st.next < now + .1) {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = this.clackBufs[Math.random() * 3 | 0]; src.playbackRate.value = .8 + Math.random() * .35 + trackV * .015;
      g.gain.value = vol * (.45 + Math.random() * .55) * (.55 + .45 * Math.min(1, trackV / 4));
      src.connect(g); g.connect(this.master); src.start(st.next);
      st.next += (.7 + Math.random() * .6) / rate;
    }
  }
  forget(key) { this.trackState?.delete(key); }
}
