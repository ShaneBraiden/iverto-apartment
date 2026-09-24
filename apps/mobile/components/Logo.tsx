/**
 * The Iverto.ai brand mark.
 *
 * Drawn as vector geometry from `theme/logo.ts`, so it stays crisp from the
 * 20px header mark up to the 96px login lockup with no bitmap assets involved.
 *
 * Two shapes:
 *   <Logo />      the bare mark, tinted however you like
 *   <LogoBadge /> the mark inside a rounded tile — the app-icon lockup
 */
import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LOGO_PATH, LOGO_VIEWBOX } from '@/theme/logo';
import { colors, shadow, spacing, type } from '@/theme';

export function Logo({
  size = 32,
  color = colors.primary,
  style,
}: {
  size?: number;
  /** Any RN colour. Use `colors.onPrimary` on crimson surfaces. */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <Svg width={size} height={size} viewBox={`0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}`}>
        <Path d={LOGO_PATH} fill={color} />
      </Svg>
    </View>
  );
}

/**
 * The mark on a rounded tile, mirroring the launcher icon. `tone` picks which
 * way round the brand colours sit:
 *   'light' — crimson mark on the app canvas (default, matches the artwork)
 *   'brand' — white mark on crimson, for when the tile needs to carry weight
 */
export function LogoBadge({
  size = 56,
  tone = 'light',
  style,
}: {
  size?: number;
  tone?: 'light' | 'brand';
  style?: StyleProp<ViewStyle>;
}) {
  const brand = tone === 'brand';
  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: brand ? colors.primary : colors.surface,
          borderColor: brand ? 'transparent' : colors.border,
        },
        brand ? shadow.lifted : shadow.card,
        style,
      ]}
    >
      <Logo size={size * 0.68} color={brand ? colors.onPrimary : colors.primary} />
    </View>
  );
}

/**
 * Full brand lockup — badge plus wordmark and tagline. Used on the login
 * screen, where the app has to introduce itself.
 */
export function BrandLockup({
  size = 56,
  tagline = 'Every gate, one app',
  layout = 'row',
  style,
}: {
  size?: number;
  tagline?: string | null;
  /**
   * 'row'     — badge beside the wordmark. Compact; fits in a bar.
   * 'stacked' — badge centred above the wordmark, so the mark can be much
   *             larger without shoving the text off the edge. Used on login.
   */
  layout?: 'row' | 'stacked';
  style?: StyleProp<ViewStyle>;
}) {
  const stacked = layout === 'stacked';

  return (
    <View style={[stacked ? styles.lockupStacked : styles.lockup, style]}>
      <LogoBadge size={size} />
      <View style={stacked ? styles.stackedText : { flex: 1 }}>
        <Text
          style={[
            stacked ? type.display : type.h1,
            { color: colors.text, textAlign: stacked ? 'center' : 'left' },
          ]}
        >
          Iverto<Text style={{ color: colors.primary }}>.ai</Text>
        </Text>
        {tagline ? (
          <Text
            style={[
              type.small,
              { color: colors.textMuted, textAlign: stacked ? 'center' : 'left' },
            ]}
          >
            {tagline}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Faint mark used as a page watermark — profile screens sit it behind the
 * content so the brand is present without competing with anything.
 */
export function LogoWatermark({
  size = 260,
  opacity = 0.05,
  style,
}: {
  size?: number;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View pointerEvents="none" style={[styles.watermark, { opacity }, style]}>
      <Logo size={size} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  lockupStacked: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  stackedText: { alignItems: 'center', gap: 2 },
  watermark: {
    position: 'absolute',
    right: -60,
    top: -40,
  },
});
