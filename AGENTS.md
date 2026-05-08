# Chess Club Hub

A client-side chess platform for school clubs built with vanilla JavaScript ES modules.

## Cursor Cloud specific instructions

### Project overview

Three core modules (`engine.js`, `db.js`, `pgn.js`) provide chess logic, local storage persistence, and PGN export. The app runs entirely in the browser — no backend or external database.

### Dev commands

All commands are in `package.json`:

| Task | Command |
|------|---------|
| Dev server | `npm run dev` (Vite on port 5173) |
| Lint | `npm run lint` |
| Tests | `npm run test` |
| Build | `npm run build` |

### Gotchas

- `db.js` uses browser `localStorage` and `pgn.js` uses DOM APIs (`Blob`, `document.createElement`). Tests run under `jsdom` (configured in `vitest.config.js`) so these APIs are available during testing.
- The JS source files use ES module `export` syntax, so they must be served over HTTP (not `file://`). Vite handles this automatically.
- There is no TypeScript — all source is vanilla `.js`.
