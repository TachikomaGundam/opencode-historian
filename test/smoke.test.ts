import { describe, it, expect } from 'vitest';
import plugin from '../src/index.js';

describe('opencode-historian smoke', () => {
  it('default export has id opencode-historian when imported', () => {
    expect(plugin).toBeDefined();
    expect(plugin.id).toBe('opencode-historian');
  });

  it('default export has server function when imported', () => {
    expect(typeof plugin.server).toBe('function');
  });
});
