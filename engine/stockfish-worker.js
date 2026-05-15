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
