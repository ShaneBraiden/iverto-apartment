/**
 * The transport. Every call in `endpoints.ts` goes through this one function.
 *
 * What it owns, so that nothing above it has to:
 *
 *   • the base URL, the `/api/v1` prefix, and the `Authorization` header
 *   • a timeout, because `fetch` on React Native has none and a request that
 *     never settles is worse than one that fails
 *   • 401 → end the session, once, in one place
 *   • turning every failure into an `ApiError` carrying the HTTP status, which
 *     is the shape `lib/errors.ts` already reads to word the screen
 *
 * There is no case conversion. The service is NestJS and speaks camelCase on
 * the wire, which is what the app speaks too — so a field arrives named exactly
 * what `types/index.ts` calls it. (An earlier revision of this app converted
 * snake_case for a FastAPI service that was never built; against the real one
 * that layer was a no-op, and a no-op in the transport is a place for a bug to
 * hide.)
 *
 * It deliberately does not retry 5xx. A guard pressing a button twice is a
 * decision they made; an invisible retry of a write is not something a
 * transport gets to decide for a flow with someone standing at a barrier.
 */
import { API_PREFIX, API_URL, REQUEST_TIMEOUT_MS } from './config';
import { clearTokens, emitSessionExpired, getAccessToken } from './tokens';

/**
 * A failure with the HTTP status attached.
 *
 * `lib/errors.ts` reads `.status` to decide whether to offer a retry button,
 * so throwing anything else from this layer silently downgrades every error
 * screen in the app to "something went wrong".
 */
export class ApiError extends Error {
  status: number;
  /** The backend's machine-readable code, when it sends one. */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Status 0 — the request never reached a server. */
export const isOffline = (e: unknown) => e instanceof ApiError && e.status === 0;

/** 404 — including a route this deployment has not shipped. See `endpoints.ts`. */
export const isMissingRoute = (e: unknown) => e instanceof ApiError && e.status === 404;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type RequestOptions = {
  method?: Method;
  /** Serialised as JSON, verbatim — the wire and the app share a case. */
  body?: unknown;
  /** Appended as a query string; `undefined` and `null` entries are dropped. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /**
   * Sent as `Idempotency-Key`.
   *
   * The service does not honour this header yet, so it buys nothing today. It
   * is still sent, and still generated per-attempt at the call sites that need
   * it, because the alternative is threading the keys through later under time
   * pressure — and a header the server ignores costs one line.
   */
  idempotencyKey?: string;
  /** Skip the bearer token — only the login endpoint does this. */
  anonymous?: boolean;
  /**
   * Treat a `401` as an ordinary error instead of as the end of the session.
   *
   * Exactly one call needs it. Passcode verification answers a wrong, revoked,
   * spent or expired guest code with `401` and a sentence — and signing the
   * guard out because a visitor mistyped six digits would take the gate down
   * for everybody behind them. Everywhere else a 401 means what it looks like.
   */
  allow401?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** `${origin}/api/v1${path}` — the one place the prefix is applied. */
export function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = `${API_URL}${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* A proxy or a captive portal answering with HTML. Not JSON, not ours. */
    return { message: text.slice(0, 200) };
  }
}

/**
 * NestJS answers `{"statusCode":400,"message":...,"error":"Bad Request"}`,
 * where `message` is either a sentence or an array of validation strings. Both
 * are unwrapped to one sentence, because a screen has room for one sentence.
 */
function messageOf(payload: unknown, fallback: string): { message: string; code?: string } {
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    const code = typeof body.error === 'string' ? body.error : undefined;
    const detail = body.message ?? body.error;
    if (typeof detail === 'string' && detail.trim()) return { message: detail, code };
    if (Array.isArray(detail)) {
      /* Every validation line, not just the first: "email must be an email"
         alone, when the password was also blank, sends someone to fix one
         field and submit into the identical error. */
      const lines = detail.filter((d): d is string => typeof d === 'string');
      if (lines.length) return { message: `${capitalise(lines.join('. '))}.`, code };
    }
    if (code) return { message: fallback, code };
  }
  return { message: fallback };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const STATUS_FALLBACK: Record<number, string> = {
  400: 'That request was not accepted.',
  401: 'Your session has ended. Sign in again.',
  403: 'You do not have access to this.',
  404: 'That is no longer there.',
  409: 'Someone else got there first.',
  413: 'That photo was too large to send. Take it again.',
  422: 'Some of those details were not valid.',
  429: 'Too many attempts. Wait a moment and try again.',
};

/* ----------------------------------------------------------------- Request */

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    idempotencyKey: idemKey,
    anonymous = false,
    allow401 = false,
    timeoutMs = REQUEST_TIMEOUT_MS,
    signal,
  } = options;

  /* No token and the endpoint needs one: fail here rather than at the server.
     This is the moment right after sign-out, when a screen that has not
     unmounted yet refetches. Sending it would come back 401, trip the
     session-expired path, clear the cache, and provoke the same refetch again
     — a loop paid for one round trip at a time. */
  if (!anonymous && !getAccessToken()) {
    throw new ApiError('You are signed out.', 401, 'no_session');
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  if (!anonymous) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  /* The caller's signal (a screen unmounting) and ours (the timeout) both have
     to abort the same fetch, and RN has no `AbortSignal.any`. */
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new ApiError('Cancelled', 0, 'cancelled');
    throw new ApiError(
      'Could not reach the server. Check your connection.',
      0,
      e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  /* There is no refresh token to spend, so a 401 is simply the end of the
     session — reported once, here, rather than discovered separately by every
     screen that happens to be mounted. */
  if (res.status === 401 && !anonymous && !allow401) {
    await clearTokens();
    emitSessionExpired();
    throw new ApiError('Your session has ended. Sign in again.', 401, 'session_expired');
  }

  /* 413 is the one status whose wording is taken away from the service. Express
     answers an oversized body with body-parser's own `request entity too
     large`, which reached a guard verbatim, in a dialog, with someone standing
     at the barrier. The body is only ever large because of the photo, and the
     only useful instruction is to take it again. */
  if (res.status === 413) {
    throw new ApiError(STATUS_FALLBACK[413], 413, 'payload_too_large');
  }

  if (!res.ok) {
    const { message, code } = messageOf(
      await parse(res),
      STATUS_FALLBACK[res.status] ?? 'The server had a problem.',
    );
    throw new ApiError(message, res.status, code);
  }

  return (await parse(res)) as T;
}

/** Convenience wrappers, so endpoint bodies read as one line each. */
export const get = <T>(path: string, query?: RequestOptions['query'], o?: RequestOptions) =>
  request<T>(path, { ...o, method: 'GET', query });

export const post = <T>(path: string, body?: unknown, o?: RequestOptions) =>
  request<T>(path, { ...o, method: 'POST', body });

export const patch = <T>(path: string, body?: unknown, o?: RequestOptions) =>
  request<T>(path, { ...o, method: 'PATCH', body });

export const put = <T>(path: string, body?: unknown, o?: RequestOptions) =>
  request<T>(path, { ...o, method: 'PUT', body });

export const del = <T>(path: string, o?: RequestOptions) =>
  request<T>(path, { ...o, method: 'DELETE' });

/**
 * A client-generated idempotency key.
 *
 * Generated where the user acted, not where the request is sent, so a retry
 * after a timeout carries the *same* key. The server does not read it yet (see
 * `RequestOptions.idempotencyKey`); the call sites are written as though it
 * does, so switching it on is a backend change alone.
 */
export const idempotencyKey = (prefix = 'app') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
