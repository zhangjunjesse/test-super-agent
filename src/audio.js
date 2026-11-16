/**
 * Tiny WebAudio toy box: every sound is synthesised, no assets required.
 * The context is created on the first user gesture so browsers stay happy.
 */
export class AudioKit {
  constructor({ muted = false } = {}) {
    this.ctx = null;
    this.master = null;
    this.muted = muted;
    this.noiseBuffer = null;
    this._volume = 0.5;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this._volume;

    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 22;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.24;

    this.master.connect(limiter);
    limiter.connect(this.ctx.destination);
    this._makeNoise();
  }

  async resume() {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* the browser can still refuse; that's fine */
      }
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : this._volume, now, 0.03);
  }

  _makeNoise() {
    const length = Math.floor(this.ctx.sampleRate * 1.2);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  get ready() {
    return Boolean(this.ctx) && !this.muted;
  }

  _tone(freq, { duration = 0.2, type = 'sine', gain = 0.2, when = 0, glide = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t0 + duration);

    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  _noise({ duration = 0.4, gain = 0.15, from = 600, to = 1800, q = 1.4, when = 0 } = {}) {
    if (!this.ctx || this.muted || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + duration);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.035);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  /** Bright bell for a collected stardust mote. Pitch rises with a combo. */
  collect(step = 0) {
    if (!this.ctx || this.muted) return;
    const base = 660 * Math.pow(2, Math.min(step, 7) / 12);
    this._tone(base, { duration: 0.22, type: 'sine', gain: 0.16 });
    this._tone(base * 2, { duration: 0.18, type: 'triangle', gain: 0.055, when: 0.012 });
    this._tone(base * 3, { duration: 0.14, type: 'sine', gain: 0.028, when: 0.03 });
  }

  golden() {
    if (!this.ctx || this.muted) return;
    [0, 0.07, 0.14, 0.23].forEach((when, i) => {
      this._tone(784 * Math.pow(2, i / 12), {
        duration: 0.3,
        type: 'triangle',
        gain: 0.11,
        when,
      });
    });
  }

  /** A soft, warm thump + sizzle for poking the sun. */
  poke() {
    this._tone(140, { duration: 0.32, type: 'sine', gain: 0.22, glide: 0.55 });
    this._tone(210, { duration: 0.16, type: 'triangle', gain: 0.07, glide: 0.7 });
    this._noise({ duration: 0.4, gain: 0.09, from: 500, to: 2600, q: 1.1 });
  }

  /** Big corona burst. */
  burst() {
    if (!this.ctx || this.muted) return;
    this._tone(60, { duration: 1.5, type: 'sine', gain: 0.3, glide: 0.6 });
    this._tone(90, { duration: 1.2, type: 'triangle', gain: 0.12, glide: 0.7, when: 0.02 });
    this._noise({ duration: 1.3, gain: 0.18, from: 220, to: 3200, q: 0.8 });
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      this._tone(freq, {
        duration: 0.7,
        type: 'sine',
        gain: 0.05,
        when: 0.08 + i * 0.07,
      })
    );
  }

  levelUp() {
    if (!this.ctx || this.muted) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this._tone(freq, {
        duration: 0.34,
        type: 'triangle',
        gain: 0.1,
        when: i * 0.09,
      });
      this._tone(freq * 2, {
        duration: 0.26,
        type: 'sine',
        gain: 0.03,
        when: i * 0.09 + 0.02,
      });
    });
  }

  planet() {
    this._tone(320, { duration: 0.28, type: 'sine', gain: 0.12, glide: 1.7 });
    this._tone(480, { duration: 0.22, type: 'triangle', gain: 0.04, glide: 1.5, when: 0.02 });
  }
}
