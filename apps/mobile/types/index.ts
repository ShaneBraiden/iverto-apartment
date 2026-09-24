/**
 * Domain types for the Iverto Gate platform.
 *
 * These mirror what the service actually sends, field for field and name for
 * name. The wire is camelCase and so is this file, so there is no translation
 * step and no place for the two to drift: if a type here has a field, the
 * response has that field, and if it does not, the app must not invent it.
 *
 * `mobile-api-documentation.md` at the repo root is the contract these were
 * read off; `API.md` beside this app records where the deployed service and
 * that document disagree.
 *
 * Two kinds of type live here and the distinction matters:
 *
 *   • **wire types** — exactly a response body. `EntryEvent`, `Passcode`.
 *   • **client types** — assembled by `endpoints.ts` from one or more
 *     responses, marked as such. `Context` is the only significant one.
 */

/* --------------------------------------------------------------- Identity */

/**
 * The signed-in person, as `POST /auth/login` returns them.
 *
 * Identity is an email and a password, not a phone number: residents are
 * onboarded by the society office, which mints a temporary password of
 * `<phone>@iverto` and sets `mustChangePassword` until it is replaced.
 */
export type User = {
  id: string;
  email: string;
  name: string;
  phone: string;
  isSuperadmin: boolean;
  /** True until the onboarding password has been replaced. Gates every route. */
  mustChangePassword: boolean;
};

export type UnitRole = 'OWNER' | 'TENANT' | 'FAMILY';
export type SocietyRole = 'SOCIETY_ADMIN' | 'GUARD_SUPERVISOR' | 'GUARD';
export type Role = UnitRole | SocietyRole;

/**
 * One hat this person wears — a *client* type.
 *
 * `GET /mobile/me/contexts` answers with parallel arrays (`units`,
 * `societies`, and `gates` where the deployment sends them); `endpoints.ts`
 * flattens them into this union, because the app swaps its entire navigation
 * graph on the active context and a single list is what a switcher can render.
 *
 * `id` is the membership/role row's own id, which is stable across sessions —
 * that is what makes it safe to persist the chosen context and restore it.
 */
export type Context =
  | {
      type: 'UNIT';
      id: string;
      unitId: string;
      societyId: string;
      /** "A-402" — the flat, as everybody says it. */
      label: string;
      /** The society's name. */
      sublabel: string;
      role: UnitRole;
      /** The building this flat is in, when the response named one. */
      buildingName?: string | null;
      isPrimary?: boolean;
    }
  | {
      type: 'SOCIETY';
      id: string;
      societyId: string;
      label: string;
      sublabel: string;
      role: SocietyRole;
    }
  | {
      type: 'GATE';
      id: string;
      gateId: string;
      societyId: string;
      label: string;
      sublabel: string;
      role: Extract<SocietyRole, 'GUARD' | 'GUARD_SUPERVISOR'>;
    };

export type ScopeType = Context['type'];

/* ------------------------------------------------------------- Directory */

/**
 * One flat as the gate sees it — `GET /mobile/gates/{gateId}/directory`.
 *
 * Deliberately not a contact list. Guard turnover is high and their device is
 * the least trusted in the system, so this carries names and numbers for
 * confirming a call and nothing else; `maskPhone` in `lib/rbac.ts` is what
 * decides how much of the number reaches the screen.
 */
export type DirectoryUnit = {
  unitId: string;
  unitNumber: string;
  buildingId: string | null;
  buildingName: string | null;
  residents: { id: string; name: string; phone: string; role: UnitRole }[];
};

/* ------------------------------------------------------------ Gate & place */

/**
 * A gate's terminal, from `GET /web/societies/{id}/devices`.
 *
 * Only the admin shell reads this, and only that route serves it — the mobile
 * surface has no device endpoint at all. Every field is optional because the
 * `/web` responses are the one part of this file not pinned to a documented
 * shape; see the note at the top of `endpoints.ts`.
 */
export type DeviceVendor = 'ZKTECO' | 'ESSL' | 'MATRIX' | 'OTHER';
export type Device = {
  id: string;
  gateId?: string | null;
  gateName?: string | null;
  societyId?: string | null;
  vendor?: DeviceVendor | string | null;
  serialNo?: string | null;
  /** ISO. Silence here is what the admin dashboard warns about. */
  lastHeartbeatAt?: string | null;
  status?: string | null;
};

/** Computed client-side from the heartbeat a device response carried. */
export type DeviceHealth = {
  ok: boolean;
  /** Null when the terminal has never reported at all. */
  minutesSilent: number | null;
  device: Device | null;
};

/** A unit as the society roll lists it — `GET /web/societies/{id}/units`. */
export type Unit = {
  id: string;
  societyId?: string | null;
  unitNumber: string;
  buildingId?: string | null;
  buildingName?: string | null;
  residents?: { id: string; name: string; phone: string; role: UnitRole }[];
};

/* -------------------------------------------------------------- The moat */

export type StaffType = 'MAID' | 'COOK' | 'DRIVER' | 'NANNY' | 'OTHER';
export type StaffStatus = 'ACTIVE' | 'INACTIVE';

/** A person on the society's register. */
export type Staff = {
  id: string;
  societyId: string;
  name: string;
  phone: string;
  staffType: StaffType;
  /** Base64 JPEG the office captured at registration, or null. */
  photoData?: string | null;
  /** The id the face terminal enrolled them under. Null until the office binds it. */
  facePersonRef?: string | null;
  status: StaffStatus;
  createdAt?: string | null;
};

/**
 * `GET /mobile/units/{unitId}/staff` — a person, plus this household's
 * subscription to them.
 *
 * `notify` belongs to the assignment, not the person: one house help serving
 * four homes is four rows, each independently silenced.
 *
 * Note what is *not* here. The mobile staff response carries no presence, no
 * last-seen timestamp and no count of how many homes this person serves, so no
 * screen may claim any of the three. Where the old build showed "Inside · 4
 * homes" it now shows what the response supports, which is the person, their
 * role, and whether this home is muted.
 */
export type UnitStaff = {
  assignmentId: string;
  staffId: string;
  name: string;
  phone: string;
  staffType: StaffType;
  /** Base64 JPEG the office captured at registration, or null. */
  photoData?: string | null;
  facePersonRef?: string | null;
  status: StaffStatus;
  notify: boolean;
  activeFrom: string;
  activeTo?: string | null;
};

/* ------------------------------------------------------- Events & approvals */

export type EventSource = 'M50_DEVICE' | 'GUARD_APP' | 'PASSCODE';
export type SubjectType = 'STAFF' | 'VISITOR' | 'DELIVERY' | 'RESIDENT';
export type Direction = 'IN' | 'OUT';

/**
 * One crossing of a gate.
 *
 * `visitorName` is the name on the event whatever the subject is — a courier,
 * a guest, a staff member — so `lib/status.ts` has `entryTitle`/`entrySubtitle`
 * to turn a row into the two lines a list draws, rather than each screen
 * inventing its own wording for a null.
 */
export type EntryEvent = {
  id: string;
  societyId: string;
  gateId: string;
  unitId: string | null;
  eventSource: EventSource;
  subjectType: SubjectType;
  visitorName?: string | null;
  visitorPhone?: string | null;
  staffId?: string | null;
  direction: Direction;
  occurredAt: string;
  /** When the service wrote it down, as against when it happened. */
  recordedAt?: string | null;
  /** Who logged it, on `GUARD_APP` events. */
  guardUserId?: string | null;
  idempotencyKey?: string | null;
  /**
   * Whatever the source attached, untyped by the service.
   *
   * Two keys the app reads: `platform` on a delivery, and `originalEntryId` on
   * an OUT row naming the IN it closes — a completed visit is two rows, and
   * the first is never mutated.
   */
  rawPayload?: Record<string, unknown> | null;
  /**
   * *Client-side.* Lifted out of `rawPayload.platform` by `endpoints.ts`, so a
   * log row and a delivery rule name the field the same way. There is no
   * top-level `platform` on the response.
   */
  platform?: Platform | null;
};

/** Paginated list envelope — `GET /mobile/units/{unitId}/entry-events`. */
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'AUTO_APPROVED';

/**
 * A household being asked to admit someone.
 *
 * Flat, exactly as the service sends it: the visitor's details sit on the
 * approval itself rather than in a nested entry event, so a card renders from
 * one row with no second call and no join.
 *
 * `expiresAt` is the server's deadline and the only authority on it — the
 * countdown ring divides by it, and `APPROVAL_WINDOW_SECONDS` is used only as
 * the denominator when `createdAt` is missing.
 *
 * The service does **not** put the visitor on this row. `GET .../pending`
 * returns the bare approval; the gate's own queue nests the entry event beside
 * it instead. Everything below the line is therefore *client* enrichment,
 * joined on `entryEventId` in `endpoints.ts` so that one card renders from one
 * object however it was fetched — and absent, not wrong, when the join misses.
 */
export type ApprovalRequest = {
  id: string;
  entryEventId: string;
  unitId: string;
  status: ApprovalStatus;
  expiresAt: string;
  createdAt?: string | null;
  decidedByUserId?: string | null;
  decidedAt?: string | null;

  /* ---------------- joined client-side, never sent ---------------- */
  visitorName?: string | null;
  visitorPhone?: string | null;
  subjectType?: SubjectType | null;
  platform?: Platform | null;
  /** "A-402", read off the gate directory. */
  unitNumber?: string | null;
};

/**
 * What `POST /mobile/gates/{gateId}/entry-events` answers with.
 *
 * Three bodies behind one type, and telling them apart *is* the outcome:
 *
 *   • a household is being asked — `approvalRequest` PENDING, no `mode`
 *   • a standing delivery rule answered — `autoApproved`, `mode` says which
 *   • nothing to decide, a resident or staff scan — **no `approvalRequest` key
 *     at all**, which is why it is optional rather than nullable
 *
 * There is no `message`. The service used to write the sentence the guard acts
 * on and no longer does, so `entryOutcome` in `lib/status.ts` composes it from
 * these fields — in one place, because two screens wording the same outcome
 * differently is how a guard learns to stop reading it.
 */
export type EntryEventResult = {
  entryEvent: EntryEvent;
  approvalRequest?: ApprovalRequest | null;
  autoApproved: boolean;
  /** Only on an auto-approval — `ASK_ME` is not one. */
  mode?: Extract<DeliveryMode, 'LEAVE_AT_GATE' | 'ALLOW_TO_DOOR'> | null;
};

/* -------------------------------------------------------------- Deliveries */

export type Platform =
  | 'BLINKIT'
  | 'ZEPTO'
  | 'SWIGGY'
  | 'INSTAMART'
  | 'AMAZON'
  | 'FLIPKART'
  | 'OTHER';

export type DeliveryMode = 'ASK_ME' | 'LEAVE_AT_GATE' | 'ALLOW_TO_DOOR';

export type DeliveryPermission = {
  id?: string;
  unitId: string;
  platform: Platform;
  mode: DeliveryMode;
  /** "HH:mm", or null for "any time". Outside the window everything asks. */
  windowStart: string | null;
  windowEnd: string | null;
  /** Log it, don't buzz me. Only meaningful when mode is not ASK_ME. */
  silent: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/* --------------------------------------------------------------- Passcodes */

/**
 * A guest's entry code.
 *
 * There is no guest name on this record. The service stores a code, a validity
 * window and a use count, and nothing that says who it was for — so the app
 * does not ask for one rather than collecting a name it would have to throw
 * away. `API.md` lists it as a gap for the backend to close.
 *
 * Two credentials, one pass: six digits that can be read out over a phone, and
 * `qrToken` for a scan. The gate takes either, in the same field.
 */
export type Passcode = {
  id: string;
  unitId: string;
  code: string;
  /** A UUID minted for every passcode, whether or not `code` was chosen. */
  qrToken?: string | null;
  createdByUserId?: string | null;
  validFrom: string;
  validUntil: string;
  maxUses: number;
  usesCount: number;
  revoked: boolean;
  createdAt?: string | null;
};

/**
 * `POST /mobile/gates/{gateId}/passcodes/verify` — the guard's answer. A
 * *client* type.
 *
 * The service rejects a bad code with `401` and a sentence saying which kind of
 * bad: revoked, used up, outside its window, or simply unknown. To a guard at
 * the barrier that is an answer, not a failure, so `verifyPasscode` folds those
 * four into this shape and leaves only transport and rate-limit failures to
 * raise.
 *
 * That fold is not cosmetic. A 401 anywhere else in this app ends the session,
 * and a guard signed out by a guest's stale code is the bug this type exists to
 * prevent.
 */
export type PasscodeVerification = {
  valid: boolean;
  message: string;
  entryEvent?: EntryEvent | null;
  /** The flat the code belongs to, on a successful check. */
  unitId?: string | null;
};
