/**
 * Where the app points, and the few numbers the backend and the client have
 * to agree on.
 *
 * Resolution order is deliberate: an `EXPO_PUBLIC_API_URL` in the environment
 * beats `expo.extra.apiUrl` in `app.json`. The env var is what a developer
 * sets to aim a dev client at a laptop; the manifest value is what ships in
 * the APK. Nothing here reads a hostname at runtime, so a build is always
 * pointed at exactly one place and you can tell which by looking at it.
 */
import Constants from 'expo-constants';

type Extra = { apiUrl?: string; wsUrl?: string };

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/**
 * Origin for every REST call — scheme, host, and any path prefix the service
 * is mounted under. `API_PREFIX` below carries the versioned segment, so a
 * value ending in a slash or in `/api/v1` is wrong and will produce 404s.
 */
export const API_URL = trimSlash(
  process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? 'https://iverto-backend.onrender.com',
);

/**
 * The versioned prefix every route sits under, kept out of the endpoint paths.
 *
 * `endpoints.ts` writes `/mobile/units/{id}/staff` and `http.ts` prepends this,
 * so the day the service moves to `/api/v2` is a one-line change here rather
 * than a find-and-replace across forty call sites.
 */
export const API_PREFIX = '/api/v1';

/**
 * The WebSocket origin.
 *
 * Derived from `API_URL` unless overridden, because in every environment they
 * are the same service — and a derived value cannot drift out of sync with the
 * REST base the way a second hand-maintained constant would. Socket.IO is
 * given an http(s) origin and negotiates its own upgrade, so unlike a raw
 * WebSocket URL this is deliberately *not* rewritten to ws(s).
 */
export const WS_URL = trimSlash(process.env.EXPO_PUBLIC_WS_URL ?? extra.wsUrl ?? API_URL);

/**
 * Whether this build was actually pointed at a backend.
 *
 * The fallback above keeps the app from crashing on a bare checkout, but a
 * build that fell back to it will fail every request with a connection error
 * that reads like an outage. This flag lets the sign-in screen say the true
 * thing — "this build has no API configured" — instead.
 */
export const API_CONFIGURED = !!(process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl);

/**
 * How long a request may hang before it is treated as an offline failure.
 *
 * Thirty seconds is long for a phone on a good connection and short for a
 * guard holding someone at a barrier. It is this high because the service is
 * deployed on a platform that idles containers out: the first request after a
 * quiet period pays for a cold start, and timing that out would show every
 * morning's first guard an outage that is really a fifteen-second wake-up.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Entry creation and passcode verification carry a base64 photo in the request
 * body, so they are allowed longer than a plain read.
 */
export const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * The approval window, for display only.
 *
 * The server owns the real deadline and sends it as `expiresAt` on every
 * approval; this is only the denominator the countdown ring divides by when a
 * card has no `createdAt` to measure from.
 */
export const APPROVAL_WINDOW_SECONDS = 90;

/** How stale a cached query may be before a foreground refetch replaces it. */
export const STALE_AFTER_MS = 30_000;

/** WebSocket reconnect backoff, capped so a long outage still retries. */
export const WS_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
