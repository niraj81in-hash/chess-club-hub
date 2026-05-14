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
| Captured pieces tray | No (deferred) |
| Sound effects | No (deferred) |
| Undo button | No (deferred) |

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
  selected,       // [r,c] | null
  hints,          // [[r,c], ...]
  lastMove,       // { from: [r,c], to: [r,c] } | null
  flipped,        // bool
  interactive,    // bool — false during CPU turn or opponent's online turn
})

// Trigger a move animation then call onMove
// (used when engine completes CPU move)
boardUI.animateMove(from, to, piece, callback)
```

**Internal responsibilities:**
- SVG piece definitions (all 12 pieces, ~250 lines)
- Square DOM construction and class management
- Drag & drop event handling (`pointerdown`, `pointermove`, `pointerup`)
- Click-to-move fallback
- CSS transition animation (floating element approach)
- Last-move and selection highlight
- Coordinate label injection on edge squares

### 3.2 Files changed

| File | Change |
|---|---|
| `chess/board-ui.js` | **New** — full board UI module |
| `css/tokens.css` | Update `--sq` to larger fluid value; add board-shadow token |
| `style.css` | Replace `.board`, `.sq`, `.board-wrap` rules; add stacked game layout |
| `app.js` | Replace `renderBoard()` calls with `boardUI.render()`; wire drag/click callbacks; pass `lastMove` from history |
| `index.html` | Update Play page HTML structure to stacked layout |

### 3.3 Stacked layout structure (Play page)

```
<div class="game-page">
  <div class="player-bar" id="bar-top">   <!-- opponent -->
  <div class="board-wrap">
    <div class="board-with-ranks">
      <div class="rank-labels">           <!-- 8..1 -->
      <div class="board" id="chessboard">
    </div>
    <div class="file-labels">             <!-- a..h -->
  </div>
  <div class="status-bar">
  <div class="player-bar" id="bar-bottom"> <!-- local player -->
  <div class="controls">
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
[ Avatar ] [ Name / Rating / Captured row ]     [ Clock ]
```

- `active-turn` class on the active player's bar: `border-color: rgba(167,139,250,.35)`
- Clock: `running` state → purple chip (`background: #a78bfa; color: #050508`); `idle` → muted (`background: #1a1a24; color: #52525b`)
- Avatar: initials-based circle (2 letters), white/black coloring

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

1. Import `boardUI` from `./chess/board-ui.js`
2. On game init: `boardUI.mount(document.getElementById('chessboard-container'), { onMove: executeMove })`
3. Replace every `renderBoard()` call with `boardUI.render(gameState, { selected, hints, lastMove, flipped, interactive })`
4. Track `lastMove` as `{ from, to }` — set in `executeMove()`, cleared on new game
5. `onMove` online callback: pass to `boardUI.animateMove()` when receiving opponent move from Firebase relay

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
- Captured pieces tray
- Undo / takeback button
- Pre-move (queued moves while opponent is thinking)
- Board theme switcher (additional palettes)
