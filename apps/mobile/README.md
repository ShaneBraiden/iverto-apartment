# Iverto Gate — mobile app

The single RBAC-driven app from §1 of `gate-management-architecture.md`. One
install, one login, and three entirely different apps depending on which hat
the person is wearing: resident, guard, society admin.

Brand, theme and design system are lifted from the Iverto.ai app — same crimson
`#B9000E` accent on the same neutral `#F3F3F3` canvas, same glass surfaces,
same Poppins type scale, same vector brand mark.

## What is built

**Wired to the live service.** Email/password auth with the mandatory
first-login reset, units and memberships, the RBAC grant engine, the context
switcher, and conditional navigator trees per role. A tenant and a guard log
into the same APK and see entirely different apps.

Every flow runs over HTTP against `https://gate.iverto.ai/apt`. **There
is no mock data left in the app.** Read `API.md` before changing anything in
`lib/api/` — it is the record of where the deployed service and
`mobile-api-documentation.md` disagree, and several screens are shaped by those
gaps rather than by preference.

| Flow | Where | Spec |
|---|---|---|
| Multi-home staff fan-out | one socket frame → every subscribed household | §6.1 |
| Guard visitor entry, photo mandatory | `app/new-entry.tsx` | §6.2 |
| Approve / deny with a live 90s countdown | `components/ApprovalCard.tsx` | §6.2 |
| Rejection sync — guard's card cannot be cleared | `app/guard/index.tsx` | §6.2 |
| Per-home, per-platform, per-window delivery rules | `app/deliveries.tsx` | §6.3 |
| Passcode issue, share, revoke, verify | `app/passcodes.tsx`, guard sheet | §6.4 |
| Exit and overstay — "still inside" list | `app/guard/log.tsx` | §6.5 |
| FCM push — channels, token, tap routing | `lib/push.ts` | §5.4 |
| Terminal heartbeat health | `app/admin/gates.tsx` | §5.5 |
| Face enrolment binding | `app/admin/staff.tsx` | §5.4 |

**The API contract is [`API.md`](./API.md).** Every endpoint the app calls,
every response shape, the WebSocket frames, and the handful of paths §8 did not
enumerate are written down there. A service that matches it works with this app
unchanged.

## What is not built

- **The backend itself.** This is the client half. `API.md` §8 gives the
  bring-up order — four endpoints get past sign-in, another three light up the
  entire guard flow.
- **Push has no full-screen intent, and no delivery receipts.** FCM itself is
  wired — see the table above — but a visitor alert is a heads-up banner on a
  MAX channel, not a full-screen ringing intent, and nothing tells the service
  a push was actually delivered. Notifee full-screen intents, receipts, and the
  OEM battery-optimisation onboarding in §7 are still Phase 1.
- **Nothing un-registers a device token.** The service has no route for it, so
  signing out stops this app re-sending its token and does not stop the backend
  pushing to the handset. On a gate tablet handed between shifts that matters.
  `API.md` §4.7.
- **No offline queue.** §9 wants queued entry events drained on reconnect;
  there is no local database in this app yet. What exists is honest failure —
  the guard is told the entry did not send, under an OFFLINE banner, rather
  than looking at a screen that has quietly stopped updating.
- **No gate bridge.** The admin simulator that fabricated face scans went out
  with the mock. Gate events are ingested under a per-device bridge token
  scoped to `gate-events` (§10), which an admin session does not hold.
- **Photos go up inline, and nothing retries.** The entry-event body carries
  the image as base64; a failed send fails the submit.
- **No gate log.** The service has no endpoint that reads entry events back for
  a gate, so the guard's log tab shows what that device raised since launch and
  says so. See `API.md` §4.2.
- **Android only** so far. iOS builds but has had no attention, and §14 is
  right that notification parity there is a fortnight of work, not a flag.

## Layout

```
app/                 expo-router tree — one directory per shell
  index.tsx          front door: waits for contexts, picks the shell
  login.tsx          email + password
  change-password.tsx  the mandatory first-login reset
  resident/          UNIT context — home, staff, log, settings
  guard/             GATE context — gate queue, directory, log
  admin/             SOCIETY context — society, staff, gates
  new-entry.tsx      guard raises a visitor or delivery
  deliveries.tsx     per-platform delivery rules
  passcodes.tsx      guest codes
components/          design system, carried over from the Iverto.ai app
lib/
  rbac.ts            §4.1 grants, transcribed
  auth.tsx           session, contexts, the active hat
  push.ts            FCM: channels, token registration, tap routing
  errors.ts          a thrown thing → words a guard can act on
  status.ts          domain state → colour, icon, label
  gateSession.ts     what this device logged — stands in for a missing endpoint
  api/
    config.ts        origin, the /api/v1 prefix, timeouts
    tokens.ts        the access token, in the keystore
    http.ts          fetch: auth, timeout, 401 → sign out, ApiError
    endpoints.ts     every call, one function each
    keys.ts          cache keys, ordered for prefix invalidation
    query.ts         useQuery / useMutation / invalidation
    realtime.ts      Socket.IO, and applyServerEvent
theme/               design tokens and the brand mark's vector path
```

## Running it

```bash
npm install
cp .env.example .env    # point it at your API — see below
npm start               # Metro, then open in a dev client
npm run typecheck
```

### Pointing it at a backend

`EXPO_PUBLIC_API_URL` wins over `expo.extra.apiUrl` in `app.json`, which is what
ships in the APK. No trailing slash, and no `/api/v1` — `API_PREFIX` in
`lib/api/config.ts` carries that.

```bash
EXPO_PUBLIC_API_URL=https://gate.iverto.ai/apt            # the deployed service
EXPO_PUBLIC_API_URL=http://10.0.2.2:8031                  # Android emulator → host machine
EXPO_PUBLIC_API_URL=http://192.168.1.20:8031              # a real phone on the same wifi
```

Restart Metro after changing it; the value is compiled into the bundle. A build
with no API configured says so on the sign-in screen, rather than failing every
request with something that reads like an outage.

The request timeout is 30 seconds because the deployment idles its container
out — the first request after a quiet period pays for a cold start.

## Signing in

Email and password, against `POST /api/v1/auth/login`. There is no demo account
and no bypass — the app has nothing to show that the backend has not given it.
Accounts are created by the society office, which issues a temporary password of
`<phone>@iverto`; that account comes back with `mustChangePassword` and the
router will show it exactly one screen until it is replaced.

What appears afterwards is decided entirely by `GET /api/v1/mobile/me/contexts`:
one row per (scope, role) the account holds, and the app mounts a different
navigation tree per `type`. The caret beside the place name in the header
switches between them — except for a guard, who is fixed to their posting. An
account with no rows is told so, rather than dropped into an empty resident
shell.

**The guard shell needs a `gates[]` array in that response, and no deployment
sends one yet.** A society role of `GUARD` with no gate posting has no `gateId`,
and every guard screen is `/mobile/gates/{gateId}/…`, so the front door says "No
gate assigned" instead. `API.md` §4.4 has the shape it needs.

## Building

The Android project is checked in (bare workflow, per §2), so the build needs
no Expo account and no cloud.

```bash
cd android
./gradlew assembleRelease bundleRelease
# → android/app/build/outputs/apk/release/app-release.apk
# → android/app/build/outputs/bundle/release/app-release.aab
```

Requires JDK 17 and an Android SDK with platform 36 / build-tools 36.0.0. Set
`JAVA_HOME` and `ANDROID_HOME` (or write `sdk.dir` into
`android/local.properties`) first.

**[`BUILDING.md`](./BUILDING.md) is the full guide** — debug vs release, APK vs
AAB, creating a keystore and wiring it in, verifying which key actually signed
a build, testing an AAB with bundletool, Play App Signing, CI, and the errors
each of those produces when it goes wrong.

Two things worth knowing before any release build:

- **The API URL is compiled in.** Release takes it from `expo.extra.apiUrl` in
  `app.json` unless `EXPO_PUBLIC_API_URL` is set in the build environment — so
  check which one you are shipping before you ship it.
- **Signing falls back silently.** Credentials live in
  `android/keystore.properties`, which is not committed. Without it the build
  succeeds on the debug key — the APK runs, it just is not shippable, and
  nothing tells you until you verify it or Play rejects it.

R8 minification is off for this build. The proguard rules the Iverto.ai app
uses are known-good for this library set and should go back on before the
pilot, but a first build is not the place to debug a stripped release.
