import type { ApproveRequestBody, ApproveRequestResponse, CreateRequestBody, CreateRequestResponse, RequestView } from './contract';

/** A failure the screens can show. `message` from the server is deliberately NOT kept. */
export interface ApiFailure {
  code: string; // stable code, or one of: network, bad-response
  status: number; // 0 for network problems
  retryAfterSec?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

export interface ApiClientOptions {
  base: string;
  getToken: () => string | null;
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  createRequest(body: CreateRequestBody): Promise<ApiResult<CreateRequestResponse>>;
  getRequest(requestId: string): Promise<ApiResult<RequestView>>;
  approveRequest(requestId: string, body: ApproveRequestBody): Promise<ApiResult<ApproveRequestResponse>>;
}

/** Used only when the server gives no usable code. */
const STATUS_CODES: Record<number, string> = {
  400: 'invalid-request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not-found',
  409: 'not-awaiting-approval',
  413: 'payload-too-large',
  429: 'rate-limited',
};

export function defaultApiBase(): string {
  return import.meta.env.VITE_API_BASE?.trim() || 'http://127.0.0.1:8787';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function readFailure(res: Response): Promise<ApiFailure> {
  let code: string | undefined;
  try {
    const json: unknown = await res.json();
    if (isObject(json) && isObject(json.error) && typeof json.error.code === 'string') {
      code = json.error.code;
    }
  } catch {
    // not JSON: fall back to the status
  }
  const retryHeader = Number(res.headers.get('Retry-After'));
  const failure: ApiFailure = {
    code: code ?? STATUS_CODES[res.status] ?? 'unknown',
    status: res.status,
  };
  if (Number.isFinite(retryHeader) && retryHeader > 0) failure.retryAfterSec = Math.ceil(retryHeader);
  return failure;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const base = opts.base.replace(/\/+$/, '');

  async function call<T>(
    path: string,
    init: RequestInit,
    accept: (v: unknown) => v is T,
    okStatuses: number[],
  ): Promise<ApiResult<T>> {
    const doFetch = opts.fetchImpl ?? fetch;
    const token = opts.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.body) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers });
    } catch {
      return { ok: false, error: { code: 'network', status: 0 } };
    }
    if (!okStatuses.includes(res.status)) return { ok: false, error: await readFailure(res) };
    try {
      const json: unknown = await res.json();
      if (accept(json)) return { ok: true, data: json };
    } catch {
      // fall through
    }
    return { ok: false, error: { code: 'bad-response', status: res.status } };
  }

  return {
    createRequest: (body) =>
      call(
        '/v1/requests',
        { method: 'POST', body: JSON.stringify(body) },
        (v): v is CreateRequestResponse => isObject(v) && typeof v.requestId === 'string',
        [202],
      ),
    getRequest: (requestId) =>
      call(
        `/v1/requests/${encodeURIComponent(requestId)}`,
        { method: 'GET' },
        (v): v is RequestView =>
          isObject(v) &&
          typeof v.requestId === 'string' &&
          ['queued', 'interpreting', 'needs-confirmation', 'running', 'succeeded', 'failed'].includes(v.status as string),
        [200],
      ),
    approveRequest: (requestId, body) =>
      call(
        `/v1/requests/${encodeURIComponent(requestId)}/approve`,
        { method: 'POST', body: JSON.stringify(body) },
        (v): v is ApproveRequestResponse => isObject(v) && typeof v.requestId === 'string',
        [202],
      ),
  };
}
