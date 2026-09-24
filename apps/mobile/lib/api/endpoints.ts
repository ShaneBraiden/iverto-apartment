/**
 * Every call the app makes, one function each.
 *
 * The paths are the deployed service's, read off `mobile-api-documentation.md`
 * and checked against the live OpenAPI document at `/api/docs-json`. Three
 * groups, and the difference between them is the difference between code you
 * can trust and code you have to watch:
 *
 *   • **Mobile** (`/mobile/...`) — documented *and* deployed. Everything the
 *     resident and guard shells run on.
 *   • **Missing** — documented but not deployed; the deployment answers 404.
 *     These return `null` rather than throwing, so a screen can tell "this
 *     backend does not have it" apart from "there is nothing here", and say so.
 *   • **Web** (`/web/...`) — deployed, but with no documented response shape.
 *     Only the admin shell touches these, every reader is defensive, and
 *     `API.md` says plainly that the shapes are unverified.
 *
 * Rules this file keeps:
 *   • no state — a function takes ids and returns a promise; nothing is cached
 *     here (that is `query.ts`) and nothing is remembered between calls
 *   • no business logic — the delivery-permission resolution runs on the
 *     server and the response says what it decided (`autoApproved`, `mode`),
 *     because a rule the client evaluates is a rule an attacker edits. The
 *     *sentence* about it is the client's, in `lib/status.ts`; the decision
 *     never is.
 *   • no invention — where a response has no field for something a screen used
 *     to show, the screen stops showing it. See `UnitStaff` in `types`.
 */
import { ApiError, buildUrl, del, get, idempotencyKey, patch, post, put, request } from './http';
import { UPLOAD_TIMEOUT_MS } from './config';
import { getAccessToken } from './tokens';
import type {
  ApprovalRequest,
  Context,
  DeliveryPermission,
  Device,
  DeviceHealth,
  DirectoryUnit,
  EntryEvent,
  EntryEventResult,
  Page,
  Passcode,
  PasscodeVerification,
  Platform,
  SocietyRole,
  Staff,
  StaffType,
  Unit,
  UnitRole,
  UnitStaff,
  User,
} from '@/types';

/**
 * How long a terminal may stay silent before the admin shell calls it sick.
 *
 * Applied on the client rather than the server so the counter keeps moving
 * while somebody watches it, instead of freezing between refetches.
 */
const HEARTBEAT_STALE_MINUTES = 5;

/**
 * A read whose route this deployment has not shipped.
 *
 * Returns `null` on 404 and rethrows everything else, so a screen can render
 * "not available from this backend" for the first and a real error state for
 * the second. Swallowing both into `[]` would make a missing endpoint look
 * like an empty list, which is the one thing this cannot be allowed to do.
 */
async function optional<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (e) {
    if (e && typeof e === 'object' && (e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/* -------------------------------------------------------------------- Auth */

/**
 * Like `optional`, but swallows *every* failure, not only a 404.
 *
 * Only for the joins below, where a second request decorates a first one. The
 * queue of people waiting at a gate must not disappear because the call that
 * would have named them timed out — a card that says "Visitor" is degraded;
 * an empty queue is wrong.
 */
async function soft<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- Wire → app shapes */

/**
 * Lift out of `rawPayload` the one field screens read.
 *
 * The service keeps the delivery platform inside the event's untyped payload
 * bag. Every screen wants it beside `subjectType`, and doing that here — once,
 * at the edge — is what keeps `rawPayload` from being indexed into in a dozen
 * render functions where a shape change would be found one screen at a time.
 */
function normaliseEvent<T extends EntryEvent>(event: T): T {
  if (!event) return event;
  const raw = event.rawPayload as Record<string, unknown> | null | undefined;
  const fromPayload = typeof raw?.platform === 'string' ? (raw.platform as Platform) : null;
  return { ...event, platform: event.platform ?? fromPayload };
}

/**
 * Put the visitor back on the approval.
 *
 * `approval_requests` rows carry an `entryEventId` and nothing else about who
 * is standing at the barrier, so the name, the number, the kind of arrival and
 * the flat are joined on here from whatever the caller could fetch. Existing
 * fields win: a deployment that denormalises them onto the row is not
 * overwritten by a join that found less.
 */
function withSubject(
  approval: ApprovalRequest,
  event?: EntryEvent | null,
  unitNumber?: string | null,
): ApprovalRequest {
  return {
    ...approval,
    visitorName: approval.visitorName ?? event?.visitorName ?? null,
    visitorPhone: approval.visitorPhone ?? event?.visitorPhone ?? null,
    subjectType: approval.subjectType ?? event?.subjectType ?? null,
    platform: approval.platform ?? event?.platform ?? null,
    unitNumber: approval.unitNumber ?? unitNumber ?? null,
  };
}

export type Session = { accessToken: string; user: User };

/**
 * `POST /auth/login`.
 *
 * Email and password — the society office onboards a resident with a temporary
 * password of `<phone>@iverto` and the account comes back with
 * `mustChangePassword: true` until it is replaced. `AuthProvider` is what
 * enforces that; this function only reports it.
 */
export const login = (email: string, password: string) =>
  post<Session>(
    '/auth/login',
    { email: email.trim().toLowerCase(), password },
    { anonymous: true },
  );

/**
 * `POST /auth/change-password` — the mandatory first-login reset.
 *
 * Answers with a *fresh* token as well as the updated user, because the old
 * one carries the must-change claim. Storing the new one is the caller's job
 * and is not optional: keep the old token and every subsequent request is
 * authenticated as an account that still has to change its password.
 */
export const changePassword = (newPassword: string) =>
  post<Session & { message?: string }>('/auth/change-password', { newPassword });

/* ---------------------------------------------------------------------- Me */

/** The raw shape of `GET /mobile/me/contexts`, before it is flattened. */
type ContextsResponse = {
  units?: {
    id: string;
    unitId: string;
    role: UnitRole;
    isPrimary?: boolean;
    unitNumber: string;
    buildingId?: string | null;
    buildingName?: string | null;
    societyId: string;
    societyName?: string | null;
  }[];
  societies?: {
    id: string;
    societyId: string;
    role: SocietyRole;
    societyName?: string | null;
    /**
     * A gate posting hung off the society row.
     *
     * Not in the documented shape, and read anyway. A service adding gate
     * support to a response that already has a `societies` array is at least
     * as likely to decorate the guard's existing row as to add a fourth
     * array, and the cost of understanding both is six lines here against a
     * guard shell that will not open.
     */
    gateId?: string | null;
    gateName?: string | null;
    gate?: { id?: string | null; name?: string | null; gateId?: string | null } | null;
  }[];
  /**
   * Gate postings. The documented response describes gate roles but its
   * example omits the array, so it is read where present and its absence is a
   * state the app names rather than a crash. Without a `gateId` there is no
   * guard shell — every call it makes is `/mobile/gates/{gateId}/…`.
   *
   * Every field is optional because this array is the least pinned-down part
   * of the response: it is read for whatever it carries and the row is dropped
   * only when there is no gate id in it anywhere. See `gateRowsOf`.
   */
  gates?: {
    id?: string | null;
    gateId?: string | null;
    gateName?: string | null;
    name?: string | null;
    societyId?: string | null;
    societyName?: string | null;
    role?: 'GUARD' | 'GUARD_SUPERVISOR' | null;
    gate?: { id?: string | null; name?: string | null; gateId?: string | null } | null;
  }[];
  /** Some deployments name it this instead. Same rows, same reader. */
  gateAssignments?: ContextsResponse['gates'];
};

/** A gate posting, after the shapes above have been folded into one. */
type GateRow = {
  id: string;
  gateId: string;
  gateName: string | null;
  societyId: string;
  societyName: string | null;
  role: 'GUARD' | 'GUARD_SUPERVISOR';
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/**
 * Every gate this response describes, however it chose to describe it.
 *
 * Deliberately generous, and deliberately strict about one thing: a row is
 * kept only if a `gateId` can be found in it. That id is the whole of the
 * guard shell — a context without one produces a screen whose every request is
 * `/mobile/gates/undefined/…`.
 *
 * The `id` is synthesised from the gate when the row carries none of its own.
 * It is the value `AuthProvider` persists as the chosen context and matches
 * against on the next launch, so it has to exist and has to be stable; an
 * `undefined` here is not a missing label but a guard who signs in, is handed
 * a context list of one, and is told "no gate assigned" because nothing in it
 * could be selected.
 */
function gateRowsOf(data: ContextsResponse): GateRow[] {
  const rows = [...(data.gates ?? []), ...(data.gateAssignments ?? [])];
  const out: GateRow[] = [];

  for (const g of rows) {
    const gateId = str(g.gateId) ?? str(g.gate?.gateId) ?? str(g.gate?.id);
    if (!gateId) continue;
    out.push({
      id: str(g.id) ?? `gate:${gateId}`,
      gateId,
      gateName: str(g.gateName) ?? str(g.name) ?? str(g.gate?.name),
      societyId: str(g.societyId) ?? '',
      societyName: str(g.societyName),
      role: g.role === 'GUARD_SUPERVISOR' ? 'GUARD_SUPERVISOR' : 'GUARD',
    });
  }

  /* A posting decorating the society row instead of standing on its own. */
  for (const s of data.societies ?? []) {
    if (s.role !== 'GUARD' && s.role !== 'GUARD_SUPERVISOR') continue;
    const gateId = str(s.gateId) ?? str(s.gate?.gateId) ?? str(s.gate?.id);
    if (!gateId || out.some((r) => r.gateId === gateId)) continue;
    out.push({
      id: `gate:${gateId}`,
      gateId,
      gateName: str(s.gateName) ?? str(s.gate?.name),
      societyId: str(s.societyId) ?? '',
      societyName: str(s.societyName),
      role: s.role,
    });
  }

  /**
   * A gate row that named no society, given the only one it could belong to.
   *
   * `societyId` is what the switcher dedupes on and what the socket handshake
   * carries, and a row missing it would leave a guard with both a working gate
   * context *and* a society context that resolves to "No gate assigned" —
   * sitting next to each other in the same list. Only done when there is
   * exactly one society to attribute it to, because a guess between two would
   * be worse than the blank.
   */
  const societies = data.societies ?? [];
  if (societies.length === 1) {
    const only = str(societies[0].societyId);
    if (only) {
      for (const row of out) {
        if (!row.societyId) row.societyId = only;
        row.societyName = row.societyName ?? str(societies[0].societyName);
      }
    }
  }

  return out;
}

/**
 * `GET /mobile/me/contexts` — every hat this person wears.
 *
 * Never read from the token. Roles change while a session is alive — a tenant
 * moves out, a guard's posting ends — and a JWT minted an hour ago would still
 * be claiming the old one.
 *
 * The response is three parallel arrays; the app wants one list, because the
 * switcher renders a list and the router picks a shell from a single active
 * row. Flattening here means no screen ever sees the wire's shape.
 */
export async function getContexts(): Promise<Context[]> {
  const data = (await get<ContextsResponse>('/mobile/me/contexts')) ?? {};
  const out: Context[] = [];

  for (const u of data.units ?? []) {
    out.push({
      type: 'UNIT',
      id: u.id,
      unitId: u.unitId,
      societyId: u.societyId,
      label: u.unitNumber,
      sublabel: u.societyName ?? u.buildingName ?? 'Your society',
      role: u.role,
      buildingName: u.buildingName ?? null,
      isPrimary: u.isPrimary ?? false,
    });
  }

  const gates = gateRowsOf(data);
  for (const g of gates) {
    out.push({
      type: 'GATE',
      id: g.id,
      gateId: g.gateId,
      societyId: g.societyId,
      label: g.gateName ?? 'Gate',
      sublabel: g.societyName ?? 'Your society',
      role: g.role,
    });
  }

  for (const s of data.societies ?? []) {
    /* A guard's society row, once their gate posting has been read out of it,
       is a hat with no shell behind it: `shellFor` sends a non-admin SOCIETY
       context to `unassigned`, so keeping it would put "No gate assigned" in
       the switcher beside the gate that is working. Supervisors keep theirs —
       `entry.view@SOCIETY` and the roster are society-wide. */
    if (s.role === 'GUARD' && gates.some((g) => g.societyId === s.societyId)) continue;
    out.push({
      type: 'SOCIETY',
      id: s.id,
      societyId: s.societyId,
      label: s.societyName ?? 'Society',
      sublabel: s.societyName ?? 'Society',
      role: s.role,
    });
  }

  /* The household first. Someone who is both a resident and a guard opens the
     app far more often as a resident, and the first row is what a cold start
     with no saved choice lands on. */
  const rank = { UNIT: 0, GATE: 1, SOCIETY: 2 } as const;
  return out.sort((a, b) => rank[a.type] - rank[b.type]);
}

/**
 * `POST /mobile/me/device-token` — register for visitor push alerts.
 *
 * Nothing calls this yet: no FCM dependency is installed, so the app has no
 * token to register. It is written now, against the documented body, so that
 * adding push is a call site rather than an integration.
 */
export const registerDeviceToken = (fcmToken: string, platform: 'android' | 'ios' | 'web') =>
  post<{
    id: string;
    userId: string;
    fcmToken: string;
    platform: string;
    createdAt?: string;
    updatedAt: string;
  }>(
    '/mobile/me/device-token',
    { fcmToken, platform },
  );

/* ------------------------------------------------------------------- Units */

/**
 * `GET /mobile/units/{unitId}/pending` — who is at the gate for this home.
 *
 * Per-unit, not per-user. There is no account-wide pending feed on this
 * service, so a person with two homes has two queries and the tab badge counts
 * the one they are currently acting as — which is also the only one whose
 * approvals they could act on without switching.
 *
 * The response is the bare approval row: an id, a status, a deadline, and the
 * id of an entry event it will not tell you about. A card built from that alone
 * asks a household to admit "Visitor", which is not a decision anybody can
 * make — so one page of the home's log is fetched alongside and joined on
 * `entryEventId`.
 *
 * Only when something is actually waiting, so the common case stays one
 * request; and through `soft`, so a slow log degrades the card to a generic
 * title instead of emptying the queue.
 */
export async function getUnitPending(unitId: string): Promise<ApprovalRequest[]> {
  const pending = (await get<ApprovalRequest[]>(`/mobile/units/${unitId}/pending`)) ?? [];
  if (!pending.length) return [];

  /* One page is enough. An approval lives ninety seconds, so its entry event is
     by construction among the newest rows this home has. */
  const recent = await soft(getUnitEntryEvents(unitId, 1, 30));
  const byId = new Map((recent?.items ?? []).map((e) => [e.id, e]));
  return pending.map((a) => withSubject(a, byId.get(a.entryEventId)));
}

/**
 * `POST /mobile/units/{unitId}/approvals/{id}/decide`.
 *
 * First decision wins, server-side. A 409 here is not an error to apologise
 * for — it means a family member answered first — and the message the server
 * sends is shown as-is, because that is the truth the resident needs.
 *
 * The idempotency key is the approval, not the attempt: a request has one
 * decision, so a resubmitted tap is the same fact rather than a second one.
 */
export const decideApproval = (
  unitId: string,
  approvalId: string,
  decision: 'APPROVED' | 'REJECTED',
) =>
  post<ApprovalRequest>(
    `/mobile/units/${unitId}/approvals/${approvalId}/decide`,
    { decision },
    { idempotencyKey: `decide-${approvalId}` },
  );

/**
 * `GET /mobile/units/{unitId}/entry-events` — this home's log, newest first.
 *
 * Returns the page envelope rather than unwrapping it, because `total` is what
 * lets a screen say "42 entries" without counting the twenty it was sent.
 *
 * A completed visit is two rows — an IN and a later OUT that names it in
 * `rawPayload.originalEntryId` — not one row that changed. The log draws both,
 * which is what an append-only record looks like when you read it.
 */
export async function getUnitEntryEvents(
  unitId: string,
  page = 1,
  limit = 20,
): Promise<Page<EntryEvent>> {
  const res = await get<Page<EntryEvent>>(`/mobile/units/${unitId}/entry-events`, {
    page,
    limit,
  });
  return { ...res, items: (res?.items ?? []).map(normaliseEvent) };
}

/**
 * `GET /mobile/units/{unitId}/staff` — the household's people, with the mute.
 *
 * `notify` belongs to the assignment, not the person: one house help serving
 * four homes is four rows here, each independently silenced.
 */
export const getUnitStaff = (unitId: string) =>
  get<UnitStaff[]>(`/mobile/units/${unitId}/staff`);

/** `POST /mobile/units/{unitId}/staff` — subscribe this home to a staff member. */
export const assignStaff = (unitId: string, staffId: string, notify = true) =>
  post<{ id: string; staffId: string; unitId: string; notify: boolean; activeFrom: string }>(
    `/mobile/units/${unitId}/staff`,
    { staffId, notify },
  );

/** `DELETE /mobile/units/{unitId}/staff/{staffId}` — end-dated, not deleted. */
export const unassignStaff = (unitId: string, staffId: string) =>
  del<unknown>(`/mobile/units/${unitId}/staff/${staffId}`);

/**
 * The per-household mute.
 *
 * There is no endpoint that patches an assignment, so this re-posts the
 * assignment with the new flag — which is what the documented create body's
 * `notify` field is for. It is an upsert on the service's side, so the
 * subscription is not interrupted and `activeFrom` is the only thing that can
 * move. Called out here because "toggle a switch" reaching for a POST that
 * creates something is otherwise a thing you would call a bug on sight.
 */
export const setStaffNotify = (unitId: string, staffId: string, notify: boolean) =>
  assignStaff(unitId, staffId, notify);

/**
 * `GET /mobile/units/{unitId}/society-staff` — the roster a home can add from.
 *
 * **Documented, not deployed.** Answers 404 today, which comes back as `null`
 * so the add-staff sheet can say the register is unavailable instead of
 * showing an empty list that reads as "nobody is registered".
 */
export const getSocietyStaffRoster = (unitId: string) =>
  optional(get<Staff[]>(`/mobile/units/${unitId}/society-staff`));

/* --------------------------------------------------------- Delivery rules */

export const getDeliveryPermissions = (unitId: string) =>
  get<DeliveryPermission[]>(`/mobile/units/${unitId}/delivery-permissions`);

/**
 * `PUT /mobile/units/{unitId}/delivery-permissions/{platform}`.
 *
 * The server, not this app, decides what a rule means at the moment a parcel
 * arrives — including the fallback where anything outside the window becomes
 * ASK_ME regardless of mode. The client's only job is to store what the
 * resident chose.
 *
 * ASK_ME is written as a rule rather than expressed by deleting one, because
 * this service has no delete on this resource. That is a real difference from
 * the ideal: a stored ASK_ME row is a row an audit of "who allowed what" has
 * to know to ignore.
 */
export const setDeliveryPermission = (unitId: string, rule: DeliveryPermission) =>
  put<DeliveryPermission>(
    `/mobile/units/${unitId}/delivery-permissions/${rule.platform}`,
    {
      mode: rule.mode,
      windowStart: rule.windowStart,
      windowEnd: rule.windowEnd,
      silent: rule.silent,
    },
  );

/* --------------------------------------------------------------- Passcodes */

export const getPasscodes = (unitId: string) =>
  get<Passcode[]>(`/mobile/units/${unitId}/passcodes`);

/**
 * `POST /mobile/units/{unitId}/passcodes`.
 *
 * The code is omitted so the server mints it — a six-digit code a client chose
 * is a code a client can predict. The validity window is sent as absolute
 * instants rather than a duration, so a phone with a skewed clock produces a
 * wrong window openly instead of a right-looking one the server reinterprets.
 */
export const createPasscode = (unitId: string, input: { hours: number; maxUses: number }) => {
  const now = new Date();
  return post<Passcode>(`/mobile/units/${unitId}/passcodes`, {
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + input.hours * 3_600_000).toISOString(),
    maxUses: input.maxUses,
  });
};

/** `DELETE /mobile/units/{unitId}/passcodes/{id}` — revoke, not delete. */
export const revokePasscode = (unitId: string, passcodeId: string) =>
  del<unknown>(`/mobile/units/${unitId}/passcodes/${passcodeId}`);

/* -------------------------------------------------------------------- Gates */

/**
 * `GET /mobile/gates/{gateId}/directory` — flats, residents, numbers.
 *
 * `query` is always sent, empty for the unfiltered list, because the route
 * declares the parameter rather than treating it as optional. The search runs
 * server-side: the directory of a large society is not something to pull down
 * in full onto the least trusted device in the system.
 */
export const getGateDirectory = (gateId: string, query = '') =>
  get<DirectoryUnit[]>(`/mobile/gates/${gateId}/directory`, { query });

/**
 * `GET /mobile/gates/{gateId}/staff` — the society register, at the gate.
 *
 * **Documented, not deployed.** `null` on 404; see `getSocietyStaffRoster`.
 */
export const getGateStaff = (gateId: string, status = 'ACTIVE') =>
  optional(get<Staff[]>(`/mobile/gates/${gateId}/staff`, { status }));

/**
 * `GET /mobile/gates/{gateId}/pending` — the guard's queue, every flat at once.
 *
 * Shaped differently from the resident's queue: rows arrive as
 * `{approval, entryEvent}` because this one does join the event in. Flattened
 * here so both shells hand `ApprovalCard` the same object — a card that took
 * two shapes is a card that eventually renders one of them wrong.
 *
 * The flat number is the one thing a guard reads off this card and the one
 * thing the queue does not carry, so the directory is fetched to supply it —
 * only when something is waiting, and softly, because losing a door number is
 * survivable and losing the queue is not.
 */
export async function getGatePending(gateId: string): Promise<ApprovalRequest[]> {
  type Row = { approval?: ApprovalRequest; entryEvent?: EntryEvent | null } & Partial<ApprovalRequest>;
  const rows = (await get<Row[]>(`/mobile/gates/${gateId}/pending`)) ?? [];
  if (!rows.length) return [];

  const directory = await soft(getGateDirectory(gateId, ''));
  const doors = new Map((directory ?? []).map((u) => [u.unitId, u.unitNumber]));

  return rows.flatMap((row) => {
    /* A deployment that answers with flat approvals is still understood. */
    const approval = (row.approval ?? (row.id ? (row as ApprovalRequest) : null)) as
      | ApprovalRequest
      | null;
    if (!approval) return [];
    const event = row.entryEvent ? normaliseEvent(row.entryEvent) : null;
    return [withSubject(approval, event, doors.get(approval.unitId) ?? null)];
  });
}

/**
 * `POST /mobile/gates/{gateId}/entry-events` — the guard raising someone.
 *
 * The photo goes up inline as base64 in the request body. That is the service's
 * design, not a choice made here, and it is why this call gets the longer
 * timeout: a JPEG inflates by a third in base64 and it is on the critical path
 * of a request a guard is standing and waiting on. `quality` at the camera is
 * what keeps that body small enough to send over gate wifi.
 *
 * The response is the whole outcome — the event, the approval if a household is
 * being asked, and `mode` if a standing rule answered instead. On a scan with
 * nothing to decide there is no approval key at all, which is why the result is
 * read defensively rather than destructured.
 */
export async function createEntryEvent(
  gateId: string,
  input: {
    unitId: string;
    visitorName: string;
    visitorPhone?: string | null;
    subjectType: 'VISITOR' | 'DELIVERY';
    platform?: Platform | null;
    photoBase64?: string | null;
    mimeType?: string | null;
  },
  key: string,
): Promise<EntryEventResult> {
  const res = await post<EntryEventResult & { approval?: ApprovalRequest | null }>(
    `/mobile/gates/${gateId}/entry-events`,
    input,
    { idempotencyKey: key, timeoutMs: UPLOAD_TIMEOUT_MS },
  );

  const event = normaliseEvent(res.entryEvent);
  /* `approval` was the old key for it; both are read so a mid-flight backend
     rollback does not blank the guard's card. */
  const approval = res.approvalRequest ?? res.approval ?? null;
  return {
    ...res,
    entryEvent: event,
    /* The event that was just created *is* the subject of its own approval, so
       the card is complete without a second call. */
    approvalRequest: approval ? withSubject(approval, event) : null,
  };
}

/**
 * `POST /mobile/gates/{gateId}/passcodes/verify`.
 *
 * Verifying spends one of the code's uses and writes an entry event, so it is a
 * mutation and not a lookup. Takes the six digits or the `qrToken` UUID from a
 * scan in the same field; the service tells them apart.
 *
 * A rejected code comes back `401` with a sentence naming which kind of
 * rejection. That is turned into an answer here — `valid: false` and the
 * server's own words — under `allow401`, so it does not trip the session-ended
 * path in `http.ts`. Everything else still raises: a `429` is the gate being
 * rate-limited, which is a failure the guard must be told about rather than a
 * verdict on the guest.
 *
 * The key comes from the caller and is held for the length of one attempt: it
 * cannot be derived from the code, because a two-use code legitimately
 * verified twice would collapse into one.
 */
export async function verifyPasscode(
  gateId: string,
  codeOrQrToken: string,
  key: string,
  photoBase64?: string | null,
): Promise<PasscodeVerification> {
  type Wire = {
    verified?: boolean;
    valid?: boolean;
    message?: string;
    entryEvent?: EntryEvent | null;
    unitId?: string | null;
  };

  try {
    const res = await post<Wire>(
      `/mobile/gates/${gateId}/passcodes/verify`,
      { codeOrQrToken: codeOrQrToken.trim(), photoBase64: photoBase64 ?? undefined },
      {
        idempotencyKey: key,
        timeoutMs: photoBase64 ? UPLOAD_TIMEOUT_MS : undefined,
        allow401: true,
      },
    );
    const valid = res.verified ?? res.valid ?? false;
    const event = res.entryEvent ? normaliseEvent(res.entryEvent) : null;
    return {
      valid,
      message:
        res.message ??
        (valid ? 'Code checked out. Let them in.' : 'That code was not accepted.'),
      entryEvent: event,
      unitId: res.unitId ?? event?.unitId ?? null,
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { valid: false, message: e.message, entryEvent: null, unitId: null };
    }
    throw e;
  }
}

/**
 * `POST /mobile/gates/{gateId}/entry-events/{id}/exit` — closes an open entry.
 *
 * Writes a *new* OUT row naming the original in `rawPayload.originalEntryId`;
 * the IN row is never touched. A 404 here means the id is not this gate's to
 * close, which reads the same as one that never existed — see `API.md`.
 *
 * The key is derived from the entry rather than generated, because an entry has
 * exactly one exit: any retry — this guard pressing twice, the next shift
 * closing the same row — carries the same key.
 */
export const markExit = async (gateId: string, entryEventId: string) =>
  normaliseEvent(
    await post<EntryEvent>(
      `/mobile/gates/${gateId}/entry-events/${entryEventId}/exit`,
      undefined,
      { idempotencyKey: `exit-${entryEventId}` },
    ),
  );

/* -------------------------------------------------------------- Entry photo */

/**
 * An `<Image source>` for a captured visitor photo.
 *
 * The route serves JPEG bytes behind the same bearer token as everything else,
 * so it cannot be a bare URI — React Native's `Image` takes headers on the
 * source for exactly this, and without them it renders a broken box.
 *
 * **No response says whether a photo exists.** There is no `hasPhoto` flag on
 * an entry event and never was one on an approval; the only way to find out is
 * to ask and read the 404. So this builds a source for any id, `SubjectPhoto`
 * asks when a photo is plausible, and the icon is what a 404 leaves behind.
 */
export function entryPhotoSource(entryEventId: string | null | undefined) {
  if (!entryEventId) return undefined;
  const token = getAccessToken();
  if (!token) return undefined;
  return {
    uri: buildUrl(`/mobile/entry-events/${entryEventId}/photo`),
    headers: { Authorization: `Bearer ${token}` },
  };
}

/* ---------------------------------------------------------------- Society */
/*
 * Everything below is `/web/...`: deployed, used only by the admin shell, and
 * the one part of this file with no documented response shape. Each reader
 * normalises defensively — a missing field becomes null, an envelope or a bare
 * array both parse — because the alternative is an admin screen that crashes
 * on a body that was merely shaped differently than guessed.
 */

const listOf = <T>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const body = payload as Record<string, unknown>;
    for (const k of ['items', 'data', 'results']) {
      if (Array.isArray(body[k])) return body[k] as T[];
    }
  }
  return [];
};

/** `GET /web/societies/{id}/units` — the society roll. */
export const getUnits = async (societyId: string): Promise<Unit[]> =>
  listOf<Unit>(await get(`/web/societies/${societyId}/units`));

/** `GET /web/societies/{id}/staff` — the register the whole product rests on. */
export const getSocietyStaff = async (societyId: string): Promise<Staff[]> =>
  listOf<Staff>(await get(`/web/societies/${societyId}/staff`));

/** `POST /web/societies/{id}/staff` — the office registers a person. */
export const createStaff = (
  societyId: string,
  input: { name: string; phone: string; staffType: StaffType },
) => post<Staff>(`/web/societies/${societyId}/staff`, input);

/**
 * `PATCH /web/societies/{id}/staff/{staffId}` — the face-enrolment binding.
 *
 * Until this is set the staff member is invisible to the gate: the terminal
 * knows a face and the platform knows a name, and nothing joins them.
 */
export const bindFaceRef = (societyId: string, staffId: string, facePersonRef: string) =>
  patch<Staff>(`/web/societies/${societyId}/staff/${staffId}`, {
    facePersonRef: facePersonRef.trim().toUpperCase(),
  });

/** `GET /web/societies/{id}/devices` — every terminal, with its heartbeat. */
export const getDevices = async (societyId: string): Promise<Device[]> =>
  listOf<Device>(await get(`/web/societies/${societyId}/devices`));

/** `GET /web/societies/{id}/logs` — every gate in the society, one feed. */
export const getSocietyEntryEvents = async (
  societyId: string,
  limit = 100,
): Promise<EntryEvent[]> => listOf<EntryEvent>(await get(`/web/societies/${societyId}/logs`, { limit }));

/** `GET /web/societies/{id}/dashboard` — whatever counters the service keeps. */
export const getSocietyDashboard = (societyId: string) =>
  get<Record<string, unknown>>(`/web/societies/${societyId}/dashboard`);

/**
 * A terminal is unhealthy when it has been silent for five minutes.
 *
 * The only piece of domain logic left on the client, and it stays because it
 * is not a decision — it is a reading of a timestamp the server already sent,
 * and computing it here means the number on screen keeps counting up while the
 * admin watches it instead of freezing until the next poll.
 */
export function deviceHealth(device: Device | null | undefined): DeviceHealth {
  if (!device?.lastHeartbeatAt) return { ok: false, minutesSilent: null, device: device ?? null };
  const minutes = Math.floor((Date.now() - new Date(device.lastHeartbeatAt).getTime()) / 60_000);
  return { ok: minutes < HEARTBEAT_STALE_MINUTES, minutesSilent: minutes, device };
}

/* ------------------------------------------------------------- Re-exports */

export { idempotencyKey, request };
