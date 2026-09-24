/**
 * Motion — the app's animation vocabulary, in one place.
 *
 * Built on React Native's own `Animated`, deliberately. The obvious alternative
 * is `react-native-reanimated`, and it would be the right call for gesture-
 * driven work; this app has none. What it has is entrances, press feedback and
 * one sheet, all of which `Animated` drives natively — and Reanimated's worklet
 * runtime plus its native library is several MB of APK for effects that do not
 * need it. Nothing here adds a dependency.
 *
 * Three rules the rest of the app relies on:
 *
 *   1. NATIVE DRIVER ONLY. Everything below animates `opacity` and `transform`
 *      and nothing else, so the animation runs on the UI thread and keeps 60 fps
 *      while JS is busy parsing the response that is about to replace it. That
 *      is also why nothing here animates colour, height or `elevation` — those
 *      cannot cross to the native driver, and a JS-driven animation stutters at
 *      exactly the moment it is most visible. Layout changes use
 *      `animateLayout()` instead, which is the platform's own layout animator.
 *
 *   2. ENTRANCES PLAY ONCE, ON MOUNT. `Appear` runs its animation from a
 *      mount-only effect. Re-rendering a card must never replay it — a list that
 *      re-fades every time a socket event lands is worse than one that never
 *      animates at all.
 *
 *   3. REDUCED MOTION IS HONOURED. A user who has asked the OS to cut down on
 *      animation gets the final frame immediately, never a frozen blank one.
 */
import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  StyleProp,
  StyleSheet,
  TextStyle,
  UIManager,
  View,
  ViewStyle,
} from 'react-native';

/* Old-architecture Android needs this opt-in before `LayoutAnimation` does
   anything. Called at import so any module that reaches for `animateLayout()`
   is already covered.

   Fabric enables layout animations itself and turns the call into a no-op that
   warns in dev, so it is skipped there — `nativeFabricUIManager` on the global
   is how the renderer announces itself. `animateLayout()` works on both. */
const isFabric = (globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager != null;

if (Platform.OS === 'android' && !isFabric && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ------------------------------------------------------------------ Tokens */

/**
 * Durations, in milliseconds. Short on purpose: this is a utility app that
 * people open to check one thing, and every animation below sits between them
 * and that thing. Anything past ~350 ms stops reading as polish and starts
 * reading as lag.
 */
export const duration = {
  /** Press feedback and other responses to a finger. */
  fast: 140,
  /** The default — entrances, cross-fades, tab changes. */
  base: 240,
  /** Sheets and anything travelling a long distance. */
  slow: 320,
  /** Counters rolling up to their value. */
  count: 700,
};

export const ease = {
  /** Decelerating. Everything arriving on screen uses this. */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** Accelerating. Only for things leaving. */
  in: Easing.bezier(0.55, 0, 1, 0.45),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
};

/** Gap between one item's entrance and the next one's. */
const STAGGER_STEP = 45;

/**
 * How many steps the stagger climbs before it flattens out. Without a cap the
 * twentieth row of a history list would wait almost a second to appear, which
 * is not a stagger any more — it is a queue.
 */
const STAGGER_CAP = 8;

const staggerDelay = (index: number) => Math.min(index, STAGGER_CAP) * STAGGER_STEP;

/* --------------------------------------------------------- Reduced motion */

/**
 * Read once at import and kept current by the OS listener.
 *
 * An entrance needs the answer *at mount*, and `isReduceMotionEnabled()` is
 * async — a component asking for itself would not have it in time and would
 * animate anyway on the first frame. So the module asks once, at startup, and
 * every animation below reads the cached answer synchronously.
 */
let reduced = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => {
    reduced = on;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
  reduced = on;
});

/** True when the OS has been asked to cut down on animation. */
export const prefersReducedMotion = () => reduced;

/* ------------------------------------------------------------ animateLayout */

/**
 * Animates the *next* layout pass — the one thing here that is not on the
 * native driver, because the platform runs it itself.
 *
 * Reach for this when something changes size or comes and goes in a flow:
 * a note appearing above a form, a row leaving a list, a section expanding.
 * Call it immediately before the `setState` that causes the change.
 */
export function animateLayout(ms: number = duration.base) {
  if (reduced) return;
  LayoutAnimation.configureNext(
    LayoutAnimation.create(ms, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity)
  );
}

/* ------------------------------------------------------------------ Appear */

type AppearProps = {
  children: React.ReactNode;
  /** Position in a group. Turns a set of entrances into a stagger. */
  index?: number;
  /** Extra hold before this one starts, on top of `index`. */
  delay?: number;
  /** How far it travels, in dp. Negative comes down from above. */
  distance?: number;
  /** Starting scale. 1 keeps it a pure fade-and-rise. */
  scale?: number;
  /**
   * Applied to the animated wrapper, not to the child. Anything positional —
   * `flex: 1` in particular — has to be passed here, because the wrapper is now
   * the flex child and the original element is one level in.
   */
  style?: StyleProp<ViewStyle>;
};

/**
 * Fades and lifts its child in, once, when it mounts.
 *
 * Remounting is what replays it, which is exactly the behaviour a screen wants:
 * swapping a skeleton for the real content mounts new elements and they arrive;
 * a refetch that lands the same rows leaves them mounted and still.
 */
export function Appear({
  children,
  index = 0,
  delay = 0,
  distance = 12,
  scale = 1,
  style,
}: AppearProps) {
  /* Starts at the finish line under reduced motion, so the child is on screen
     from the first frame and no animation is ever scheduled. */
  const t = React.useRef(new Animated.Value(reduced ? 1 : 0)).current;

  React.useEffect(() => {
    if (reduced) return;
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: duration.base,
      delay: delay + staggerDelay(index),
      easing: ease.out,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    /* Mount only — see rule 2 in the file header. A changing `index` must not
       re-run the entrance, or a list that re-sorts would flicker. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transform = [
    ...(distance !== 0
      ? [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }]
      : []),
    ...(scale !== 1
      ? [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [scale, 1] }) }]
      : []),
  ];

  return (
    <Animated.View style={[{ opacity: t, transform }, style]}>{children}</Animated.View>
  );
}

/* ----------------------------------------------------------------- Stagger */

/**
 * Gives every child its own `Appear`, one after the next.
 *
 * Fragments are flattened first. Screens are written as
 * `{loading ? <Skeleton/> : <>{a}{b}{c}</>}`, and without flattening that whole
 * branch would count as one child and arrive in a single block — which is the
 * one thing a stagger exists to avoid.
 */
export function Stagger({
  children,
  from = 0,
  distance,
  style,
}: {
  children: React.ReactNode;
  /** Index the first child starts at, for a list that continues another group. */
  from?: number;
  distance?: number;
  /** Applied to every child's wrapper. */
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <>
      {flatten(children).map(({ node, key }, i) => (
        <Appear key={key} index={from + i} distance={distance} style={style}>
          {node}
        </Appear>
      ))}
    </>
  );
}

/**
 * Children in render order, with fragments dissolved, each paired with a key
 * that does not move when its neighbours come and go.
 *
 * The key is the whole reason this is not four lines. Wrapping children changes
 * who React reconciles against what, and keying the wrappers by their position
 * in the *rendered* list would mean a strip appearing at the top — an emergency
 * alert landing on the admin dashboard, a curfew banner arriving a moment after
 * the counters — shifts every key below it by one. React would read that as
 * "these are all different elements now" and remount the lot: entrances replay,
 * horizontal filter bars jump back to the left, and anything half-typed is
 * gone.
 *
 * `React.Children.toArray` is what avoids it. It hands back a key per child
 * derived from that child's own key, or failing that from its position in the
 * source — and, crucially, that position does not shift when a sibling renders
 * `null`, because React counts the slot either way. Fragment children are
 * prefixed with the fragment's key so the same guarantee survives a level down.
 */
function flatten(
  children: React.ReactNode,
  prefix = ''
): { node: React.ReactNode; key: string }[] {
  const out: { node: React.ReactNode; key: string }[] = [];
  React.Children.toArray(children).forEach((child, i) => {
    /* `toArray` keys elements and leaves bare strings and numbers alone, so
       those fall back to their position — they hold no state worth preserving. */
    const key = prefix + (React.isValidElement(child) ? String(child.key) : `#${i}`);
    if (React.isValidElement(child) && child.type === React.Fragment) {
      out.push(...flatten((child.props as { children?: React.ReactNode }).children, `${key}/`));
      return;
    }
    out.push({ node: child, key });
  });
  return out;
}

/* ------------------------------------------------------------ Press motion */

/**
 * The app's touch feedback: the surface dips under the finger and springs back.
 *
 * Spread `pressProps` onto a `Pressable` and `style` onto an `Animated.View`
 * inside it. Two springs rather than one, because press-in and press-out are
 * different gestures: going down is immediate and dead flat, coming back up is
 * allowed a little overshoot, which is what makes a tap feel answered rather
 * than merely registered.
 */
export function usePressMotion(to = 0.97) {
  const scale = React.useRef(new Animated.Value(1)).current;

  const pressProps = React.useMemo(() => {
    if (reduced) return {};
    return {
      onPressIn: () => {
        Animated.spring(scale, {
          toValue: to,
          speed: 50,
          bounciness: 0,
          useNativeDriver: true,
        }).start();
      },
      onPressOut: () => {
        Animated.spring(scale, {
          toValue: 1,
          speed: 20,
          bounciness: 8,
          useNativeDriver: true,
        }).start();
      },
    };
  }, [scale, to]);

  return { pressProps, style: { transform: [{ scale }] } };
}

/* ------------------------------------------------------------------- Pop */

/**
 * Springs between two scales when `on` flips — a checkbox filling in, a tab
 * icon taking focus. Unlike `Appear` this *is* meant to re-run on every change.
 */
export function usePop(on: boolean, { from = 0.6, to = 1 }: { from?: number; to?: number } = {}) {
  const t = React.useRef(new Animated.Value(on ? 1 : 0)).current;

  React.useEffect(() => {
    if (reduced) {
      t.setValue(on ? 1 : 0);
      return;
    }
    const anim = Animated.spring(t, {
      toValue: on ? 1 : 0,
      speed: 18,
      bounciness: on ? 12 : 0,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [on, t]);

  return {
    progress: t,
    style: {
      opacity: t,
      transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) }],
    },
  };
}

/* ---------------------------------------------------------------- CountUp */

/**
 * A number that rolls up to its value instead of appearing at it.
 *
 * Only whole numbers within a sane range count: the tiles this renders hold
 * counts of passes, and anything else — an em dash, a formatted total, a value
 * the server has not sent yet — is drawn as-is rather than mangled into a
 * number. Counting also stops at four figures, past which the digits change too
 * fast to read and the effect is just noise.
 *
 * The driver has to be the JS one — text content is not a native prop — so the
 * listener rounds before it sets state, and React drops the re-render whenever
 * the rounded value has not moved. A tile counting to 4 re-renders five times,
 * not sixty.
 */
export function CountUp({
  value,
  style,
  numberOfLines,
  adjustsFontSizeToFit,
  minimumFontScale,
}: {
  value: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}) {
  const target = Number(value);
  const countable =
    value.trim() !== '' && Number.isInteger(target) && target >= 0 && target < 10000;

  const [shown, setShown] = React.useState(0);
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!countable) return;
    if (reduced) {
      setShown(target);
      return;
    }
    const id = progress.addListener(({ value: v }) => setShown(Math.round(v)));
    const anim = Animated.timing(progress, {
      toValue: target,
      duration: duration.count,
      easing: ease.out,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) setShown(target);
    });
    return () => {
      anim.stop();
      progress.removeListener(id);
    };
  }, [countable, target, progress]);

  return (
    <Animated.Text
      style={style}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
    >
      {countable ? String(shown) : value}
    </Animated.Text>
  );
}

/* ---------------------------------------------------------------- LiveDot */

/**
 * A status dot with a halo pulsing out of it, for the states that are still
 * moving — an approval waiting on a household, a maid currently inside.
 *
 * The pulse is the point: it says "this is live, it may change while you are
 * looking at it", which a static dot cannot. Statuses that have settled get the
 * plain dot and no loop, so nothing is animating on a screen full of decided
 * passes.
 */
export function LiveDot({ color, size = 6 }: { color: string; size?: number }) {
  const t = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      {/* Absolutely positioned so the halo can grow past the dot without
          widening the pill it sits in. */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          },
        ]}
      />
      <View
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
      />
    </View>
  );
}

/* ---------------------------------------------------------------- useFade */

/**
 * Fades a value in or out when `on` flips, with an optional hold before the
 * *first* run only.
 *
 * `usePop` springs and scales, which is right for a control answering a
 * finger. This is for things that light up rather than move: a window in the
 * drawn tower, the spill of light around it, a lamp on a gate pillar. The
 * first-run delay is what turns a facade full of windows into a building
 * waking up one flat at a time instead of a grid switching on at once.
 *
 * Later changes skip the delay, because by then the light coming on *is* the
 * event — a staff member walking in should not wait half a second for their
 * floor to acknowledge it.
 */
export function useFade(
  on: boolean,
  { delay = 0, duration: ms = duration.base }: { delay?: number; duration?: number } = {}
) {
  const t = React.useRef(new Animated.Value(reduced ? (on ? 1 : 0) : 0)).current;
  const first = React.useRef(true);

  React.useEffect(() => {
    const wasFirst = first.current;
    first.current = false;

    if (reduced) {
      t.setValue(on ? 1 : 0);
      return;
    }
    const anim = Animated.timing(t, {
      toValue: on ? 1 : 0,
      duration: ms,
      delay: wasFirst ? delay : 0,
      easing: ease.out,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    /* `delay` is read on the first run and irrelevant after, so it is not a
       dependency — changing it must not restart a light that is already on. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ms, t]);

  return t;
}

/* -------------------------------------------------------------- useBreathe */

/**
 * A slow loop between 0 and 1, for anything alive but idle: the halo around
 * the sun, a lamp on a gate pillar, the shimmer under a loading skeleton.
 *
 * `period` is the round trip. `hold` pauses at the bottom of each cycle, which
 * is what keeps a screenful of these from marching in step — give two lamps
 * different holds and they drift apart on their own, with no phase bookkeeping
 * and no `setTimeout` to clean up.
 *
 * Returns the raw value rather than a style: callers interpolate it into
 * opacity, scale, or both, and every one of those crosses to the native
 * driver.
 */
export function useBreathe({
  period = 3200,
  hold = 0,
  /** Where it sits when the OS has asked for less motion. */
  still = 0.55,
}: { period?: number; hold?: number; still?: number } = {}) {
  const t = React.useRef(new Animated.Value(reduced ? still : 0)).current;

  React.useEffect(() => {
    if (reduced) {
      t.setValue(still);
      return;
    }
    const half = period / 2;
    const loop = Animated.loop(
      Animated.sequence([
        /* Not `Animated.delay`: that one hardcodes `useNativeDriver: false`,
           and a JS-driven step inside an otherwise native loop is exactly the
           stutter this whole file exists to avoid. Holding the value where it
           already is, for `hold` milliseconds, is the same pause on the same
           thread. */
        Animated.timing(t, {
          toValue: 0,
          duration: hold,
          easing: ease.inOut,
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 1,
          duration: half,
          easing: ease.inOut,
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: half,
          easing: ease.inOut,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [period, hold, still, t]);

  return t;
}

/* ---------------------------------------------------------------- useShake */

/**
 * Two quick shakes sideways when `trigger` changes to something truthy — a
 * wrong OTP, a code the gate refuses.
 *
 * Deliberately small (6 dp) and short: this is the app saying "not that",
 * beside an error message that says why. Never fires on mount, so a screen
 * restored with an error already in state does not shake at someone who has
 * not typed anything yet.
 */
export function useShake(trigger: unknown) {
  const x = React.useRef(new Animated.Value(0)).current;
  const first = React.useRef(true);

  React.useEffect(() => {
    const wasFirst = first.current;
    first.current = false;
    if (wasFirst || !trigger || reduced) return;

    const step = (to: number) =>
      Animated.timing(x, { toValue: to, duration: 55, easing: ease.inOut, useNativeDriver: true });
    const seq = Animated.sequence([step(-6), step(6), step(-4), step(4), step(0)]);
    seq.start();
    return () => seq.stop();
  }, [trigger, x]);

  return { transform: [{ translateX: x }] };
}
