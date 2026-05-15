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
