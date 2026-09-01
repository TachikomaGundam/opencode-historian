/**
 * Unit tests for src/wiki/assets.ts — asset upload via POST /u (pitfall #7):
 *
 *   sanitizeAssetName table-driven (7 degenerate inputs)
 *   upload happy path (2): FormData field name + sanitized filename + auth header;
 *     folderId present/absent controls the extra `parent` field.
 *   error paths (3): server type:'error' -> AssetUploadError with serverMsg;
 *     non-JSON body -> AssetUploadError naming status; timeout -> AssetUploadError
 *     message names 'timeout'.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeAssetName,
  uploadAsset,
  AssetUploadError,
} from '../src/wiki/assets.js';

// --- sanitizeAssetName (table-driven) ----------------------------------------

const SANITIZE_CASES: readonly (readonly [string, string])[] = [
  ['My Photo.png', 'my_photo.png'],
  ['a#b;c,d.png', 'a_b_c_d.png'],
  ['__x__.md', 'x_.md'],
  ['..', 'asset'],
  ['  ', 'asset'],
  ['É.png', 'é.png'],
  ['photo.2026.png', 'photo.2026.png'],
  ['', 'asset'],
];

describe('sanitizeAssetName', () => {
  it.each(SANITIZE_CASES)('sanitizeAssetName(%p) === %p', (input, expected) => {
    expect(sanitizeAssetName(input)).toBe(expected);
  });

  it('never produces ".." in output', () => {
    expect(sanitizeAssetName('..')).not.toContain('..');
    expect(sanitizeAssetName('a/../../../b.png')).not.toContain('..');
  });
});

// --- uploadAsset helpers -----------------------------------------------------

const BASE = 'http://localhost:3000';
const KEY = 'sk-asset-unit-fixture';

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: FormData;
  readonly signal: AbortSignal;
}

function makeFetch(
  respondWith: Response,
  captured: { req?: CapturedRequest },
): typeof fetch {
  return vi.fn(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body;
    if (!(body instanceof FormData)) throw new Error('expected FormData body');
    const headers: Record<string, string> = {};
    init?.headers &&
      Object.entries(init.headers as Record<string, string>).forEach(([k, v]) => {
        headers[k] = v;
      });
    captured.req = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body,
      signal: init?.signal as AbortSignal,
    };
    return respondWith;
  }) as unknown as typeof fetch;
}

function jsonOk(location: string): Response {
  return new Response(JSON.stringify({ type: 'success', location }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// --- uploadAsset happy path --------------------------------------------------

describe('uploadAsset happy path', () => {
  it('POSTs FormData with mediaUpload field (sanitized filename) + Bearer auth', async () => {
    const captured: { req?: CapturedRequest } = {};
    const fetchImpl = makeFetch(jsonOk('/u/my_photo.png'), captured);

    const result = await uploadAsset(
      { baseUrl: BASE, apiKey: KEY, fetchImpl },
      { bytes: new Uint8Array([1, 2, 3]), filename: 'My Photo.png' },
    );

    expect(result).toEqual({ url: '/u/my_photo.png', name: 'my_photo.png', size: 3 });

    const req = captured.req!;
    expect(req.url).toBe(`${BASE}/u`);
    expect(req.method).toBe('POST');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);

    const field = req.body.get('mediaUpload');
    expect(field).toBeInstanceOf(File);
    expect((field as File).name).toBe('my_photo.png');
  });

  it('includes parent field when folderId provided; omits otherwise', async () => {
    const cap1: { req?: CapturedRequest } = {};
    const cap2: { req?: CapturedRequest } = {};
    const fetchImpl = vi.fn();
    fetchImpl.mockImplementation(async (_input, init) => {
      const cap = cap1.req === undefined ? cap1 : cap2;
      const body = init?.body as FormData;
      const headers: Record<string, string> = {};
      Object.entries(init?.headers as Record<string, string>).forEach(([k, v]) => {
        headers[k] = v;
      });
      cap.req = {
        url: typeof _input === 'string' ? _input : '',
        method: 'POST',
        headers,
        body,
        signal: init?.signal as AbortSignal,
      };
      return jsonOk('/u/x.png');
    });

    await uploadAsset(
      { baseUrl: BASE, apiKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch },
      { bytes: new Uint8Array([9]), filename: 'x.png' },
      42,
    );
    expect(cap1.req!.body.get('parent')).toBe('42');

    await uploadAsset(
      { baseUrl: BASE, apiKey: KEY, fetchImpl: fetchImpl as unknown as typeof fetch },
      { bytes: new Uint8Array([9]), filename: 'y.png' },
    );
    expect(cap2.req!.body.get('parent')).toBeNull();
  });
});

// --- uploadAsset error paths -------------------------------------------------

describe('uploadAsset error paths', () => {
  it('server type:error -> AssetUploadError carrying serverMsg', async () => {
    const res = new Response(JSON.stringify({ type: 'error', msg: 'file too large' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const fetchImpl = makeFetch(res, {});

    let err: Error | undefined;
    try {
      await uploadAsset(
        { baseUrl: BASE, apiKey: KEY, fetchImpl },
        { bytes: new Uint8Array([1]), filename: 'big.png' },
      );
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(AssetUploadError);
    expect((err as AssetUploadError).serverMsg).toBe('file too large');
  });

  it('non-JSON response -> AssetUploadError naming status', async () => {
    const res = new Response('<html>gateway error</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
    const fetchImpl = makeFetch(res, {});

    let err: Error | undefined;
    try {
      await uploadAsset(
        { baseUrl: BASE, apiKey: KEY, fetchImpl },
        { bytes: new Uint8Array([1]), filename: 'x.png' },
      );
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(AssetUploadError);
    expect(err!.message).toMatch(/502/);
  });

  it('timeout -> AssetUploadError whose message names timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;

    let err: Error | undefined;
    try {
      await uploadAsset(
        { baseUrl: BASE, apiKey: KEY, fetchImpl, timeoutMs: 50 },
        { bytes: new Uint8Array([1]), filename: 'x.png' },
      );
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(AssetUploadError);
    expect(err!.message.toLowerCase()).toMatch(/timeout/);
  });
});
