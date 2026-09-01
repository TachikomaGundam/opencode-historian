import { describe, it, expect } from 'vitest';
import { parseJsonc } from '../src/jsonc.js';
import { ConfigError } from '../src/config.js';

describe('parseJsonc seam', () => {
  it('strips comments and trailing commas string-aware, preserving https:// inside strings', () => {
    const parsed = parseJsonc(
      `{
  // line comment
  "url": "https://gateway.example.com/v1", /* block after value */
  "inner": "/* literal in string */ // literal",
  "arr": [1, 2, 3,],
}`,
      'fixture',
    );
    expect(parsed).toEqual({
      url: 'https://gateway.example.com/v1',
      inner: '/* literal in string */ // literal',
      arr: [1, 2, 3],
    });
  });

  it('throws ConfigError (not SyntaxError) on garbage', () => {
    let caught: unknown;
    try {
      parseJsonc('this is { not json', 'fixture');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
  });

  it('throws ConfigError for unterminated block comment', () => {
    expect(() => parseJsonc('{"a": 1 /* never closed', 'fixture')).toThrow(ConfigError);
  });

  it('throws ConfigError for unterminated string', () => {
    expect(() => parseJsonc('{"a": "oops', 'fixture')).toThrow(ConfigError);
  });
});