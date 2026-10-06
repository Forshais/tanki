// Sounds: shots, hits and explosions are synthesized; driving uses one recorded loop for every tank.
export class Sfx {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = .55; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // recorded driving loop (garuda1982, Freesound 541240, CC BY 4.0), made by tools/make_drive_loop.py
    this.drives = new Map(); this.driveBuf = null;
    fetch('assets/tank_drive.wav').then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => { this.driveBuf = buf; }).catch(() => {});
  }

  // the recorded loop for one tank: idling = slower, quieter and muffled; driving opens it up to full speed and
  // brightness; pressing the throttle (load) revs it a little. vol 0 (destroyed, far away) fades the voice out.
  drive(key, trackV, vol, load = 0) {
    if (!this.driveBuf) return;
    const ctx = this.ctx, t = ctx.currentTime, k = Math.min(1, trackV / 8);
    let d = this.drives.get(key);
    if (!(vol > .02)) {
      if (d) { d.g.gain.setTargetAtTime(0, t, .25); d.src.stop(t + 1.2); this.drives.delete(key); }
      return;
    }
    if (!d) {
      const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.driveBuf; src.loop = true; lp.type = 'lowpass'; lp.Q.value = .7; lp.frequency.value = 800; g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(this.master); src.start(0, Math.random() * this.driveBuf.duration);
      this.drives.set(key, d = { src, lp, g });
    }
    d.seen = true;
    const level = vol * Math.min(1, .3 + .7 * Math.pow(k, .7) + .15 * load);
    d.g.gain.setTargetAtTime(level, t, level > d.g.gain.value ? .15 : .3);
    d.src.playbackRate.setTargetAtTime(.62 + .46 * k + .07 * load, t, .25);
    d.lp.frequency.setTargetAtTime(750 + 8000 * Math.pow(k, 1.3) + 1500 * load, t, .2);
  }
  // after each update: silence and drop loops of tanks that were not updated (gone, removed wrecks)
  driveSweep() {
    for (const [key, d] of this.drives) {
      if (d.seen) { d.seen = false; continue; }
      d.g.gain.setTargetAtTime(0, this.ctx.currentTime, .15);
      d.src.stop(this.ctx.currentTime + .8); this.drives.delete(key);
    }
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
  stopEngine() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const d of this.drives?.values() || []) d.g.gain.setTargetAtTime(0, t, .3);
  }

}
