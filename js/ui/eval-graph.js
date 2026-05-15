// Pure DOM render: array of evals → <svg> element.
// Clamps cp to ±500; mate goes to the top/bottom edge.

const CLAMP_CP = 500;
const WIDTH    = 600;   // viewBox; scales via CSS
const HEIGHT   = 80;

export function evalToY(ev, height = HEIGHT) {
  if (!ev) return height / 2;
  if (ev.mate != null) return ev.mate > 0 ? 0 : height;
  const cp = Math.max(-CLAMP_CP, Math.min(CLAMP_CP, ev.cp ?? 0));
  // cp=+500 → y=0 (top), cp=-500 → y=height (bottom), cp=0 → y=height/2.
  return ((CLAMP_CP - cp) / (2 * CLAMP_CP)) * height;
}

export function renderEvalGraph(evals, options = {}) {
  const onClick = options.onClick || null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'eval-graph');
  svg.style.width = '100%';
  svg.style.height = HEIGHT + 'px';

  // Zero line.
  const zero = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  zero.setAttribute('x1', '0'); zero.setAttribute('x2', String(WIDTH));
  zero.setAttribute('y1', String(HEIGHT / 2)); zero.setAttribute('y2', String(HEIGHT / 2));
  zero.setAttribute('stroke', 'rgba(255,255,255,.2)');
  zero.setAttribute('stroke-width', '1');
  svg.appendChild(zero);

  if (!evals.length) return svg;

  const stepX = evals.length === 1 ? 0 : WIDTH / (evals.length - 1);
  const points = evals.map((ev, i) => `${(i * stepX).toFixed(1)},${evalToY(ev).toFixed(1)}`).join(' ');

  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', '#f0b429');
  poly.setAttribute('stroke-width', '1.5');
  svg.appendChild(poly);

  if (onClick) {
    svg.style.cursor = 'pointer';
    svg.addEventListener('click', (e) => {
      const rect = svg.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const idx = Math.max(0, Math.min(evals.length - 1, Math.round(x * (evals.length - 1))));
      onClick(idx);
    });
  }
  return svg;
}
