# Play Page Redesign — Design Spec

**Date:** 2026-05-14  
**Scope:** Play page only (Phase 1 of full-app redesign)  
**Stack:** Vite + React + TypeScript + Tailwind CSS  
**Aesthetic:** Swiss spa — warm ivory, generous whitespace, DM Serif Display + DM Sans

---

## 1. Goals

Redesign the Chess Club Hub Play page with a premium, minimalist "Swiss spa" aesthetic. The game engine stays unchanged; only the UI layer is rebuilt. The result must be fully responsive, smooth-animated, and establish the design system that carries to all future pages.

---

## 2. Architecture

### Tech stack
- **Vite** — zero-config dev server and build, no custom webpack config needed
- **React 18 + TypeScript** — component tree, hooks-based state
- **Tailwind CSS v3** — utility classes driven by a token config
- **Lucide React** — icon set (Flip, Undo, Flag/Resign, etc.)
- **React Router v6** — Play is `/play`; other routes are stubs for now

### Chess engine integration
The existing vanilla JS modules are copied into `src/chess/` and imported directly into the React project. No wrappers or rewrites:
- `engine.js` — game state, legal moves, `undoMove`
- `ai.js` — CPU move generation
- `clock.js` — timer logic
- `pgn.js` — PGN serialisation
- `elo.js` — ELO calculation

Firebase (`db.js`, `relay.js`) is imported but unused in this sprint — only local/CPU mode is wired up.

### Board rendering
The board is a pure React div-grid (8×8 `<Square>` components). Pieces render as Unicode glyphs or image sprites inside each square. No canvas. This allows full React control over highlights, drag state, and animations without an imperative canvas API.

### State management
A single `useGameState` hook in `<PlayPage>` owns:
- `gameState` — engine state object (board, turn, castling rights, etc.)
- `moveHistory` — array of SAN strings
- `clockTimes` — `{ w: number, b: number }` updated by `useInterval`
- `selected` — `[row, col] | null` — currently selected square
- `hints` — `[row, col][]` — legal move targets for selected piece
- `cpuThinking` — boolean

No Redux, no Zustand. Props pass at most two levels deep.

---

## 3. Component Tree

```
<PlayPage>
  ├── <NavBar />
  ├── <div class="play-layout">          ← flex row (md+), single col (mobile)
  │    ├── <BoardColumn>
  │    │    ├── <PlayerBar side="top" />
  │    │    ├── <ChessBoard />
  │    │    │    └── <Square /> ×64
  │    │    └── <PlayerBar side="bottom" />
  │    │
  │    └── <GameSidebar>
  │         ├── <MoveList />
  │         ├── <StatusBar />
  │         └── <ControlBar />
  │
  └── <CpuThinkingOverlay />
```

### Component responsibilities

| Component | Responsibility |
|---|---|
| `NavBar` | Logo + nav links on espresso background |
| `PlayerBar` | Avatar, player name, ELO, clock badge (terracotta = active) |
| `ChessBoard` | 8×8 grid; delegates clicks to `onSquareClick` prop |
| `Square` | Renders piece glyph, legal-hint dot, last-move highlight, handles click + drag |
| `MoveList` | Scrollable SAN move list; current move highlighted in terracotta |
| `StatusBar` | Italic DM Serif Display line: "White to move — Ruy López" |
| `ControlBar` | Flip / Undo / Resign buttons with Lucide icons |
| `CpuThinkingOverlay` | Pulsing "Thinking…" indicator shown while AI computes |

---

## 4. CSS Token System

All values defined in `src/styles/tokens.css` and mapped in `tailwind.config.ts`. Components use only token-derived Tailwind classes — never raw hex or pixel values.

```css
:root {
  /* Palette */
  --color-linen:      #f7f4ef;
  --color-espresso:   #1a1612;
  --color-terracotta: #c4733a;
  --color-parchment:  #ede8e0;
  --color-stone:      #8a7a6a;
  --color-driftwood:  #6b5c4e;
  --color-ivory:      #c4b49a;

  /* Board */
  --board-light: #f0e4d0;
  --board-dark:  #d4b896;

  /* Typography */
  --font-display: 'DM Serif Display', serif;
  --font-body:    'DM Sans', sans-serif;

  /* Shape */
  --radius-card: 16px;
  --radius-btn:  8px;

  /* Motion */
  --dur-piece:  280ms;
  --dur-fast:   150ms;
  --ease-piece: cubic-bezier(.25,.46,.45,.94);
}
```

**Tailwind mapping** (`tailwind.config.ts`):
- `bg-linen`, `bg-espresso`, `bg-terracotta`, `bg-parchment`
- `text-espresso`, `text-stone`, `text-driftwood`, `text-terracotta`
- `font-display`, `font-body`
- `rounded-card`, `rounded-btn`

---

## 5. Animations

| Moment | Technique | Duration |
|---|---|---|
| Piece move | Absolutely-positioned clone translates from source to target square via `transform: translate()` + CSS transition | 280ms ease-out |
| Square hover | `scale(1.04)` on piece `<span>` | 150ms |
| Legal hint dots | `opacity: 0 → 1` on selection | 120ms |
| Clock urgent (≤10s) | Terracotta badge `@keyframes pulse` — scale 1 → 1.06 → 1 | 800ms loop |

All animations respect `prefers-reduced-motion`: piece clone uses 0ms transition, pulse disabled, hints appear instantly.

---

## 6. Responsive Strategy

| Breakpoint | Layout |
|---|---|
| **≥ 768px (md)** | Flex row — `<BoardColumn>` left, `<GameSidebar>` right (`w-64` fixed) |
| **< 768px** | Single column — `PlayerBar → ChessBoard → PlayerBar → MoveList (horizontal scroll) → ControlBar`. Sidebar hidden; status text below board |

The board always renders with `aspect-square` and fills available container width, scaling naturally on any screen.

---

## 7. Out of Scope (This Sprint)

- Home, Review, Tournament, Leaderboard, Events pages
- Online multiplayer (Firebase relay)
- ELO persistence
- PGN export UI
- Service worker / PWA
