/**
 * Sign in.
 *
 * Email and password, because that is what the service authenticates: a
 * resident is onboarded by the society office, which issues a temporary
 * password of `<phone>@iverto` and marks the account as having to change it.
 * The app does not say that here — a login screen that explains the onboarding
 * password to everyone who reads it has published a password format — it says
 * it on the screen the office sends people to, once they are already inside.
 *
 * It is also the only screen in the app with room to say what the app is *for*,
 * so it says it in a picture rather than a sentence: a block of flats, lit at
 * whatever hour it currently is, with more of its windows coming on as the form
 * fills in. Nobody has to read that to understand it.
 *
 * ── One screenful, never scrolled ──────────────────────────────────────────
 *
 * The form is short enough to be a single page, and a first screen that scrolls
 * reads as a first screen with something hidden below it. So this one does not
 * scroll: it fits itself to the room it has, and the drawing is what gives way.
 *
 * The order is decided top down. The form — lockup, card, footer — takes the
 * height it needs and is measured; the building gets whatever is left, sized to
 * that height rather than to a width (`towerFor` below); and when there is not
 * enough left to draw a building anyone would recognise, it is not drawn.
 *
 * The keyboard is the same problem with a much smaller number. A screen that
 * cannot scroll has to lay out inside what the keyboard leaves visible, so the
 * frame is measured against the keyboard's top edge and the body is padded by
 * the overlap — at which point the building's budget goes to nothing on its own
 * and the tower steps aside without being told to. The decoration that is left
 * (the lockup, the subtitle, the note about the society office, the watermark)
 * is the part nobody is reading while they type, so it stands down for as long
 * as the keys are up, and comes back when they go.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  Pressable,
  useWindowDimensions,
  type LayoutChangeEvent,
  type TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BrandLockup } from '@/components/Logo';
import { ApartmentTower, towerHeight } from '@/components/building';
import { Button, Card, Field, Note, PoweredBy } from '@/components/ui';
import { Appear, useShake } from '@/components/motion';
import { useKeyboardOverlap, useKeyboardVisible } from '@/components/KeyboardAware';
import { colors, spacing, type } from '@/theme';
import { useAuth } from '@/lib/auth';
import { API_CONFIGURED, API_URL } from '@/lib/api';
import { errorCopy } from '@/lib/errors';

/* ------------------------------------------------------- Sizing the drawing */

/** Four flats to a floor, as everywhere else the tower is drawn. */
const TOWER_COLUMNS = 4;

/**
 * Widths the tower is allowed to take.
 *
 * Under the floor there is no drawing left — four columns of eleven-point
 * windows is a texture, not a building — so below it nothing is drawn at all.
 * The cap is what stops a tall screen turning the decoration into the subject.
 */
const TOWER_MIN_WIDTH = 104;
const TOWER_MAX_WIDTH = 168;

/**
 * The tallest building that fits in `budget` points, or null when that is
 * nothing worth drawing.
 *
 * `ApartmentTower` is sized by width and derives its height from it, which is
 * the right way round everywhere else in the app — the tower on a stat card is
 * sized by the card. Here the constraint runs the other way, so the search runs
 * the other way too: tallest first, and for each storey count the widest width
 * whose *drawn* height still fits. `towerHeight` is the drawing's own geometry
 * rather than an estimate of it, which is the difference between a tower that
 * fills the gap and one that has its water tank clipped off by a rounding
 * error.
 *
 * Storeys before width, because a six-floor block at 130 points still reads as
 * a block of flats and a three-floor one at 168 has already spent the budget on
 * a shape that says less. Below `TOWER_MIN_WIDTH` no arrangement reads as a
 * building at all, and nothing is drawn.
 */
function towerFor(budget: number, maxWidth: number) {
  for (const floors of [6, 5, 4, 3]) {
    /* Two points a step: `towerHeight` only moves in whole points and nobody
       can see the difference between a 148-point tower and a 149-point one. */
    for (let width = Math.round(maxWidth); width >= TOWER_MIN_WIDTH; width -= 2) {
      if (towerHeight(width, floors, TOWER_COLUMNS) <= budget) return { width, floors };
    }
  }
  return null;
}

/**
 * How much of the building is awake. A fraction rather than a count, because
 * the tower now has between three and six storeys depending on the phone, and
 * "about a fifth of the flats, then about half" is the thing being said — not
 * "five windows, then eleven".
 */
const LIT_IDLE = 0.21;
const LIT_READY = 0.46;

/* ------------------------------------------------------------------ Screen */

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  /* A refused sign-in is a small "no" and deserves a small one back — the card
     shakes once beside the message that says why. */
  const shake = useShake(error);

  const { width: screenWidth } = useWindowDimensions();
  /* The frame is the full-height body; the overlap is how much of it the
     keyboard is standing on. Padding the body by that overlap is what makes
     everything below lay out inside what is still visible. */
  const { ref: frameRef, overlap, onLayout: remeasure } = useKeyboardOverlap();
  const typing = useKeyboardVisible();

  const [frameHeight, setFrameHeight] = useState(0);
  const [formHeight, setFormHeight] = useState(0);

  const onFrame = useCallback(
    (e: LayoutChangeEvent) => {
      setFrameHeight(e.nativeEvent.layout.height);
      remeasure();
    },
    [remeasure]
  );

  const onForm = useCallback((e: LayoutChangeEvent) => {
    setFormHeight(e.nativeEvent.layout.height);
  }, []);

  const ready = email.includes('@') && password.length > 0;

  /* Height the body actually has: its frame, less its own padding, less
     whatever the keyboard is covering. */
  const room = frameHeight - spacing.lg * 2 - overlap;
  /* And what is left for the building once the form and the gap above it are
     out. Both measurements have to have landed first: a tower sized against a
     form height of zero would be drawn full height and then jump. */
  const measured = frameHeight > 0 && formHeight > 0;
  const heroBudget = room - formHeight - spacing.lg;
  /**
   * The escape hatch, and the reason the body is a `ScrollView` at all.
   *
   * With the drawing gone and the decoration stood down there is nothing left
   * to give, and on a small phone carrying a tall keyboard — or an OS text size
   * turned right up — the form can still want more room than it has. Scrolling
   * a screen that fits would be the bug this screen was rewritten to remove, so
   * it is enabled only when the numbers say the alternative is a "Sign in"
   * button nobody can reach. Everywhere else this is a fixed page.
   */
  const overflowing = measured && formHeight > room;

  /* And when it does overflow, the bottom of the form is the half worth
     keeping: the two fields being typed into and the button they lead to. The
     heading above them can go under the top edge. Without this the screen would
     be scrollable and still be showing the wrong end of itself. */
  useEffect(() => {
    if (!overflowing || !typing) return;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [overflowing, typing]);

  const tower = useMemo(
    () =>
      measured && !typing
        ? towerFor(heroBudget, Math.min(TOWER_MAX_WIDTH, screenWidth * 0.44))
        : null,
    [measured, typing, heroBudget, screenWidth]
  );

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      /* Where to next is the router's decision, not this screen's: an account
         that still has to change its password goes somewhere different from one
         that does not, and only `app/index.tsx` knows about both. */
      router.replace('/');
    } catch (e) {
      /* Worded by `lib/errors.ts`, so a rate-limited 429 says how long to wait
         and an unreachable server does not read as a rejected password. */
      setError(errorCopy(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* `collapsable={false}`: a view Android has optimised away cannot be
          measured, and this one is measured twice — for its own height, and
          against the top edge of the keyboard. */}
      <View ref={frameRef} collapsable={false} onLayout={onFrame} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          scrollEnabled={overflowing}
          showsVerticalScrollIndicator={false}
          /* A tap on the button while the keyboard is up should press the
             button, not spend itself closing the keyboard. */
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          /* `flexGrow`, not `flex`: the content is exactly the height of the
             frame whenever it fits — which is the whole point of the screen —
             and only takes its own height when it does not. */
          contentContainerStyle={[styles.body, { paddingBottom: spacing.lg + overlap }]}
        >
          {tower ? (
            /* Given a height and clipped to it, so the building can never be the
               thing that pushes the form off the bottom of the screen. It stands
               on the form rather than floating above it — hence `flex-end`. */
            <Appear distance={12} style={[styles.hero, { height: heroBudget }]}>
              {/* Windows come on one flat at a time while the screen settles, and
                  more of them once both fields are filled: the building is waking
                  up, and by the time you can press the button it is awake. `lit`
                  is a real count, not a fraction of an opacity, so the change is a
                  light switching on rather than a redraw. */}
              <ApartmentTower
                width={tower.width}
                floors={tower.floors}
                columns={TOWER_COLUMNS}
                seed={9}
                lit={Math.round(tower.floors * TOWER_COLUMNS * (ready ? LIT_READY : LIT_IDLE))}
              />
            </Appear>
          ) : null}

          <Appear distance={12} index={1}>
            <View style={styles.form} onLayout={onForm}>
              {/* The lockup introduces the app to someone who has just opened
                  it. Someone typing their password has been introduced, and on
                  a small phone the fifty points it occupies are the difference
                  between a reachable "Sign in" button and one under the keys. */}
              {!typing ? (
                <BrandLockup
                  size={34}
                  layout="row"
                  tagline="Every gate, one app"
                  style={styles.lockup}
                />
              ) : null}

              <Animated.View style={shake}>
                <Card>
                  <View style={{ gap: spacing.md }}>
                    <View>
                      <Text style={[type.h2, { color: colors.text }]}>Sign in</Text>
                      {!typing ? (
                        <Text style={[type.small, { color: colors.textMuted, marginTop: 2 }]}>
                          One account, in every society you belong to.
                        </Text>
                      ) : null}
                    </View>

                    <Field
                      label="Email"
                      icon="mail-outline"
                      placeholder="you@example.com"
                      keyboardType="email-address"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={email}
                      onChangeText={setEmail}
                      returnKeyType="next"
                      /* Keeps the keyboard up while focus moves to the password —
                         on a screen that lays itself out around the keyboard, a
                         keyboard that closes and reopens is the whole page
                         collapsing and rebuilding between two fields. */
                      blurOnSubmit={false}
                      onSubmitEditing={() => passwordRef.current?.focus()}
                    />

                    <Field
                      label="Password"
                      icon="lock-closed-outline"
                      placeholder="••••••••"
                      secureTextEntry={!reveal}
                      autoComplete="password"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={password}
                      onChangeText={setPassword}
                      inputRef={passwordRef as never}
                      returnKeyType="go"
                      onSubmitEditing={submit}
                      /* Typing a password on a phone at a gate, in sunlight, with
                         one hand. The reveal is not a nicety — and inside the
                         field it costs the layout nothing, where the row it used
                         to sit on was a whole line of a screen with none to
                         spare. */
                      right={
                        <Pressable
                          onPress={() => setReveal((v) => !v)}
                          hitSlop={12}
                          accessibilityRole="button"
                          accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
                        >
                          <Ionicons
                            name={reveal ? 'eye-off-outline' : 'eye-outline'}
                            size={18}
                            color={reveal ? colors.primary : colors.textFaint}
                          />
                        </Pressable>
                      }
                    />

                    {error ? <Note icon="alert-circle-outline" tone="danger" text={error} /> : null}

                    <Button
                      label="Sign in"
                      icon="arrow-forward"
                      loading={busy}
                      disabled={!ready || busy}
                      onPress={submit}
                    />

                    {!typing ? (
                      <Text style={[type.small, { color: colors.textFaint, textAlign: 'center' }]}>
                        Accounts are created by your society office. If you cannot get in, ask them
                        to check the email they registered for you.
                      </Text>
                    ) : null}
                  </View>
                </Card>
              </Animated.View>

              {/* A build that was never pointed at a backend fails every request
                  with a connection error that reads like an outage. Saying so
                  here is cheaper than someone debugging their wifi because
                  `EXPO_PUBLIC_API_URL` was never set. */}
              {!API_CONFIGURED ? (
                <Note
                  icon="construct-outline"
                  tone="danger"
                  text={`No API is configured in this build (${API_URL}). Set EXPO_PUBLIC_API_URL, or expo.extra.apiUrl in app.json, and rebuild.`}
                />
              ) : null}

              {!typing ? <PoweredBy /> : null}
            </View>
          </Appear>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  body: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    /* Only reached when the form is shorter than the room and the building has
       already declined to fill the rest — a very tall screen, or a keyboard
       that leaves an awkward amount behind. The form sits in the middle of what
       is left rather than clinging to the top of it. */
    justifyContent: 'center',
    gap: spacing.lg,
  },
  hero: { alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  form: { gap: spacing.lg },
  lockup: { alignSelf: 'center' },
});
