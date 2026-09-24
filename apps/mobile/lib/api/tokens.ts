/**
 * Where the session lives.
 *
 * One token. `POST /api/v1/auth/login` returns a single `accessToken` and the
 * service exposes no refresh endpoint, so there is nothing to rotate and
 * nothing to exchange: the token is good until the server stops accepting it,
 * and the first 401 after that is the end of the session.
 *
 * It is held in the keystore and mirrored in memory because every request
 * needs it and `SecureStore` is an async native call — awaiting a disk read
 * per request would put it on the critical path of the one flow that is timed
 * in seconds. The mirror is written *after* the keystore write succeeds, so a
 * failed persist can never leave the app authenticated against a session that
 * will be gone on next launch.
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'gate.access';
const USER_KEY = 'gate.user';

let access: string | null = null;

/** Read the stored session off disk. Called once, at cold start. */
export async function loadToken(): Promise<string | null> {
  try {
    const a = await SecureStore.getItemAsync(ACCESS_KEY);
    if (!a) return null;
    access = a;
    return a;
  } catch {
    /* An unreadable keystore entry is a signed-out user, not a crash. */
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, token);
  access = token;
}

export async function clearTokens(): Promise<void> {
  access = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(USER_KEY).catch(() => {}),
  ]);
}

export const getAccessToken = () => access;

/**
 * The signed-in person, cached beside the token.
 *
 * Login returns the user, and nothing else in the app needs a round trip to
 * learn their own name — so it is stored rather than refetched, and rewritten
 * whenever a login or a password change returns a fresh copy.
 */
export async function saveUser(user: unknown): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)).catch(() => {});
}

export async function loadUser<T>(): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- Session expiry */

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Fires when the token is refused — the session is over and no retry will
 * help. `AuthProvider` subscribes and signs the user out; the transport stays
 * ignorant of navigation, which is the only reason this event exists rather
 * than a direct call.
 */
export function onSessionExpired(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitSessionExpired() {
  listeners.forEach((fn) => fn());
}
