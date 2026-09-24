# API integration

The app is wired to the deployed Iverto Gate service at
`https://gate.iverto.ai/apt`. Endpoints and shapes come from
`mobile-api-documentation.md` at the repo root, cross-checked against the live
OpenAPI document the service publishes at `/api/docs-json`.

This file records two things: how the client is put together, and **every place
the deployed service and that document disagree**. The second half is the useful
one. Nothing below is aspirational — where something is missing it is written
down as missing, and the app says so on screen rather than filling the gap in.

---

## 1. What changed, and why

The app was originally built against a speculative FastAPI contract — OTP login,
a rotating refresh token, `snake_case` on the wire, presigned photo uploads,
`/v1/...` paths. None of that is what the service does. The integration was
therefore a rewrite of the data plumbing, not an adjustment of it:

| Was | Is |
|---|---|
| `POST /v1/auth/otp/request` + `otp/verify` | `POST /api/v1/auth/login` with `{email, password}` |
| Access + rotating refresh token, silent refresh on 401 | One `accessToken`. No refresh endpoint exists, so a 401 ends the session |
| — | `mustChangePassword` on the user, gating every route until cleared |
| `snake_case` on the wire, converted in `case.ts` | camelCase both sides. `case.ts` deleted |
| `/v1/...` | `/api/v1/...`, applied once in `http.ts` as `API_PREFIX` |
| `{"detail": ...}` errors | `{"statusCode", "message", "error"}`, `message` sometimes an array |
| `GET /v1/me/contexts` → `Context[]` | `GET /api/v1/mobile/me/contexts` → `{units[], societies[]}`, flattened client-side |
| `GET /v1/me/pending` (account-wide) | `GET /api/v1/mobile/units/{id}/pending` (per unit) |
| Presigned PUT to object storage, then `photoKey` | `photoBase64` inline in the entry-event body |
| Raw `WSS /v1/ws?ticket=` | Socket.IO at the default path, JWT in the handshake `auth` |

The screens' layout, copy and design system are otherwise untouched. Where a
screen has changed it is because the data behind it changed — see §4.

### 1.1 Second pass — the implementation-derived document

`mobile-api-documentation.md` was then rewritten from the backend source rather
than from the design spec, and it disagreed with the previous version in ways
the app was reading. Everything below is now aligned to it:

| Was | Is |
|---|---|
| `approval.validUntil` | `approval.expiresAt` |
| Pending approvals carried `visitorName`, `visitorPhone`, `subjectType`, `platform`, `unitNumber` | Bare `approval_requests` rows. The app joins the entry event back on — §5 |
| `GET /mobile/gates/{id}/pending` → flat approvals | `{approval, entryEvent}` pairs, flattened in `endpoints.ts` |
| `entryEvent.hasPhoto` | No flag anywhere. Ask for the photo and read the 404 — §4.5 |
| `entryEvent.platform` | Inside `rawPayload.platform`, lifted out at the edge |
| `eventSource: FACE_DEVICE` | `M50_DEVICE` |
| Create-entry → `{entryEvent, approval, autoApproved, message}` | `{entryEvent, approvalRequest?, autoApproved, mode?}`. **No `message`** — the guard's sentence is now the client's to write, in `lib/status.ts` |
| Verify passcode → `200 {valid, message}` | `200 {verified, entryEvent, unitId}` / **`401`** with the reason. Folded back into `{valid, message}` — §4.6 |
| Socket handshake `auth.token = "Bearer <jwt>"` | The bare JWT. A `Bearer` string is not what the server verifies |
| Client emits `subscribe` with its rooms | Rooms are computed server-side from RBAC. The gate room is asked for in the handshake as `auth.gateId` — §6 |
| No `qrToken` on a passcode | Every passcode has one; the gate takes it or the six digits in the same field |
| Rate limits undocumented | 120/min globally, 8/min on login, 15/min on passcode verify — §3 |

The paths did not change. The screens did not change, except where a field they
were drawing stopped existing.

### 1.2 What the alignment made possible, and one bug it turned up

**The guest pass is real now.** `qrToken` exists on every passcode and the gate
takes it in the same field as the six digits, so `components/GuestPass.tsx`
draws both — black on white regardless of the app's palette, because it is read
by a camera at arm's length and not by a person. `components/QrScanner.tsx`
(`expo-camera`) is the other half: the guard scans what the resident's phone
shows, locking after the first frame that decodes, because verification spends
one of the code's uses. Typing the digits stays beside it — a scan that will not
focus in the dark is a queue at the barrier.

**`useMutation` was calling the wrong closure.** `mutate` is deliberately a
stable identity, and a `useCallback` with `[]` deps holds the *first* render's
function for ever — so every mutation that read a screen's state was sending the
state that screen had when it mounted. `create.mutate()` on the passcode screen
ignored the resident's chosen validity and always sent the defaults;
`raise.mutate()` in the guard's new-entry screen would have posted an empty
visitor. The writer is now held in a ref, exactly as its options already were.
It went unnoticed because the guard shell has never been able to load (§4.4) and
because the passcode defaults are the common choice.

---

## 2. Configuration

`lib/api/config.ts` resolves the origin in this order:

1. `EXPO_PUBLIC_API_URL` — an environment variable, inlined at bundle time
2. `expo.extra.apiUrl` in `app.json` — what ships in the APK
3. `https://iverto-backend.onrender.com` — the deployed service, as a fallback

No trailing slash, and **no `/api/v1`** — `API_PREFIX` carries that, applied in
one place in `http.ts`. Copy `.env.example` to `.env` to point a dev client
somewhere else, and restart Metro; the value is compiled into the bundle.

The Socket.IO origin is the same value unless `EXPO_PUBLIC_WS_URL` overrides it.
It wants an **http(s)** origin — Socket.IO negotiates its own upgrade, so a
`ws://` URL here is wrong.

Timeouts are 30s for a normal request and 60s for the two that carry a base64
photo. Thirty is high on purpose: the service idles its container out, and the
first request after a quiet period pays for a cold start of ten to fifteen
seconds. Timing that out would show every morning's first guard an outage that
is really a wake-up.

---

## 3. Conventions

**Case.** camelCase on the wire and in the app. There is no conversion layer.

**Auth.** `Authorization: Bearer <accessToken>` on everything except
`POST /auth/login`. There is no refresh token and no refresh endpoint, so a 401
is the end of the session: the transport clears the keystore, emits
`onSessionExpired`, and `AuthProvider` signs the user out in one place.

**Errors.** NestJS sends `{"statusCode":400,"message":…,"error":"Bad Request"}`.
`message` is either a sentence or an array of validation strings; `http.ts`
joins the array rather than taking the first, because "email must be an email"
alone — when the password was also blank — sends someone to fix one field and
submit into the identical error. The status decides the wording and whether a
retry is offered:

| Status | Screen says | Retry offered |
|---|---|---|
| 0 (client-side: timeout or no connection) | "You are offline" | Yes |
| 401 / 403 | "Not allowed" | No |
| 404 | "Not there any more" | No |
| 409 | The `message` you send | Yes |
| 429 | Your `message` — include the wait | Yes |
| 5xx | "The server had a problem" | Yes |

**A 401 is the end of the session — with one exception.** There is no refresh
token, so `http.ts` treats a 401 as sign-out. Passcode verification is the one
call that must not: the service rejects a wrong, revoked, spent or expired guest
code with `401` and a sentence, and signing the guard out because a visitor
mistyped six digits would take the gate down for everyone behind them. That call
passes `allow401`, and `verifyPasscode` turns the four rejections into
`{valid: false, message}`. Nothing else may use that flag.

**Rate limits.** 120 requests/minute per IP across the board, and two stricter
ones on the endpoints worth brute-forcing:

| Endpoint | Limit |
|---|---|
| `POST /auth/login` | 8/min per IP |
| `POST /mobile/gates/{id}/passcodes/verify` | 15/min per IP |

They are per **IP**, not per account, and a gate's wifi is one IP with a shift's
worth of guards behind it. A `429` on the verify path is therefore a plausible
event rather than an abuse signal — it raises (it is not a verdict on the guest)
and the screen offers a retry.

**Idempotency.** The app sends `Idempotency-Key` on every event-creating write
and **the service does not read it**. The keys are still generated where the
user acted rather than where the request is sent, so honouring the header is a
backend change alone. Until then, a timed-out entry that the guard retries can
admit the same visitor twice. Keys in use:

| Call | Key | Why |
|---|---|---|
| `POST /mobile/gates/{id}/entry-events` | per attempt, held in screen state | A timeout retry must be the same visitor, not a second one |
| `POST …/entry-events/{id}/exit` | `exit-{id}` | An entry has exactly one exit |
| `POST /mobile/units/{id}/approvals/{id}/decide` | `decide-{id}` | A request has one decision |
| `POST /mobile/gates/{id}/passcodes/verify` | per attempt | A two-use code verified twice is two facts, not one |

**Pagination.** Only `GET /mobile/units/{id}/entry-events` is paginated, as
`{items, total, page, limit}`. Everything else returns a bare array.

---

## 4. Gaps between the document, the deployment, and the app

This is the section to read before changing anything.

### 4.1 Documented but not deployed — answers 404

| Endpoint | Consequence |
|---|---|
| `GET /mobile/units/{unitId}/society-staff` | A resident cannot add staff to their home. The add sheet says the register is unavailable. |
| `GET /mobile/gates/{gateId}/staff` | The guard's directory has no staff section. |

Both are called through `optional()` in `endpoints.ts`, which returns `null` on
404 and rethrows anything else. `null` is not `[]` and the screens treat them
differently: "this backend does not have it" and "there is nobody registered"
are different sentences, and only one of them sends someone to the office to ask
a question the office cannot answer.

### 4.2 Not documented and not deployed — no endpoint at all

| Missing | What the app does instead |
|---|---|
| **Gate entry-event list.** Events can be created and closed, never listed. | `lib/gateSession.ts` keeps what *this device* logged since launch, in memory. Every screen showing it says so in those words. Without it the exit endpoint would be unreachable — marking someone out needs an event id and there is no list to take one from. |
| **Still-inside list** (IN with no OUT) | Same. Scoped to this device and labelled as such. |
| **Recently-decided approvals** | Removed. The guard's card shows a verdict while the approval is still in the pending response; after that it is gone. |
| **Account-wide pending feed** | Per-unit queries. The resident tab badge counts the active home only. |
| **Unit approvals history** | Removed from the resident log. Only the live queue is available. |
| **Notices** | Section removed from both shells. |
| **Complaints** | Section removed from both shells. A form that posts nowhere is worse than no form. |
| **Staff → units fan-out list** | Removed from the admin staff screen, along with the per-person "serves N homes" count. |
| **`PATCH` on a staff assignment** | `setStaffNotify` re-POSTs `POST /mobile/units/{id}/staff` with the new `notify` — which is what the documented create body's `notify` field is for. It upserts. |
| **`DELETE` on a delivery permission** | ASK_ME is written as a rule rather than expressed by deleting one. Screens that count granted permissions filter ASK_ME out instead of counting rows. |
| **Masked calling** | The guard's "no response — call" button opens an empty OS dialer. |

### 4.3 Fields the app used to show and no longer can

Each of these was in the original design and is absent from the response. None
is inferred; the screens stopped claiming them.

| Field | Where it was | Now |
|---|---|---|
| `presence` / `lastSeenAt` on staff | Resident + admin staff lists, home screen "staff inside" counter | Gone. The home screen counts today's arrivals from the entry log instead, which is a fact the response supports. |
| `assignmentCount` on staff | "Serves 4 homes" — the number the product is built around | Gone from the admin register. |
| `guestName` on a passcode | Every passcode row and the share sheet | Gone. The service stores a code, a window and a use count; asking for a name and dropping it would label the issuing phone and nothing else. |
| `qrToken` on a passcode | QR pass | **Back, and drawn.** Every passcode carries a `qrToken` UUID and the gate accepts it or the six digits in the same field. `GuestPass` renders it; `QrScanner` reads it — §1.2. |
| `decidedByName` on an approval | "Priya answered this" | Replaced with "answered 2 min ago" from `decidedAt`. |
| `subjectDetail` on an entry event | The second line of every log row | Composed from `platform`, `subjectType` and `eventSource` by `entryTitle`/`entrySubtitle` in `lib/status.ts`. |
| `Gate` as a resource, with `device` embedded | Admin gates screen | The admin screen lists `GET /web/societies/{id}/devices`. A gate with no terminal fitted does not appear at all. |

### 4.4 Gate contexts

`GET /mobile/me/contexts` returns `{units, societies}`. Its description mentions
gate roles; no deployment has been seen returning a `gates` array, and there is
no other endpoint that yields a `gateId`.

Every call in the guard shell is `/mobile/gates/{gateId}/…`, so **without a gate
posting the guard shell cannot load a single screen.** `getContexts` reads a
`gates[]` if the service sends one; when it does not, a society role of `GUARD`
resolves to `shell: 'unassigned'` and the front door says "No gate assigned"
rather than mounting a shell that fires five failing requests.

**To make the guard shell work, `/mobile/me/contexts` needs to return:**

```jsonc
"gates": [
  {
    "id": "role_…",        // the role row's own id; stable, persisted as the chosen context
    "gateId": "gate_main",
    "gateName": "Main Gate",
    "societyId": "soc_…",
    "societyName": "Palm Grove Residences",
    "role": "GUARD"        // GUARD | GUARD_SUPERVISOR
  }
]
```

### 4.5 The photo endpoint needs auth, and nothing says a photo exists

`GET /mobile/entry-events/{id}/photo` was once documented as open; the deployment
always answered **401**, and the document now agrees with the deployment.
`entryPhotoSource` in `endpoints.ts` builds an `<Image source>` carrying an
`Authorization` header, because a bare URI renders as a broken box.

Authorisation is resolved from the event's own tenancy rather than from the URL —
the logging guard, a member of the unit, a guard or admin covering that gate, or
a superadmin. A `403` is "not yours"; a `404` is either "no such event" or "that
event has no photo", and the two are not distinguishable.

**There is no `hasPhoto` flag on anything** — not on an entry event, not on an
approval. The request is the question and the 404 is the answer. So:

- an **approval card** always asks. The household is deciding whether to admit a
  stranger, and a face is the whole basis of that decision; showing an icon when
  a photo existed is the expensive mistake, and one 404 on gate wifi is the cheap
  one.
- a **log row** asks only when `expectsPhoto()` in `lib/status.ts` says it is
  plausible — a visitor or a delivery, not a face-terminal staff scan. A screen
  of twenty staff rows firing twenty requests for photos nobody took is the
  wasteful direction of the same trade.

### 4.6 Pending approvals do not say who is waiting

`GET /mobile/units/{id}/pending` returns the bare `approval_requests` row: an id,
a status, a deadline, and the id of an entry event it will not tell you about. A
card built from that alone asks a household to admit "Visitor", which is not a
decision anybody can make.

So `getUnitPending` fetches one page of the home's log alongside and joins on
`entryEventId` — only when something is actually waiting, so the common case
stays one request, and through `soft()`, so a slow log degrades the card to a
generic title instead of emptying the queue. Ninety seconds is the whole life of
an approval, so its event is by construction among the newest rows there.

The gate's queue is shaped differently again — `{approval, entryEvent}` pairs,
because that one *does* join the event in. It is flattened to the same
`ApprovalRequest` the resident's queue produces, and the flat number is looked up
from the directory, since it is the one thing a guard reads off the card and the
one thing neither response carries. A card that took two shapes is a card that
eventually renders one of them wrong.

---

### 4.7 Push arrives with no channel on it

The app is an FCM client as of v0.3.0 — `expo-notifications`, which links
`com.google.firebase:firebase-messaging`, with `google-services.json` compiled
in and `lib/push.ts` doing the rest. It registers its token through
`POST /mobile/me/device-token` once a session exists and again on every
foreground, reads §5.4's `data.type`, refreshes the cache through the *same*
`applyServerEvent` the socket calls, and routes a tap to the screen the
notification was about.

Two things it cannot do for itself.

**The channel.** On Android 8 and up the channel decides sound, vibration and
whether a banner is pushed over what the user is doing — and for a push that
lands while the app is backgrounded or killed, **the channel is chosen
natively, before any JavaScript runs.** expo-notifications takes it from
`remoteMessage.notification.channelId` or `remoteMessage.data.channelId`
(`FirebaseNotificationTrigger.kt`) and from nowhere else. With neither set
nothing breaks — the library creates a fallback channel at IMPORTANCE_HIGH and
every push shows on it. What is lost is the *difference*: one channel, one
importance, one sound, so a `DELIVERY_SILENT` rings at eleven at night exactly
as loudly as a visitor at the door.

The app creates four channels plus a fallback and the service has to name one:

| `data.type` | `data.channelId` | Importance |
|---|---|---|
| `VISITOR_APPROVAL` | `approvals` | MAX |
| `DELIVERY_APPROVAL` | `approvals` | MAX |
| `DELIVERY_ARRIVED` | `deliveries` | DEFAULT |
| `DELIVERY_SILENT` | `deliveries-silent` | LOW, silent |
| `STAFF_MOVEMENT` | `staff` | LOW, silent |

Anything unrecognised falls to `general` at DEFAULT, so a type added after this
APK ships still shows rather than being dropped.

**Un-registering.** There is no route that removes a device token. Signing out
calls `forgetPushRegistration()`, which stops *this app* re-sending the token
and does nothing to stop the service. A gate tablet handed to the next shift
keeps receiving the previous guard's traffic, and a sold phone keeps receiving
a household's visitor alerts. Both are items in
`backend-changes-required.md` (#16, #17).

**`unitId` in `data`** is optional and worth sending: it is what lets a
resident with two homes tap an alert for the second one and have the app switch
to that flat before it opens the queue. Without it they land on whichever home
they were last acting as, see an empty queue, and read it as "the visitor is
gone".

---

## 5. Endpoints in use

Everything below was probed against the deployment: `401` unauthenticated means
the route exists.

### Auth

| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{accessToken, user}` |
| POST | `/auth/change-password` | `{newPassword}` → `{accessToken, message, user}` |

`change-password` returns a **new token**, and adopting it is not optional:
keeping the old one leaves every later request authenticated as an account that
still has to change its password.

### Me

| Method | Path | Body → Response |
|---|---|---|
| GET | `/mobile/me/contexts` | → `{units[], societies[]}` — see §4.4 |
| POST | `/mobile/me/device-token` | `{fcmToken, platform}` → device token row |

`device-token` is written but nothing calls it: no FCM dependency is installed,
so the app has no token to register. See §7.

### Units — the resident shell

| Method | Path | Body → Response |
|---|---|---|
| GET | `/mobile/units/{id}/pending` | → bare approval rows — no visitor, no photo. Joined client-side; see §4.6 |
| POST | `/mobile/units/{id}/approvals/{id}/decide` | `{decision: "APPROVED" \| "REJECTED"}` |
| GET | `/mobile/units/{id}/entry-events?page&limit` | → `{items, total, page, limit}` |
| GET | `/mobile/units/{id}/staff` | → `UnitStaff[]` |
| POST | `/mobile/units/{id}/staff` | `{staffId, notify}` — also the mute toggle |
| DELETE | `/mobile/units/{id}/staff/{staffId}` | |
| GET | `/mobile/units/{id}/delivery-permissions` | → `DeliveryPermission[]` |
| PUT | `/mobile/units/{id}/delivery-permissions/{platform}` | `{mode, windowStart, windowEnd, silent}` |
| GET | `/mobile/units/{id}/passcodes` | → `Passcode[]` |
| POST | `/mobile/units/{id}/passcodes` | `{validFrom, validUntil, maxUses}` — `code` omitted so the server mints it; response carries `code` **and** `qrToken` |
| DELETE | `/mobile/units/{id}/passcodes/{id}` | |

### Gates — the guard shell

| Method | Path | Body → Response |
|---|---|---|
| GET | `/mobile/gates/{id}/directory?query=` | → `DirectoryUnit[]`. `query` is always sent, empty for the unfiltered list |
| GET | `/mobile/gates/{id}/pending` | → `{approval, entryEvent}[]`, flattened — §4.6 |
| POST | `/mobile/gates/{id}/entry-events` | see below |
| POST | `/mobile/gates/{id}/entry-events/{id}/exit` | → `EntryEvent` |
| POST | `/mobile/gates/{id}/passcodes/verify` | `{codeOrQrToken, photoBase64?}` → `200 {verified, entryEvent, unitId}` or `401` with the reason |
| GET | `/mobile/entry-events/{id}/photo` | JPEG bytes. Needs a bearer token — see §4.5 |

**Create entry event** — request:

```json
{
  "unitId": "49208a9f-3958-450f-90e9-b541982bca10",
  "visitorName": "Siddharth Roy",
  "visitorPhone": "+91 98223 44556",
  "subjectType": "VISITOR",
  "platform": null,
  "photoBase64": "data:image/jpeg;base64,/9j/4AAQ…",
  "mimeType": "image/jpeg"
}
```

The frame is downscaled to a 1024px long edge and re-encoded as JPEG at
`compress: 0.5` before it is sent — `takePhoto` in `app/new-entry.tsx`. The
camera's `quality` option compresses but does not change pixel dimensions, so a
full-resolution frame plus base64's one-third inflation put the body over the
service's limit and came back `413 request entity too large`. 1024px is sized
to what the photo is for — a face on a phone — and the body is on the critical
path of a request a guard is standing and waiting on.

A `413` never reaches the guard in the service's own words: `http.ts` replaces
the body-parser sentence with an instruction to retake the photo.

The response is one of three shapes, and telling them apart *is* the outcome:

| Case | Body |
|---|---|
| A household is being asked | `{entryEvent, approvalRequest: {status: "PENDING", expiresAt}, autoApproved: false}` |
| A standing delivery rule answered | `{entryEvent, approvalRequest: {status: "AUTO_APPROVED"}, autoApproved: true, mode}` |
| Nothing to decide (resident/staff scan, or no `unitId`) | `{entryEvent, autoApproved: false}` — **no `approvalRequest` key at all** |

There is no `message`. The service used to write the sentence the guard acts on;
`entryOutcome` in `lib/status.ts` composes it now, in one place, from
`autoApproved` and `mode`. The *decision* is still entirely the server's — a
delivery rule the client evaluated would be a rule a modified client ignores —
and `LEAVE_AT_GATE` and `ALLOW_TO_DOOR` are worded as two different instructions,
because they are the difference between a parcel stopping at the barrier and a
stranger walking to a door.

A rejected passcode is a **`401`** carrying the reason — `Passcode has been
revoked`, `Passcode usage limit exceeded`, `Passcode is expired or not yet
valid`, or `Invalid passcode or QR token`. To the guard that is an answer, not a
failure, so `verifyPasscode` returns `{valid: false, message}` with the server's
own words rather than raising. See §3 for why that call, and only that call,
suppresses the sign-out path.

### Society — the admin shell

**These are `/web/...` routes.** They are deployed and were probed, but the
service publishes no response shape for any of them, and no shape has been
verified against a live token. Every reader in `endpoints.ts` normalises
defensively — `listOf()` accepts a bare array or an `{items}`/`{data}`/`{results}`
envelope, and every field on `Device` and `Unit` is optional — so a body shaped
differently renders a dash rather than crashing. Treat this table as paths that
exist, not as a contract.

| Method | Path |
|---|---|
| GET | `/web/societies/{id}/units` |
| GET | `/web/societies/{id}/staff` |
| POST | `/web/societies/{id}/staff` — `{name, phone, staffType}` |
| PATCH | `/web/societies/{id}/staff/{id}` — `{facePersonRef}` |
| GET | `/web/societies/{id}/devices` |
| GET | `/web/societies/{id}/logs` |
| GET | `/web/societies/{id}/dashboard` |

---

## 6. Realtime

Socket.IO, at the default `/socket.io/` path on the API origin. The **bare** JWT
goes in the handshake — not a `Bearer` string, unlike every REST call — and a
connection with no verifiable token is refused outright. There is no anonymous
socket.

```js
io(WS_URL, {
  auth: { token: accessToken, gateId },   // gateId only when a guard is on shift
  transports: ['websocket', 'polling'],
})
```

**Rooms are not the client's to choose.** The server computes them from the same
RBAC grants that govern the REST API, at every connect: `user:<id>` always, a
`unit:<id>` for every home you hold a role on, a `society:<id>` for every society.
The `subscribe` emit this app used to send has been removed — it was a guess made
when the documentation was silent, and the answer turned out to be no.

The one room a client asks for is the gate, and it is a **handshake parameter**:
a guard declares which barrier the device is standing at, the server joins them
only if RBAC agrees, and an ask it disagrees with is ignored in silence rather
than refused. Because it is read once at connect, `setRealtimeScopes` reopens the
socket when the active gate changes — a guard who walks to the other barrier must
stop hearing the one they left. (`unitId`/`societyId` also go up, and are read
only for platform superadmins, who hold no membership rows to derive rooms from.)

Events, and who hears them:

| Event | Room | Fired when |
|---|---|---|
| `approval.requested` | `unit:` | A visitor or an `ASK_ME` delivery needs a decision |
| `approval.decided` | `unit:` + `gate:` | A resident decided, or a rule auto-approved |
| `entry.delivery` | `unit:` | A delivery was auto-approved |
| `entry.passcode` | `unit:` | A guest code was verified at any gate |
| `passcode.verified` | `gate:` | The same crossing, for the kiosk |
| `entry.exit` | `unit:` + `gate:` | A guard marked someone out |
| `staff.status` | `unit:` | A staff face matched, to every notify-enabled home |

Several crossings are announced twice under different names, once per audience.
Both are listened for and both end in the same invalidation, so hearing one
crossing twice costs a refetch that was already going to happen.

**Frames are treated as notifications, not as data.** The service sends rich
payloads; `applyServerEvent` reads exactly two things out of them — what
happened, and which scopes it touched — and everything on screen then comes from
a refetch. That is more round trips than rendering the payload, and it is the
right trade: a frame carrying state can be stale, out of order or partial, and
the bug that causes is a guard's screen still reading "pending" after the
resident pressed Deny.

A frame naming no scope sweeps every mounted query. Blunt, and correct: the app
has been told something changed and cannot tell where.

**The socket reflects RBAC as it was at connect.** A resident removed from a
home keeps that home's room until the connection is replaced, so any action that
changes what someone is entitled to should be followed by a reconnect if it has
to take effect now.

Behind the socket, two fallbacks carry the app on their own: every mounted query
refetches on foreground, and the guard's queue is a mounted query so it returns
with the screen. The connection state drives the guard's "OFFLINE" banner,
because a screen that has quietly stopped updating looks exactly like a gate
where nothing is happening.

---

## 7. Where the code lives

```
lib/api/
  config.ts      origin, /api/v1 prefix, timeouts
  tokens.ts      keystore-backed access token + session-expiry event
  http.ts        fetch wrapper: auth, timeout, 401 → sign out, ApiError
  endpoints.ts   every call, one function each — the file to read first
  keys.ts        cache keys, ordered outermost-scope-first for prefix invalidation
  query.ts       useQuery / useMutation / invalidate / foreground refetch
  realtime.ts    Socket.IO, and applyServerEvent
  index.ts       the barrel screens import
lib/
  auth.tsx       session, contexts, active hat, mustChangePassword gate
  push.ts        FCM: channels, token registration, tap routing — §4.7
  gateSession.ts what this device logged — see §4.2. Delete when the gate log ships
```

A screen reads:

```tsx
const staff = useQuery(keys.unitStaff(unitId), () => api.getUnitStaff(unitId));
// staff.data ?? [] · staff.loading · staff.error · staff.refetch()
```

and writes:

```tsx
const mute = useMutation(
  (staffId: string, notify: boolean) => api.setStaffNotify(unitId, staffId, notify),
  { invalidates: [keys.unitStaff(unitId)] },
);
```

A failed mutation alerts with copy from `lib/errors.ts` unless the caller passes
`onError` or `silent`. The alternative — a tap that silently does nothing — is
what makes a guard press the button four times and admit four people.

---

## 8. Still not built

- **Push.** No FCM dependency is installed, so `registerDeviceToken` has nothing
  to register. The seam exists: `applyServerEvent(payload)` takes the same shape
  a data message would carry, so a Headless JS background handler calls the same
  function and push and socket cannot drift apart.
- **Offline queue.** The guard app does not queue entry events. What exists is
  honest failure — the guard is told the entry did not send. Note that the
  photo now travels inside the entry-event body, so a queued entry would have to
  carry its base64 payload; that is a real design cost of the inline upload.
- **Idempotency.** Client-side only. See §3.
- **Certificate pinning** in the guard build.

## 9. What the backend could ship to close the biggest gaps

In the order that would help most:

1. `gates[]` on `/mobile/me/contexts` — §4.4. The rewritten API document still
   returns only `{units, societies}`, so this is unchanged and still the only
   thing between the app and a working gate flow.
2. `GET /mobile/gates/{gateId}/entry-events`, with `?open=true` for the
   still-inside list — §4.2. This retires `lib/gateSession.ts` entirely.
3. Deploy the two documented-but-missing routes — §4.1.
4. The visitor on the pending row — `visitorName`, `visitorPhone`, `subjectType`,
   `platform` — or a `hasPhoto` flag on the entry event. Either one removes a
   whole join from §4.6; the flag also stops the app guessing which log rows are
   worth a photo request.
5. `presence`, `lastSeenAt` and `assignmentCount` on staff — §4.3. These are the
   numbers the product's story is told with.
6. Honour `Idempotency-Key` on the four writes in §3.
7. `channelId` on the FCM data payload, and a way to *un*register a device
   token — §4.7. Without the first, every push sounds the same; without the
   second, a handed-over gate tablet keeps ringing.
8. `guestName` on a passcode.
