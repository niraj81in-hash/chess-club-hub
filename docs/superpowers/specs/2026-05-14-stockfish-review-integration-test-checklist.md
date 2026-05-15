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
