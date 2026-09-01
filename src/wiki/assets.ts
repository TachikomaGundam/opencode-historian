/**
 * Asset upload via POST /u (wiki.js multipart endpoint, pitfall #7).
 *
 * Body: FormData, field `mediaUpload` (filename = sanitizeAssetName(filename)).
 * Optional `parent` field carries numeric folderId for folder-scoped uploads.
 * Auth: Bearer token. Api key is INJECTED via `deps.apiKey` — resolution
 * lives in the caller (tools layer, todo 11, via readWikiApiKey), so this
 * module stays network- and config-free (pure + injected, trivially testable).
 *
 * Response JSON: `{type:'success', location}` or `{type:'error', msg}`.
 * Non-JSON and timeouts → AssetUploadError (message names 'timeout').
 */

// --- Error ------------------------------------------------------------------

/** Server-rejected upload or transport failure. `serverMsg` carries the
 *  wiki.js `msg` field on server errors; empty on transport failures. */
export class AssetUploadError extends Error {
  readonly serverMsg: string;
  constructor(message: string, serverMsg = '') {
    super(message);
    this.name = 'AssetUploadError';
    this.serverMsg = serverMsg;
  }
}

// --- sanitizeAssetName ------------------------------------------------------

/**
 * Lowercase; ` `/`,`/`;`/`#` → `_`; collapse `_+`; strip leading `_`;
 * preserve the extension (last dot group) lowercased. Fallback `'asset'`
 * on empty / degenerate inputs. Invariant: never produces `'..'`.
 * Non-ASCII letters are preserved (only named chars above are replaced).
 */
export function sanitizeAssetName(name: string): string {
  if (name === '') return 'asset';
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const base = (hasExt ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[ ,;#]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '');
  if (base === '' || base.includes('..')) return 'asset';
  return hasExt ? `${base}.${name.slice(dot + 1).toLowerCase()}` : base;
}

// --- uploadAsset ------------------------------------------------------------

export interface AssetUploadResult {
  readonly url: string;
  readonly name: string;
  readonly size: number;
}

export interface UploadDeps {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface UploadFile {
  readonly bytes: Uint8Array | string;
  readonly filename: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function isAbort(err: unknown): boolean {
  return err != null && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
}

/** POST a single file to /u. Returns {url, sanitizedName, byteLength}. */
export async function uploadAsset(
  deps: UploadDeps,
  file: UploadFile,
  folderId?: number,
): Promise<AssetUploadResult> {
  const url = `${deps.baseUrl.replace(/\/+$/, '')}/u`;
  const name = sanitizeAssetName(file.filename);
  const bytes: Uint8Array =
    typeof file.bytes === 'string' ? new TextEncoder().encode(file.bytes) : file.bytes;

  const form = new FormData();
  form.set('mediaUpload', new File([bytes as BlobPart], name));
  if (folderId !== undefined) form.set('parent', String(folderId));

  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const detail = isAbort(err) ? `timeout after ${timeoutMs}ms` : (err as Error).message;
    throw new AssetUploadError(`asset upload to ${url} ${detail}`);
  }

  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch {
    throw new AssetUploadError(`asset upload to ${url} returned non-JSON (HTTP ${res.status})`);
  }

  const type = (body as { type?: unknown } | null)?.type;
  if (type === 'success') {
    const loc = (body as { location?: unknown }).location;
    return { url: typeof loc === 'string' ? loc : '', name, size: bytes.byteLength };
  }
  if (type === 'error') {
    const msg = (body as { msg?: unknown }).msg;
    const s = typeof msg === 'string' ? msg : 'asset upload rejected by server';
    throw new AssetUploadError(s, s);
  }
  throw new AssetUploadError(
    `asset upload to ${url} returned unexpected payload (HTTP ${res.status})`,
  );
}
