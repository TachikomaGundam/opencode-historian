// Minimal ambient declarations for the node builtins used by this package.
// The plugin targets a zero-runtime-dependency surface and the strict
// environment does not ship @types/node; declaring only what we consume keeps
// `tsc` strict-clean without adding dependencies.

declare module 'node:os' {
  export function homedir(): string;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
}

declare var process: {
  env: NodeJS.ProcessEnv;
};