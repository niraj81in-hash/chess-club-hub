// @vitest-environment happy-dom
// happy-dom gives us a DOM in Vitest without spinning a browser.
import { describe, it, expect } from 'vitest';
import { renderEvalGraph, evalToY } from '../js/ui/eval-graph.js';

describe('evalToY', () => {
  it('clamps cp above +500 to the top of the chart', () => {
    expect(evalToY({ cp: 9999, mate: null }, 100)).toBe(0);
  });
  it('clamps cp below -500 to the bottom of the chart', () => {
    expect(evalToY({ cp: -9999, mate: null }, 100)).toBe(100);
  });
  it('puts cp 0 at the vertical center', () => {
    expect(evalToY({ cp: 0, mate: null }, 100)).toBe(50);
  });
  it('places winning mate at the top edge', () => {
    expect(evalToY({ cp: null, mate: 3 }, 100)).toBe(0);
  });
  it('places losing mate at the bottom edge', () => {
    expect(evalToY({ cp: null, mate: -3 }, 100)).toBe(100);
  });
});

describe('renderEvalGraph', () => {
  it('returns an <svg> element with a polyline of N points for N evals', () => {
    const svg = renderEvalGraph([{ cp: 0, mate: null }, { cp: 100, mate: null }, { cp: -200, mate: null }]);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    const poly = svg.querySelector('polyline');
    expect(poly).not.toBeNull();
    expect(poly.getAttribute('points').split(' ').length).toBe(3);
  });

  it('returns an empty <svg> when given an empty array', () => {
    const svg = renderEvalGraph([]);
    expect(svg.querySelector('polyline')).toBeNull();
  });
});
