import { describe, it, expect } from 'vitest';
import { clampMenuPosition } from '../menu-position';

describe('clampMenuPosition (#141)', () => {
  const vw = 1280;
  const vh = 800;

  it('keeps the click position when the menu fits', () => {
    expect(clampMenuPosition(100, 100, 180, 240, vw, vh)).toEqual({ left: 100, top: 100 });
  });

  it('shifts the menu up when it would overflow the bottom edge', () => {
    const pos = clampMenuPosition(100, 700, 180, 240, vw, vh);
    expect(pos.left).toBe(100);
    expect(pos.top).toBe(vh - 240 - 8);
  });

  it('shifts the menu left when it would overflow the right edge', () => {
    const pos = clampMenuPosition(1200, 100, 180, 240, vw, vh);
    expect(pos.left).toBe(vw - 180 - 8);
    expect(pos.top).toBe(100);
  });

  it('never goes above the top-left margin', () => {
    expect(clampMenuPosition(-20, -20, 180, 240, vw, vh)).toEqual({ left: 8, top: 8 });
  });
});
