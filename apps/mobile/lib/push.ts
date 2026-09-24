/**
 * Firebase Cloud Messaging — the half of realtime that survives the app being
 * closed.
 *
 * The socket in `lib/api/realtime.ts` is deliberately foreground-only: it is
 * torn down when the app goes to the background, because a socket held open
 * behind a locked screen costs battery and buys nothing. **This module is what
 * makes that safe.** A visitor at the barrier has ninety seconds; if the phone
 * is in a pocket, the only thing that will reach the resident in time is a
 * push, and the only thing that will reach them at all is FCM.
 *
 * ── The one rule ───────────────────────────────────────────────────────────
 *
 * A push is a *notification*, not data. `applyServerEvent` — the same function
 * the socket calls, from the same file — is what turns it into screen updates,
 * and it reads exactly two things out of any frame: what happened and which
 * scopes it touched. Everything drawn afterwards comes from a refetch.
 *
 * That is the design `realtime.ts` was written against ("when FCM lands, the
 * background handler decodes the same payload and calls the same function, so
 * push and socket cannot drift apart"), and it is why a stale or reordered
 * push cannot put a wrong fact on screen. It can only cause a refetch that was
 * going to be right anyway.
 *
 * ── The five types ─────────────────────────────────────────────────────────
 *
 * §5.4 of the API document defines a `data.type` on every push, precisely so a
 * client can route without parsing display text. `CHANNELS` below is that
 * table, and it is the only place in the app that knows what each type means:
 *
 *   VISITOR_APPROVAL   someone is at the gate, ninety seconds — MAX, buzzes
 *   DELIVERY_APPROVAL  a parcel needs a decision                — MAX, buzzes
 *   DELIVERY_ARRIVED   a standing rule already answered         — DEFAULT
 *   DELIVERY_SILENT    LEAVE_AT_GATE with `silent: true`        — LOW, mute
 *   STAFF_MOVEMENT     a household staff scan matched           — LOW
 *
 * The channels are not decoration. On Android 8 and up **the channel, not the
 * payload, decides whether a phone makes a sound**, and a channel's importance
 * is fixed at creation — the app cannot raise it later, only the user can. So
 * an approval must be born on a MAX channel or it will never buzz through, and
 * `DELIVERY_SILENT` must be born on a separate LOW one or the resident's
 * eleven-o'clock Blinkit order wakes the house. Two facts, two channels; they
 * cannot be one channel reconfigured per message.
 *
 * **And the service has to name one.** For a push that lands while the app is
 * backgrounded or killed — every push that matters — the channel is picked
 * natively, before any of this file runs, from `notification.channelId` or
 * `data.channelId` on the message. Nothing here can influence it at that
 * moment. Without one, expo-notifications falls back to a single HIGH channel
 * of its own: pushes still arrive and still buzz, but every one of them buzzes
 * the same, and `DELIVERY_SILENT` is as loud as a stranger at the door. The
 * ids below are the contract — `backend-changes-required.md` §16.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 *
 * No local notification is ever *composed* here. The service sends the title
 * and body; this module decides whether to show what arrived, on which
 * channel, and where a tap lands. An app that wrote its own copy for a push
 * would be a second place the product's wording lives, and the two would
 * disagree within a release.
 *
 * There is also no unregister call: the service exposes
 * `POST /mobile/me/device-token` and nothing that deletes one. Sign-out
 * therefore stops *this* app from registering again; it does not tell the
 * backend to stop sending. That is a real gap and it is the backend's to
 * close — see `backend-changes-required.md`.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as api from '@/lib/api';
import { applyServerEvent, type ServerEvent } from '@/lib/api';
import type { Context } from '@/types';

/* ------------------------------------------------------------ The catalog */

/** `data.type` on every push the service sends — §5.4. */
export type PushType =
  | 'VISITOR_APPROVAL'
  | 'DELIVERY_APPROVAL'
  | 'DELIVERY_ARRIVED'
  | 'DELIVERY_SILENT'
  | 'STAFF_MOVEMENT';

type ChannelSpec = {
  id: string;
  name: string;
  description: string;
  importance: Notifications.AndroidImportance;
  /** Null is a silent channel. `undefined` would mean "the system default". */
  sound: string | null;
  vibrate: number[] | null;
  /** Where a tap on this kind of push should land. */
  route: string;
};

/**
 * One channel per kind of interruption, keyed by `data.type`.
 *
 * Named for what they interrupt you *about*, because these strings are what
 * the resident reads in Android's notification settings when they go looking
 * for the one that woke them — "Deliveries, quiet" is a setting somebody can
 * act on; "channel-3" is not.
 */
const CHANNELS: Record<PushType, ChannelSpec> = {
  VISITOR_APPROVAL: {
    id: 'approvals',
    name: 'Someone at the gate',
    description:
      'A visitor is waiting and the household has ninety seconds to answer. These are the only notifications this app will ever interrupt you for.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrate: [0, 250, 250, 250],
    route: '/resident',
  },
  DELIVERY_APPROVAL: {
    /* The same channel as a visitor, on purpose: an ASK_ME parcel is on the
       same ninety-second clock and is refused in the same way if it is missed.
       A resident who wants deliveries quieter has a delivery *rule* for that —
       muting the channel would silence the visitor at the door too. */
    id: 'approvals',
    name: 'Someone at the gate',
    description:
      'A visitor is waiting and the household has ninety seconds to answer. These are the only notifications this app will ever interrupt you for.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrate: [0, 250, 250, 250],
    route: '/resident',
  },
  DELIVERY_ARRIVED: {
    id: 'deliveries',
    name: 'Deliveries',
    description: 'A parcel arrived and one of your standing rules already answered for it.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrate: [0, 200],
    route: '/resident/log',
  },
  DELIVERY_SILENT: {
    /* `silent: true` on a LEAVE_AT_GATE rule. The resident asked to be told,
       not woken — so this is a separate channel at LOW with no sound and no
       vibration, which is the only way Android will honour that. */
    id: 'deliveries-silent',
    name: 'Deliveries, quiet',
    description:
      'Parcels left at the gate under a rule you marked silent. Logged without a sound.',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrate: null,
    route: '/resident/log',
  },
  STAFF_MOVEMENT: {
    id: 'staff',
    name: 'Household staff',
    description: 'Your maid, cook or driver was recognised at a gate.',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrate: null,
    route: '/resident/staff',
  },
};

/**
 * The channel a push with no recognisable `type` lands on.
 *
 * Android will not display a notification whose channel does not exist, so
 * something has to catch a `type` this build has never heard of — a new one
 * the service adds after this APK ships. DEFAULT rather than MAX: an unknown
 * message is worth showing and is not worth waking somebody for.
 */
const FALLBACK: ChannelSpec = {
  id: 'general',
  name: 'Everything else',
  description: 'Notices from your society and anything this version of the app does not recognise.',
  importance: Notifications.AndroidImportance.DEFAULT,
  sound: 'default',
  vibrate: [0, 200],
  route: '/',
};

/* -------------------------------------------------------- Reading a payload */

/**
 * FCM stringifies every value in `data`.
 *
 * A `unitId` arrives as a string, and so does a nested object — as JSON, if it
 * arrives at all. Both are read defensively here rather than at three call
 * sites, because the alternative is a routing bug that only reproduces on a
 * real push to a real phone.
 */
type PushData = Record<string, unknown> & {
  type?: string;
  unitId?: string;
  gateId?: string;
  societyId?: string;
};

function dataOf(notification: Notifications.Notification): PushData {
  const raw = notification?.request?.content?.data;
  return (raw ?? {}) as PushData;
}

function specFor(data: PushData): ChannelSpec {
  const type = typeof data.type === 'string' ? data.type : '';
  return CHANNELS[type as PushType] ?? FALLBACK;
}

/**
 * A push, read as the socket would read the same fact.
 *
 * `applyServerEvent` wants scope ids and nothing else, and a push carries them
 * flat as strings. Anything it cannot find leaves the frame scopeless, which
 * that function already handles by sweeping every mounted query — the blunt
 * answer, and the correct one when the app has been told something changed and
 * cannot tell where.
 */
function eventOf(data: PushData): ServerEvent {
  return {
    type: typeof data.type === 'string' ? data.type : undefined,
    unitId: typeof data.unitId === 'string' ? data.unitId : null,
    gateId: typeof data.gateId === 'string' ? data.gateId : null,
    societyId: typeof data.societyId === 'string' ? data.societyId : null,
  };
}

/* -------------------------------------------------------------- The handler */

/**
 * What to do with a push that lands while the app is open and on screen.
 *
 * Set at module scope, because expo-notifications reads it the moment a
 * notification arrives and that can be before any component has mounted.
 *
 * A foreground banner is still shown for approvals. The resident may well be
 * on the passcodes screen when somebody arrives at the gate, and "they were
 * technically in the app" is not a reason to let a ninety-second window pass
 * silently — the queue badge alone is too quiet for a countdown. Silent
 * deliveries and staff movements are the opposite case: those refresh the
 * screen and say nothing.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const spec = specFor(dataOf(notification));
    const quiet = spec.importance <= Notifications.AndroidImportance.LOW;
    return {
      shouldShowBanner: !quiet,
      /* Even a silent delivery belongs in the tray — the resident should be
         able to find out at breakfast that something was left at the gate. */
      shouldShowList: true,
      shouldPlaySound: !quiet && spec.sound !== null,
      shouldSetBadge: false,
      priority: quiet
        ? Notifications.AndroidNotificationPriority.LOW
        : Notifications.AndroidNotificationPriority.MAX,
    };
  },
});

/* ------------------------------------------------------------- Registration */

/**
 * Create every channel this app can send on, before the first push arrives.
 *
 * Idempotent — Android upserts by id — but *not* retroactive: importance is
 * fixed when a channel is created and cannot be raised by the app afterwards.
 * Changing an importance here therefore does nothing on a phone that already
 * has the channel; it needs a new id. That is the platform's rule, not a
 * choice, and it is why the ids read as names rather than versions.
 */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const specs = [...Object.values(CHANNELS), FALLBACK];
  const seen = new Set<string>();

  for (const spec of specs) {
    /* VISITOR_APPROVAL and DELIVERY_APPROVAL deliberately share one. */
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    await Notifications.setNotificationChannelAsync(spec.id, {
      name: spec.name,
      description: spec.description,
      importance: spec.importance,
      /* `null`, not `undefined`. The channel input treats null as "no sound"
         and an absent key as "whatever Android defaults to" — which for the
         quiet channels is the opposite of what was asked for. */
      sound: spec.sound,
      vibrationPattern: spec.vibrate,
      enableVibrate: !!spec.vibrate,
      /* A visitor's name on a lock screen is the household's business and the
         bus queue's is not. PRIVATE hides the content until the phone is
         unlocked, and still shows that something arrived. */
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    }).catch(() => {
      /* A channel that will not create is a notification that will not show,
         and there is nothing the app can do about it at this point. It must
         not take the sign-in with it. */
    });
  }
}

/** The last token this app successfully registered, so it is not re-sent. */
let registeredToken: string | null = null;

/**
 * Ask for permission, get the FCM token, hand it to the service.
 *
 * Returns the token, or null for every ordinary reason it could not get one —
 * an emulator with no Play Services, a resident who said no, a build with no
 * `google-services.json`. None of those are errors worth a screen: push is an
 * enhancement to a socket that already works while the app is open, so failing
 * to register must never be the thing that stops somebody using the app.
 *
 * The permission prompt is deliberately *not* fired on the login screen. It is
 * asked for after a session exists, which is the first moment the request makes
 * sense to the person answering it — Android 13 gives an app exactly one
 * chance at this dialog, and one spent before the user knows what the app is
 * is a resident who never gets told a visitor is downstairs.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    await ensureChannels();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return null;

    /* Throws rather than returning null wherever FCM is unavailable — a
       simulator, an emulator image without Play Services, a build whose
       `google-services.json` never made it in. Every one of those is caught
       below and answered with null: push is an enhancement to a socket that
       already works while the app is open, and none of them are a reason a
       resident cannot use the app. It is attempted on an emulator rather than
       skipped, because a Play-Services image *can* receive a real push and
       that is where this gets tested. */
    const token = await Notifications.getDevicePushTokenAsync();
    const value = typeof token?.data === 'string' ? token.data : null;
    if (!value) return null;

    if (value !== registeredToken) {
      /* The service upserts on the token itself, so re-registering the same
         one is harmless — but it is a request a guard's phone makes on a gate
         connection, so it is skipped when nothing changed. */
      await api.registerDeviceToken(value, Platform.OS === 'ios' ? 'ios' : 'android');
      registeredToken = value;
    }
    return value;
  } catch {
    return null;
  }
}

/** Sign-out. See the file header: the service has no delete for a token. */
export function forgetPushRegistration() {
  registeredToken = null;
}

/* ----------------------------------------------------------------- The hook */

/**
 * Wire push into a signed-in session.
 *
 * Mounted once, inside `AuthProvider`, by `components/Push.tsx`. It does four
 * things and no more:
 *
 *   1. registers the device once a usable session exists
 *   2. re-registers when FCM rolls the token mid-session
 *   3. refreshes the cache on every push, foreground or not, through
 *      `applyServerEvent` — the same path the socket uses
 *   4. routes a tap to the screen the notification was about, switching to the
 *      right home first when the resident has more than one
 *
 * `contexts` and `setContext` are passed in rather than read from `useAuth`
 * because this hook is what `AuthProvider` mounts; taking the auth context
 * from inside it would be a cycle.
 */
export function usePushNotifications(options: {
  /** True once there is a token and the account has cleared its onboarding password. */
  enabled: boolean;
  /**
   * True once the router exists.
   *
   * A cold start *from* a notification tap resolves the tap before the
   * navigator has mounted, and a `navigate` issued then goes nowhere — the
   * resident taps a visitor alert and lands on the home screen, which is the
   * one case where push has to work. So a route decided too early is held and
   * replayed rather than fired into a router that is not there yet.
   */
  navigationReady: boolean;
  contexts: Context[];
  setContext: (id: string) => void;
}) {
  const { enabled, navigationReady, contexts, setContext } = options;

  /* Read through a ref inside the listeners: they are subscribed once, and a
     tap must route against the contexts the app holds *now*, not the ones it
     held when the subscription was made. */
  const latest = useRef({ contexts, setContext });
  latest.current = { contexts, setContext };

  /* A cold start from a notification tap must be handled exactly once. The
     response is still returned by `getLastNotificationResponseAsync` after it
     has been acted on, so without this a later foreground would re-route. */
  const handled = useRef<string | null>(null);

  /* A tap decided before the router existed. Replayed by the effect below. */
  const queued = useRef<PushData | null>(null);
  const readyRef = useRef(navigationReady);
  readyRef.current = navigationReady;

  /**
   * Send the app where the notification was about.
   *
   * The flat comes first. A resident with two homes who is currently acting
   * as the other one would otherwise tap a visitor alert and land on a home
   * screen showing a different door's empty queue — which reads as "the
   * request is gone" at the exact moment it is counting down.
   */
  const routeTo = useCallback((data: PushData) => {
    if (!readyRef.current) {
      queued.current = data;
      return;
    }
    const spec = specFor(data);
    const { contexts: list, setContext: choose } = latest.current;

    if (typeof data.unitId === 'string') {
      const home = list.find((c) => c.type === 'UNIT' && c.unitId === data.unitId);
      /* Only if they still hold it. A push can outlive a tenancy. */
      if (home) choose(home.id);
    }

    /* `navigate`, not `push`: tapping three delivery alerts should not build
       a stack of three identical log screens to back out of. */
    router.navigate(spec.route as never);
  }, []);

  useEffect(() => {
    if (!navigationReady || !queued.current) return;
    const data = queued.current;
    queued.current = null;
    routeTo(data);
  }, [navigationReady, routeTo]);

  useEffect(() => {
    if (!enabled) {
      forgetPushRegistration();
      return;
    }

    let alive = true;

    void registerForPush();

    /* Arrived while the app is open. The banner is the handler's decision
       above; this is only the refetch, and it runs for silent pushes too —
       that is the entire point of a data-only delivery notification. */
    const received = Notifications.addNotificationReceivedListener((notification) => {
      applyServerEvent(eventOf(dataOf(notification)));
    });

    /* Tapped — from the tray, from the background, or from cold. */
    const responded = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = dataOf(response.notification);
      handled.current = response.notification.request.identifier;
      applyServerEvent(eventOf(data));
      routeTo(data);
    });

    /* FCM can roll a token while the app is running; the old one stops
       delivering the moment it does. */
    const rolled = Notifications.addPushTokenListener((token) => {
      const value = typeof token?.data === 'string' ? token.data : null;
      if (!value || value === registeredToken) return;
      api
        .registerDeviceToken(value, Platform.OS === 'ios' ? 'ios' : 'android')
        .then(() => {
          registeredToken = value;
        })
        .catch(() => {
          /* Next foreground will try again. */
          registeredToken = null;
        });
    });

    /* The app was launched *by* a tap. The listener above does not fire for
       this — the notification was responded to before JS existed. */
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!alive || !response) return;
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const data = dataOf(response.notification);
      applyServerEvent(eventOf(data));
      routeTo(data);
    });

    /**
     * Re-register on foreground.
     *
     * A token can be revoked while the app is closed — a restore to a new
     * phone, a cleared app storage, Play Services rotating it — and the first
     * the app hears of it is that pushes silently stop. Asking again on every
     * foreground is one cheap call that closes that hole; `registeredToken`
     * means it is a no-op whenever nothing moved.
     */
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void registerForPush();
    });

    return () => {
      alive = false;
      received.remove();
      responded.remove();
      rolled.remove();
      appState.remove();
    };
  }, [enabled, routeTo]);
}
