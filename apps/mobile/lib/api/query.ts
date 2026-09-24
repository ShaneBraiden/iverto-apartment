/**
 * A small query cache — the seam the old in-memory store used to sit in.
 *
 * Screens keep the shape they had. `useStore(() => api.getUnitStaff(id))`
 * became `useQuery(keys.unitStaff(id), () => api.getUnitStaff(id))`, and the
 * only real difference is that the result now carries `loading` and `error`,
 * because a network can fail and an object in memory could not.
 *
 * Why this rather than TanStack Query, which §7 names: nothing here needs a
 * dependency. It is one `Map`, a subscriber set per key, and prefix
 * invalidation — about a hundred lines against forty kilobytes of library, and
 * the API surface is deliberately a subset of TanStack's, so moving to it
 * later is an import change and a rename of `loading` to `isLoading`.
 *
 * What it does that matters:
 *   • dedupes — two screens asking for the same key share one request
 *   • serves cached data instantly and refetches behind it, so switching tabs
 *     never shows a spinner over data the app already has
 *   • refetches everything on foreground (§7's "pending queue on app open")
 *   • invalidates by key prefix, which is how a WebSocket frame or a mutation
 *     tells the app what moved
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import { STALE_AFTER_MS } from './config';
import { errorCopy } from '@/lib/errors';
import type { QueryKey } from './keys';

/* ------------------------------------------------------------------ Cache */

type Entry = {
  data?: unknown;
  error?: unknown;
  updatedAt: number;
  /** The in-flight request, so a second caller joins it instead of starting one. */
  promise?: Promise<unknown>;
  /** Latest fetcher seen for this key — used by `invalidate`, which has none. */
  fetcher?: () => Promise<unknown>;
};

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

/** `['unit','a402','staff']` → `unit|a402|staff`. Prefix match is a substring. */
const hash = (key: QueryKey) => key.map((k) => String(k ?? '')).join('|');

function entryOf(k: string): Entry {
  let e = cache.get(k);
  if (!e) {
    e = { updatedAt: 0 };
    cache.set(k, e);
  }
  return e;
}

function notify(k: string) {
  listeners.get(k)?.forEach((fn) => fn());
}

function subscribe(k: string, fn: () => void) {
  let set = listeners.get(k);
  if (!set) {
    set = new Set();
    listeners.set(k, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) listeners.delete(k);
  };
}

/**
 * Run the fetcher for a key, or join the one already running.
 *
 * A failed fetch keeps whatever data was already there. A guard whose gate log
 * loaded a minute ago and whose phone just lost signal should still be able to
 * read it — replacing it with an error screen would be throwing away the only
 * copy of information they still need.
 */
function load(k: string, fetcher: () => Promise<unknown>): Promise<unknown> {
  const e = entryOf(k);
  if (e.promise) return e.promise;
  e.fetcher = fetcher;
  const p = fetcher()
    .then((data) => {
      e.data = data;
      e.error = undefined;
      e.updatedAt = Date.now();
      return data;
    })
    .catch((err) => {
      e.error = err;
      e.updatedAt = Date.now();
      throw err;
    })
    .finally(() => {
      e.promise = undefined;
      notify(k);
    });
  e.promise = p;
  notify(k);
  /* Swallowed here so an invalidation storm cannot produce an unhandled
     rejection; every caller reads the error off the entry instead. */
  return p.catch(() => undefined);
}

/* ------------------------------------------------------------ Invalidation */

/**
 * Refetch every mounted query whose key starts with this prefix.
 *
 * Unmounted keys are dropped rather than refetched — refetching a screen
 * nobody is looking at is a request the user pays for and never sees. They
 * reload on next mount because their cached entry is gone.
 */
export function invalidate(...prefixes: QueryKey[]) {
  for (const prefix of prefixes) {
    const p = hash(prefix);
    for (const k of [...cache.keys()]) {
      if (k !== p && !k.startsWith(`${p}|`)) continue;
      const e = cache.get(k)!;
      if (listeners.has(k) && e.fetcher) load(k, e.fetcher);
      else cache.delete(k);
    }
  }
}

/**
 * Drop everything. Sign-out, and context switches that change scope.
 *
 * The generation counter is what makes this safe. Clearing the map alone would
 * leave every mounted screen holding a key whose entry no longer exists and no
 * reason to ask again — a permanent spinner on the screen the user is looking
 * at. Bumping the generation puts it in `useQuery`'s effect deps, so every
 * mounted query re-registers and refetches under the new session or the new
 * context.
 */
export function clearCache() {
  cache.clear();
  generation += 1;
  listeners.forEach((set) => set.forEach((fn) => fn()));
  globalListeners.forEach((fn) => fn());
}

let generation = 0;
const globalListeners = new Set<() => void>();

function subscribeGlobal(fn: () => void) {
  globalListeners.add(fn);
  return () => {
    globalListeners.delete(fn);
  };
}

/**
 * Write into the cache without a request.
 *
 * Used where the server's response to a mutation *is* the new state of a row —
 * `decideApproval` returns the decided approval — so the screen can show the
 * verdict on the same frame as the tap rather than after a round trip.
 */
export function setQueryData<T>(key: QueryKey, updater: T | ((prev: T | undefined) => T)) {
  const k = hash(key);
  const e = entryOf(k);
  e.data =
    typeof updater === 'function' ? (updater as (p: T | undefined) => T)(e.data as T) : updater;
  e.updatedAt = Date.now();
  e.error = undefined;
  notify(k);
}

export function getQueryData<T>(key: QueryKey): T | undefined {
  return cache.get(hash(key))?.data as T | undefined;
}

/* ------------------------------------------------------- Foreground refetch */

/**
 * §7: `GET /v1/me/pending` on every foreground, so a lost push costs the
 * resident nothing more than the time between the phone waking and the screen
 * drawing. Every other mounted query rides along — they are all cheap reads
 * and the alternative is a screen showing a state the gate has moved past.
 */
let appState: AppStateStatus = AppState.currentState;
AppState.addEventListener('change', (next) => {
  const woke = appState.match(/inactive|background/) && next === 'active';
  appState = next;
  if (!woke) return;
  for (const [k, e] of cache) {
    if (listeners.has(k) && e.fetcher) load(k, e.fetcher);
  }
});

/* ------------------------------------------------------------------ Hooks */

export type QueryResult<T> = {
  data: T | undefined;
  error: unknown;
  /** First load, nothing to show yet. */
  loading: boolean;
  /** A refetch behind data that is already on screen. */
  refreshing: boolean;
  refetch: () => void;
};

export function useQuery<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  options: { enabled?: boolean } = {},
): QueryResult<T> {
  const { enabled = true } = options;
  const k = hash(key);

  /* The fetcher is a fresh closure every render; keeping it in a ref means the
     effect below depends on the key alone and does not refire on every render
     of the parent. */
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  /* Re-runs the effect below when the whole cache is dropped. */
  const [gen, setGen] = useState(generation);
  useEffect(() => subscribeGlobal(() => setGen(generation)), []);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribe(k, rerender);
    const e = entryOf(k);
    e.fetcher = () => fetcherRef.current();
    const fresh = e.data !== undefined && Date.now() - e.updatedAt < STALE_AFTER_MS;
    if (!fresh && !e.promise) load(k, e.fetcher);
    return unsubscribe;
  }, [k, enabled, gen, rerender]);

  const e = cache.get(k);
  const refetch = useCallback(() => {
    const entry = entryOf(k);
    if (entry.fetcher) load(k, entry.fetcher);
  }, [k]);

  return {
    data: e?.data as T | undefined,
    error: e?.data === undefined ? e?.error : undefined,
    loading: !!enabled && e?.data === undefined && (!!e?.promise || !e?.error),
    refreshing: !!e?.promise && e?.data !== undefined,
    refetch,
  };
}

/* -------------------------------------------------------------- Mutations */

export type MutationResult<A extends unknown[], R> = {
  /** Never throws. The error lands on `.error` and, by default, in an alert. */
  mutate: (...args: A) => Promise<R | undefined>;
  loading: boolean;
  error: unknown;
};

/**
 * A write, plus what it invalidates.
 *
 * The default failure behaviour is an alert worded by `lib/errors.ts`, because
 * the alternative — a tap that silently does nothing — is the failure mode
 * that makes a guard press the button four times and admit four people. Pass
 * `onError` to handle it inline instead.
 */
export function useMutation<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: {
    invalidates?: QueryKey[] | ((result: R, ...args: A) => QueryKey[]);
    onSuccess?: (result: R, ...args: A) => void;
    onError?: (error: unknown) => void;
    /** Suppress the default alert without writing an `onError`. */
    silent?: boolean;
  } = {},
): MutationResult<A, R> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  /**
   * Both the writer and its options are held in refs, and both for the same
   * reason: `mutate` is a stable identity (`[]` deps) so that passing it to a
   * button does not re-render the tree, and a stable callback closes over the
   * *first* render's values for ever.
   *
   * `fn` typically reads a screen's state — the flat the guard picked, the
   * validity the resident chose — so calling last render's copy would silently
   * send the state the form had when it mounted. Empty, in other words.
   */
  const call = useRef(fn);
  call.current = fn;
  const opts = useRef(options);
  opts.current = options;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const mutate = useCallback(async (...args: A) => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await call.current(...args);
      const { invalidates, onSuccess } = opts.current;
      const list = typeof invalidates === 'function' ? invalidates(result, ...args) : invalidates;
      if (list?.length) invalidate(...list);
      onSuccess?.(result, ...args);
      return result;
    } catch (e) {
      if (alive.current) setError(e);
      if (opts.current.onError) opts.current.onError(e);
      else if (!opts.current.silent) {
        const copy = errorCopy(e);
        Alert.alert(copy.title, copy.message);
      }
      return undefined;
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mutate, loading, error };
}

/**
 * A clock that ticks only while something is watching it.
 *
 * Approval cards count down to their expiry, and the countdown has to be
 * visibly moving for a guard to trust that the ninety seconds are real. Any
 * screen without a live countdown never calls this, so nothing re-renders once
 * a second in the background.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
