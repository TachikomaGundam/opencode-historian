import { describe, it, expect } from 'vitest';
import {
  makeTranslator,
  TranslateError,
  normalizeMessagesUrl,
  splitMarkdownBlocks,
  pickResponseText,
  buildSystemPrompt,
} from '../src/translate.js';
import type { HistorianOptions } from '../src/config.js';

// Unit surface of the todo-8 translation engine. Every case runs against
// injected fetchImpl mocks — no network. The synthetic KEY below is used
// verbatim in fake response bodies to pin the log-leak guard: a buggy
// translateChunk that echoes body text into errors without redaction fails.

const KEY = 'sk-translate-unit-fixture-0d1e2f';

const OPTS: HistorianOptions = {
  baseUrl: 'http://localhost:3000',
  apiKeyPath: '~/.wikijs-api-key',
  translate: {
    endpoint: 'https://translate.example.com/apps/anthropic',
    model: 'qwen3.7-plus',
    apiKey: KEY,
    providerKey: 'my-provider',
  },
  sections: ['_sandbox'],
  locales: ['en', 'zh'],
  readingLoop: true,
  capture: { enabled: false },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Captures the edge error; rethrows (test failure) if the promise resolves. */
async function catchError(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected promise to reject');
}

interface Captured {
  url: string;
  init: RequestInit;
}

function captureFetch(
  responses: readonly ((call: number) => Response)[] = [() => okText('译文')],
): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: typeof fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    const call = calls.length;
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(responses[Math.min(call, responses.length - 1)](call));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function okText(text: string): Response {
  return jsonResponse({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
}

describe('normalizeMessagesUrl', () => {
  it.each([
    ['https://translate.example.com/apps/anthropic', 'https://translate.example.com/apps/anthropic/v1/messages'],
    ['https://translate.example.com', 'https://translate.example.com/v1/messages'],
    ['https://translate.example.com/', 'https://translate.example.com/v1/messages'],
    ['https://translate.example.com/apps/anthropic/v1', 'https://translate.example.com/apps/anthropic/v1'],
    ['https://translate.example.com/apps/anthropic/v1/messages', 'https://translate.example.com/apps/anthropic/v1/messages'],
    ['https://TOKEN-PLAN.EXAMPLE.COM/APPS/ANTHROPIC/V1', 'https://TOKEN-PLAN.EXAMPLE.COM/APPS/ANTHROPIC/V1'],
  ])('normalizes %s', (endpoint, expected) => {
    expect(normalizeMessagesUrl(endpoint)).toBe(expected);
  });
});

describe('splitMarkdownBlocks', () => {
  it('passes small text through as a single block', () => {
    expect(splitMarkdownBlocks('Hello world', 50)).toEqual(['Hello world']);
  });

  it('splits long text into groups at blank-line boundaries', () => {
    expect(splitMarkdownBlocks('Block one\n\nBlock two\n\nBlock three', 10)).toEqual([
      'Block one',
      'Block two',
      'Block three',
    ]);
  });

  it('passes an oversized single block through whole', () => {
    const huge = 'x'.repeat(100);
    expect(splitMarkdownBlocks(`${huge}\n\ntail`, 30)).toEqual([huge, 'tail']);
  });

  it('never splits inside a code fence across blank lines', () => {
    const text = '## Head\n\n```js\n\nfunction x() {}\n\n```\n\ntail';
    expect(splitMarkdownBlocks(text, 20)).toEqual([
      '## Head',
      '```js\n\nfunction x() {}\n\n```',
      'tail',
    ]);
  });
});

describe('pickResponseText', () => {
  it('returns the text of a single text part', () => {
    expect(pickResponseText({ content: [{ type: 'text', text: '你好' }] })).toBe('你好');
  });

  it('joins all text parts when the first content part is not text', () => {
    const json = {
      content: [
        { type: 'tool_use', id: 't1', name: 'x', input: {} },
        { type: 'text', text: '第一' },
        { type: 'text', text: '第二' },
      ],
    };
    expect(pickResponseText(json)).toBe('第一第二');
  });

  it('throws malformed when content is missing', () => {
    expect(() => pickResponseText({})).toThrow(TranslateError);
  });

  it('throws malformed when content is not an array', () => {
    expect(() => pickResponseText({ content: 'nope' })).toThrow(TranslateError);
  });

  it('throws malformed when no part is a text part', () => {
    expect(() => pickResponseText({ content: [{ type: 'tool_use', id: 't1' }] })).toThrow(TranslateError);
  });

  it('throws malformed when the text is empty', () => {
    expect(() => pickResponseText({ content: [{ type: 'text', text: '' }] })).toThrow(TranslateError);
  });
});

describe('buildSystemPrompt', () => {
  it('renders the direction and a glossary term table when glossary is given', () => {
    const prompt = buildSystemPrompt('en', 'zh', { SDK: '软件开发套件', OOM: '内存耗尽' });
    expect(prompt).toContain('DIRECTION: en->zh');
    expect(prompt).toContain('GLOSSARY:');
    expect(prompt).toContain('SDK|软件开发套件');
  });

  it('omits the glossary section when glossary is absent', () => {
    const prompt = buildSystemPrompt('zh', 'en');
    expect(prompt).toContain('DIRECTION: zh->en');
    expect(prompt).not.toContain('GLOSSARY:');
  });
});

describe('makeTranslator', () => {
  it('sends the configured model, api key and anthropic-version with max_tokens 500 for short text', async () => {
    // Given
    const { fetchImpl, calls } = captureFetch();
    const translate = makeTranslator(OPTS, { fetchImpl });
    // When
    const out = await translate('Hello world', 'en', 'zh');
    // Then
    expect(out).toBe('译文');
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://translate.example.com/apps/anthropic/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('qwen3.7-plus');
    expect(body.max_tokens).toBe(500);
    expect(body.system).toContain('DIRECTION: en->zh');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello world' }]);
  });

  it('uses max_tokens 32000 for long text and never doubles /v1 when the endpoint ends with /v1', async () => {
    // Given
    const { fetchImpl, calls } = captureFetch();
    const opts = { ...OPTS, translate: { ...OPTS.translate, endpoint: 'https://translate.example.com/apps/anthropic/v1' } };
    const translate = makeTranslator(opts, { fetchImpl });
    // When
    await translate('a'.repeat(2000), 'en', 'zh');
    // Then
    const { url, init } = calls[0];
    expect(url).toBe('https://translate.example.com/apps/anthropic/v1');
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(32000);
  });

  it('chunks long text on blank lines into one request per chunk and joins results with double newline', async () => {
    // Given
    const { fetchImpl, calls } = captureFetch([(n) => okText(`T${n}`), (n) => okText(`T${n}`)]);
    const translate = makeTranslator(OPTS, { fetchImpl });
    // When
    const out = await translate(`${'a'.repeat(2500)}\n\n${'b'.repeat(2500)}`, 'en', 'zh');
    // Then
    expect(out).toBe('T0\n\nT1');
    expect(calls).toHaveLength(2);
    for (const [i, { init }] of calls.entries()) {
      const body = JSON.parse(String(init.body));
      expect(body.max_tokens).toBe(32000);
      expect(body.messages[0].content).toBe([`${'a'.repeat(2500)}`, `${'b'.repeat(2500)}`][i]);
    }
  });

  it('surfaces HTTP 429 as a TranslateError naming the status, with the api key redacted from echoed bodies', async () => {
    // Given — the fake body echoes the api key; the error must never leak it.
    const { fetchImpl } = captureFetch([() => jsonResponse({ error: { message: `bad key ${KEY}` } }, 429)]);
    const translate = makeTranslator(OPTS, { fetchImpl });
    // When
    const err = await catchError(translate('hi', 'en', 'zh'));
    // Then
    expect(err).toBeInstanceOf(TranslateError);
    const tErr = err as TranslateError;
    expect(tErr.cause).toBe('http');
    expect(tErr.message).toContain('429');
    expect(tErr.message).not.toContain(KEY);
    expect(tErr.detail).not.toContain(KEY);
  });

  it('reports stop_reason max_tokens as truncated, never returning partial text', async () => {
    // Given
    const { fetchImpl } = captureFetch([() => jsonResponse({ content: [{ type: 'text', text: 'partial only' }], stop_reason: 'max_tokens' })]);
    const translate = makeTranslator(OPTS, { fetchImpl });
    // When
    const err = await catchError(translate('hi', 'en', 'zh'));
    // Then
    expect(err).toBeInstanceOf(TranslateError);
    expect((err as TranslateError).cause).toBe('truncated');
  });

  it('maps an empty content answer to malformed', async () => {
    // Given
    const { fetchImpl } = captureFetch([() => jsonResponse({ content: [], stop_reason: 'end_turn' })]);
    const translate = makeTranslator(OPTS, { fetchImpl });
    // When
    const err = await catchError(translate('hi', 'en', 'zh'));
    // Then
    expect(err).toBeInstanceOf(TranslateError);
    expect((err as TranslateError).cause).toBe('malformed');
  });

  it('maps an aborted request to timeout naming the configured timeoutMs', async () => {
    // Given
    const abortErr = new Error('The operation was aborted.');
    abortErr.name = 'AbortError';
    const fetchImpl = (() => Promise.reject(abortErr)) as typeof fetch;
    const translate = makeTranslator(OPTS, { fetchImpl, timeoutMs: 1234 });
    // When
    const err = await catchError(translate('hi', 'en', 'zh'));
    // Then
    expect(err).toBeInstanceOf(TranslateError);
    const tErr = err as TranslateError;
    expect(tErr.cause).toBe('timeout');
    expect(tErr.message).toContain('1234');
  });

  it('defaults to the legacy 300s timeout when timeoutMs is not injected', async () => {
    // Given
    const abortErr = new Error('The operation was aborted.');
    abortErr.name = 'AbortError';
    const fetchImpl = (() => Promise.reject(abortErr)) as typeof fetch;
    const translate = makeTranslator(OPTS, { fetchImpl });
    // When
    const err = await catchError(translate('hi', 'en', 'zh'));
    // Then
    expect((err as TranslateError).message).toContain('300000');
  });
});
describe('unset endpoint (no baked-in gateway default)', () => {
  it('rejects with cause config and never calls fetch when endpoint is empty', async () => {
    // Given
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(jsonResponse({ content: [{ type: 'text', text: 'x' }] }));
    }) as unknown as typeof fetch;
    const unconfigured: HistorianOptions = { ...OPTS, translate: { ...OPTS.translate, endpoint: '' } };
    // When
    const err = await catchError(makeTranslator(unconfigured, { fetchImpl })('hello', 'en', 'zh'));
    // Then
    expect(err).toBeInstanceOf(TranslateError);
    expect((err as TranslateError).cause).toBe('config');
    expect(err.message).toContain('translate.endpoint not configured');
    expect(calls).toBe(0);
  });
});
