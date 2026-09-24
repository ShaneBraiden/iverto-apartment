import React from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { prefersReducedMotion } from '@/components/motion';
import { blur, colors, font, glassFill, radius, spacing } from '@/theme';

/** Bar height above the system gesture / navigation inset. */
export const TAB_BAR_HEIGHT = 64;

/** Frosted backdrop so the tab bar reads as glass, not as a solid strip. */
function TabBackground() {
  if (Platform.OS === 'android') {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: glassFill.strong }]} />;
  }
  return (
    <BlurView intensity={blur.bar} tint="light" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glass }]} />
    </BlurView>
  );
}

/**
 * Shared bottom-tab styling for all three role shells.
 *
 * Setting an explicit `height` on `tabBarStyle` overrides the height
 * react-navigation would otherwise derive from the safe-area inset, so the
 * inset has to be added back by hand — otherwise labels sit under the gesture
 * bar on Android and under the home indicator on iOS.
 */
export function useTabScreenOptions(): BottomTabNavigationOptions {
  const insets = useSafeAreaInsets();
  return {
    headerShown: false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.textFaint,
    tabBarBackground: () => <TabBackground />,
    tabBarStyle: {
      position: 'absolute',
      backgroundColor: 'transparent',
      borderTopColor: colors.border,
      borderTopWidth: 1,
      elevation: 0,
      height: TAB_BAR_HEIGHT + insets.bottom,
      paddingBottom: insets.bottom + spacing.sm,
      paddingTop: spacing.sm,
    },
    tabBarLabelStyle: { fontSize: 11, fontFamily: font.semibold },
    tabBarBadgeStyle: {
      backgroundColor: colors.primary,
      fontSize: 10,
      fontFamily: font.bold,
    },
  };
}

export function tabIcon(name: React.ComponentProps<typeof Ionicons>['name']) {
  const Icon = ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <TabIcon name={name} color={color} size={size ?? 22} focused={focused} />
  );
  Icon.displayName = `TabIcon(${String(name)})`;
  return Icon;
}

/**
 * The active tab's icon lifts and grows out of a soft brand-tinted disc.
 *
 * react-navigation already cross-fades the label colour, which tells you which
 * tab is selected but not that *you* selected it. The spring does: it starts
 * from wherever the icon currently is, so tapping through three tabs quickly
 * reads as one continuous movement rather than three restarts.
 *
 * Mounted at the tab's current state, not at rest — the first render after a
 * cold start would otherwise animate the home tab in from unfocused, half a
 * second after the user has already looked at it.
 */
function TabIcon({
  name,
  color,
  size,
  focused,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  size: number;
  focused: boolean;
}) {
  const t = React.useRef(new Animated.Value(focused ? 1 : 0)).current;

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      t.setValue(focused ? 1 : 0);
      return;
    }
    const anim = Animated.spring(t, {
      toValue: focused ? 1 : 0,
      speed: 18,
      bounciness: focused ? 10 : 0,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [focused, t]);

  return (
    <Animated.View
      style={{
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
        ],
      }}
    >
      {/* Behind the glyph, so it grows out from under it rather than pushing
          the icon around. `absoluteFill` inset negatively to give the disc room
          the icon itself does not take up. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.focusDisc,
          {
            opacity: t,
            transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          },
        ]}
      />
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  focusDisc: {
    position: 'absolute',
    top: -6,
    bottom: -6,
    left: -10,
    right: -10,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
});
