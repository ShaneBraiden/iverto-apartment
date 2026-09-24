/**
 * Shared presentational components.
 * Purely visual — no data fetching, no global state.
 *
 * Iverto.ai design language: every surface is semi-transparent white glass
 * (rgba(255,255,255,0.8) → 0.9) with a hairline border, soft curves and a
 * neutral float shadow. The brand crimson (#B9000E, sampled from the logo)
 * appears only as an accent — icon tints, the primary button, selected chips,
 * status dots.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  TextInputProps,
  ViewProps,
  ViewStyle,
  StyleProp,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Logo } from '@/components/Logo';
import { useEnsureVisible } from '@/components/KeyboardAware';
import { Appear, CountUp, LiveDot, useBreathe, usePop, usePressMotion } from '@/components/motion';
import {
  blur,
  cardBackground,
  colors,
  glassFill,
  LIFT,
  radius,
  shadow,
  spacing,
  type,
} from '@/theme';
import { statusInfo } from '@/lib/status';
import { errorCopy } from '@/lib/errors';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/* ------------------------------------------------------------ GlassPanel */

/**
 * Frosted surface behind cards, bars and badges.
 *
 * Android gets a flat opaque fill — real blur is too costly there, and an
 * elevated view with a translucent background makes Android render the
 * shadow caster as a hard white rectangle inside the card.
 */
export function GlassPanel({
  children,
  intensity = blur.card,
  style,
  strong,
  onLayout,
}: {
  children: React.ReactNode;
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
  /** Forwarded so a caller can measure the panel — the bottom sheet does. */
  onLayout?: ViewProps['onLayout'];
}) {
  if (Platform.OS === 'android') {
    const fill = strong ? glassFill.strong : glassFill.base;
    return (
      <View onLayout={onLayout} style={[{ backgroundColor: fill }, style]}>
        {children}
      </View>
    );
  }
  const fill = strong ? colors.glassStrong : colors.glass;
  return (
    <BlurView intensity={intensity} tint="light" onLayout={onLayout} style={style}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      {children}
    </BlurView>
  );
}

/* ---------------------------------------------------------------- Button */

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  full = true,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = variant === 'primary';
  const palette: Record<string, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.primary, fg: colors.onPrimary },
    secondary: { bg: colors.glassStrong, fg: colors.text, border: colors.borderStrong },
    ghost: { bg: 'transparent', fg: colors.primary },
    danger: { bg: colors.dangerBg, fg: colors.danger, border: 'rgba(220,38,38,0.22)' },
    success: { bg: colors.successBg, fg: colors.success, border: 'rgba(5,150,105,0.22)' },
  };
  const p = palette[variant];
  const press = usePressMotion(0.96);

  const inner = loading ? (
    <ActivityIndicator color={p.fg} size="small" />
  ) : (
    <>
      {icon ? <Ionicons name={icon} size={18} color={p.fg} style={{ flexShrink: 0 }} /> : null}
      {/* Two buttons sharing a row each get half the width, and half of a
          narrow screen is not much: "Call the resident" or "Confirm
          override" have to be allowed to wrap onto a second line rather than
          be clipped by a fixed height. `flexShrink` lets the label give up
          space to the icon instead of pushing it out of the button. */}
      <Text
        style={[type.bodyMed, { color: p.fg, flexShrink: 1, textAlign: 'center' }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </>
  );

  /* The scale lives on a wrapper rather than on the `Pressable` itself, because
     the Pressable's style is a function of `pressed` and a function style cannot
     carry an `Animated.Value`. The wrapper is now the flex child, so the
     caller's `style` — `{ flex: 1 }` on the paired buttons in a row — goes here
     with it, and the button inside stretches to fill. */
  return (
    <Animated.View style={[full && { alignSelf: 'stretch' }, style, press.style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        {...press.pressProps}
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: p.bg,
            borderColor: p.border ?? 'transparent',
            borderWidth: p.border ? 1 : 0,
            opacity: disabled ? 0.45 : pressed ? 0.92 : 1,
          },
          isPrimary && shadow.lifted,
        ]}
      >
        {isPrimary ? (
          <LinearGradient
            colors={colors.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={styles.btnRow}>{inner}</View>
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  style,
  onPress,
  padded = true,
  strong,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padded?: boolean;
  strong?: boolean;
}) {
  const press = usePressMotion();

  const content = (
    <GlassPanel strong={strong} style={styles.cardInner}>
      <View style={padded ? { padding: spacing.lg } : undefined}>{children}</View>
    </GlassPanel>
  );

  if (!onPress) return <View style={[styles.card, style]}>{content}</View>;

  /* Two things happen on press and they are driven differently on purpose. The
     lift and its deeper shadow are a *style* swap — `elevation` cannot cross to
     the native driver, so animating it would drag the whole card back onto the
     JS thread. The dip under the finger is the animated half, and it is the one
     that has to stay smooth while a socket event is being handled. */
  return (
    <Animated.View style={[style, press.style]}>
      <Pressable
        onPress={onPress}
        {...press.pressProps}
        style={({ pressed }) => [
          styles.card,
          pressed && [shadow.hover, { transform: [{ translateY: LIFT }] }],
        ]}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}

/* ----------------------------------------------------------------- Input */

/**
 * Text field.
 *
 * The keyboard is part of the field, not an afterthought: `keyboardType` picks
 * the right key layout, `returnKeyType` + `onSubmitEditing` chain one field to
 * the next, and `inputRef` is what lets the previous field hand focus over.
 * Multiline fields get a "return means newline" keyboard automatically.
 *
 * On focus the field asks its scroll container to lift it above the keyboard.
 * The container also does this when the keyboard opens, but that event only
 * fires once — without the focus call, tabbing from one field to the next
 * while the keyboard is already up would leave the cursor behind the keys.
 */
export function Field({
  label,
  placeholder,
  icon,
  value,
  multiline,
  keyboardType,
  secureTextEntry,
  hint,
  editable = true,
  maxLength,
  autoCapitalize,
  autoComplete,
  autoCorrect,
  autoFocus,
  returnKeyType,
  onSubmitEditing,
  blurOnSubmit,
  inputRef,
  onChangeText,
  right,
}: {
  label?: string;
  placeholder?: string;
  icon?: IconName;
  value?: string;
  multiline?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  secureTextEntry?: boolean;
  hint?: string;
  editable?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: TextInputProps['autoComplete'];
  /** Off for anything the keyboard must not "help" with — emails, codes, PINs. */
  autoCorrect?: boolean;
  autoFocus?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  /** Pass false when handing focus to the next field, so the keyboard stays up. */
  blurOnSubmit?: boolean;
  /** Lets a previous field call `.focus()` on this one. */
  /* `RefObject<TextInput | null>` and not `RefObject<TextInput>`: from React 19
     `useRef<T>(null)` is typed as nullable, which is honest — the ref is null
     until the input mounts. */
  inputRef?: React.RefObject<TextInput | null>;
  onChangeText?: (t: string) => void;
  right?: React.ReactNode;
}) {
  const ensureVisible = useEnsureVisible();

  return (
    <View style={{ gap: spacing.sm }}>
      {label ? (
        <Text style={[type.smallMed, { color: colors.textMuted }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.input,
          multiline && {
            minHeight: 108,
            height: undefined,
            alignItems: 'flex-start',
            paddingTop: spacing.md,
            paddingBottom: spacing.md,
          },
          !editable && { backgroundColor: colors.glassSoft },
        ]}
      >
        {icon ? (
          <Ionicons name={icon} size={18} color={colors.textFaint} style={{ flexShrink: 0 }} />
        ) : null}
        <TextInput
          ref={inputRef}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          multiline={multiline}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          autoFocus={autoFocus}
          onFocus={() => {
            /* A frame late on purpose: on the first focus the keyboard has not
               finished coming up, and measuring against the old layout would
               scroll to the wrong place. */
            if (ensureVisible) requestAnimationFrame(ensureVisible);
          }}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          returnKeyType={returnKeyType ?? (multiline ? 'default' : 'done')}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={blurOnSubmit ?? !multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={[type.body, { flex: 1, color: colors.text, paddingVertical: 0 }]}
        />
        {right}
      </View>
      {hint ? <Text style={[type.small, { color: colors.textFaint }]}>{hint}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------ StatusPill */

/**
 * Takes a concrete domain state — an approval status, a direction, a complaint
 * — and reads its colour, icon and short label out of `lib/status`. Nothing in
 * the app maps a state to a colour by hand.
 */
export function StatusPill({
  status,
  small,
}: {
  status: string;
  small?: boolean;
}) {
  const m = statusInfo(status);
  const live = m.tone === 'active' || m.tone === 'pending';
  return (
    /* The pill is the trailing item in rows whose leading item is a name or a
       reason. Without `flexShrink` a long label ("Waiting on you") wins
       the layout and pushes the text it sits beside off the card, so it gives
       ground first and truncates rather than overflowing. */
    <View
      style={[styles.pill, { backgroundColor: m.bg }, small && { paddingVertical: 3 }]}
    >
      {/* Only the unsettled states pulse — see `LiveDot`. A screen full of
          decided passes animates nothing. */}
      {live ? <LiveDot color={m.fg} size={6} /> : null}
      <Ionicons name={m.icon as IconName} size={small ? 12 : 14} color={m.fg} />
      <Text
        style={[small ? type.caption : type.smallMed, { color: m.fg, flexShrink: 1 }]}
        numberOfLines={1}
      >
        {m.label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------ RoleAvatar */

/**
 * People are shown by role, not by name — so the avatar is an icon on glass
 * rather than a coloured initials disc.
 */
export function Avatar({
  size = 44,
  icon = 'person-outline',
  tint = colors.primary,
}: {
  size?: number;
  icon?: IconName;
  tint?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        /* Fixed-size decoration in a flex row is still shrinkable by default,
           so a long name beside it squashes the circle into an oval. */
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.glassStrong,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Ionicons name={icon} size={size * 0.44} color={tint} />
    </View>
  );
}

/** Small square icon tile used inside rows and tiles. */
export function IconTile({
  icon,
  size = 36,
  tint = colors.primary,
  bg = colors.primarySoft,
}: {
  icon: IconName;
  size?: number;
  tint?: string;
  bg?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.36,
        backgroundColor: bg,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={size * 0.5} color={tint} />
    </View>
  );
}

/* -------------------------------------------------------------- Sections */

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      {/* A generated title ("Awaiting your decision", "12 groups") has to give
          way to the action rather than shove it off the right edge. */}
      <Text style={[type.h3, { color: colors.text, flexShrink: 1 }]} numberOfLines={2}>
        {title}
      </Text>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={8} style={{ flexShrink: 0 }}>
          <Text style={[type.smallMed, { color: colors.primary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Row({
  icon,
  label,
  value,
  color,
}: {
  icon: IconName;
  label: string;
  value?: string;
  color?: string;
}) {
  return (
    /* The label is sized by its own text and the value takes what is left,
       right-aligned. The other way round — label `flex: 1`, value unconstrained
       — is what this used to be, and it let a home address or a comma-separated
       site list run straight off the edge of the card, because a `Text` with no
       flex basis reports its full intrinsic width and never shrinks. Two lines
       rather than one, so a long value reads instead of ending in an ellipsis. */
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}>
        <Ionicons name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={[type.small, { color: colors.textMuted, flexShrink: 1 }]} numberOfLines={2}>
        {label}
      </Text>
      {value ? (
        <Text
          style={[type.smallMed, { color: color ?? colors.text, flex: 1, textAlign: 'right' }]}
          numberOfLines={2}
        >
          {value}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
    </View>
  );
}

export function ListTile({
  icon,
  title,
  subtitle,
  onPress,
  right,
  lead,
  tint,
  danger,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  /**
   * Replaces the icon tile at the head of the row. For rows that *are* a
   * place — a flat in the directory — a door plate with the number on it says
   * more than a house glyph repeated forty times down a list.
   */
  lead?: React.ReactNode;
  tint?: string;
  danger?: boolean;
}) {
  const fg = danger ? colors.danger : colors.text;
  /* Shallower than a card's: a row inside a list is already small, and dipping
     it as far as a standalone surface makes the whole list look loose. */
  const press = usePressMotion(0.985);

  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        {...press.pressProps}
        style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}
      >
        {lead ?? (
          <IconTile
            icon={icon}
            bg={tint ?? (danger ? colors.dangerBg : colors.primarySoft)}
            tint={danger ? colors.danger : colors.primary}
          />
        )}
        {/* `minWidth: 0` is what actually lets the text inside shrink. A flex
            child's default minimum size is its content, so without it a long
            subtitle — an email address, a comma-joined site list — widens the
            row past the card instead of wrapping inside it. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.bodyMed, { color: fg }]} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[type.small, { color: colors.textMuted, marginTop: 2 }]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ?? (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textFaint}
            style={{ flexShrink: 0 }}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  art,
}: {
  icon: IconName;
  title: string;
  message: string;
  /**
   * A drawing to stand in for the icon disc — a dark tower for a household
   * with nobody in it, a shut gate for a queue with nothing in it. Worth the
   * space only where the *shape* says something the sentence underneath does
   * not; everywhere else the disc is quieter and reads faster.
   */
  art?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {/* The mark scales in ahead of the words. An empty state is the one place
          the app has nothing to show, so the little bit of life it does have
          belongs on the only thing drawn on the screen. */}
      {art ? (
        <Appear scale={0.9} distance={0} style={{ marginBottom: spacing.sm }}>
          {art}
        </Appear>
      ) : (
        <Appear scale={0.8} distance={0} style={styles.emptyIcon}>
          <Ionicons name={icon} size={30} color={colors.primary} />
        </Appear>
      )}
      <Appear index={1}>
        <Text style={[type.h3, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      </Appear>
      <Appear index={2}>
        <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>
          {message}
        </Text>
      </Appear>
    </View>
  );
}

/** Shown while a screen's first request is in flight. */
export function Loader({ label }: { label?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.primary} />
      {label ? (
        <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>{label}</Text>
      ) : null}
    </View>
  );
}

/**
 * Shown when a request fails — always with a way back to trying again.
 *
 * Pass the thrown `error` rather than a pre-formatted string and the state
 * words itself: an offline phone gets "You're offline" under a cloud icon, a
 * 500 gets "The server had a problem", a 403 loses the retry button because
 * pressing it again cannot help. `title` / `message` still override, for the
 * few screens that know something the error object does not.
 */
export function ErrorState({
  error,
  title,
  message,
  onRetry,
  secondaryLabel,
  onSecondary,
}: {
  error?: unknown;
  title?: string;
  message?: string;
  onRetry?: () => void;
  /**
   * A second way off the screen, for the dead ends where retrying cannot help
   * — an account linked to nothing, a guard with no gate. Without it those
   * states are a wall with no door but the app switcher.
   */
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const copy = errorCopy(error, message);
  const retryable = onRetry && (error === undefined || copy.canRetry);

  return (
    <View style={styles.empty}>
      <Appear scale={0.8} distance={0} style={[styles.emptyIcon, { backgroundColor: colors.dangerBg }]}>
        <Ionicons name={copy.icon as IconName} size={30} color={colors.danger} />
      </Appear>
      <Appear index={1}>
        <Text style={[type.h3, { color: colors.text, textAlign: 'center' }]}>
          {title ?? copy.title}
        </Text>
      </Appear>
      <Appear index={2}>
        <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>
          {message ?? copy.message}
        </Text>
      </Appear>
      {retryable ? (
        <Appear index={3}>
          <Button
            label="Try again"
            variant="secondary"
            icon="refresh-outline"
            full={false}
            onPress={onRetry}
          />
        </Appear>
      ) : null}
      {secondaryLabel && onSecondary ? (
        <Appear index={4}>
          <Button
            label={secondaryLabel}
            variant="ghost"
            full={false}
            onPress={onSecondary}
          />
        </Appear>
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: inset }} />;
}

/**
 * Footer for a cursor-paginated list. Renders nothing when there is no next
 * page, so a screen can drop it in unconditionally.
 */
export function LoadMore({
  hasMore,
  loading,
  onPress,
  total,
}: {
  hasMore: boolean;
  loading: boolean;
  onPress: () => void;
  /** How many rows are already on screen — shown once the list is exhausted. */
  total?: number;
}) {
  if (!hasMore) {
    return total && total > 8 ? (
      <Text style={[type.small, { color: colors.textFaint, textAlign: 'center' }]}>
        That's everything.
      </Text>
    ) : null;
  }
  return (
    <Button
      label={loading ? 'Loading…' : 'Load more'}
      variant="secondary"
      icon="chevron-down"
      loading={loading}
      disabled={loading}
      onPress={onPress}
    />
  );
}

/** Pale tinted note strip — info / warning / danger, always translucent. */
export function Note({
  icon,
  text,
  tone = 'info',
}: {
  icon: IconName;
  text: string;
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'brand';
}) {
  const map = {
    info: { fg: colors.info, bg: colors.infoBg },
    warning: { fg: colors.warning, bg: colors.warningBg },
    danger: { fg: colors.danger, bg: colors.dangerBg },
    success: { fg: colors.success, bg: colors.successBg },
    brand: { fg: colors.primary, bg: colors.primarySoft },
  }[tone];
  return (
    <View style={[styles.note, { backgroundColor: map.bg }]}>
      <Ionicons name={icon} size={16} color={map.fg} />
      <Text style={[type.small, { color: colors.textMuted, flex: 1 }]}>{text}</Text>
    </View>
  );
}

/* ------------------------------------------------------------ PoweredBy */

export function PoweredBy() {
  return (
    <View style={styles.powered}>
      <Logo size={13} />
      <Text style={[type.caption, { color: colors.textFaint, letterSpacing: 0.8 }]}>
        POWERED BY IVERTO.AI
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------ Stat block */

export function StatCard({
  label,
  value,
  icon,
  fg,
  bg,
  onPress,
}: {
  label: string;
  value: string;
  icon: IconName;
  fg: string;
  bg: string;
  /** When set the tile becomes a link and grows a chevron next to its label. */
  onPress?: () => void;
}) {
  const press = usePressMotion();

  const body = (
    <GlassPanel style={[styles.cardInner, { flex: 1 }]}>
      <View style={styles.stat}>
        <IconTile icon={icon} size={32} tint={fg} bg={bg} />
        {/* A four-figure count still has to fit a third of the screen.
            `CountUp` rolls the number up when the tile first lands and falls
            back to printing the string whenever it is not a plain count. */}
        <CountUp
          value={value}
          style={[type.h1, { color: colors.text, marginTop: spacing.sm }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        />
        <View style={styles.statLabelRow}>
          {/* Two lines rather than shrink-to-fit: `adjustsFontSizeToFit` is
              unreliable on Android — it frequently leaves the text at full size
              and clips it — and three tiles side by side leave barely room for
              "Approved today" on one line anyway. Wrapping is honest, and
              `alignItems: stretch` on the row keeps the tiles level. */}
          <Text
            style={[type.small, { color: colors.textMuted, flexShrink: 1 }]}
            numberOfLines={2}
          >
            {label}
          </Text>
          {onPress ? (
            <Ionicons name="chevron-forward" size={13} color={fg} style={{ flexShrink: 0 }} />
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );

  if (!onPress) return <View style={[styles.card, { flex: 1 }]}>{body}</View>;

  return (
    <Animated.View style={[{ flex: 1 }, press.style]}>
      <Pressable
        onPress={onPress}
        {...press.pressProps}
        style={({ pressed }) => [
          styles.card,
          { flex: 1 },
          pressed && [shadow.hover, { transform: [{ translateY: LIFT }] }],
        ]}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}

/* ----------------------------------------------------------------- Chips */

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
}) {
  const press = usePressMotion(0.94);

  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        {...press.pressProps}
        style={[
          styles.chip,
          selected
            ? { backgroundColor: colors.primarySoft, borderColor: colors.primary }
            : { backgroundColor: colors.glass, borderColor: colors.border },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={14}
            color={selected ? colors.primary : colors.textMuted}
            style={{ flexShrink: 0 }}
          />
        ) : null}
        {/* Category and site names come from the tenant, so a chip can hold
            anything. `maxWidth` keeps one long enough to fill the row from
            spilling out of a wrapping chip group. */}
        <Text
          style={[
            type.smallMed,
            { color: selected ? colors.primary : colors.textMuted, flexShrink: 1 },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------- Checkbox */

export function Checkbox({ checked }: { checked?: boolean }) {
  /* The tick springs in rather than blinking on. It is the only confirmation a
     multi-select row gives, and a state change that is *seen* to happen is
     harder to miss than one that has simply already happened. The box itself
     changes colour instantly — colour is a JS-driven animation and not worth
     the thread for 22 px. */
  const tick = usePop(!!checked, { from: 0.4 });

  return (
    <View
      style={[
        styles.check,
        checked
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { backgroundColor: colors.glassStrong, borderColor: colors.borderStrong },
      ]}
    >
      <Animated.View style={tick.style}>
        <Ionicons name="checkmark" size={14} color="#fff" />
      </Animated.View>
    </View>
  );
}

/* ------------------------------------------------------------- Skeletons */

/**
 * The shape of the answer, while the answer is in flight.
 *
 * A spinner says "wait"; a skeleton says "wait, and here is roughly what for",
 * which on a dashboard of counters and rows is a materially different promise
 * — the layout does not jump when the data lands, because the space was
 * already the right size.
 *
 * All of them breathe on one shared rhythm rather than each on their own. A
 * screen of independently pulsing blocks reads as noise; a screen of blocks
 * pulsing together reads as one surface waiting.
 */
export function Skeleton({
  width,
  height = 12,
  rounded = 6,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useBreathe({ period: 1400 });
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: rounded,
          backgroundColor: colors.neutralBg,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
        },
        style,
      ]}
    />
  );
}

/** Three counters, at the size the real ones will be. */
export function SkeletonStats() {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.card, { flex: 1 }]}>
          <GlassPanel style={[styles.cardInner, { flex: 1 }]}>
            <View style={styles.stat}>
              <Skeleton width={32} height={32} rounded={12} />
              <Skeleton width={44} height={22} style={{ marginTop: spacing.sm }} />
              <Skeleton width="80%" height={10} style={{ marginTop: 6 }} />
            </View>
          </GlassPanel>
        </View>
      ))}
    </View>
  );
}

/** A card of list rows — an icon tile, a title, a subtitle. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <Card padded={false}>
      <View style={{ padding: spacing.sm }}>
        {Array.from({ length: rows }).map((_, i) => (
          <View key={i} style={styles.tile}>
            <Skeleton width={36} height={36} rounded={13} />
            <View style={{ flex: 1, gap: 7 }}>
              <Skeleton width={i % 2 ? '52%' : '68%'} height={13} />
              <Skeleton width={i % 2 ? '78%' : '44%'} height={10} />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** A block of prose — the building card, a notice, a verdict. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-end' }}>
          <Skeleton width={92} height={116} rounded={4} />
          <View style={{ flex: 1, gap: 8, paddingBottom: spacing.xs }}>
            <Skeleton width="70%" height={16} />
            {Array.from({ length: lines }).map((_, i) => (
              <Skeleton key={i} width={i === lines - 1 ? '55%' : '92%'} height={10} />
            ))}
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  btn: {
    /* `minHeight`, not `height`: a two-line label on a half-width button has
       to be able to make the button taller instead of being cut off by it. */
    minHeight: 52,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    /* Deliberately no `alignItems: center`. That would size the inner row to
       its own content on the cross axis, so the label would lay out against an
       unbounded width, never wrap, and get clipped by `overflow: hidden`.
       Letting the row stretch to the button's width and centring *inside* it
       is what gives the label a width to wrap at. */
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    // iOS: transparent, so the BlurView in GlassPanel is what you see.
    // Android: opaque, because `elevation` on a see-through view makes the
    // platform paint the shadow caster as a solid rectangle over the content.
    backgroundColor: cardBackground,
    overflow: 'hidden',
    ...shadow.card,
  },
  cardInner: { borderRadius: radius.xl, overflow: 'hidden' },
  input: {
    /* Grows with the font when the OS text size is turned up. */
    minHeight: 52,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glassStrong,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    flexShrink: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  detailIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    flexShrink: 0,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
    /* Empty and error copy is centred prose; without side padding a long
       sentence runs edge to edge and reads badly on a narrow screen. */
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  powered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.lg,
  },
  stat: { paddingVertical: spacing.lg, paddingHorizontal: spacing.md, gap: 2 },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: '100%',
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
