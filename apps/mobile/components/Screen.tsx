/**
 * Screen scaffolding: scroll container, dashboard header, top bar.
 * All chrome is glass — no coloured header blocks anywhere in the app.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Avatar, GlassPanel } from '@/components/ui';
import { KeyboardAwareScroll } from '@/components/KeyboardAware';
import { Logo } from '@/components/Logo';
import { DoorPlate, Skyline } from '@/components/building';
import { Appear, Stagger, usePop, usePressMotion } from '@/components/motion';
import { TAB_BAR_HEIGHT } from '@/components/TabBar';
import { blur, building, colors, font, radius, shadow, spacing, type } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Plain scrolling screen on the app background.
 *
 * The tab bar is absolutely positioned, so it floats over the scroll view and
 * the content has to reserve room for it. `SafeAreaView` already contributes
 * the bottom inset, so only the bar's own height plus a little breathing room
 * is added here — otherwise the last card ends up half-hidden behind the bar.
 *
 * The scroll container is the keyboard-aware one rather than a plain
 * `ScrollView`, because a screen cannot know in advance whether it holds a
 * field: the passcode sheet, the visitor form and the complaint box all sit on
 * one. Making it the default means "the screen moves so you can see what you
 * are typing" is a property of the app, not something each screen opts in to
 * and one of them forgets.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  clearTabBar = true,
  animate = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Set false on screens without a bottom tab bar (modals, detail pages). */
  clearTabBar?: boolean;
  /**
   * Set false for a screen that would rather run its own entrance, or none.
   * Everything else gets the app's, without asking — same reasoning as the
   * keyboard handling above: a screen cannot be relied on to remember.
   */
  animate?: boolean;
}) {
  /* Each top-level block fades and rises in, one shortly after the next. The
     order is the render order, which is already the order of importance on
     every screen here — the approval you have to answer lands before the
     counters, the counters before the log. */
  const content = animate ? <Stagger>{children}</Stagger> : children;
  const body = padded ? (
    <View style={{ padding: spacing.lg, gap: spacing.lg }}>{content}</View>
  ) : (
    <>{content}</>
  );
  const bottomPad = (clearTabBar ? TAB_BAR_HEIGHT : 0) + spacing.xl;
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {scroll ? (
        <KeyboardAwareScroll extraBottomSpace={bottomPad}>{body}</KeyboardAwareScroll>
      ) : (
        <View style={{ flex: 1, paddingBottom: bottomPad }}>{body}</View>
      )}
    </SafeAreaView>
  );
}

/**
 * Dashboard header. Frosted glass, dark text, role icon on the left.
 *
 * `title` is the *place* — "A-402", "Main Gate" — and `role` the hat being
 * worn there. That way round because a person who owns one flat and rents
 * another needs to know which household they are about to approve a visitor
 * for, and their own name tells them nothing.
 *
 * Which is exactly why a household's place is set in a door plate rather than
 * in the same type as everything around it (`plate`). The flat number is the
 * one word on the screen that changes what every button below it does, and a
 * brass plate with two screws in it is how a building has always said that.
 *
 * The header also ends in a roofline. It is the top of the sky the whole app
 * is painted on (`components/Ambience`), so it finishes where the society
 * starts rather than at an arbitrary rounded rectangle.
 */
export function AppHeader({
  greeting,
  title,
  role,
  meta,
  onSwitch,
  icon = 'person-outline',
  onBell,
  badgeCount,
  plate,
}: {
  greeting: string;
  title: string;
  role?: string;
  meta?: string;
  /**
   * Sets the place in a door plate. True for a household, whose place is a
   * flat with a number on its door; false for a gate or a society office,
   * which are not doors and would look silly wearing one.
   */
  plate?: boolean;
  /**
   * Turns the place into a tap target with a caret beside it. Left undefined
   * for a guard, who has exactly one context and no business switching out of
   * it mid-shift (§4.3) — so the caret only appears when there is genuinely
   * something to choose between.
   */
  onSwitch?: () => void;
  icon?: IconName;
  onBell?: () => void;
  badgeCount?: number;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const bell = usePressMotion(0.88);
  /* "A-402, Palm Grove" is one string from the server and two things to a
     reader: the door, and the place the door is in. The plate takes the door
     and the line beside it takes the rest — and if a tenant's label ever
     arrives without a comma, the whole thing goes on the plate rather than
     being truncated into a guess. */
  const [door, ...place] = title.split(',');
  const around = place.join(',').trim();
  /* Springs when the number arrives, and again whenever it changes. The badge
     is the only thing on a dashboard that can appear without the user having
     done anything, so it is the one thing worth drawing the eye to. */
  const badge = usePop(!!badgeCount, { from: 0.3 });

  return (
    <GlassPanel intensity={blur.header} strong style={styles.header}>
      <StatusBar barStyle="dark-content" />
      {/* Drawn before the content so it stays behind it, and inside the
          panel's own clip so it is flush with the header's bottom edge: the
          glass ends on a rooftop rather than on an arbitrary rounded line. */}
      <Skyline
        width={width}
        height={26}
        seed={5}
        color={building.silhouette}
        style={styles.roofline}
      />
      <View style={[styles.headerPad, { paddingTop: insets.top + spacing.md }]}>
        {/* The header comes *down* onto the screen while the body below rises
            to meet it — negative `distance`, which is the whole difference. */}
        <Appear distance={-8} style={styles.brandStrip}>
          <Logo size={18} />
          <Text style={styles.brandText}>
            Iverto<Text style={{ color: colors.primary }}>.ai</Text>
            <Text style={{ color: colors.textFaint }}> Gate</Text>
          </Text>
        </Appear>
        <Appear distance={-8} index={1} style={styles.headerRow}>
          <Avatar size={46} icon={icon} />
          {/* `minWidth: 0` so the title and meta line inside can actually
              truncate — a flex child defaults to its content as a minimum, and
              without it a long society name pushes the bell off the edge. */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={1}>
              {greeting}
            </Text>
            {onSwitch ? (
              <Pressable
                onPress={onSwitch}
                hitSlop={8}
                style={({ pressed }) => [styles.titleRow, pressed && { opacity: 0.6 }]}
              >
                <Place plate={plate} door={door} around={around} title={title} />
                <Ionicons name="chevron-down" size={15} color={colors.primary} />
              </Pressable>
            ) : (
              <View style={styles.titleRow}>
                <Place plate={plate} door={door} around={around} title={title} />
              </View>
            )}
            {role || meta ? (
              <View style={styles.metaRow}>
                {role ? (
                  <View style={styles.roleChip}>
                    <Text style={[type.caption, { color: colors.primary }]} numberOfLines={1}>
                      {role.toUpperCase()}
                    </Text>
                  </View>
                ) : null}
                {meta ? (
                  <Text
                    style={[type.small, { color: colors.textFaint, flexShrink: 1 }]}
                    numberOfLines={1}
                  >
                    {meta}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <Animated.View style={bell.style}>
            <Pressable onPress={onBell} style={styles.bell} hitSlop={8} {...bell.pressProps}>
              <Ionicons name="notifications-outline" size={20} color={colors.text} />
              {badgeCount ? (
                <Animated.View style={[styles.badge, badge.style]}>
                  <Text style={styles.badgeText}>{badgeCount}</Text>
                </Animated.View>
              ) : null}
            </Pressable>
          </Animated.View>
        </Appear>
      </View>
    </GlassPanel>
  );
}

/**
 * The place, set either as a door plate or as plain type.
 *
 * Pulled out because the switchable and fixed headers render it identically
 * and must keep doing so — a household that can switch and one that cannot are
 * the same household, and having their flat number drawn two different ways
 * depending on how many homes they happen to own would be absurd.
 */
function Place({
  plate,
  door,
  around,
  title,
}: {
  plate?: boolean;
  door: string;
  around: string;
  title: string;
}) {
  if (!plate) {
    return (
      <Text style={[type.h2, { color: colors.text, flexShrink: 1 }]} numberOfLines={1}>
        {title}
      </Text>
    );
  }
  return (
    <>
      <DoorPlate label={door.trim()} />
      {around ? (
        <Text
          style={[type.h3, { color: colors.textMuted, flexShrink: 1 }]}
          numberOfLines={1}
        >
          {around}
        </Text>
      ) : null}
    </>
  );
}

/** Simple titled top bar with an optional back button and right action. */
export function TopBar({
  title,
  subtitle,
  back = true,
  rightIcon,
  onRight,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  rightIcon?: IconName;
  onRight?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const backPress = usePressMotion(0.88);
  const rightPress = usePressMotion(0.88);

  return (
    <GlassPanel intensity={blur.bar} strong style={styles.topBarWrap}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        {back ? (
          <Animated.View style={backPress.style}>
            <Pressable
              onPress={() => router.back()}
              style={styles.iconBtn}
              hitSlop={8}
              {...backPress.pressProps}
            >
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
          </Animated.View>
        ) : (
          <View style={{ width: 38, flexShrink: 0 }} />
        )}
        {/* Both lines are bounded: the subtitle is a unit label, a staff name
            or a gate, any of which would otherwise wrap and make the bar a
            different height on every screen. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.h3, { color: colors.text, textAlign: 'center' }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightIcon ? (
          <Animated.View style={rightPress.style}>
            <Pressable
              onPress={onRight}
              style={styles.iconBtn}
              hitSlop={8}
              {...rightPress.pressProps}
            >
              <Ionicons name={rightIcon} size={20} color={colors.text} />
            </Pressable>
          </Animated.View>
        ) : (
          /* No action on this bar — the slot that balances the back button
             carries the brand mark instead of sitting empty. */
          <View style={styles.barMark}>
            <Logo size={20} />
          </View>
        )}
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
    overflow: 'hidden',
    ...shadow.card,
  },
  headerPad: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  brandStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  brandText: {
    fontFamily: font.semibold,
    fontSize: 13,
    letterSpacing: 0.2,
    color: colors.text,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  roofline: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  roleChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    flexShrink: 0,
  },
  barMark: { width: 38, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    flexShrink: 0,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: font.bold },
  topBarWrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  iconBtn: {
    width: 38,
    height: 38,
    flexShrink: 0,
    borderRadius: radius.md,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
