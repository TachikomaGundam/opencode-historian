import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveOptions } from '../dist/config.js';

const JSONC = join(homedir(), '.config', 'opencode', 'opencode.jsonc');

export function pluginRawOptions() {
  const text = readFileSync(JSONC, 'utf8');
  const i = text.indexOf('opencode-wiki-historian');
  if (i < 0) throw new Error('plugin entry not found in opencode.jsonc');
  const brace = text.indexOf('{', i);
  let depth = 0;
  for (let j = brace; j < text.length; j++) {
    if (text[j] === '{') depth += 1;
    else if (text[j] === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(brace, j + 1));
    }
  }
  throw new Error('unterminated plugin options object');
}

export function liveOptions() {
  return resolveOptions(pluginRawOptions());
}
