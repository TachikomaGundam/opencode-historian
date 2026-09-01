/**
 * Minimal ambient typings for the node builtins src/map.ts reads/writes.
 *
 * The runtime (Node >= 20) provides full types; @types/node is not declared in
 * the immutable package.json, so this shim keeps the boundary imports
 * type-checked. Signatures are the exact subset used — narrowed to what the
 * code calls, nothing more.
 */

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): unknown;
}

declare module 'node:os' {
  export function homedir(): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}