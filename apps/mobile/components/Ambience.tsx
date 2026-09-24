/**
 * What the app sits in front of.
 *
 * Every glass surface in this product is semi-transparent, which means the
 * canvas behind them is not a background — it is the thing they are made of.
 * Until now that canvas was one flat grey with two blooms on it. Now it is the
 * society: the sky at whatever hour it actually is, the sun or the moon in it,
 * and the neighbouring rooftops along the bottom of the screen.
 *
 * It renders once, at the root, behind the whole navigator — so the sky does
 * not restart when a screen pushes, and a tab change does not re-run a sunrise.
 *
 * EVERYTHING HERE IS INERT. `pointerEvents="none"` throughout, no data, no
 * navigation. If this component threw every frame the app would still work;
 * that is the level of importance it is allowed to have.
 */
import React from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Skyline, useSkyPhase } from '@/components/building';
import { useBreathe } from '@/components/motion';
import { building, colors } from '@/theme';
import { sky, type SkyPhase } from '@/theme/sky';

/** Fixed positions, so the stars do not migrate between renders. */
const STARS = [
  { x: 0.12, y: 0.08 }, { x: 0.31, y: 0.15 }, { x: 0.44, y: 0.06 },
  { x: 0.58, y: 0.19 }, { x: 0.67, y: 0.09 }, { x: 0.83, y: 0.22 },
  { x: 0.91, y: 0.12 }, { x: 0.22, y: 0.27 }, { x: 0.51, y: 0.31 },
  { x: 0.75, y: 0.34 }, { x: 0.07, y: 0.36 }, { x: 0.38, y: 0.41 },
];

export function Ambience() {
  const { width, height } = useWindowDimensions();
  const phase = useSkyPhase();

  /* Two skies at once for the length of a change: the one that was, and the
     one arriving over it. Four times a day, and usually while the phone is in
     someone's pocket — but an evening that snaps on mid-glance looks like a
     rendering bug, and a nine-hundred-millisecond fade does not. */
  const [pair, setPair] = React.useState<{ from: SkyPhase; to: SkyPhase }>({
    from: phase,
    to: phase,
  });
  const cross = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    setPair((current) => (current.to === phase ? current : { from: current.to, to: phase }));
  }, [phase]);

  React.useEffect(() => {
    if (pair.from === pair.to) return;
    cross.setValue(0);
    const anim = Animated.timing(cross, {
      toValue: 1,
      duration: 900,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [pair, cross]);

  const preset = sky[pair.to];
  const orb = preset.orb;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* The sky that was. */}
      <LinearGradient colors={sky[pair.from].gradient} style={StyleSheet.absoluteFill} />
      {/* The sky that is, arriving over it. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: cross }]}>
        <LinearGradient colors={preset.gradient} style={StyleSheet.absoluteFill} />
      </Animated.View>

      {/* Sun or moon, with a halo that breathes. The disc itself is still —
          a wobbling sun is a lava lamp, and this has to survive being looked
          at all day. */}
      <Orb
        size={orb.size}
        color={orb.color}
        halo={orb.halo}
        left={width * orb.x - orb.size / 2}
        top={height * orb.y}
      />

      {preset.stars
        ? STARS.map((star, i) => (
            <Star key={i} left={width * star.x} top={height * star.y} index={i} />
          ))
        : null}

      {/* The brand blooms the glass has always refracted, kept — they are why
          a translucent card reads as glass rather than as grey paint. */}
      <View style={[styles.bloom, styles.bloomTop, { backgroundColor: colors.bloomA }]} />
      <View style={[styles.bloom, styles.bloomBottom, { backgroundColor: colors.bloomB }]} />

      {/* The society, along the bottom of every screen. Two ranks at different
          heights and opacities, which is the whole trick: one silhouette is a
          border, two is a distance.

          Both are tall — 140 and 176 — because the bottom ~90 points of most
          screens in this app are under the tab bar. On iOS that bar is frosted
          and the rooftops read *through* it, which is the best version of this;
          on Android it is opaque, so the ranks have to stand tall enough that
          their peaks clear it. A 64-point skyline was invisible on half the
          screens in the app. */}
      <Skyline
        width={width}
        height={176}
        seed={41}
        color="rgba(24, 24, 27, 0.035)"
        style={styles.far}
      />
      <Skyline
        width={width}
        height={140}
        seed={17}
        color={building.silhouette}
        style={styles.near}
      />
    </View>
  );
}

/** The sun, or the moon. */
function Orb({
  size,
  color,
  halo,
  left,
  top,
}: {
  size: number;
  color: string;
  halo: string;
  left: number;
  top: number;
}) {
  const t = useBreathe({ period: 7000 });

  return (
    <View style={{ position: 'absolute', left, top, width: size, height: size }}>
      <Animated.View
        style={{
          position: 'absolute',
          top: -size * 0.5,
          bottom: -size * 0.5,
          left: -size * 0.5,
          right: -size * 0.5,
          borderRadius: size,
          backgroundColor: halo,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] }) }],
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: 0.75,
        }}
      />
    </View>
  );
}

/**
 * A star.
 *
 * Each gets its own period and its own pause, so twelve of them never blink
 * together — de-synchronised by arithmetic rather than by a phase table, which
 * is what `hold` on `useBreathe` is for.
 */
function Star({ left, top, index }: { left: number; top: number; index: number }) {
  const t = useBreathe({ period: 2400 + index * 260, hold: index * 130, still: 0.4 });
  const size = index % 3 === 0 ? 2.5 : 1.8;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        top,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: 'rgba(90, 104, 140, 0.85)',
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.55] }),
      }}
    />
  );
}

const styles = StyleSheet.create({
  bloom: { position: 'absolute', width: 460, height: 460, borderRadius: 230 },
  bloomTop: { top: -190, right: -150 },
  bloomBottom: { bottom: -220, left: -170 },
  far: { position: 'absolute', left: 0, right: 0, bottom: 30 },
  near: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
