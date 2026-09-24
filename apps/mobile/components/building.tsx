/**
 * The building, drawn.
 *
 * This app is not a generic dashboard that happens to hold entry logs — it is
 * the front door of a block of flats, and until now nothing on screen said so.
 * Everything in this file is the place itself: the tower a household lives in,
 * the gate a guard stands at, the plate screwed beside a flat's door, and the
 * rooftops behind all of it.
 *
 * NOT ONE IMAGE. Every shape here is a `View` sized off `theme/building`, or
 * an SVG path generated at render. Three reasons, in the order they matter:
 *
 *   1. It is *live*. A window is lit because someone is actually inside — the
 *      household's tower lights one flat per staff member present, and goes
 *      dark again when they leave. A photograph of a building can only ever be
 *      decoration; this is the same data as the number printed beside it.
 *
 *   2. It fits the hour. `theme/sky` decides whether glass is warm or cold and
 *      which side the light falls from, so the drawing at 7 a.m. is not the
 *      drawing at 11 p.m. An asset would need four of everything.
 *
 *   3. It costs nothing. The same component is crisp at 300 px on the login
 *      screen and at 44 px in a list row, at every density, with no APK weight
 *      — which matters for an app installed on the cheapest phone in the
 *      society.
 *
 * MOTION RULES, inherited from `components/motion`: opacity and transform
 * only, so every light in here animates on the UI thread; nothing loops unless
 * it is saying something ("this gate is waiting"); reduced motion gets the lit
 * building immediately rather than a dark one that never fills in.
 */
import React from 'react';
import {
  AppState,
  Animated,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useBreathe, useFade } from '@/components/motion';
import { building, colors, font, radius, spacing } from '@/theme';
import { phaseAt, sky, type SkyPhase } from '@/theme/sky';

/* ------------------------------------------------------------- useSkyPhase */

/**
 * The current sky, kept current.
 *
 * Polled once a minute rather than scheduled for the exact boundary: a timer
 * set for 5 p.m. is wrong the moment the phone sleeps through it, and a minute
 * of stale sky is invisible. The `AppState` listener is the half that matters
 * — an app resumed after a night in a pocket must not still be showing
 * yesterday evening.
 */
export function useSkyPhase(): SkyPhase {
  const [phase, setPhase] = React.useState(phaseAt);

  React.useEffect(() => {
    const sync = () =>
      setPhase((current) => {
        const next = phaseAt();
        return next === current ? current : next;
      });
    const timer = setInterval(sync, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return phase;
}

/* ------------------------------------------------------------------ Random */

/**
 * Seeded noise, so a facade looks scattered but never *changes*.
 *
 * `Math.random()` would re-roll which flats have their lights on at every
 * render, so a socket event landing would visibly rearrange the building.
 * Same seed, same tower, forever.
 */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Indices 0…n-1 in a scattered but stable order. */
function scatter(n: number, seed: number): number[] {
  const rng = seeded(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/* ------------------------------------------------------------ TowerWindow */

/**
 * One flat's window.
 *
 * The light behind it is a separate layer from the glass, so switching it on
 * is a fade of one opacity — native driver, no colour animation — and the cold
 * pane underneath stays exactly where it was. The spill of warm light onto the
 * surrounding facade rides the same value, which is what makes a lit window at
 * night read as *inside* the wall rather than as a bright rectangle stuck onto
 * it.
 */
function TowerWindow({
  size,
  height,
  lit,
  delay,
  glassLit,
  glow,
}: {
  size: number;
  height: number;
  lit: boolean;
  delay: number;
  glassLit: string;
  glow: boolean;
}) {
  const t = useFade(lit, { delay, duration: 420 });
  /* Below about nine points across, a cross of hairlines stops being a window
     frame and becomes grey mush. Small towers get plain panes. */
  const framed = size >= 9;

  return (
    <View style={{ width: size, height }}>
      {glow ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -size * 0.4,
            bottom: -size * 0.4,
            left: -size * 0.4,
            right: -size * 0.4,
            borderRadius: size,
            backgroundColor: building.windowGlow,
            opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }),
          }}
        />
      ) : null}
      <View style={[styles.pane, { borderRadius: Math.max(1, size * 0.14) }]}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: glassLit, opacity: t }]}
        />
        {framed ? (
          <>
            <View style={styles.mullionH} />
            <View style={styles.mullionV} />
          </>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------- Lamp */

/** A bulb with a halo — on a gate pillar, or either side of an entrance. */
function Lamp({
  size = 6,
  color,
  pulse,
  hold = 0,
}: {
  size?: number;
  color: string;
  pulse?: boolean;
  hold?: number;
}) {
  const t = useBreathe({ period: 2400, hold });

  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      {pulse ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -size,
            bottom: -size,
            left: -size,
            right: -size,
            borderRadius: size * 1.5,
            backgroundColor: color,
            opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.3] }),
            transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.1] }) }],
          }}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/* --------------------------------------------------------- ApartmentTower */

export type TowerProps = {
  /** Total footprint, including the plinth. Everything else derives from it. */
  width?: number;
  floors?: number;
  /** Flats per floor, across the face. */
  columns?: number;
  /**
   * How many windows have a light on. Pass a real count — staff currently
   * inside, homes with someone waiting — and the drawing stops being a
   * decoration. Left out, it takes the hour's share from `theme/sky`.
   */
  lit?: number;
  /** Defaults to the live sky. */
  phase?: SkyPhase;
  /**
   * Marks one floor as *yours*: a crimson tick on the facade beside it, and a
   * window on that row lit whatever else is going on. Floor 1 is the lowest
   * row of windows; the entrance is the plinth below it.
   */
  highlightFloor?: number | null;
  /** Different seed, different building. Same seed, same building forever. */
  seed?: number;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Thickness of the two lines drawn between one floor and the next. */
const SLAB_LIGHT = 1;
const SLAB_DARK = 1.5;
/** The pool of shade under the plinth, less the point it is pulled up by. */
const SHADE_HEIGHT = 7;
const SHADE_LIFT = 1;

/**
 * Every measurement in the drawing, derived from its width.
 *
 * Pulled out of the component so `towerHeight` below can answer "how tall will
 * that be" without drawing anything — and so there is exactly one copy of the
 * proportions rather than one here and a second, drifting one in whichever
 * screen needed the answer.
 */
function towerGeometry(width: number, columns: number) {
  const bodyW = Math.round(width * 0.9);
  const baseW = Math.round(width * 0.97);
  const pad = Math.max(3, Math.round(bodyW * 0.09));
  const gap = Math.max(2, Math.round(bodyW * 0.045));
  const winW = Math.max(3, (bodyW - pad * 2 - gap * (columns - 1)) / columns);
  const winH = Math.max(4, Math.round(winW * 1.15));
  const rowPad = Math.max(2, Math.round(winH * 0.3));
  const roofH = Math.max(3, Math.round(width * 0.045));
  const tankH = Math.max(6, Math.round(width * 0.1));
  const baseH = Math.max(16, Math.round(width * 0.24));
  /* Under about 44 points of plinth there is no room for a canopy, a door and
     two lamps that are distinguishable from one another, so a small tower gets
     a plain base rather than a smudge. */
  const detailed = baseW >= 44;
  return { bodyW, baseW, pad, gap, winW, winH, rowPad, roofH, tankH, baseH, detailed };
}

/**
 * How tall `ApartmentTower` will draw itself, in dp, at a given width.
 *
 * The component takes a width and derives its height, which is what every
 * caller but one wants. The login screen is the one: it does not scroll, so it
 * has a height budget and needs the width that fits inside it, and the only
 * honest way to search for that is to ask the drawing itself.
 */
export function towerHeight(width: number, floors: number, columns = 4) {
  const g = towerGeometry(width, columns);
  const floorH = g.winH + g.rowPad * 2 + SLAB_LIGHT + SLAB_DARK;
  return (
    g.tankH + g.roofH + floors * floorH + g.baseH + (SHADE_HEIGHT - SHADE_LIFT)
  );
}

/**
 * A block of flats.
 *
 * Proportioned so it still reads at 60 px: the parapet overhangs, the roof
 * carries a water tank and an aerial, the facade is banded by balcony slabs,
 * and the ground floor is a plinth with a crimson canopy over the entrance —
 * which between them are the four things that make a shape say "flats" rather
 * than "office block".
 */
export function ApartmentTower({
  width = 168,
  floors = 5,
  columns = 4,
  lit,
  phase,
  highlightFloor,
  seed = 3,
  animate = true,
  style,
}: TowerProps) {
  const live = useSkyPhase();
  const preset = sky[phase ?? live];

  const { bodyW, baseW, pad, gap, winW, winH, rowPad, roofH, tankH, baseH, detailed } =
    towerGeometry(width, columns);

  const total = floors * columns;
  const order = React.useMemo(() => scatter(total, seed), [total, seed]);
  const home = highlightFloor == null ? null : Math.max(1, Math.min(floors, highlightFloor));

  const litSet = React.useMemo(() => {
    const count = Math.max(0, Math.min(total, lit ?? Math.round(total * preset.litFraction)));
    const set = new Set(order.slice(0, count));
    /* The household's own window is lit whatever the occupancy says: the point
       of the marker is "this is you", and an unlit you is a strange thing to
       show someone. */
    if (home != null) set.add((floors - home) * columns + Math.floor(columns / 2));
    return set;
  }, [order, lit, preset.litFraction, total, home, floors, columns]);

  /* Position in the reveal, not position on the facade — so the building fills
     in scattered, the way lights actually come on in the evening, rather than
     sweeping left to right like a progress bar. */
  const revealAt = React.useMemo(() => {
    const map = new Map<number, number>();
    order.forEach((index, position) => map.set(index, position));
    return map;
  }, [order]);

  const shading = (
    preset.sunFrom === 'left'
      ? ['rgba(255,255,255,0.62)', 'rgba(24,24,27,0.055)']
      : ['rgba(24,24,27,0.055)', 'rgba(255,255,255,0.62)']
  ) as readonly [string, string];

  return (
    <View style={[{ width, alignItems: 'center' }, style]}>
      {/* Roof furniture: an aerial and a water tank on legs, the two things on
          top of every building this app will ever be installed in. */}
      <View style={[styles.roofDeck, { width: bodyW, height: tankH, paddingHorizontal: pad }]}>
        <View style={{ width: 1.5, height: tankH, backgroundColor: building.edge }} />
        <View style={{ alignItems: 'center' }}>
          <View
            style={{
              width: Math.round(width * 0.17),
              height: tankH * 0.58,
              borderRadius: 2,
              backgroundColor: building.slab,
            }}
          />
          <View style={{ flexDirection: 'row', gap: Math.round(width * 0.08) }}>
            <View style={{ width: 1.5, height: tankH * 0.42, backgroundColor: building.edge }} />
            <View style={{ width: 1.5, height: tankH * 0.42, backgroundColor: building.edge }} />
          </View>
        </View>
      </View>

      {/* Parapet — wider than the body, which is the overhang that reads as a
          roof rather than as the top of a box. */}
      <View style={{ width, height: roofH, borderRadius: 2, backgroundColor: building.slab }} />

      <View style={[styles.body, { width: bodyW }]}>
        <LinearGradient
          pointerEvents="none"
          colors={shading}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {Array.from({ length: floors }).map((_, row) => {
          const floorNumber = floors - row;
          const mine = home === floorNumber;
          return (
            <View key={row}>
              <View style={[styles.floor, { paddingHorizontal: pad, paddingVertical: rowPad, gap }]}>
                {Array.from({ length: columns }).map((_, column) => {
                  const index = row * columns + column;
                  return (
                    <TowerWindow
                      key={column}
                      size={winW}
                      height={winH}
                      lit={litSet.has(index)}
                      glassLit={preset.windowLit}
                      glow={preset.glow}
                      delay={animate ? Math.min(900, 140 + (revealAt.get(index) ?? 0) * 70) : 0}
                    />
                  );
                })}
              </View>
              {/* The slab between floors. Two tones, because one line reads as
                  a border, and a lit edge over a shadow reads as concrete with
                  a balcony sitting on it. */}
              <View style={[styles.slabLight, { marginHorizontal: pad * 0.5 }]} />
              <View style={[styles.slabDark, { marginHorizontal: pad * 0.5 }]} />
              {mine ? <View style={[styles.homeTick, { height: winH + rowPad }]} /> : null}
            </View>
          );
        })}
      </View>

      {/* Ground floor: plinth, canopy, doorway, two lamps. */}
      <View style={[styles.base, { width: baseW, height: baseH }]}>
        {detailed ? (
          <>
            <View
              style={[
                styles.canopy,
                { width: baseW * 0.5, height: Math.max(3, baseH * 0.11), top: baseH * 0.24 },
              ]}
            />
            <View style={[styles.entranceRow, { gap: baseW * 0.12 }]}>
              <Lamp size={Math.max(3, baseW * 0.045)} color={building.lamp} pulse={preset.glow} />
              <View
                style={{
                  width: baseW * 0.22,
                  height: baseH * 0.52,
                  borderTopLeftRadius: baseW * 0.11,
                  borderTopRightRadius: baseW * 0.11,
                  backgroundColor: building.door,
                  opacity: 0.88,
                }}
              />
              <Lamp
                size={Math.max(3, baseW * 0.045)}
                color={building.lamp}
                pulse={preset.glow}
                hold={700}
              />
            </View>
          </>
        ) : null}
      </View>

      {/* The pool of shade the tower stands in. Without it the building floats
          a millimetre above the canvas. */}
      <View style={[styles.shade, { width }]} />
    </View>
  );
}

/* --------------------------------------------------------------- Skyline */

/**
 * The rest of the society, three streets back.
 *
 * Generated rather than tiled: real rooftops are not periodic, and a repeated
 * tile announces itself the moment the screen is wider than the tile. Water
 * tanks are punched into the roofline at random, which is the one detail that
 * stops a silhouette reading as a bar chart.
 */
export function Skyline({
  width,
  height = 56,
  color = building.silhouette,
  seed = 11,
  style,
}: {
  width: number;
  height?: number;
  color?: string;
  seed?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const d = React.useMemo(() => {
    const rng = seeded(seed);
    let x = -8;
    let path = `M -8 ${height}`;
    while (x < width + 8) {
      const w = 20 + rng() * 42;
      const top = height - height * (0.3 + rng() * 0.66);
      path += ` L ${x.toFixed(1)} ${top.toFixed(1)}`;
      if (w > 28 && rng() > 0.55) {
        const tankX = x + w * 0.52;
        const tankTop = top - 5;
        path +=
          ` L ${tankX.toFixed(1)} ${top.toFixed(1)}` +
          ` L ${tankX.toFixed(1)} ${tankTop.toFixed(1)}` +
          ` L ${(tankX + 8).toFixed(1)} ${tankTop.toFixed(1)}` +
          ` L ${(tankX + 8).toFixed(1)} ${top.toFixed(1)}`;
      }
      path += ` L ${(x + w).toFixed(1)} ${top.toFixed(1)}`;
      x += w;
    }
    return `${path} L ${x.toFixed(1)} ${height} Z`;
  }, [width, height, seed]);

  return (
    <View pointerEvents="none" style={style}>
      <Svg width={width} height={height}>
        <Path d={d} fill={color} />
      </Svg>
    </View>
  );
}

/* ------------------------------------------------------------ GateGraphic */

export type GateState = 'closed' | 'waiting' | 'open';

/**
 * The gate, in the three states the product has.
 *
 * A sliding gate between two pillars, not a swinging one: it is what actually
 * hangs at the entrance of these societies, and it moves along one axis, which
 * means the whole animation is a `translateX` on the native driver.
 *
 * The states are the product's, not decoration:
 *   closed  — nothing waiting; the lamps are asleep
 *   waiting — someone is held at the barrier. Amber lamps, and the leaves
 *             strain against each other without ever parting, because §6.2
 *             says a pending request cannot be cleared: no decision, no
 *             admission, so the gate *cannot* open
 *   open    — a decision came back ALLOW. The leaves run into the pillars and
 *             warm light spills through the gap
 */
export function GateGraphic({
  state = 'closed',
  width = 200,
  style,
}: {
  state?: GateState;
  width?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const height = Math.round(width * 0.5);
  const pillarW = Math.max(10, Math.round(width * 0.12));
  const pillarH = Math.round(height * 0.72);
  const capW = pillarW + Math.round(width * 0.04);
  const spanW = width - pillarW * 2;
  const leafW = spanW / 2;
  const roadH = Math.max(3, Math.round(height * 0.07));

  const open = useFade(state === 'open', { duration: 520 });
  const strain = useBreathe({ period: 2000 });

  const lampColor =
    state === 'open' ? colors.success : state === 'waiting' ? colors.warning : building.lampOff;

  /* Waiting nudges the leaves *together*; opening sends them apart. Both ride
     translateX and are summed, so a gate that opens mid-nudge does not jump. */
  const leafShift = (direction: -1 | 1) => ({
    transform: [
      {
        translateX: Animated.add(
          open.interpolate({ inputRange: [0, 1], outputRange: [0, direction * leafW] }),
          strain.interpolate({
            inputRange: [0, 1],
            outputRange: [0, state === 'waiting' ? -direction * 1.6 : 0],
          })
        ),
      },
    ],
  });

  return (
    <View style={[{ width, height }, style]}>
      {/* Light through the opening, tied to how far open it is. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: pillarW,
          width: spanW,
          bottom: roadH,
          height: pillarH,
          opacity: open,
        }}
      >
        <LinearGradient
          colors={['rgba(255,196,107,0)', 'rgba(255,196,107,0.4)'] as const}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* The span clips the leaves, so they vanish into the pillars instead of
          sliding out past them. */}
      <View
        style={{
          position: 'absolute',
          left: pillarW,
          width: spanW,
          bottom: roadH,
          height: pillarH * 0.9,
          flexDirection: 'row',
          overflow: 'hidden',
        }}
      >
        <Animated.View style={[{ width: leafW }, leafShift(-1)]}>
          <GateLeaf width={leafW} />
        </Animated.View>
        <Animated.View style={[{ width: leafW }, leafShift(1)]}>
          <GateLeaf width={leafW} />
        </Animated.View>
      </View>

      {/* Pillars last, so they cover the leaves running in behind them. */}
      {([-1, 1] as const).map((side) => (
        <View
          key={side}
          style={[
            styles.pillarStack,
            { bottom: roadH },
            side === -1 ? { left: 0 } : { right: 0 },
          ]}
        >
          <View style={[styles.pillarCap, { width: capW }]} />
          <View style={styles.pillarLamp}>
            <Lamp
              size={Math.max(4, Math.round(width * 0.03))}
              color={lampColor}
              pulse={state !== 'closed'}
              hold={side === 1 ? 500 : 0}
            />
          </View>
          <View style={[styles.pillar, { width: pillarW, height: pillarH }]} />
        </View>
      ))}

      <View style={[styles.road, { height: roadH }]} />
    </View>
  );
}

/** One half of the gate: two rails and the bars between them. */
function GateLeaf({ width }: { width: number }) {
  const bars = Math.max(3, Math.round(width / 11));
  return (
    <View style={styles.leaf}>
      {Array.from({ length: bars }).map((_, i) => (
        <View key={i} style={styles.bar} />
      ))}
    </View>
  );
}

/* -------------------------------------------------------------- DoorPlate */

/**
 * The flat's number, as the plate screwed beside its door.
 *
 * The header used to say "A-402" in the same type as everything around it,
 * which made the most important word on the screen — *which home am I acting
 * for* — indistinguishable from a subtitle. A plate is how a building says it,
 * and it is unmistakable at a glance.
 */
export function DoorPlate({
  label,
  sub,
  compact,
  style,
}: {
  label: string;
  sub?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.plate, compact && styles.plateCompact, style]}>
      <LinearGradient
        colors={['rgba(255,255,255,0.95)', 'rgba(230,230,235,0.95)'] as const}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.screw} />
      <View style={{ flexShrink: 1, alignItems: 'center' }}>
        <Text style={[styles.plateLabel, compact && styles.plateLabelCompact]} numberOfLines={1}>
          {label}
        </Text>
        {sub && !compact ? (
          <Text style={styles.plateSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={styles.screw} />
    </View>
  );
}

const styles = StyleSheet.create({
  /* ---- tower ---- */
  roofDeck: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  body: { backgroundColor: building.wall, overflow: 'hidden' },
  floor: { flexDirection: 'row', justifyContent: 'space-between' },
  slabLight: { height: SLAB_LIGHT, backgroundColor: 'rgba(255,255,255,0.7)' },
  slabDark: { height: SLAB_DARK, backgroundColor: building.balcony },
  homeTick: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 3,
    backgroundColor: colors.primary,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  pane: {
    flex: 1,
    backgroundColor: building.windowDark,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: building.edge,
  },
  mullionH: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: building.edge,
  },
  mullionV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: StyleSheet.hairlineWidth,
    backgroundColor: building.edge,
  },
  base: {
    backgroundColor: building.wallShade,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  canopy: { position: 'absolute', borderRadius: 2, backgroundColor: building.canopy },
  entranceRow: { flexDirection: 'row', alignItems: 'center' },
  shade: {
    height: SHADE_HEIGHT,
    borderRadius: 4,
    marginTop: -SHADE_LIFT,
    backgroundColor: building.shade,
  },

  /* ---- gate ---- */
  leaf: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'stretch',
    borderTopWidth: 2.5,
    borderBottomWidth: 2.5,
    borderColor: building.slab,
    paddingVertical: 2,
  },
  bar: { width: 2, borderRadius: 1, backgroundColor: building.slab },
  pillarStack: { position: 'absolute', alignItems: 'center' },
  pillar: {
    backgroundColor: building.wallShade,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: building.edge,
  },
  pillarCap: { height: 4, borderRadius: 2, backgroundColor: building.slab },
  pillarLamp: { alignItems: 'center', paddingVertical: 3 },
  road: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 3,
    backgroundColor: building.ground,
  },

  /* ---- plate ---- */
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(24,24,27,0.16)',
    overflow: 'hidden',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  plateCompact: { paddingVertical: 2, paddingHorizontal: 6, gap: 5 },
  screw: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    flexShrink: 0,
    backgroundColor: 'rgba(24,24,27,0.28)',
  },
  plateLabel: { fontFamily: font.bold, fontSize: 15, letterSpacing: 1.6, color: colors.text },
  plateLabelCompact: { fontSize: 12, letterSpacing: 1 },
  plateSub: {
    fontFamily: font.medium,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.textFaint,
    marginTop: -1,
  },
});
