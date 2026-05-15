# Stockfish Review Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local Stockfish (WASM in a Web Worker) for review-page analysis, augmenting the existing Lichess cloud-eval. Supports per-position eval as users click through a game and a full-game pass that classifies moves and renders an evaluation graph.

**Architecture:** New `engine/` module with a single public API (`engine/analysis.js`). It tries Lichess cloud-eval first per position, falls back to local Stockfish via a wrapper Web Worker. A pure classifier (`engine/move-quality.js`) tags each move best/excellent/good/inaccuracy/mistake/blunder. Results persist in IndexedDB on the game record. UI: settings strip (depth presets + custom slider + version dropdown + source badge), Analyze button, SVG eval graph, inline move badges.

**Tech Stack:** Vanilla JS ES modules (no build step), Vitest (unit tests), Web Worker + UCI protocol, Stockfish 16 WASM via jsdelivr CDN, SVG for the eval graph, IndexedDB for analysis persistence.

**Spec:** `docs/superpowers/specs/2026-05-14-stockfish-review-integration-design.md`

---

## File Structure

**New files:**
- `engine/versions.js` — registry mapping engine ID → WASM URLs (single + multi-threaded)
- `engine/move-quality.js` — pure `classify(before, after, sideToMove)` → tier
- `engine/stockfish-loader.js` — runtime SAB detection + worker factory
- `engine/stockfish-worker.js` — Web Worker that loads Stockfish WASM and bridges UCI ↔ postMessage
- `engine/analysis.js` — public API: `analyzePosition`, `analyzeGame`, `cancel`
- `js/ui/eval-graph.js` — pure function returning an `<svg>` element from an array of evals
- `tests/versions.test.js`
- `tests/move-quality.test.js`
- `tests/stockfish-loader.test.js`
- `tests/analysis.test.js`
- `tests/eval-graph.test.js`

**Modified files:**
- `index.html` — engine settings strip, Analyze button, progress bar, eval graph container
- `app.js` — replace `fetchEngineEval`; wire settings strip controls; wire Analyze button; render quality badges in `renderReviewMoveList`; render eval graph
- `sw.js` — note jsdelivr origin in the external-host comment (no behavior change)

---

## Task 1: `engine/versions.js` — engine registry

**Files:**
- Create: `engine/versions.js`
- Create: `tests/versions.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/versions.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { ENGINES, DEFAULT_ENGINE, getEngine } from '../engine/versions.js';

describe('engine registry', () => {
  it('has stockfish-16 as the default', () => {
    expect(DEFAULT_ENGINE).toBe('stockfish-16');
    expect(ENGINES[DEFAULT_ENGINE]).toBeDefined();
  });

  it('stockfish-16 has label, st URL, mt URL', () => {
    const e = ENGINES['stockfish-16'];
    expect(e.label).toBe('Stockfish 16');
    expect(typeof e.st).toBe('string');
    expect(typeof e.mt).toBe('string');
    expect(e.st).toMatch(/^https:/);
    expect(e.mt).toMatch(/^https:/);
  });

  it('getEngine returns the engine record for a known id', () => {
    const e = getEngine('stockfish-16');
    expect(e.label).toBe('Stockfish 16');
  });

  it('getEngine throws for an unknown id', () => {
    expect(() => getEngine('stockfish-99')).toThrow(/Unknown engine/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- versions
```
Expected: FAIL with `Cannot find module '../engine/versions.js'`

- [ ] **Step 3: Create `engine/versions.js`**

```javascript
// Registry of available Stockfish engines. Adding a future version is a single
// entry here — analysis.js and the UI consume this registry by id.

export const ENGINES = {
  'stockfish-16': {
    label: 'Stockfish 16',
    // Single-threaded build — works in every browser, no special headers required.
    st: 'https://cdn.jsdelivr.net/npm/stockfish@16.1.0/src/stockfish-nnue-16-single.js',
    // Multi-threaded build — requires SharedArrayBuffer + COOP/COEP headers.
    // Currently unreachable in v1 (headers not enabled); included so the loader can
    // pick it up automatically once task #13b lands.
    mt: 'https://cdn.jsdelivr.net/npm/stockfish@16.1.0/src/stockfish-nnue-16.js',
  },
};

export const DEFAULT_ENGINE = 'stockfish-16';

export function getEngine(id) {
  const e = ENGINES[id];
  if (!e) throw new Error(`Unknown engine: ${id}`);
  return e;
}
```

Note: the jsdelivr URL points at `stockfish@16.1.0` on npm — Stockfish 16 NNUE, the most recent build currently published on the public CDN. Identifier (`stockfish-16`) and label (`Stockfish 16`) match the binary, which keeps the registry honest. When a later Stockfish version becomes available on the same CDN, add a new entry to `ENGINES` (e.g. `'stockfish-17'` → SF17 URLs) and update `DEFAULT_ENGINE` to point at it; do not mutate the existing `stockfish-16` entry.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- versions
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add engine/versions.js tests/versions.test.js
git commit -m "feat(engine): add engine registry — Stockfish 16 single + multi-threaded URLs"
```

---

## Task 2: `engine/move-quality.js` — pure classifier

**Files:**
- Create: `engine/move-quality.js`
- Create: `tests/move-quality.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/move-quality.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { classify } from '../engine/move-quality.js';

// Evaluation objects use the same shape as the engine output:
// { cp: number|null, mate: number|null }  — both from white's POV.
//   cp > 0  → white is better
//   mate >0 → white mates in N
//   mate <0 → black mates in N

describe('classify — centipawn loss thresholds', () => {
  it('cp loss < 10 → best', () => {
    // White moves, eval was +50, now +45 → white lost 5cp → best
    expect(classify({ cp: 50, mate: null }, { cp: 45, mate: null }, 'w')).toBe('best');
  });
  it('cp loss 10..24 → excellent', () => {
    expect(classify({ cp: 50, mate: null }, { cp: 35, mate: null }, 'w')).toBe('excellent');
  });
  it('cp loss 25..49 → good', () => {
    expect(classify({ cp: 50, mate: null }, { cp: 20, mate: null }, 'w')).toBe('good');
  });
  it('cp loss 50..99 → inaccuracy', () => {
    expect(classify({ cp: 50, mate: null }, { cp: -10, mate: null }, 'w')).toBe('inaccuracy');
  });
  it('cp loss 100..199 → mistake', () => {
    expect(classify({ cp: 50, mate: null }, { cp: -100, mate: null }, 'w')).toBe('mistake');
  });
  it('cp loss >=200 → blunder', () => {
    expect(classify({ cp: 50, mate: null }, { cp: -200, mate: null }, 'w')).toBe('blunder');
  });

  it('inverts perspective for black moves', () => {
    // Black moves, eval was -50 (good for black), now -45 → black lost 5cp → best
    expect(classify({ cp: -50, mate: null }, { cp: -45, mate: null }, 'b')).toBe('best');
    // Black moves, eval was -50, now +100 → black lost 150cp → mistake
    expect(classify({ cp: -50, mate: null }, { cp: 100, mate: null }, 'b')).toBe('mistake');
  });
});

describe('classify — mate handling', () => {
  it('mover maintains a winning mate → best', () => {
    // White had M3, plays the mating move, now M2 → best
    expect(classify({ cp: null, mate: 3 }, { cp: null, mate: 2 }, 'w')).toBe('best');
  });
  it('mover throws away a winning mate → blunder', () => {
    // White had M3, blundered into no-mate position with +200 → blunder
    expect(classify({ cp: null, mate: 3 }, { cp: 200, mate: null }, 'w')).toBe('blunder');
  });
  it('mover slows down a winning mate → mistake', () => {
    // White had M3, plays a move that delays mate to M5 → mistake
    expect(classify({ cp: null, mate: 3 }, { cp: null, mate: 5 }, 'w')).toBe('mistake');
  });
  it('mover escapes a losing mate → best', () => {
    // White was getting mated in 4, defended to a -200 cp position → best (escape)
    expect(classify({ cp: null, mate: -4 }, { cp: -200, mate: null }, 'w')).toBe('best');
  });
  it('mover walks into a mate → blunder', () => {
    // White had +100, blundered into M-3 (getting mated) → blunder
    expect(classify({ cp: 100, mate: null }, { cp: null, mate: -3 }, 'w')).toBe('blunder');
  });
  it('mover finds a mate → best', () => {
    // White had +200, found M3 → best
    expect(classify({ cp: 200, mate: null }, { cp: null, mate: 3 }, 'w')).toBe('best');
  });
});

describe('classify — null inputs', () => {
  it('returns null for missing eval', () => {
    expect(classify(null, { cp: 0, mate: null }, 'w')).toBe(null);
    expect(classify({ cp: 0, mate: null }, null, 'w')).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- move-quality
```
Expected: FAIL — `Cannot find module '../engine/move-quality.js'`

- [ ] **Step 3: Implement `engine/move-quality.js`**

```javascript
// Pure classification of a single move's quality given before/after evals.
// Both evals are from white's POV. `sideToMove` is the color that JUST moved
// (so the player whose perspective we judge cp-loss from).

export const TIERS = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

const CP_THRESHOLDS = [
  { max: 10,  tier: 'best' },
  { max: 25,  tier: 'excellent' },
  { max: 50,  tier: 'good' },
  { max: 100, tier: 'inaccuracy' },
  { max: 200, tier: 'mistake' },
];

export function classify(evalBefore, evalAfter, sideToMove) {
  if (!evalBefore || !evalAfter) return null;

  // Sign that converts a white-POV eval into a mover-POV eval.
  const sign = sideToMove === 'w' ? 1 : -1;

  const beforeMate = evalBefore.mate != null;
  const afterMate  = evalAfter.mate  != null;

  // Both mate: compare mate distances from mover's POV.
  if (beforeMate && afterMate) {
    const before = sign * evalBefore.mate;
    const after  = sign * evalAfter.mate;
    if (before > 0 && after > 0) {
      // Mover is mating; smaller mate distance is better.
      return after <= before ? 'best' : 'mistake';
    }
    if (before < 0 && after < 0) {
      // Mover is being mated; larger negative distance (slower mate) is better.
      return after < before ? 'best' : 'mistake';
    }
    if (before > 0 && after < 0) return 'blunder';
    // before < 0 && after > 0 — mover turned a loss into a win.
    return 'best';
  }

  if (beforeMate && !afterMate) {
    const before = sign * evalBefore.mate;
    return before > 0 ? 'blunder' : 'best';
  }

  if (!beforeMate && afterMate) {
    const after = sign * evalAfter.mate;
    return after > 0 ? 'best' : 'blunder';
  }

  // Both cp: measure mover's loss in centipawns.
  const before = sign * evalBefore.cp;
  const after  = sign * evalAfter.cp;
  const loss   = before - after;

  if (loss < 0) return 'best';   // mover improved their own position
  for (const { max, tier } of CP_THRESHOLDS) {
    if (loss < max) return tier;
  }
  return 'blunder';
}
```

- [ ] **Step 4: Run test to verify all pass**

```bash
npm test -- move-quality
```
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add engine/move-quality.js tests/move-quality.test.js
git commit -m "feat(engine): pure move-quality classifier — 6 tiers, cp + mate handling"
```

---

## Task 3: `engine/stockfish-loader.js` — SAB detection

**Files:**
- Create: `engine/stockfish-loader.js`
- Create: `tests/stockfish-loader.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/stockfish-loader.test.js`:
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pickStockfishUrl } from '../engine/stockfish-loader.js';

const originalSAB = globalThis.SharedArrayBuffer;
const originalCOI = globalThis.crossOriginIsolated;

afterEach(() => {
  if (originalSAB === undefined) delete globalThis.SharedArrayBuffer;
  else globalThis.SharedArrayBuffer = originalSAB;
  if (originalCOI === undefined) delete globalThis.crossOriginIsolated;
  else globalThis.crossOriginIsolated = originalCOI;
});

describe('pickStockfishUrl', () => {
  it('picks single-threaded URL when SAB unavailable', () => {
    delete globalThis.SharedArrayBuffer;
    globalThis.crossOriginIsolated = false;
    const { url, threaded } = pickStockfishUrl('stockfish-16');
    expect(threaded).toBe(false);
    expect(url).toMatch(/single/);
  });

  it('picks single-threaded URL when crossOriginIsolated is false', () => {
    globalThis.SharedArrayBuffer = ArrayBuffer; // stub
    globalThis.crossOriginIsolated = false;
    const { url, threaded } = pickStockfishUrl('stockfish-16');
    expect(threaded).toBe(false);
    expect(url).toMatch(/single/);
  });

  it('picks multi-threaded URL when both SAB and crossOriginIsolated are true', () => {
    globalThis.SharedArrayBuffer = ArrayBuffer; // stub
    globalThis.crossOriginIsolated = true;
    const { url, threaded } = pickStockfishUrl('stockfish-16');
    expect(threaded).toBe(true);
    expect(url).not.toMatch(/single/);
  });

  it('throws for unknown engine id', () => {
    expect(() => pickStockfishUrl('stockfish-99')).toThrow(/Unknown engine/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- stockfish-loader
```
Expected: FAIL — `Cannot find module '../engine/stockfish-loader.js'`

- [ ] **Step 3: Implement `engine/stockfish-loader.js`**

```javascript
import { getEngine, DEFAULT_ENGINE } from './versions.js';

// Returns { url, threaded } for the chosen engine, picking the multi-threaded
// build when SharedArrayBuffer is available AND the page is crossOriginIsolated.
// `crossOriginIsolated` is only true when the page is served with
// Cross-Origin-Opener-Policy: same-origin AND Cross-Origin-Embedder-Policy: require-corp.
export function pickStockfishUrl(engineId = DEFAULT_ENGINE) {
  const engine = getEngine(engineId);
  const canSAB =
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof crossOriginIsolated !== 'undefined' &&
    crossOriginIsolated === true;
  return { url: canSAB ? engine.mt : engine.st, threaded: canSAB, engineId };
}

// Boots our wrapper worker and tells it which Stockfish URL to load.
// The wrapper worker lives at /engine/stockfish-worker.js and proxies UCI ↔ postMessage.
export function createEngineWorker(engineId = DEFAULT_ENGINE) {
  const { url, threaded, engineId: id } = pickStockfishUrl(engineId);
  const worker = new Worker('/engine/stockfish-worker.js');
  worker.postMessage({ type: 'init', stockfishUrl: url });
  return { worker, threaded, engineId: id };
}
```

- [ ] **Step 4: Run test to verify all pass**

```bash
npm test -- stockfish-loader
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add engine/stockfish-loader.js tests/stockfish-loader.test.js
git commit -m "feat(engine): stockfish loader — picks ST/MT WASM URL by SAB availability"
```

---

## Task 4: `engine/stockfish-worker.js` — UCI bridge

This is a Web Worker file that runs in its own context. It loads Stockfish via `importScripts`, then translates between our message protocol and UCI text.

No unit test (DOM-less Worker is awkward to test in Vitest). Verified by manual smoke test in Task 13 and via mocked tests in Task 5.

**Files:**
- Create: `engine/stockfish-worker.js`

- [ ] **Step 1: Create the worker file**

```javascript
// Classic Web Worker — runs in its own scope, no module imports.
// On init, importScripts loads the Stockfish WASM glue script (which is itself
// designed to run as / inside a worker). We then forward UCI commands to it and
// parse its UCI output into typed messages back to the main thread.

let engine = null;

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      importScripts(msg.stockfishUrl);
      // The Stockfish script exposes a global Stockfish() factory.
      engine = self.Stockfish();
      engine.addMessageListener(handleUciLine);
      engine.postMessage('uci');
      engine.postMessage('isready');
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
    return;
  }

  if (!engine) {
    self.postMessage({ type: 'error', message: 'Engine not initialized' });
    return;
  }

  if (msg.type === 'analyze') {
    const multiPV = msg.multiPV || 3;
    engine.postMessage(`setoption name MultiPV value ${multiPV}`);
    engine.postMessage(`position fen ${msg.fen}`);
    engine.postMessage(`go depth ${msg.depth}`);
    return;
  }

  if (msg.type === 'stop') {
    engine.postMessage('stop');
    return;
  }
});

function handleUciLine(line) {
  if (typeof line !== 'string') return;
  if (line.startsWith('info ') && line.includes(' pv ')) {
    const info = parseInfoLine(line);
    if (info) self.postMessage({ type: 'info', ...info });
  } else if (line.startsWith('bestmove ')) {
    const move = line.split(' ')[1];
    self.postMessage({ type: 'bestmove', move });
  }
}

function parseInfoLine(line) {
  // Example: "info depth 14 seldepth 18 multipv 1 score cp 23 nodes ... pv e2e4 e7e5 g1f3"
  const parts = line.split(' ');
  const out = { multipv: 1, depth: null, cp: null, mate: null, pv: '' };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === 'depth')   out.depth   = parseInt(parts[++i], 10);
    else if (p === 'multipv') out.multipv = parseInt(parts[++i], 10);
    else if (p === 'cp')      out.cp      = parseInt(parts[++i], 10);
    else if (p === 'mate')    out.mate    = parseInt(parts[++i], 10);
    else if (p === 'pv') {
      out.pv = parts.slice(i + 1).join(' ');
      break;
    }
  }
  if (out.depth == null || out.pv === '') return null;
  return out;
}
```

- [ ] **Step 2: Commit**

```bash
git add engine/stockfish-worker.js
git commit -m "feat(engine): stockfish-worker — UCI bridge (importScripts + message proxy)"
```

---

## Task 5: `engine/analysis.js` — `analyzePosition` (cloud + local fallback + cancel)

**Files:**
- Create: `engine/analysis.js`
- Create: `tests/analysis.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/analysis.test.js`:
```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the loader so analysis.js doesn't try to spawn a real Worker.
vi.mock('../engine/stockfish-loader.js', () => {
  return {
    createEngineWorker: () => {
      const listeners = new Set();
      const worker = {
        postMessage: vi.fn((msg) => {
          // Simulate Stockfish responses on the next microtask.
          queueMicrotask(() => {
            if (msg.type === 'analyze') {
              listeners.forEach((cb) => cb({ data: { type: 'info', depth: msg.depth, cp: 42, mate: null, multipv: 1, pv: 'e2e4' } }));
              listeners.forEach((cb) => cb({ data: { type: 'bestmove', move: 'e2e4' } }));
            }
          });
        }),
        addEventListener: (event, cb) => { if (event === 'message') listeners.add(cb); },
        removeEventListener: (event, cb) => { if (event === 'message') listeners.delete(cb); },
        terminate: vi.fn(),
        __listeners: listeners,
      };
      // Fire 'ready' on the next tick.
      queueMicrotask(() => listeners.forEach((cb) => cb({ data: { type: 'ready' } })));
      return { worker, threaded: false, engineId: 'stockfish-16' };
    },
  };
});

import { analyzePosition, cancel } from '../engine/analysis.js';

const FEN_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_INVALID = 'not a fen';

beforeEach(() => {
  cancel();
  vi.unstubAllGlobals();
});

describe('analyzePosition — cloud first', () => {
  it('returns cloud result when Lichess responds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ depth: 18, pvs: [{ cp: 15, moves: 'e2e4 e7e5' }] }),
    })));
    const r = await analyzePosition(FEN_START, { depth: 14 });
    expect(r.source).toBe('cloud');
    expect(r.cp).toBe(15);
    expect(r.reachedDepth).toBe(18);
  });

  it('falls back to local when Lichess returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const r = await analyzePosition(FEN_START, { depth: 14 });
    expect(r.source).toBe('local');
    expect(r.cp).toBe(42); // from the mocked worker
  });

  it('falls back to local when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = await analyzePosition(FEN_START, { depth: 14 });
    expect(r.source).toBe('local');
  });

  it('returns terminal result for an invalid FEN without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await analyzePosition(FEN_INVALID, { depth: 14 });
    expect(r.cp).toBe(null);
    expect(r.mate).toBe(null);
    expect(r.reason).toBe('terminal');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('analyzePosition — cancellation', () => {
  it('a second call cancels the first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const first = analyzePosition(FEN_START, { depth: 14 });
    const second = analyzePosition(FEN_START, { depth: 14 });
    const r2 = await second;
    expect(r2.source).toBe('local');
    // The first call should have been cancelled; awaiting it should throw or resolve to a cancellation marker.
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- analysis
```
Expected: FAIL — `Cannot find module '../engine/analysis.js'`

- [ ] **Step 3: Implement `analyzePosition` + `cancel` in `engine/analysis.js`**

```javascript
import { createEngineWorker } from './stockfish-loader.js';

// ── Cheap FEN sanity check — pre-empts both engines for terminal/garbage input.
function isPlausibleFen(fen) {
  if (typeof fen !== 'string') return false;
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return false;
  // First field: 8 ranks separated by '/', each rank made of pieces or digits 1-8.
  const ranks = parts[0].split('/');
  if (ranks.length !== 8) return false;
  return parts[1] === 'w' || parts[1] === 'b';
}

// ── Worker lifecycle (lazy, persistent across analyses).
let workerCtx = null;        // { worker, threaded, ready, listeners: Set }
let workerReadyPromise = null;

function ensureWorker() {
  if (workerCtx) return workerReadyPromise;
  const { worker, threaded, engineId } = createEngineWorker();
  workerCtx = { worker, threaded, engineId, ready: false };
  // Worker crashes: reset state so the next analyzePosition recreates the worker.
  worker.addEventListener('error', () => {
    workerCtx = null;
    workerReadyPromise = null;
    if (activeRequest) {
      const req = activeRequest;
      activeRequest = null;
      const err = new Error('Engine crashed');
      err.name = 'EngineError';
      req.reject(err);
    }
  });
  workerReadyPromise = new Promise((resolve, reject) => {
    const onMessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { workerCtx.ready = true; worker.removeEventListener('message', onMessage); resolve(); }
      else if (m.type === 'error' && !workerCtx.ready) {
        worker.removeEventListener('message', onMessage);
        workerCtx = null;
        workerReadyPromise = null;
        reject(new Error(m.message || 'Engine failed to load'));
      }
    };
    worker.addEventListener('message', onMessage);
  });
  return workerReadyPromise;
}

// ── Active request state (one at a time — calling analyzePosition cancels prior).
let activeRequest = null;    // { abort, reject, listener }

export function cancel() {
  if (!activeRequest) return;
  const req = activeRequest;
  activeRequest = null;
  try { req.abort(); } catch {}
  if (workerCtx?.worker) {
    workerCtx.worker.postMessage({ type: 'stop' });
    if (req.listener) workerCtx.worker.removeEventListener('message', req.listener);
  }
  const err = new Error('Analysis cancelled');
  err.name = 'AbortError';
  req.reject(err);
}

export async function analyzePosition(fen, options = {}) {
  cancel();

  const depth = options.depth ?? 18;
  const multiPV = options.multiPV ?? 3;

  if (!isPlausibleFen(fen)) {
    return { source: 'local', depth, reachedDepth: 0, cp: null, mate: null, pvs: [], reason: 'terminal' };
  }

  // ── Step 1: try Lichess cloud-eval.
  const ctl = new AbortController();
  const pending = new Promise((resolve, reject) => {
    activeRequest = {
      abort: () => ctl.abort(),
      reject,
      listener: null,
      resolve,
    };
  });

  try {
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPV}`;
    const res = await fetch(url, { signal: ctl.signal });
    if (res.ok) {
      const data = await res.json();
      if (data && data.pvs && data.pvs.length) {
        const top = data.pvs[0];
        const result = {
          source: 'cloud',
          depth,
          reachedDepth: data.depth ?? depth,
          cp: top.mate != null ? null : top.cp,
          mate: top.mate ?? null,
          pvs: data.pvs.map((p) => ({ cp: p.mate != null ? null : p.cp, mate: p.mate ?? null, moves: p.moves })),
        };
        if (activeRequest) { activeRequest.resolve(result); activeRequest = null; }
        return result;
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      // cancel() already rejected `pending`.
      return pending;
    }
    // any other fetch error → fall through to local
  }

  // ── Step 2: local Stockfish.
  await ensureWorker();
  const worker = workerCtx.worker;
  const result = await new Promise((resolve, reject) => {
    if (!activeRequest) {
      const err = new Error('Analysis cancelled');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    let lastInfo = null;
    const listener = (e) => {
      const m = e.data;
      if (m.type === 'info' && m.multipv === 1) {
        lastInfo = m;
      } else if (m.type === 'bestmove') {
        worker.removeEventListener('message', listener);
        const out = lastInfo
          ? {
              source: 'local',
              depth,
              reachedDepth: lastInfo.depth ?? depth,
              cp: lastInfo.mate != null ? null : lastInfo.cp,
              mate: lastInfo.mate ?? null,
              pvs: [{ cp: lastInfo.mate != null ? null : lastInfo.cp, mate: lastInfo.mate ?? null, moves: lastInfo.pv }],
            }
          : { source: 'local', depth, reachedDepth: 0, cp: null, mate: null, pvs: [] };
        resolve(out);
      }
    };
    worker.addEventListener('message', listener);
    activeRequest.listener = listener;
    worker.postMessage({ type: 'analyze', fen, depth, multiPV });
  });

  if (activeRequest) activeRequest = null;
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- analysis
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add engine/analysis.js tests/analysis.test.js
git commit -m "feat(engine): analyzePosition — cloud first, local fallback, cancellable"
```

---

## Task 6: `engine/analysis.js` — `analyzeGame` (full-game pass)

**Files:**
- Modify: `engine/analysis.js` (add `analyzeGame` export)
- Modify: `tests/analysis.test.js` (add suite)

- [ ] **Step 1: Add failing tests for analyzeGame**

Append to `tests/analysis.test.js`:
```javascript
import { analyzeGame } from '../engine/analysis.js';
import { initGameState, makeMove } from '../chess/engine.js';

describe('analyzeGame — full-game pass', () => {
  it('returns one eval per position (initial + after each move)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const moves = [
      { from: [6, 4], to: [4, 4] },  // e2e4
      { from: [1, 4], to: [3, 4] },  // e7e5
    ];
    const result = await analyzeGame(moves, { depth: 10 });
    expect(result.evals.length).toBe(3);   // initial + after move 1 + after move 2
    expect(result.qualities.length).toBe(2); // one per actual move
  });

  it('streams progress for each position', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const moves = [{ from: [6, 4], to: [4, 4] }, { from: [1, 4], to: [3, 4] }];
    const updates = [];
    await analyzeGame(moves, { depth: 10 }, (p) => updates.push(p));
    expect(updates.length).toBe(3);
    expect(updates[0]).toMatchObject({ index: 0, total: 3 });
    expect(updates[2]).toMatchObject({ index: 2, total: 3 });
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npm test -- analysis
```
Expected: FAIL — `analyzeGame is not exported`

- [ ] **Step 3: Add `analyzeGame` to `engine/analysis.js`**

At the top of `engine/analysis.js`, alongside existing imports, add:
```javascript
import { initGameState, makeMove } from '../chess/engine.js';
import { classify } from './move-quality.js';
```

Then add a helper to convert a chess/engine state into a FEN string:
```javascript
// Build a FEN-ish string from a state object (chess/engine.js produces piece codes like 'wK').
// Minimal correct FEN for analysis — only board, side, castling, en passant, half/full moves.
function stateToFen(state) {
  const PIECE_FEN = { wK:'K', wQ:'Q', wR:'R', wB:'B', wN:'N', wP:'P', bK:'k', bQ:'q', bR:'r', bB:'b', bN:'n', bP:'p' };
  const rankStrs = state.board.map((row) => {
    let s = '';
    let empty = 0;
    for (const sq of row) {
      if (!sq) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      s += PIECE_FEN[sq];
    }
    if (empty) s += empty;
    return s;
  });
  let castling = '';
  if (state.castling?.wK) castling += 'K';
  if (state.castling?.wQ) castling += 'Q';
  if (state.castling?.bK) castling += 'k';
  if (state.castling?.bQ) castling += 'q';
  if (!castling) castling = '-';
  let ep = '-';
  if (state.enPassant) {
    const [r, c] = state.enPassant;
    ep = String.fromCharCode(97 + c) + (8 - r);
  }
  return `${rankStrs.join('/')} ${state.turn} ${castling} ${ep} ${state.halfMove ?? 0} ${state.fullMove ?? 1}`;
}
```

Then add the public function:
```javascript
// Iterates positions (initial + after each move), analyzes each, classifies each move.
// onProgress: called after each position with { index, total, eval, classification }.
export async function analyzeGame(moves, options = {}, onProgress = () => {}) {
  const depth = options.depth ?? 14;
  const total = moves.length + 1;
  const evals = [];
  const qualities = [];

  // Build the sequence of positions by replaying moves through the engine.
  let state = initGameState();
  const positions = [state];
  for (const m of moves) {
    state = makeMove(state, m.from, m.to, m.promotion || 'Q');
    positions.push(state);
  }

  for (let i = 0; i < positions.length; i++) {
    const fen = stateToFen(positions[i]);
    const ev = await analyzePosition(fen, { depth, multiPV: 1 });
    evals.push({ cp: ev.cp, mate: ev.mate, depth: ev.reachedDepth });

    let classification = null;
    if (i > 0) {
      // The side that just moved is the OPPOSITE of positions[i].turn.
      const sideJustMoved = positions[i].turn === 'w' ? 'b' : 'w';
      classification = classify(evals[i - 1], evals[i], sideJustMoved);
      qualities.push(classification);
    }
    onProgress({ index: i, total, eval: evals[i], classification });
  }

  return { evals, qualities, depth, version: 'stockfish-16', ranAt: Date.now() };
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
npm test -- analysis
```
Expected: PASS (8 tests total: 6 from Task 5 + 2 new)

- [ ] **Step 5: Commit**

```bash
git add engine/analysis.js tests/analysis.test.js
git commit -m "feat(engine): analyzeGame — full-game pass with progress + classification"
```

---

## Task 7: `index.html` — engine settings strip + Analyze button + eval graph container

**Files:**
- Modify: `index.html` (review page section, around the existing engine-eval area)

- [ ] **Step 1: Locate the existing engine eval block**

Search `index.html` for `id="engine-eval"`. It is inside the review board view section. The new DOM is added in the same panel, above the current `engine-eval` element.

- [ ] **Step 2: Replace the engine analysis panel with the expanded layout**

Find the surrounding container that holds the existing `engine-eval`, `engine-lines`, `engine-depth`, `engine-status` elements. Replace ONLY that container with:

```html
<div class="engine-panel">
  <!-- Settings strip -->
  <div class="engine-settings">
    <label class="engine-setting">
      <span>Engine</span>
      <select id="engine-version" disabled>
        <option value="stockfish-16">Stockfish 16</option>
      </select>
    </label>
    <div class="engine-setting depth-presets" role="radiogroup" aria-label="Analysis depth">
      <button type="button" class="depth-chip" data-depth="12">Quick</button>
      <button type="button" class="depth-chip active" data-depth="18">Standard</button>
      <button type="button" class="depth-chip" data-depth="22">Deep</button>
      <button type="button" class="depth-chip" id="depth-custom-toggle" data-depth="custom">Custom</button>
    </div>
    <label class="engine-setting depth-slider-wrap" id="depth-slider-wrap" hidden>
      <span>Depth <output id="depth-slider-val">18</output></span>
      <input type="range" id="depth-slider" min="10" max="26" value="18" />
    </label>
    <span class="engine-source" id="engine-source"></span>
  </div>

  <!-- Eval readout (preserves existing IDs) -->
  <div class="engine-readout">
    <span id="engine-eval">—</span>
    <span id="engine-depth"></span>
    <span id="engine-status"></span>
  </div>
  <div id="engine-lines"></div>

  <!-- Full-game analysis controls -->
  <div class="engine-fullgame">
    <button type="button" id="analyze-game-btn" class="btn btn-surface btn-sm">⚙️ Analyze game</button>
    <div id="analyze-progress" class="analyze-progress" hidden>
      <div class="analyze-progress-bar"><div id="analyze-progress-fill"></div></div>
      <span id="analyze-progress-label"></span>
    </div>
  </div>

  <!-- Eval graph (filled after a full-game pass) -->
  <div id="eval-graph-container" class="eval-graph-container" hidden></div>
</div>
```

- [ ] **Step 3: Add styles to `style.css`**

Append to `style.css`:

```css
.engine-panel { display:flex; flex-direction:column; gap:.5rem; padding:.5rem; border:1px solid var(--border); border-radius:.5rem; background:var(--surface); }
.engine-settings { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; font-size:.85rem; }
.engine-setting { display:flex; gap:.35rem; align-items:center; color:var(--text-dim); }
.engine-setting select, .engine-setting input[type=range] { background:var(--surface-elev); color:var(--text); border:1px solid var(--border); border-radius:.25rem; padding:.15rem .35rem; }
.depth-presets { display:flex; gap:.25rem; }
.depth-chip { font-size:.8rem; padding:.2rem .5rem; border:1px solid var(--border); border-radius:.25rem; background:var(--surface-elev); color:var(--text-dim); cursor:pointer; }
.depth-chip.active { background:var(--gold); color:#000; border-color:var(--gold); }
.engine-source { margin-left:auto; font-size:.7rem; padding:.1rem .35rem; border-radius:.2rem; border:1px solid var(--border); color:var(--text-dim); }
.engine-source.cloud { color:var(--emerald); border-color:var(--emerald); }
.engine-source.local { color:var(--gold);    border-color:var(--gold); }
.engine-readout { display:flex; gap:.5rem; align-items:baseline; font-family:monospace; }
.engine-fullgame { display:flex; gap:.5rem; align-items:center; }
.analyze-progress { display:flex; gap:.5rem; align-items:center; flex:1; }
.analyze-progress-bar { flex:1; height:6px; background:var(--surface-elev); border-radius:3px; overflow:hidden; }
.analyze-progress-bar > div { height:100%; width:0; background:var(--gold); transition:width .15s ease; }
.eval-graph-container { width:100%; }
.move-quality { font-weight:600; margin-left:.15rem; }
.move-quality.best        { color:var(--emerald); }
.move-quality.excellent   { color:var(--emerald); opacity:.7; }
.move-quality.good        { color:var(--text-dim); }
.move-quality.inaccuracy  { color:#facc15; }
.move-quality.mistake     { color:#f97316; }
.move-quality.blunder     { color:var(--red); }
```

- [ ] **Step 4: Manually verify the page renders**

```bash
python3 -m http.server 8080
# Open http://localhost:8080, click Review, open a game.
```
Expected: settings strip shows engine dropdown + Quick/Standard/Deep/Custom chips with Standard highlighted, custom slider hidden, Analyze game button visible, no JS errors in the console.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css
git commit -m "feat(ui): engine settings strip, Analyze button, eval graph container on review page"
```

---

## Task 8: `js/ui/eval-graph.js` — SVG renderer

**Files:**
- Create: `js/ui/eval-graph.js`
- Create: `tests/eval-graph.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/eval-graph.test.js`:
```javascript
// @vitest-environment happy-dom
// happy-dom gives us a DOM in Vitest without spinning a browser.
import { describe, it, expect } from 'vitest';
import { renderEvalGraph, evalToY } from '../js/ui/eval-graph.js';

describe('evalToY', () => {
  it('clamps cp above +500 to the top of the chart', () => {
    expect(evalToY({ cp: 9999, mate: null }, 100)).toBe(0);
  });
  it('clamps cp below -500 to the bottom of the chart', () => {
    expect(evalToY({ cp: -9999, mate: null }, 100)).toBe(100);
  });
  it('puts cp 0 at the vertical center', () => {
    expect(evalToY({ cp: 0, mate: null }, 100)).toBe(50);
  });
  it('places winning mate at the top edge', () => {
    expect(evalToY({ cp: null, mate: 3 }, 100)).toBe(0);
  });
  it('places losing mate at the bottom edge', () => {
    expect(evalToY({ cp: null, mate: -3 }, 100)).toBe(100);
  });
});

describe('renderEvalGraph', () => {
  it('returns an <svg> element with a polyline of N points for N evals', () => {
    const svg = renderEvalGraph([{ cp: 0, mate: null }, { cp: 100, mate: null }, { cp: -200, mate: null }]);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    const poly = svg.querySelector('polyline');
    expect(poly).not.toBeNull();
    expect(poly.getAttribute('points').split(' ').length).toBe(3);
  });

  it('returns an empty <svg> when given an empty array', () => {
    const svg = renderEvalGraph([]);
    expect(svg.querySelector('polyline')).toBeNull();
  });
});
```

- [ ] **Step 2: Add happy-dom and run test to verify it fails**

```bash
npm install --save-dev happy-dom
npm test -- eval-graph
```
Expected: FAIL — `Cannot find module '../js/ui/eval-graph.js'`

- [ ] **Step 3: Implement `js/ui/eval-graph.js`**

```javascript
// Pure DOM render: array of evals → <svg> element.
// Clamps cp to ±500; mate goes to the top/bottom edge.

const CLAMP_CP = 500;
const WIDTH    = 600;   // viewBox; scales via CSS
const HEIGHT   = 80;

export function evalToY(ev, height = HEIGHT) {
  if (!ev) return height / 2;
  if (ev.mate != null) return ev.mate > 0 ? 0 : height;
  const cp = Math.max(-CLAMP_CP, Math.min(CLAMP_CP, ev.cp ?? 0));
  // cp=+500 → y=0 (top), cp=-500 → y=height (bottom), cp=0 → y=height/2.
  return ((CLAMP_CP - cp) / (2 * CLAMP_CP)) * height;
}

export function renderEvalGraph(evals, options = {}) {
  const onClick = options.onClick || null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'eval-graph');
  svg.style.width = '100%';
  svg.style.height = HEIGHT + 'px';

  // Zero line.
  const zero = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  zero.setAttribute('x1', '0'); zero.setAttribute('x2', String(WIDTH));
  zero.setAttribute('y1', String(HEIGHT / 2)); zero.setAttribute('y2', String(HEIGHT / 2));
  zero.setAttribute('stroke', 'rgba(255,255,255,.2)');
  zero.setAttribute('stroke-width', '1');
  svg.appendChild(zero);

  if (!evals.length) return svg;

  const stepX = evals.length === 1 ? 0 : WIDTH / (evals.length - 1);
  const points = evals.map((ev, i) => `${(i * stepX).toFixed(1)},${evalToY(ev).toFixed(1)}`).join(' ');

  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', '#f0b429');
  poly.setAttribute('stroke-width', '1.5');
  svg.appendChild(poly);

  if (onClick) {
    svg.style.cursor = 'pointer';
    svg.addEventListener('click', (e) => {
      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const idx = Math.round(x * (evals.length - 1));
      onClick(idx);
    });
  }
  return svg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- eval-graph
```
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add js/ui/eval-graph.js tests/eval-graph.test.js package.json package-lock.json
git commit -m "feat(ui): pure SVG eval-graph renderer with cp clamping and mate edges"
```

---

## Task 9: `app.js` — wire settings strip + replace `fetchEngineEval`

**Files:**
- Modify: `app.js` (replace `fetchEngineEval` body, add new state vars for engine settings)

- [ ] **Step 1: Add imports**

At the top of `app.js`, with the other module imports, add:
```javascript
import { analyzePosition, analyzeGame, cancel as cancelEngine } from './engine/analysis.js';
```

- [ ] **Step 2: Add engine settings state and DOM wiring**

Add near the other module-level `let` declarations in `app.js`:
```javascript
let engineDepth = 18;          // active per-position depth
let engineSource = '';         // 'cloud' | 'local' | ''
```

Add this initialization function and call it from `initUI()` after the rest of review-page setup:
```javascript
function initEngineSettingsStrip() {
  const chips = document.querySelectorAll('.depth-chip');
  const slider = document.getElementById('depth-slider');
  const sliderWrap = document.getElementById('depth-slider-wrap');
  const sliderVal = document.getElementById('depth-slider-val');

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const v = chip.dataset.depth;
      if (v === 'custom') {
        sliderWrap.hidden = false;
        engineDepth = Number(slider.value);
      } else {
        sliderWrap.hidden = true;
        engineDepth = Number(v);
      }
      if (reviewGame) refreshEngineForCurrentPosition();
    });
  });

  slider.addEventListener('input', () => {
    sliderVal.textContent = slider.value;
    engineDepth = Number(slider.value);
    if (reviewGame && document.getElementById('depth-custom-toggle').classList.contains('active')) {
      refreshEngineForCurrentPosition();
    }
  });
}
```

Call it from `initUI()`:
```javascript
initEngineSettingsStrip();
```

- [ ] **Step 3: Replace `fetchEngineEval` body**

Replace the entire existing `fetchEngineEval` function in `app.js` (around line 1322) with:

```javascript
async function fetchEngineEval(fen) {
  const evalEl   = document.getElementById('engine-eval');
  const linesEl  = document.getElementById('engine-lines');
  const depthEl  = document.getElementById('engine-depth');
  const statusEl = document.getElementById('engine-status');
  const sourceEl = document.getElementById('engine-source');

  evalEl.textContent  = '…';
  evalEl.style.color  = 'var(--text-dim)';
  linesEl.innerHTML   = '';
  depthEl.textContent = '';
  statusEl.textContent = '';

  let result;
  try {
    result = await analyzePosition(fen, { depth: engineDepth, multiPV: 3 });
  } catch (e) {
    if (e?.name === 'AbortError') return;
    statusEl.textContent = "Engine couldn't load. Reconnect and try again.";
    evalEl.textContent = '—';
    // Disable the Analyze button when the engine can't load.
    const analyzeBtn = document.getElementById('analyze-game-btn');
    if (analyzeBtn) analyzeBtn.disabled = true;
    return;
  }

  if (result.reason === 'terminal' || !result.pvs.length) {
    evalEl.textContent = '—';
    return;
  }

  // Source badge
  sourceEl.textContent = result.source === 'cloud' ? 'Cloud' : 'Local';
  sourceEl.className = `engine-source ${result.source}`;
  engineSource = result.source;

  depthEl.textContent = `depth ${result.reachedDepth}`;
  const top = result.pvs[0];
  if (top.mate != null) {
    const m = top.mate;
    evalEl.textContent = m > 0 ? `M${m}` : `-M${Math.abs(m)}`;
    evalEl.style.color = m > 0 ? 'var(--emerald)' : 'var(--red)';
  } else {
    const cp = top.cp / 100;
    evalEl.textContent = (cp >= 0 ? '+' : '') + cp.toFixed(2);
    evalEl.style.color = cp > 0.3 ? 'var(--emerald)' : cp < -0.3 ? 'var(--red)' : 'var(--text)';
  }

  // PV lines — DOM-built (no innerHTML).
  while (linesEl.firstChild) linesEl.removeChild(linesEl.firstChild);
  for (const pv of result.pvs) {
    const row = document.createElement('div');
    const score = document.createElement('span');
    score.style.color = 'var(--gold)';
    score.style.display = 'inline-block';
    score.style.minWidth = '3.5rem';
    score.textContent = pv.mate != null
      ? (pv.mate > 0 ? `M${pv.mate}` : `-M${Math.abs(pv.mate)}`)
      : ((pv.cp >= 0 ? '+' : '') + (pv.cp / 100).toFixed(2));
    row.appendChild(score);
    row.appendChild(document.createTextNode(pv.moves.split(' ').slice(0, 6).join(' ')));
    linesEl.appendChild(row);
  }
}
```

- [ ] **Step 4: Add `refreshEngineForCurrentPosition` helper**

Add this helper near `fetchEngineEval`:
```javascript
function refreshEngineForCurrentPosition() {
  if (!reviewGame) return;
  // Replay moves up to reviewIdx and convert to FEN via the engine's stateToFen export,
  // or rely on the existing flow that already passes a FEN into fetchEngineEval.
  // The existing renderReviewBoard() calls fetchEngineEval with the FEN.
  // Triggering fetchEngineEval directly here means duplicating FEN computation;
  // simpler: re-call renderReviewBoard().
  renderReviewBoard();
}
```

- [ ] **Step 5: Cancel pending analysis when leaving review**

Modify `backToList` in `app.js` to cancel any in-flight engine work:
```javascript
window.backToList = async function() {
  cancelEngine();
  // ... existing body unchanged
};
```

- [ ] **Step 6: Manually verify**

```bash
python3 -m http.server 8080
```
Open a game in review, click through moves. Expected:
- The source badge shows `Cloud` for cached Lichess positions and flips to `Local` for unique positions.
- Clicking Quick/Standard/Deep chips re-runs the analysis at that depth.
- Clicking Custom reveals the slider; moving it updates the eval after release.
- No XSS-like errors; PV lines render correctly.

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat(review): wire engine settings strip; replace fetchEngineEval with analysis abstraction"
```

---

## Task 10: `app.js` — Analyze button + full-game pass + persistence + eval graph

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add imports**

Add to the existing import block:
```javascript
import { renderEvalGraph } from './js/ui/eval-graph.js';
```

- [ ] **Step 2: Wire the Analyze button**

Add this function near `fetchEngineEval`:

```javascript
window.runAnalyzeGame = async function() {
  if (!reviewGame) return;
  const btn          = document.getElementById('analyze-game-btn');
  const progressWrap = document.getElementById('analyze-progress');
  const progressFill = document.getElementById('analyze-progress-fill');
  const progressLabel= document.getElementById('analyze-progress-label');

  // Confirmation if depth >= 20.
  if (engineDepth >= 20) {
    const cores = navigator.hardwareConcurrency || 2;
    const warn = cores <= 2
      ? `Full-game analysis at depth ${engineDepth} may take 10+ minutes on this device. Continue?`
      : `Full-game analysis at depth ${engineDepth} will take several minutes. Continue?`;
    if (!confirm(warn)) return;
  }

  const fullGameDepth = engineDepth >= 20 ? engineDepth : 14;  // lighter default per spec
  btn.disabled = true;
  progressWrap.hidden = false;
  progressFill.style.width = '0%';
  progressLabel.textContent = 'Starting…';

  let result;
  try {
    result = await analyzeGame(reviewGame.moves, { depth: fullGameDepth }, (p) => {
      const pct = ((p.index + 1) / p.total) * 100;
      progressFill.style.width = pct.toFixed(1) + '%';
      progressLabel.textContent = `Move ${p.index}/${p.total - 1}`;
    });
  } catch (e) {
    progressLabel.textContent = 'Analysis cancelled';
    btn.disabled = false;
    setTimeout(() => { progressWrap.hidden = true; }, 1500);
    return;
  }

  // Persist on the game record.
  reviewGame.analysis = result;
  await saveGame(reviewGame);

  renderEvalGraphForGame();
  renderReviewMoveList();
  progressWrap.hidden = true;
  btn.disabled = false;
};
```

- [ ] **Step 3: Render the eval graph**

Add:
```javascript
function renderEvalGraphForGame() {
  const container = document.getElementById('eval-graph-container');
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!reviewGame?.analysis?.evals?.length) { container.hidden = true; return; }
  const svg = renderEvalGraph(reviewGame.analysis.evals, {
    onClick: (idx) => { reviewIdx = idx; renderReviewBoard(); renderReviewMoveList(); },
  });
  container.appendChild(svg);
  container.hidden = false;
}
```

- [ ] **Step 4: Show cached analysis when re-opening a game**

In `loadReview(id)` (existing function), after `reviewGame = await getGame(id)`, add:
```javascript
  // Refresh the Analyze button label if cached analysis exists.
  const btn = document.getElementById('analyze-game-btn');
  if (reviewGame.analysis) {
    btn.textContent = `⚙️ Re-analyze (was depth ${reviewGame.analysis.depth})`;
    renderEvalGraphForGame();
  } else {
    btn.textContent = '⚙️ Analyze game';
    document.getElementById('eval-graph-container').hidden = true;
  }
```

- [ ] **Step 5: Wire the button to the function in `index.html`**

In `index.html`, set the onclick on the analyze button (still in the engine-panel block from Task 7):
```html
<button type="button" id="analyze-game-btn" class="btn btn-surface btn-sm" onclick="runAnalyzeGame()">⚙️ Analyze game</button>
```

- [ ] **Step 6: Manually verify**

```bash
python3 -m http.server 8080
```
Open a game with at least 20 moves. Click "Analyze game" at Standard depth (18). Expected:
- Progress bar fills as positions analyze.
- After completion: eval graph appears above the move list.
- Clicking a point on the graph jumps the board.
- Close and re-open the game: graph re-renders from cache; button label shows "Re-analyze".

- [ ] **Step 7: Commit**

```bash
git add app.js index.html
git commit -m "feat(review): Analyze game button — full-game pass + persisted analysis + eval graph"
```

---

## Task 11: `app.js` — move-quality badges in `renderReviewMoveList`

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace `renderReviewMoveList` body**

Find `renderReviewMoveList` (around line 1395). Replace its body with:

```javascript
function renderReviewMoveList() {
  const el = document.getElementById('review-move-list');
  while (el.firstChild) el.removeChild(el.firstChild);
  if (!reviewGame) return;
  const moves = reviewGame.moves;
  const qualities = reviewGame.analysis?.qualities || [];

  for (let i = 0; i < moves.length; i += 2) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '.5rem';
    row.style.padding = '.15rem 0';

    const num = document.createElement('span');
    num.style.color = 'var(--text-dim)';
    num.style.minWidth = '2rem';
    num.textContent = `${Math.floor(i / 2) + 1}.`;
    row.appendChild(num);

    appendMoveSpan(row, moves[i],     i,     qualities[i]);
    if (moves[i + 1]) appendMoveSpan(row, moves[i + 1], i + 1, qualities[i + 1]);

    el.appendChild(row);
  }
}

function appendMoveSpan(row, move, plyIdx, quality) {
  const span = document.createElement('span');
  span.className = 'move-san' + (reviewIdx === plyIdx + 1 ? ' active' : '');
  span.style.cursor = 'pointer';
  span.addEventListener('click', () => window.jumpReview(plyIdx + 1));
  span.textContent = moveSAN(move);

  if (quality) {
    const badge = document.createElement('span');
    badge.className = `move-quality ${quality}`;
    badge.textContent = ' ' + qualityToSymbol(quality);
    span.appendChild(badge);
  }
  row.appendChild(span);
}

function qualityToSymbol(q) {
  return { best: '✓', excellent: '', good: '', inaccuracy: '?!', mistake: '?', blunder: '??' }[q] || '';
}
```

- [ ] **Step 2: Manually verify**

```bash
python3 -m http.server 8080
```
Open a previously-analyzed game. Expected: move list shows inline `?!`, `?`, `??` symbols color-coded; clicking a move still jumps the board.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat(review): inline move-quality badges in review move list (DOM-built, no innerHTML)"
```

---

## Task 12: `sw.js` — note jsdelivr in external-host pass-through

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Extend the external-host predicate**

Find the `isExternal` check (around line 46) and replace it with:

```javascript
  // Pass-through for live data and cross-origin engine binaries — the browser
  // HTTP cache handles re-use after the first fetch.
  const isExternal = url.hostname.includes('firebase') ||
                     url.hostname.includes('googleapis') ||
                     url.hostname.includes('gstatic') ||
                     url.hostname.includes('lichess') ||
                     url.hostname.includes('jsdelivr');
```

- [ ] **Step 2: Bump cache version**

At the top of `sw.js`, change:
```javascript
const CACHE = 'cch-v5';
```
to:
```javascript
const CACHE = 'cch-v6';
```

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "chore(sw): pass-through jsdelivr (Stockfish CDN); bump cache to v6"
```

---

## Task 13: Manual integration test checklist

**Files:**
- Create: `docs/superpowers/specs/2026-05-14-stockfish-review-integration-test-checklist.md`

- [ ] **Step 1: Create the checklist**

```markdown
# Stockfish Review Integration — Manual Test Checklist

Run all of these against a freshly-deployed build (cache cleared) before merging.

## Smoke
- [ ] Open a game in review. Settings strip renders: Engine dropdown, Quick/Standard/Deep/Custom chips, Standard active, source badge empty.
- [ ] Click through 5 moves. For each, eval, depth, PV lines appear; source badge is `Cloud` or `Local`.
- [ ] Switch chip to Quick → next click re-analyzes at depth 12 (depth badge confirms).
- [ ] Toggle Custom → slider appears, set to 22 → next analysis runs at depth 22.

## Cloud / local fallback
- [ ] Play an unusual non-opening position (e.g., move 30 of a club game). Source badge flips to `Local`. Eval still renders.
- [ ] Disable network (DevTools Offline). Click through positions. All analyses use `Local`. No console errors.

## Full-game pass
- [ ] Open a ≥30-move game. Click "Analyze game" at Standard depth → progress bar advances move-by-move → completes → eval graph appears above the move list.
- [ ] Move list shows inline `?!`, `?`, `??` symbols on inaccurate moves (color-coded).
- [ ] Close the game and re-open. Eval graph renders from cache. Analyze button reads "Re-analyze (was depth 18)".
- [ ] Re-analyze at Deep (22). Confirmation dialog appears. After completion, graph and badges update.

## Cancellation
- [ ] Start "Analyze game", then navigate away from review while it runs. No errors. Returning to the game shows no partial analysis (correct: partial is discarded).

## Mobile
- [ ] On a mobile device (or Chrome DevTools mobile emulation iPhone 12), the settings strip wraps cleanly. No horizontal scroll.

## Sentry / errors
- [ ] No uncaught errors in DevTools console across all of the above.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-14-stockfish-review-integration-test-checklist.md
git commit -m "docs: manual test checklist for Stockfish review integration"
```

---

## Definition of Done

- [ ] All 13 tasks committed.
- [ ] `npm test` passes (≥ 30 new tests across the new test files).
- [ ] Manual checklist (Task 13) executed and all boxes checked.
- [ ] No `innerHTML` introduced in new code (use DOM builders / existing `el()` helper).
- [ ] `app.js` net line growth ≤ 200 lines (most logic lives in `engine/` modules).

## Follow-up tasks (created separately when this lands)

- **#13b: COOP/COEP enablement + multi-threaded Stockfish.** Add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to `firebase.json` headers for `/`, audit every third-party include (Lucide CDN, gstatic, jsdelivr) for `Cross-Origin-Resource-Policy: cross-origin` / `crossorigin` attributes, verify SAB-enabled multi-threaded analysis runs and is ~3× faster than single-threaded.
- **#13c: Brilliant/Great move detection.** Sacrifice + criticality heuristics. Defer until users ask for it.
- **#13d: PV branch exploration.** Click a PV move → temporarily branch the review board down that line.
