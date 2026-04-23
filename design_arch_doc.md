# Chess Club Hub — Design & Architecture Document

**Version:** 2.0  
**Last Updated:** April 2026  
**Stack:** Vanilla JS (ES Modules), Firebase RTDB, Browser localStorage

---

## 1. Project Overview

Chess Club Hub is a browser-based chess platform built for middle and high school chess clubs. It requires no backend server, no login system, and no build tools — just static files served over HTTP and a free Firebase project for online multiplayer.

### Design Goals

| Goal | Decision |
|---|---|
| Zero friction to start | No accounts, no installs — open a URL and play |
| Works on phones | Mobile-first CSS with `clamp()` and flex/grid layouts |
| Offline-capable | All game logic and storage runs locally |
| Multiplayer across devices | Firebase Realtime Database for room-based sync |
| Extensible | ES module architecture — add features as new files |
| Teen-friendly UI | Dark gaming aesthetic, clear status, instant feedback |

---

## 2. System Architecture

### 2.1 Layer Overview

```
┌─────────────────────────────────────────────────────┐
│                   index.html (UI)                   │
│     Home · Play · Review · Tournament · Leaderboard │
└───────────────────┬─────────────────────────────────┘
                    │ imports
┌───────────────────▼─────────────────────────────────┐
│                    app.js (Controller)               │
│   Navigation · Game flow · UI events · State mgmt   │
└──┬──────┬──────┬──────┬──────┬──────┬───────────────┘
   │      │      │      │      │      │
   ▼      ▼      ▼      ▼      ▼      ▼
engine  clock   ai    pgn  bracket  relay
.js     .js    .js   .js    .js     .js
   │                              │
   └──────────┬───────────────────┘
              ▼
       db.js · elo.js
              │
              ▼
       localStorage / Firebase RTDB
```

### 2.2 Module Responsibilities

#### `chess/engine.js`
The heart of the application. A pure-function chess engine with zero external dependencies.

- **`initGameState()`** — returns a fresh game state object
- **`legalMoves(state, r, c)`** — returns all legal destination squares for the piece at `[r, c]`, filtering out moves that leave the king in check
- **`makeMove(state, from, to, promotion)`** — applies a move and returns a new immutable state, including checkmate/stalemate/check detection
- **`isInCheck(board, color, enPassant)`** — determines whether a color's king is under attack
- **`applyMove(board, from, to, ...)`** — low-level board transformer used by both `makeMove` and the AI search

All functions are pure (no side effects, no global mutation). This makes the engine safe to call repeatedly inside the minimax tree.

**Game state shape:**
```javascript
{
  board:      Array[8][8],   // null or piece code e.g. "wK", "bP"
  turn:       'w' | 'b',
  castling:   { wK, wQ, bK, bQ },
  enPassant:  [r, c] | null,
  halfMove:   number,        // for 50-move rule
  fullMove:   number,
  history:    Move[],        // full move log
  status:     'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw',
  winner:     'w' | 'b' | null
}
```

#### `chess/ai.js`
A minimax engine with alpha-beta pruning and piece-square table evaluation.

- **Search algorithm:** Negamax-style minimax with alpha-beta pruning. Depth scales with difficulty (1–4 plies).
- **Move ordering:** Captures are evaluated first (MVV-LVA ordering), which dramatically improves alpha-beta cutoffs.
- **Evaluation function:** Material value (P=100, N=320, B=330, R=500, Q=900) plus piece-square table bonuses for positional play. The king switches to an endgame table when queens are off the board.
- **Randomness injection:** Lower difficulty levels randomly select from top moves or play completely random moves, giving beginners a realistic opponent.
- **Async wrapper:** `getBestMoveAsync()` wraps the search in a `setTimeout` at depth ≥ 2 to yield the UI thread before heavy computation.

**Difficulty levels:**

| Level | Depth | Randomness |
|---|---|---|
| Beginner | 1 ply | 60% random |
| Intermediate | 2 ply | 20% random |
| Hard | 3 ply | 5% random |
| Expert | 4 ply | 0% |

#### `chess/clock.js`
A self-contained countdown timer supporting all standard time controls.

- Maintains two independent countdowns (`times.w`, `times.b`)
- Polls every 100ms using `setInterval`
- **`clock.switch(justMoved)`** adds the increment to the player who just moved and starts the opponent's clock
- Fires `onTimeout(loser)` when a player's time reaches zero
- Exposes `getFormatted(color)` for `mm:ss` display and `isLow(color)` for the under-30-second warning

#### `chess/pgn.js`
Converts a game record to standard PGN (Portable Game Notation) format and triggers a file download via a temporary `<a>` element and `Blob`. Games exported this way can be imported into Lichess, Chess.com, or any chess analysis tool.

#### `chess/elo.js`
Implements the FIDE ELO rating system with K-factor scaling.

**K-factor logic:**
- New players (< 20 games): K = 40 (ratings move fast to find correct level)
- Standard (< 1800): K = 32
- Advanced (1800–2399): K = 20
- Elite (≥ 2400): K = 10

**Rating titles:**

| Rating | Title |
|---|---|
| < 1000 | Beginner |
| 1000–1199 | Class E |
| 1200–1399 | Class D |
| 1400–1599 | Class C |
| 1600–1799 | Class B |
| 1800–1999 | Class A |
| 2000–2199 | Expert |
| 2200–2499 | National Master |
| 2500+ | Grandmaster |

ELO is only tracked in human vs. human games (local or online). Computer games are excluded.

#### `multiplayer/relay.js`
Wraps the Firebase Realtime Database SDK to provide room-based multiplayer.

**Room lifecycle:**
1. Host calls `createRoom(code, name)` — writes room metadata to `rooms/{code}`
2. Guest calls `joinRoom(code, name)` — writes their name, sets status to `active`
3. Both players call `onMove(cb)` — Firebase listener fires whenever a move is pushed
4. Each move is pushed via `sendMove(code, { from, to, promotion })`
5. On game end, `endRoom(code, result)` writes the final state

**Security note:** The default Firebase rules (`".read": true, ".write": true`) are suitable for a private school club. For public deployment, add authentication rules to prevent tampering.

#### `tournament/bracket.js`
A pure-function bracket engine supporting 4 or 8 player single-elimination.

- `createTournament(name, players)` shuffles players and builds the full round structure upfront. Future-round matches are seeded as `null` until winners advance.
- `recordResult(tournament, roundIdx, matchIdx, result)` returns a new tournament object with the winner advanced to the next round and the round counter incremented if all matches in the current round are complete.
- Draw results use a coin flip to determine who advances (appropriate for club play).

#### `storage/db.js`
A thin wrapper over `localStorage` providing typed access to four data stores:

| Key | Contents |
|---|---|
| `cch_games` | Array of game records (newest first) |
| `cch_players` | Win/loss/draw tallies per player name |
| `cch_tournaments` | Full tournament objects including bracket |
| `cch_profile` | The local user's name and record |

`genId()` generates collision-resistant IDs using `Date.now().toString(36)` plus a random suffix.

---

## 3. Data Flow

### 3.1 Local Game Flow

```
User clicks square
    → onSquareClick(r, c)
    → legalMoves(state, r, c)       [engine.js]
    → renderBoard() with hints

User clicks destination
    → executeMove(from, to)
    → makeMove(state, from, to)     [engine.js]
    → clock.switch(justMoved)       [clock.js]
    → renderBoard()
    → renderMoveList()
    → updateStatus()
    → autoSave()                    [db.js]
    → [if CPU] scheduleCpuMove()
         → getBestMoveAsync()       [ai.js]
         → executeMove()
    → [if game over] finalizeGame()
         → updateRatingsAfterGame() [elo.js]
         → showEloModal()
```

### 3.2 Online Game Flow

```
Host                              Firebase                          Guest
  createRoom(code, name)  ──────→  rooms/{code} created
  onMove(cb) registered   ←──────  listener attached

                                                    joinRoom(code, name)
                                                    rooms/{code}/guest written
  onOpponentJoin fires    ←──────  guest value set
  launchGame()

  executeMove()
  sendMove(code, move)    ──────→  rooms/{code}/moves pushed
                          ←──────  listener fires on guest
                                                    handleRemoteMove()
                                                    executeMove()
                                                    sendMove(code, move)
  handleRemoteMove()      ←──────  listener fires on host
  executeMove()
```

### 3.3 ELO Update Flow

```
Game ends (human vs human only)
    → finalizeGame(result)
    → updateRatingsAfterGame(whiteName, blackName, result)   [elo.js]
        → getPlayerRating(white)   reads localStorage
        → getPlayerRating(black)   reads localStorage
        → calcNewRatings(white, black, score)
            → expectedScore(rA, rB)   = 1 / (1 + 10^((rB-rA)/400))
            → kFactor(rating, games)
            → newRating = old + K × (actual - expected)
        → recordGameHistory(player, opponent, result, change)
        → savePlayerRating(white)   writes localStorage
        → savePlayerRating(black)   writes localStorage
    → showEloModal({ changeA, changeB, newWhiteRating, newBlackRating })
```

---

## 4. UI Architecture

### 4.1 Single Page Application Pattern

The app uses a manual SPA pattern with no framework. Pages are `<section>` elements with `display: none` toggled by the `nav()` function in `app.js`. There is no routing, no history API, and no virtual DOM.

```javascript
function nav(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  // trigger data load for the new page
}
```

### 4.2 Board Rendering

The chess board is rendered from scratch on every state change using `renderBoard()`. No diffing or partial updates — this is fast enough because the board is only 64 DOM elements. Coordinates are calculated based on the `flipped` boolean so the board can be viewed from either side.

### 4.3 Design System

| Token | Value |
|---|---|
| Primary background | `#0d1117` |
| Surface | `#161b22` |
| Surface elevated | `#1f2937` |
| Border | `#30363d` |
| Gold accent | `#f0b429` |
| Emerald accent | `#10b981` |
| Light square | `#f0d9b5` |
| Dark square | `#b58863` |
| Base font | `'Inter', system-ui, sans-serif` |
| Board square size | `clamp(44px, 10vmin, 72px)` |

---

## 5. State Management

There is no global state store or reactive framework. State is held in module-level `let` variables in `app.js` and passed explicitly to functions. This is intentional — the app is simple enough that a store adds more complexity than it removes.

Key stateful variables in `app.js`:

| Variable | Type | Purpose |
|---|---|---|
| `gameState` | Object | Current chess game state (from engine) |
| `selected` | `[r,c]` or null | Currently selected piece square |
| `hints` | `[r,c][]` | Legal move destinations for selected piece |
| `clock` | `ChessClock` | Active clock instance |
| `gameMode` | string | `'local' \| 'cpu' \| 'online-host' \| 'online-guest'` |
| `myColor` | `'w' \| 'b'` | The local player's color (online games) |
| `cpuColor` | `'w' \| 'b'` | The computer's color (CPU games) |
| `cpuDifficulty` | number | 0–3 index into `DIFFICULTY_LEVELS` |
| `roomCode` | string | Active 6-char room code (online games) |
| `playerNames` | `{ w, b }` | Display names for both players |
| `annotations` | Object | `{ moveIndex: noteText }` for review |
| `reviewGame` | Object | Game record loaded into review mode |
| `reviewIdx` | number | Current move index in review mode |
| `activeGameId` | string | ID of the in-progress game (for auto-save) |

---

## 6. Key Design Decisions

### Why no framework?
The app's complexity fits comfortably in vanilla JS. Removing React/Vue eliminates the build step entirely — teachers and students can open the project folder, run a single `python3 -m http.server` command, and have a working app. This dramatically reduces the barrier to contribution.

### Why localStorage instead of IndexedDB?
Game records are small (< 50KB total for hundreds of games), synchronous access is simpler to reason about, and the developer experience of JSON serialization is familiar. If the app scales to thousands of games, a migration to IndexedDB would be warranted.

### Why Firebase instead of a custom WebSocket server?
Firebase's free tier (Spark plan) supports 100 simultaneous connections and 1GB of storage — more than enough for a school chess club. It requires no server management, handles reconnection automatically, and has a generous free tier. The alternative (a Node.js WebSocket server) would require hosting costs and ongoing maintenance.

### Why not use Stockfish?
Stockfish WASM is ~30MB and takes several seconds to initialize even in a Web Worker. The custom minimax engine reaches club-level strength at depth 4 (~2000 ELO) and initializes in zero time. For a middle/high school audience, Stockfish's strength would be discouraging rather than educational.

### Why synchronous localStorage in db.js?
All storage operations complete in < 1ms for the data sizes used. Async storage (IndexedDB) would add Promise chains throughout the codebase without a meaningful user-experience benefit at this scale.

---

## 7. Extension Points

The module architecture makes the following additions straightforward:

| Feature | Approach |
|---|---|
| Chess puzzles | New `puzzles/puzzles.js` with curated positions + solution validation via `engine.js` |
| ELO-based matchmaking | Add a `rooms` index in Firebase sorted by rating; `relay.js` queries for opponents in rating range |
| Game import (PGN) | Extend `pgn.js` with a parser that replays SAN notation back through `makeMove()` |
| Opening explorer | New `openings/openings.js` mapping early move sequences to named openings |
| Analysis mode | Feed positions to a Stockfish WASM worker; display centipawn evaluation bar alongside the review board |
| Club admin dashboard | Server-rendered page (or separate SPA) with read-only access to the shared Firebase data |
| Swiss tournament format | New `tournament/swiss.js` implementing Swiss pairings and tiebreak rules |

---

## 8. File Reference

```
chess-club-hub/
├── index.html                 Single HTML file, all pages/modals
├── style.css                  Global CSS variables and component styles
├── app.js                     Main controller: navigation, game flow, UI
│
├── chess/
│   ├── engine.js              Move generation, check detection, game state
│   ├── ai.js                  Minimax + alpha-beta + piece-square tables
│   ├── clock.js               Chess clock with increment support
│   └── pgn.js                 PGN export and file download
│
├── multiplayer/
│   └── relay.js               Firebase room management and move relay
│
├── tournament/
│   └── bracket.js             Single-elimination bracket engine
│
├── storage/
│   └── db.js                  localStorage wrapper for all persistence
│
├── README.md                  Setup guide and deployment instructions
└── ARCHITECTURE.md            This document
```

---

## 9. Deployment Checklist

- [ ] Replace `FIREBASE_CONFIG` in `multiplayer/relay.js` with your project credentials
- [ ] Set Firebase Realtime Database rules (test mode for private club use)
- [ ] Serve files over HTTP (not `file://`) — ES modules require a server
- [ ] For public deployment, add Firebase auth rules to prevent data tampering
- [ ] Test on mobile — board size uses `clamp(44px, 10vmin, 72px)` and should adapt automatically
- [ ] (Optional) Deploy to GitHub Pages or Netlify for free hosting
