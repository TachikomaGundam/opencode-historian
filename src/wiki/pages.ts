/**
 * Page operations facade — re-exports the read and write halves so callers
 * import a single module. The split (pages.read.ts / pages.write.ts) keeps
 * every source file under the 250-LOC ceiling.
 */
export * from './pages.read.js';
export * from './pages.write.js';