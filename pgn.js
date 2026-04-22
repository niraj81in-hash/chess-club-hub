// ============================================================
// Chess Club Hub — PGN Export/Import
// ============================================================

const FILES = 'abcdefgh';
const RANKS = '87654321';

export function exportPGN(gameRecord) {
  const { white, black, result, date, event, moves } = gameRecord;
  const tags = [
    `[Event "${event || 'Chess Club Hub Game'}"]`,
    `[Date "${date || new Date().toISOString().slice(0,10)}"]`,
    `[White "${white || 'Player 1'}"]`,
    `[Black "${black || 'Player 2'}"]`,
    `[Result "${result || '*'}"]`,
  ].join('\n');

  let movesStr = '';
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (i % 2 === 0) movesStr += `${Math.floor(i/2)+1}. `;
    movesStr += (m.san || squareToAlg(m.from) + squareToAlg(m.to)) + ' ';
  }
  movesStr += result || '*';

  return tags + '\n\n' + movesStr.trim();
}

function squareToAlg([r, c]) {
  return FILES[c] + RANKS[r];
}

export function downloadPGN(gameRecord, filename) {
  const pgn = exportPGN(gameRecord);
  const blob = new Blob([pgn], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'game.pgn';
  a.click();
  URL.revokeObjectURL(url);
}
