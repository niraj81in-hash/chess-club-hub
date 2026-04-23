
// ============================================================
// Chess Club Hub — Chess Clock
// Supports Bullet, Blitz, Rapid, Classical + increment
// ============================================================

export const TIME_CONTROLS = [
  { label: '1 min  (Bullet)',      minutes: 1,  increment: 0  },
  { label: '2+1    (Bullet)',      minutes: 2,  increment: 1  },
  { label: '3 min  (Blitz)',       minutes: 3,  increment: 0  },
  { label: '3+2    (Blitz)',       minutes: 3,  increment: 2  },
  { label: '5 min  (Blitz)',       minutes: 5,  increment: 0  },
  { label: '10 min (Rapid)',       minutes: 10, increment: 0  },
  { label: '15+10  (Rapid)',       minutes: 15, increment: 10 },
  { label: '30 min (Classical)',   minutes: 30, increment: 0  },
  { label: 'No Clock',             minutes: 0,  increment: 0  },
];

export class ChessClock {
  constructor(minutes, increment, onTick, onTimeout) {
    this.increment = increment * 1000; // ms
    this.times     = { w: minutes * 60 * 1000, b: minutes * 60 * 1000 };
    this.active    = null;   // 'w' | 'b' | null
    this.running   = false;
    this.interval  = null;
    this.onTick    = onTick || (() => {});
    this.onTimeout = onTimeout || (() => {});
    this.enabled   = minutes > 0;
  }

  start(color) {
    if (!this.enabled) return;
    this.active  = color;
    this.running = true;
    this._tick();
  }

  // Called after a move — switches clock to opponent
  switch(justMoved) {
    if (!this.enabled) return;
    this.times[justMoved] += this.increment;
    this.active  = justMoved === 'w' ? 'b' : 'w';
    this.running = true;
    if (!this.interval) this._tick();
  }

  pause() {
    this.running = false;
    clearInterval(this.interval);
    this.interval = null;
  }

  resume() {
    if (!this.enabled || !this.active) return;
    this.running = true;
    this._tick();
  }

  stop() {
    this.running = false;
    clearInterval(this.interval);
    this.interval = null;
    this.active = null;
  }

  _tick() {
    clearInterval(this.interval);
    const last = Date.now();
    this.interval = setInterval(() => {
      if (!this.running || !this.active) return;
      const now = Date.now();
      const elapsed = now - last;

      // We re-read `last` via closure per interval call
      // Use a simpler decrement-per-second approach:
      this.times[this.active] = Math.max(0, this.times[this.active] - 100);
      this.onTick({ ...this.times });

      if (this.times[this.active] <= 0) {
        this.stop();
        this.onTimeout(this.active);
      }
    }, 100);
  }

  getFormatted(color) {
    const ms  = Math.max(0, this.times[color]);
    const s   = Math.floor(ms / 1000);
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  isLow(color) {
    return this.enabled && this.times[color] < 30000; // < 30s
  }
}
