export const LEVELS = [
  { at: 0, name: '初升', scale: 1.0 },
  { at: 3, name: '暖暖', scale: 1.09 },
  { at: 8, name: '亮晶晶', scale: 1.18 },
  { at: 14, name: '超级', scale: 1.26 },
  { at: 22, name: '耀眼', scale: 1.33 },
  { at: 32, name: '宇宙级', scale: 1.4 },
];

/** The little sun's mood: score, growth level and burst energy. */
export class Game {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.started = false;
    this.score = 0;
    this.level = 1;
    this.energy = 0;
    this.bursts = 0;
    this.collected = 0;
    this.fullAnnounced = false;
    this.combo = 0;
    this.lastCollectAt = 0;
  }

  reset() {
    this.started = false;
    this.score = 0;
    this.level = 1;
    this.energy = 0;
    this.bursts = 0;
    this.collected = 0;
    this.fullAnnounced = false;
    this.combo = 0;
    this.lastCollectAt = 0;
  }

  start() {
    this.started = true;
    this._emit();
  }

  get levelInfo() {
    return LEVELS[this.level - 1];
  }

  get nextLevel() {
    return LEVELS[this.level] ?? null;
  }

  get progress() {
    const next = this.nextLevel;
    if (!next) return 1;
    const currentAt = this.levelInfo.at;
    return Math.min(1, Math.max(0, (this.score - currentAt) / (next.at - currentAt)));
  }

  /** Collect one mote. Returns true if this triggered a level-up. */
  addStardust(value = 1) {
    if (!this.started) return false;
    const now = performance.now();
    this.combo = now - this.lastCollectAt < 1400 ? this.combo + 1 : 0;
    this.lastCollectAt = now;

    this.score += value;
    this.collected += 1;
    const energyGain = value >= 3 ? 0.34 : 0.125;
    this.energy = Math.min(1, this.energy + energyGain);

    let leveledUp = false;
    while (this.level < LEVELS.length && this.score >= LEVELS[this.level].at) {
      this.level += 1;
      leveledUp = true;
      this.callbacks.onLevelUp?.(this.levelInfo, this.level);
    }

    if (this.energy >= 1 && !this.fullAnnounced) {
      this.fullAnnounced = true;
      this.callbacks.onEnergyFull?.();
    }

    this._emit();
    return leveledUp;
  }

  triggerBurst() {
    if (!this.started || this.energy < 1) return false;
    this.energy = 0;
    this.fullAnnounced = false;
    this.bursts += 1;
    this.callbacks.onBurst?.(this.bursts);
    this._emit();
    return true;
  }

  _emit() {
    this.callbacks.onUpdate?.(this.getState());
  }

  getState() {
    return {
      started: this.started,
      score: this.score,
      level: this.level,
      levelName: this.levelInfo.name,
      energy: this.energy,
      bursts: this.bursts,
      collected: this.collected,
      progress: this.progress,
      maxLevel: this.level >= LEVELS.length,
    };
  }
}
