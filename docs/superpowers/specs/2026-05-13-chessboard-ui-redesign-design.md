# Chessboard & Game UI Redesign

**Date:** 2026-05-13  
**Status:** Approved  
**Scope:** Game screen visual overhaul — larger board, SVG pieces, sleek chess.com-inspired UI

---

## 1. Goals

- Make the board substantially larger and more polished (chess.com benchmark)
- Replace Unicode glyphs with SVG pieces for crisp, OS-independent rendering
- Restructure the game page into a clean stacked layout (board-centric, mobile-friendly)
- Improve intuitive feedback: last-move highlight, drag & drop, smooth animation, prominent clock

---

## 2. Decisions Made

| Question | Decision |
|---|---|
| Board colors | Classic Wood — light `#f0d9b5`, dark `#b58863` |
| Piece style | SVG (Merida / Lichess design) |
| Game page layout | Stacked: opponent bar → board → status → player bar → controls → move list |
| Last move highlight | Yellow tint on from/to squares (`rgba(246,246,105,0.45/0.6)`) |
| Drag & drop | Yes — in addition to click-to-move |
| Move animation | Yes — CSS `transition` on a floating piece element |
| Clock display | Prominent: active player glows purple, idle player fades |
| Coordinates | Inside board edge corners (rank on left column, file on bottom row) |
| Captured pieces tray | Yes — shown below each player bar |
| Undo button | Yes — local and CPU games only; disabled online |
| Pre-move | Yes — queue one move while opponent is thinking (online only) |
| Sound effects | No (deferred) |

---

## 3. Architecture

### 3.1 New module: `chess/board-ui.js`

A single new ES module owns all board visual logic. `app.js` delegates rendering entirely to it.

**Public API:**

```js
// Mount the board UI into a container element
boardUI.mount(containerEl, { onMove(from, to, promotion) {} })

// Re-render with current game state
boardUI.render(gameState, {
  selected,        // [r,c] | null
  hints,           // [[r,c], ...]
  lastMove,        // { from: [r,c], to: [r,c] } | null
  preMove,         // { from: [r,c], to: [r,c] } | null  (online pre-move)
  capturedByTop,   // string[]  pieces captured by the top player
  capturedByBottom,// string[]  pieces captured by the bottom player
  flipped,         // bool
  interactive,     // bool — false during CPU turn or opponent's online turn
})

// Trigger a move animation then call onMove
// (used when engine completes CPU move)
boardUI.animateMove(from, to, piece, callback)
```

**Internal responsibilities:**
- SVG piece definitions (all 12 pieces, ~250 lines)
- Square DOM construction and class management
- Drag & drop event handling (`pointerdown`, `pointermove`, `pointerup`)
- Click-to-move fallback (with pre-move detection when `interactive: false`)
- CSS transition animation (floating element approach)
- Last-move, selection, and pre-move highlight
- Coordinate label injection on edge squares
- Captured pieces tray rendering inside player bars
- Pre-move highlight (`sq.premove` class, purple tint)

### 3.2 Files changed

| File | Change |
|---|---|
| `chess/board-ui.js` | **New** — full board UI module |
| `chess/engine.js` | Add `undoMove(state)` export; store `boardSnapshotBefore` in `makeMove()` history entries |
| `css/tokens.css` | Update `--sq` formula; add `--color-premove` token (`rgba(139,92,246,.45)`) |
| `style.css` | Replace `.board`, `.sq`, `.board-wrap` rules; add stacked game layout; add `.sq.premove` rule |
| `app.js` | Replace `renderBoard()` with `boardUI.render()`; track `lastMove`, `pendingPreMove`; compute captured arrays from history; wire undo button; handle pre-move in online `onMove` callback |
| `index.html` | Update Play page HTML structure to stacked layout; add Undo button to controls row |

### 3.3 Stacked layout structure (Play page)

```
<div class="game-page">
  <div class="player-bar" id="bar-top">   <!-- opponent: avatar, name, captured tray, clock -->
  <div class="board-wrap">
    <div class="board-with-ranks">
      <div class="rank-labels">           <!-- 8..1 -->
      <div class="board" id="chessboard">
    </div>
    <div class="file-labels">             <!-- a..h -->
  </div>
  <div class="status-bar">
  <div class="player-bar" id="bar-bottom"> <!-- local player: avatar, name, captured tray, clock -->
  <div class="controls">                 <!-- Flip · Undo · PGN · Resign -->
  <div class="move-list-wrap">
</div>
```

`bar-top` renders opponent (black by default, swaps on flip). `bar-bottom` renders the local player. `active-turn` CSS class on the active player's bar lights the clock purple.

---

## 4. Visual Spec

### 4.1 Board size

The board fills its container rather than being driven by a fixed `--sq` cell size. This avoids the contradiction where `8 × --sq` can exceed the container width.

```css
/* board-wrap: fluid container */
.board-wrap  { width: 100%; max-width: 520px; }

/* board: fill container, keep square */
.board {
  width: 100%;
  aspect-ratio: 1 / 1;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows:    repeat(8, 1fr);
}
```

`--sq` is retained in `tokens.css` only as a fallback reference for any remaining code that reads it (e.g. coordinate label spacing). Set to `calc((min(520px, 100vw - 2rem)) / 8)` so it stays consistent with actual cell size.

### 4.2 Board border & shadow

```css
.board {
  border-radius: 4px;
  box-shadow: 0 12px 48px rgba(0,0,0,.7), 0 0 0 2px rgba(167,139,250,.15);
}
```

Subtle purple glow ring replaces the gold border.

### 4.3 Square highlights

| State | Style |
|---|---|
| Light square (default) | `#f0d9b5` |
| Dark square (default) | `#b58863` |
| Selected | `rgba(100,180,80,.65)` — green tint |
| Last-move from | `rgba(246,246,105,.45)` — yellow |
| Last-move to | `rgba(246,246,105,.60)` — yellow |
| In-check king | `rgba(220,50,50,.55)` — red |
| Move hint (empty) | Dark dot `::after`, 32% size |
| Move hint (capture) | Ring `border: 5px solid rgba(0,0,0,.22)` |

### 4.4 SVG Pieces

All 12 pieces defined as SVG string constants inside `board-ui.js`. Each rendered as an `<svg>` element appended to its square. Size: `width: 82%; height: 82%` within the square.

White pieces: white fill (`#fff`), black stroke (`1.5px`).  
Black pieces: black fill (`#000`), black stroke (`1.5px`), white detail lines where needed.

### 4.5 Coordinates

Rendered as absolutely-positioned `<span>` elements inside edge squares:
- Rank labels (`8`–`1`): top-left corner of squares in column 0
- File labels (`a`–`h`): bottom-right corner of squares in row 7

Color inherits square color (light square label = dark color, dark square label = light color) for contrast without visual noise.

### 4.6 Player bars

```
[ Avatar ] [ Name / Rating ]     [ Clock ]
           [ Captured pieces row ]
```

- `active-turn` class on the active player's bar: `border-color: rgba(167,139,250,.35)`
- Clock: `running` state → purple chip (`background: #a78bfa; color: #050508`); `idle` → muted (`background: #1a1a24; color: #52525b`)
- Avatar: initials-based circle (2 letters), white/black coloring

### 4.9 Captured pieces tray

Rendered inside each player bar, below the name/rating line. Shows pieces captured **by** that player (i.e. the pieces they took from the opponent), rendered as small SVG glyphs at ~55% opacity.

- Pieces sorted by value: Q → R → B → N → P
- Material advantage displayed as `+N` in purple when one side is ahead
- Derived from `gameState.history` on each render — no separate state needed
- `boardUI.render()` receives `capturedByTop` and `capturedByBottom` arrays computed in `app.js` from history

### 4.10 Undo / takeback button

Appears in the controls row as `↩ Undo`. Rules:

- **Enabled** in `local` and `cpu` game modes
- **Disabled** (greyed out, `pointer-events: none`) in `online-host` and `online-guest` modes
- In `local` mode: removes the last move from `gameState.history` by calling a new `undoMove(state)` helper in `chess/engine.js` that pops the last history entry and restores the previous `boardSnapshot`
- In `cpu` mode: undoes two half-moves (the player's move and the CPU's response) so the human is always back in control
- Button is also disabled when `gameState.history.length === 0`

`undoMove(state)` is a pure function added to `chess/engine.js`:
```js
export function undoMove(state) {
  if (state.history.length === 0) return state;
  const prev = state.history[state.history.length - 1];
  return {
    ...state,
    board: prev.boardSnapshot,           // snapshot taken before this move
    turn: color(prev.piece),
    history: state.history.slice(0, -1),
    status: 'playing',
    winner: null,
    enPassant: prev.enPassantSnapshot ?? null,
  };
}
```

Note: `boardSnapshot` in the existing history entries is the board **after** the move. We need the board **before** — so the implementation must store `boardSnapshotBefore` alongside the existing `boardSnapshot`. This requires a one-line change in `makeMove()`.

### 4.11 Pre-move (online mode only)

Allows the local player to queue exactly one move while waiting for the opponent's response. Only active in `online-host` and `online-guest` modes.

**Behaviour:**
- When it is **not** the local player's turn, clicking a piece + a destination (or drag-dropping) stores `pendingPreMove = { from, to }` instead of calling `executeMove`
- The pre-move squares are highlighted with a distinct purple tint: `rgba(139,92,246,.45)` on both from and to
- When the opponent's move arrives and state updates, `app.js` immediately attempts `executeMove(pendingPreMove.from, pendingPreMove.to)`:
  - If still legal → executes normally (feels instant)
  - If no longer legal (opponent changed the position) → silently discards and clears highlight
- Only one pre-move can be queued at a time; clicking elsewhere cancels it
- Pre-move is cleared on flip, resign, or game end

**State in `app.js`:**
```js
let pendingPreMove = null;  // { from: [r,c], to: [r,c] } | null
```

`boardUI.render()` gains an optional `preMove` prop: `{ from, to } | null` — used to apply the purple highlight CSS class `sq.premove` on those two squares.

### 4.7 Move animation

When a move is made (click or drag):

1. Measure the moving piece's source square DOM position
2. Create an absolutely-positioned floating clone of the SVG piece at source coordinates
3. Apply CSS transition (`transform`, 180ms, `cubic-bezier(0.16,1,0.3,1)`)
4. Translate clone to destination square coordinates
5. On `transitionend`: remove clone, call `boardUI.render()` with new state

For CPU moves, `boardUI.animateMove()` performs the same animation before applying state.

### 4.8 Drag & drop

Uses Pointer Events API (`pointerdown` / `pointermove` / `pointerup`) for unified mouse + touch support.

- `pointerdown` on a square with an active piece: lifts piece into a floating element that tracks pointer position; source square gets a dimmed overlay
- `pointermove`: move floating element, highlight target square if it's a legal hint
- `pointerup`: if released on a legal hint square, call `onMove`; otherwise snap back with a short transition

Fallback: click-to-move still works normally (select → hint → select).

---

## 5. `app.js` Integration

`app.js` changes are limited to:

1. Import `boardUI` from `./chess/board-ui.js`; import `undoMove` from `./chess/engine.js`
2. On game init: `boardUI.mount(document.getElementById('chessboard-container'), { onMove: executeMove, onPreMove: setPreMove })`
3. Replace every `renderBoard()` call with `boardUI.render(gameState, { selected, hints, lastMove, preMove: pendingPreMove, capturedByTop, capturedByBottom, flipped, interactive })`
4. Track `lastMove = { from, to }` — set in `executeMove()`, cleared on new game
5. Track `pendingPreMove = null | { from, to }` — set by `setPreMove()`, cleared after opponent move resolves
6. Compute `capturedByTop` / `capturedByBottom` from `gameState.history` before each `boardUI.render()` call (pure derivation, no extra state)
7. `onMove` online callback: after applying opponent move, attempt `pendingPreMove` if set; clear it regardless of legality
8. Undo button `onclick`: call `undoMove()` once (local) or twice (CPU — undo CPU reply then player move); disable when `history.length === 0` or mode is online

---

## 6. What Does NOT Change

- `chess/engine.js` — pure logic, untouched
- `chess/clock.js`, `chess/ai.js`, `chess/elo.js`, `chess/pgn.js` — untouched
- `storage/db.js`, `multiplayer/relay.js`, `tournament/bracket.js` — untouched
- All non-Play pages (Home, Review, Tournament, Leaderboard, Events) — untouched
- Firebase config, Firestore rules, Cloud Functions — untouched

---

## 7. Out of Scope (Deferred)

- Sound effects
- Board theme switcher (additional palettes)
