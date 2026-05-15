# Stockfish Review Integration — Design Spec

**Date:** 2026-05-14
**Status:** Approved (pending user spec review)
**Target task:** #13 in the active priority list (Stockfish review integration)
**Follow-up task:** #13b (COOP/COEP enablement + multi-threaded WASM)

## Goal

Add Stockfish-powered position and game analysis to the Review page, augmenting the existing Lichess cloud-eval integration. Users analyze positions one at a time as they click through a game, or kick off a full-game pass that classifies every move and renders an evaluation graph.

## Product decisions

Captured from clarifying Q&A on 2026-05-14:

| Decision | Choice | Notes |
|---|---|---|
| Engine strategy | **Augment** Lichess cloud-eval | Cloud first per position; local Stockfish fallback when not cached or offline. |
| Analysis scope | **Full-game pass + per-position** | Lichess/Chess.com pattern. Both supported. |
| Stockfish version | **Stockfish 16 only for v1; picker architecture pre-wired** | Version dropdown disabled in UI for v1; registry in `engine/versions.js` makes adding versions a one-line change. |
| Depth UX | **Presets + Custom slider** | Quick 12 / Standard 18 / Deep 22 chips; "Custom" toggle reveals slider (10–26). Default: Standard. |
| Full-game depth | **Lighter default (14), overridable** | Confirmation dialog when user-selected depth ≥ 20 estimates time. |
| Threading | **Auto-detect SharedArrayBuffer (both builds)** | Loader picks multi-thread when available, single-thread otherwise. For v1, COOP/COEP headers are NOT enabled → SAB unavailable → effectively single-thread only. Plumbing ready for #13b. |
| WASM hosting | **jsdelivr CDN, browser-cached** | Cross-origin fetch; cached by the browser HTTP cache after first load. Add jsdelivr origin to SW awareness for explicit precache on first online use. |
| Move quality | **Lichess scheme + eval graph; v1 ships 6 tiers** | `best / excellent / good / inaccuracy / mistake / blunder` for v1. `brilliant` / `great` deferred (need sacrifice detection + criticality heuristics). |
| Implementation approach | **A — Engine abstraction module** | Three new files (`engine/analysis.js`, `engine/stockfish-worker.js`, `engine/move-quality.js`) plus `stockfish-loader.js` and `versions.js`. Review page consumes the abstraction. |

## Architecture

### Module layout

```
engine/
  analysis.js         — public API; single entry point for all eval
  stockfish-worker.js — Web Worker that boots WASM and speaks UCI
  stockfish-loader.js — picks WASM URL (single-thread vs MT) at runtime
  move-quality.js     — classifies a sequence of evaluations into tiers
  versions.js         — registry mapping version label → WASM URLs
```

### Module responsibilities

**`engine/analysis.js`** — public API consumed by the review page.
- `analyzePosition(fen, options) → Promise<EvalResult>` — single-position; tries Lichess cloud first, falls back to Stockfish.
- `analyzeGame(moves, options, onProgress) → Promise<GameAnalysis>` — full-game pass; iterates positions and streams progress.
- `cancel()` — aborts any in-flight Lichess fetch and tells the worker to UCI `stop`.

```js
// EvalResult
{
  source: 'cloud' | 'local',
  depth: number,         // requested depth
  reachedDepth: number,  // actual depth reached
  cp: number | null,     // centipawns from white's perspective
  mate: number | null,   // mate-in-N, sign indicates side
  pvs: [{ cp?, mate?, moves: string }],  // up to 3 PV lines
}
```

**`engine/stockfish-worker.js`** — single Web Worker, persistent across analyses.
- On boot: imports WASM via `stockfish-loader.js`, sends UCI `uci` + `isready`.
- Message protocol:
  - Parent → worker: `{type:'analyze', fen, depth, multiPV}`, `{type:'stop'}`
  - Worker → parent: `{type:'info', depth, cp?, mate?, pv}`, `{type:'bestmove', ...}`
- One worker reused — boot cost (~1s) amortized across the full-game pass.

**`engine/stockfish-loader.js`** — picks the right WASM at runtime.
- Detects `typeof SharedArrayBuffer !== 'undefined'` and `crossOriginIsolated === true`.
- Both true → load multi-threaded URL from `versions.js`. Otherwise → single-threaded URL.
- Returns `new Worker(url, { type: 'module' })`.

**`engine/move-quality.js`** — pure functions for classification.
- `classify(evalBefore, evalAfter, sideToMove) → Tier` where Tier ∈ `'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'`.
- Centipawn-loss thresholds (from side-to-move's perspective):
  - `0–10 cp` → `best`
  - `10–25` → `excellent`
  - `25–50` → `good`
  - `50–100` → `inaccuracy`
  - `100–200` → `mistake`
  - `200+` → `blunder`
- Mate handling: any move that converts a mate-for-us into mate-against-us is a `blunder`; any move that maintains mate is `best`.
- Signature reserves room for `brilliant` / `great` (v2 — sacrifice + criticality detection).

**`engine/versions.js`** — registry.
```js
// Exact npm package + version is pinned during implementation
// (candidates: stockfish.wasm, lila-stockfish-web, stockfish-nnue-wasm).
// URLs below are illustrative — replace with concrete pinned URLs at the
// version-selection step of the implementation plan.
export const ENGINES = {
  'stockfish-16': {
    label: 'Stockfish 16',
    st:  '<jsdelivr URL — single-threaded build>',
    mt:  '<jsdelivr URL — multi-threaded build>',
  },
};
export const DEFAULT_ENGINE = 'stockfish-16';
```

### COOP/COEP decision for v1

Multi-threaded WASM needs `SharedArrayBuffer`, which only works when the page is `crossOriginIsolated`. That requires:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Side effects: every cross-origin resource (Lucide icons CDN, Firebase auth domain, gstatic, jsdelivr itself) must serve `Cross-Origin-Resource-Policy: cross-origin` or load with `crossorigin="anonymous"`. Enabling these headers without auditing all third-party includes risks breaking auth, icons, and the engine load itself.

**v1:** ship the auto-detect plumbing; do NOT enable the headers in `firebase.json`. SAB will be `undefined` → loader always picks single-thread. Adding the headers is task **#13b**, lands after v1 stabilizes.

## Data flow

### Per-position analysis

```
User clicks through review board → reviewIdx changes
  → controller calls engine.analyzePosition(fen, { depth: <slider value> })
    → analysis.js: AbortController created, prior request cancelled
    → Step 1: fetch Lichess cloud-eval (existing URL/params)
      ↳ hit → return { source: 'cloud', ...data }
      ↳ miss / 404 / network err → fall through
    → Step 2: post {type:'analyze', fen, depth, multiPV: 3} to worker
      ↳ worker streams 'info' messages (depth-by-depth updates)
      ↳ analysis.js debounces UI updates to ~5/sec
      ↳ on 'bestmove' → resolve { source: 'local', ...finalEval }
  → Review page renders eval bar + PV lines via the existing engine-* DOM elements
```

Cancellation: if `reviewIdx` changes before resolution, `analysis.cancel()` aborts the fetch and posts UCI `stop` to the worker. Worker emits its current best line; `analysis.js` discards it.

### Full-game pass

```
User clicks "Analyze game" button
  → If depth ≥ 20: confirmation modal with estimated time
  → engine.analyzeGame(reviewGame.moves, { depth }, onProgress)
    → iterate positions 0..N (initial + after each ply)
      → for each FEN: same cloud→local fallback as single-position
      → onProgress({ index, total, eval, classification })
    → resolve { evals: EvalResult[], qualities: Tier[] }
  → results written to reviewGame.analysis in IndexedDB
  → eval line graph rendered above move list
  → each move gets a quality badge in the existing move list spans
```

Progress UX: thin progress bar over the move list ("Analyzing move 23/60…"). User can navigate the board while it runs — per-position eval shows cached results for already-analyzed plies, "analyzing…" for pending.

### Persistence

`GameAnalysis` is stored on the game record in IndexedDB:

```js
// added to existing game shape in storage/db.js
analysis: {
  version: 'stockfish-16',
  depth: 14,
  evals: [{ cp?, mate?, depth }, ...],     // one per ply, index = ply number (0 = initial position)
  qualities: ['best', 'inaccuracy', ...],  // one per ply (excluding initial)
  ranAt: 1715731200000,                    // epoch ms
}
```

On re-opening a game in review:
- If `game.analysis` exists AND `game.analysis.depth ≥ <currently selected depth>` → reuse it. Show evals + qualities from cache.
- Otherwise → show "Analyze game" button as available (or "Re-analyze at depth X" if a shallower analysis exists).
- Re-analysis at higher depth **replaces** prior data (one version per game, latest wins).

Partial analyses are not persisted: if the user cancels mid-pass, the in-memory partial result is discarded.

## UI changes — Review page

All new DOM produced via the `js/ui/primitives.js` `el()` helper. No new `innerHTML` introduced (feeds into task #1 XSS sweep pattern).

### New components (additive — nothing removed)

1. **Engine settings strip** (above the board, collapsible)
   - Version: `Stockfish 16` dropdown (disabled in v1)
   - Depth: preset chips `Quick` / `Standard` / `Deep` + `Custom` toggle revealing a slider (10–26)
   - Source indicator: badge `Cloud` or `Local` reflecting the last result's source

2. **"Analyze game" button** — placed beside the existing playback controls. Shows progress bar while running.

3. **Eval line graph** — 80px-tall inline SVG above the move list
   - X-axis: ply (0 to game length)
   - Y-axis: centipawn, clamped to ±500 with linear scaling; values beyond clamp at the edge
   - Mate displayed as ±∞ markers at the chart edge with a small "M" annotation
   - Click a point → jumps `reviewIdx` to that ply
   - Hover → tooltip with cp / mate value and SAN of the move

4. **Move-quality badges** — inline in existing `move-san` spans
   - Format: `Nf3 ?!`, `Qxb7 ??`
   - Color-coded: green (best), neutral (excellent/good), yellow (inaccuracy), orange (mistake), red (blunder)

## Error handling

| Failure mode | Behavior |
|---|---|
| Lichess cloud 404 / "not in cache" | Silent fallback to local Stockfish. Remove the existing user-visible "Position not in cloud cache" message. |
| Lichess fetch network error | Silent fallback. Source badge flips to `Local`. |
| Stockfish WASM fetch fails | Inline error in settings strip: *"Engine couldn't load. Reconnect and try again."* Analyze button disabled. Per-position eval shows `—`. |
| Worker crashes mid-analysis | `worker.onerror` rejects pending promises; worker recreated lazily on next request. Sentry capture (once task #5 lands). |
| User navigates away during full-game pass | `cancel()` aborts fetch + UCI `stop`. Partial `evals` discarded (not saved). |
| Invalid FEN (terminal position) | `analysis.js` validates with cheap regex; returns `{ source:'local', cp:null, mate:null, pvs:[], reason:'terminal' }`. UI shows `—`. |
| Depth ≥ 20 on slow device | Pre-check `navigator.hardwareConcurrency`; if ≤ 2 cores and depth ≥ 20, confirmation adds *"This may take 10+ minutes on this device."* |
| Service worker cache: WASM is cross-origin | First analysis requires network. The SW's external-host pass-through caches it transparently. Add jsdelivr origin handling to make this explicit. |

## Testing

**Unit-testable (Vitest, pure modules):**
- `engine/move-quality.js` — boundary tests at cp loss = 0, 9, 10, 24, 25, 49, 50, 99, 100, 199, 200; mate-for/against transitions; terminal positions. ~12 cases.
- `engine/stockfish-loader.js` — SAB detection branches by stubbing `globalThis.SharedArrayBuffer` and `crossOriginIsolated`. ~4 cases.
- `engine/versions.js` — registry lookup, missing-version error. ~2 cases.

**Mock-based (Vitest with stubs):**
- `engine/analysis.js` — mock `fetch` (Lichess) and mock `Worker` (postMessage/onmessage). Cover: cloud hit, cloud miss → local hit, both fail, cancellation mid-analysis, FEN validation. ~8 cases.

**Manual integration tests** (checklist in PR):
- Boot worker, run known position (Italian opening at depth 14), eval within ±20 cp of Lichess.
- Full-game pass on 40-move game at depth 14, verify all 40 evals + qualities present.
- Cancel mid-analysis, confirm worker accepts a new `analyze` immediately.
- Offline (DevTools): WASM loads from cache, local-only path works end-to-end.
- Mobile Safari oldest available: single-thread path renders eval graph correctly.

**Not in v1:**
- Visual regression on the eval graph SVG (manual eyeball only).
- Cross-browser multi-thread testing (deferred to #13b).

## Scope cuts for v1

- **6-tier quality, not 7** — drop `brilliant` and `great`; defer until sacrifice + criticality heuristics exist. Classifier signature is forward-compatible.
- **No "explore alternative moves"** — clicking a PV move in engine output doesn't yet branch the board; just displayed as text.
- **No opening book recognition** — eval graph doesn't yet flag "out of book."
- **No multi-threaded execution** — plumbing ships, headers don't. Task #13b is the follow-up.
- **No "Brilliancy/Great" sound effects, animations, or game-end summary screen** — the engagement layer Lichess wraps around analysis is deferred.

## Active task list impact

Adds to the priority list:

- **#13: Stockfish review integration** — v1 of this design. Depends on **task #1** (the `el()` DOM helper is used heavily for new UI). Effort: ~4 days.
- **#13b: Enable COOP/COEP + multi-threaded Stockfish** — follow-up. Requires auditing every third-party include in `index.html` for CORP headers. Effort: ~1 day.

No changes to the revenue model — analysis remains free for all users (not a patron gate).

## Open questions (post-implementation)

These do not block v1 but should be revisited:

- Should patron tier (#11) unlock anything analysis-related? Possibilities: deeper default (Deep depth 22 as a Patron-only preset), more PV lines (5 instead of 3), opening book annotations. Pure cosmetic-only revenue model implies **no** — analysis stays free.
- Should `game.analysis` sync across devices once persistent identity (#7) lands? Probably yes — but blocked on the IndexedDB → Firestore sync work that doesn't exist yet.
- Should we support PGN import (paste a game from Lichess/Chess.com) so users can analyze games they didn't play in this app? Strong yes, but separate task.
