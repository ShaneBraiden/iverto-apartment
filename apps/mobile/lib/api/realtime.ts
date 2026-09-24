/**
 * The realtime connection, and the one function that turns a server event into
 * a screen update.
 *
 * Socket.IO, because that is what the service speaks: an http(s) origin and a
 * JWT in the handshake `auth` — the bare token, not a `Bearer` string.
 *
 * **Rooms are not the client's to choose.** The server computes them from the
 * same RBAC grants that govern the REST API, at connect, every time: a unit
 * room for every home you hold a role on, a society room for every society.
 * The one exception is the gate — a guard has to say which barrier they are
 * standing at, and that is a handshake parameter, so changing it means opening
 * a new socket rather than sending a message.
 *
 * **Frames are treated as notifications, not as data.** The service sends rich
 * payloads — a visitor thumbnail, a name, a countdown — and this module reads
 * exactly two things out of them: what kind of thing happened, and which scopes
 * it touched. Everything on screen then comes from a refetch.
 *
 * That is more round trips than rendering the payload, and it is the right
 * trade. A frame carrying state can be stale, out of order, or partial, and the
 * bug that causes is a guard's screen still reading "pending" after the
 * resident pressed Deny. A frame read only for a cache key can be wrong about
 * nothing except timing.
 *
 * `applyServerEvent` is exported for exactly this reason: when FCM lands, the
 * background handler decodes the same payload and calls the same function, so
 * push and socket cannot drift apart.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { WS_URL } from './config';
import { getAccessToken } from './tokens';
import { invalidate } from './query';
import { gateScope, societyScope, unitScope } from './keys';

export type ConnectionState = 'connecting' | 'live' | 'offline';

/**
 * The event names the service emits.
 *
 * Two audiences, and several crossings are announced twice — once to the
 * household and once to the gate, under different names, because the two
 * screens do different things with the same fact. Both are listened for; both
 * end in the same invalidation, so hearing a crossing twice costs one refetch
 * that was already going to happen.
 */
const EVENT_NAMES = [
  /* To the household. */
  'approval.requested',
  'entry.delivery',
  'entry.passcode',
  'staff.status',
  /* To the gate. */
  'passcode.verified',
  /* To both. */
  'approval.decided',
  'entry.exit',
] as const;

export type ServerEvent = {
  type?: string;
  societyId?: string | null;
  gateId?: string | null;
  unitId?: string | null;
  /** A staff arrival fans out to every household that subscribes to them. */
  unitIds?: string[];
  /** The service nests the subject on some frames; ids are read out of all. */
  approval?: { unitId?: string | null; gateId?: string | null } | null;
  approvalRequest?: { unitId?: string | null; gateId?: string | null } | null;
  entryEvent?: {
    unitId?: string | null;
    gateId?: string | null;
    societyId?: string | null;
  } | null;
};

/** Pull every scope id out of a frame, however deeply the service nested it. */
function scopesOf(event: ServerEvent) {
  const units = new Set<string>();
  const gates = new Set<string>();
  const societies = new Set<string>();

  const add = (set: Set<string>, v: string | null | undefined) => {
    if (v) set.add(v);
  };

  for (const id of event.unitIds ?? []) add(units, id);
  add(units, event.unitId);
  add(units, event.approval?.unitId);
  add(units, event.approvalRequest?.unitId);
  add(units, event.entryEvent?.unitId);

  add(gates, event.gateId);
  add(gates, event.approval?.gateId);
  add(gates, event.approvalRequest?.gateId);
  add(gates, event.entryEvent?.gateId);

  add(societies, event.societyId);
  add(societies, event.entryEvent?.societyId);

  return { units: [...units], gates: [...gates], societies: [...societies] };
}

/**
 * Turn one server event into cache invalidations.
 *
 * Deliberately over-invalidates at the scope level rather than reasoning about
 * which list a row belongs in: refetching a unit's four small queries costs
 * less than the class of bug where an event updates the log but not the badge.
 *
 * A frame that names no scope at all still sweeps everything mounted. It is a
 * blunt answer, and it is the correct one — the app has been told something
 * changed and cannot tell where, so the only honest response is to re-ask.
 */
export function applyServerEvent(event: ServerEvent, name?: string) {
  if (!event) return;
  const kind = name ?? event.type ?? '';
  if (kind === 'ping') return;

  const { units, gates, societies } = scopesOf(event);

  for (const id of units) invalidate(unitScope(id));
  for (const id of gates) invalidate(gateScope(id));
  for (const id of societies) invalidate(societyScope(id));

  if (!units.length && !gates.length && !societies.length) {
    invalidate(['unit'], ['gate'], ['society']);
  }
}

/* ------------------------------------------------------------- Connection */

let socket: Socket | null = null;
let wanted = false;
let state: ConnectionState = 'offline';
/**
 * The scope ids that go up in the handshake, set by `AuthProvider` when the
 * active hat changes. Only the gate is load-bearing for an ordinary account —
 * the other two are read by the server for platform superadmins, who hold no
 * membership rows for it to derive rooms from.
 */
let scopes: { unitId?: string | null; gateId?: string | null; societyId?: string | null } = {};

const watchers = new Set<(s: ConnectionState) => void>();

function setState(next: ConnectionState) {
  if (state === next) return;
  state = next;
  watchers.forEach((fn) => fn(next));
}

const scopeKey = (s: typeof scopes) => `${s.unitId ?? ''}|${s.gateId ?? ''}|${s.societyId ?? ''}`;

/**
 * Called by `AuthProvider` when the active context changes.
 *
 * These ids travel in the handshake, so a change to them is a reconnect and not
 * a message. That is the server's design and it is the right one for the gate:
 * a guard who moves to the other barrier must stop hearing the one they left,
 * and a room that could be swapped at runtime is a room a modified client could
 * swap to somewhere it was never entitled to.
 */
export function setRealtimeScopes(next: {
  unitId?: string | null;
  gateId?: string | null;
  societyId?: string | null;
}) {
  if (scopeKey(next) === scopeKey(scopes)) return;
  scopes = next;
  if (socket) {
    disconnect();
    connect();
  }
}

function connect() {
  if (!wanted || socket) return;
  const token = getAccessToken();
  if (!token) {
    setState('offline');
    return;
  }

  setState('connecting');

  const s = io(WS_URL, {
    /* The bare JWT — no `Bearer` prefix here, unlike every REST call. The
       server also accepts an Authorization header or a `?token=` query, and
       refuses the connection outright if none of the three verify.

       `gateId` is how a guard declares which barrier this device is at; the
       server joins that room only if RBAC agrees, and ignores the ask in
       silence if it does not. `unitId`/`societyId` are read only for platform
       superadmins, who have no membership rows to derive rooms from. */
    auth: {
      token,
      ...(scopes.gateId ? { gateId: scopes.gateId } : null),
      ...(scopes.unitId ? { unitId: scopes.unitId } : null),
      ...(scopes.societyId ? { societyId: scopes.societyId } : null),
    },
    transports: ['websocket', 'polling'],
    /* Socket.IO's own backoff, which is what this used to hand-roll. Capped so
       a long outage keeps retrying instead of giving up on the gate screen. */
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    timeout: 20_000,
  });
  socket = s;

  s.on('connect', () => {
    setState('live');
    /* A (re)connect means the app was deaf for a while, so everything on screen
       is suspect. One sweep of the mounted queries costs a few small GETs and
       removes the whole class of "it was already wrong when we reconnected". */
    invalidate(['me'], ['unit'], ['gate'], ['society']);
  });

  s.on('disconnect', () => setState('offline'));
  s.on('connect_error', () => setState('offline'));

  for (const name of EVENT_NAMES) {
    s.on(name, (payload: ServerEvent) => applyServerEvent(payload ?? {}, name));
  }

  /* Anything the service adds later still refreshes the screen, rather than
     being silently dropped until this list is updated. `onAny` does not fire
     for the lifecycle events above, so there is no double handling. */
  s.onAny((name: string, payload: ServerEvent) => {
    if ((EVENT_NAMES as readonly string[]).includes(name)) return;
    if (name === 'ping' || name === 'pong') return;
    applyServerEvent(payload ?? {}, name);
  });
}

function disconnect() {
  const s = socket;
  socket = null;
  if (s) {
    s.removeAllListeners();
    s.disconnect();
  }
  setState('offline');
}

/**
 * Open the socket while the app is in front, close it when it goes away.
 *
 * A socket held open in the background is a battery cost that buys nothing —
 * the app cannot render anything, and push is what wakes it. Called by
 * `AuthProvider` when a session appears and again when it goes.
 */
export function startRealtime() {
  if (wanted) return;
  wanted = true;
  if (AppState.currentState === 'active') connect();
}

export function stopRealtime() {
  wanted = false;
  scopes = {};
  disconnect();
}

AppState.addEventListener('change', (next: AppStateStatus) => {
  if (!wanted) return;
  if (next === 'active') connect();
  else disconnect();
});

/**
 * The connection, for the one banner that shows it.
 *
 * A guard must be *told* when approvals are unavailable rather than left to
 * guess from a screen that simply stops changing — a guard who guesses waves
 * people through.
 */
export function useConnection(): ConnectionState {
  const [value, setValue] = useState(state);
  useEffect(() => {
    watchers.add(setValue);
    setValue(state);
    return () => {
      watchers.delete(setValue);
    };
  }, []);
  return value;
}
