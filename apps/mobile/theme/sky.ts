/**
 * The sky over the society.
 *
 * A gate is outdoors, and the same screen is read at six in the morning by a
 * maid arriving, at noon by the society office, and at eleven at night by a
 * guard holding a stranger at the barrier. So the canvas behind the glass is
 * not one fixed grey — it is the hour, and the building drawn on it lights its
 * windows to match.
 *
 * ONE HARD CONSTRAINT. Every gradient below stays between roughly 0.90 and
 * 0.98 lightness, and carries the hour in *hue* rather than in brightness.
 * The whole surface system is white glass over this canvas, and on Android
 * that glass is drawn as a pre-flattened opaque fill (see `theme/index.ts`) —
 * so a canvas that strayed to a real evening blue would leave every Android
 * card looking like a patch cut out of a different picture. The sky shifts
 * warm and cool; it never goes dark.
 *
 * The phases are the same four boundaries `greeting()` uses in
 * `lib/datetime.ts`, so "Good evening" and the dusk sky always agree.
 */

export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night';

export type SkyPreset = {
  /** Said out loud on the building card — "A quiet evening at Palm Grove". */
  label: string;
  /** Three stops, top to bottom. Passed straight to `LinearGradient`. */
  gradient: readonly [string, string, string];
  /**
   * The sun, or the moon. Positioned in fractions of the screen so it lands in
   * the same place on a 5" phone and a tablet.
   */
  orb: { color: string; halo: string; size: number; x: number; y: number };
  /**
   * Share of a tower's windows with a light on behind them at this hour.
   * Used whenever a drawing has no real occupancy figure to show — the login
   * screen, an empty state. Screens that *do* know pass a count instead.
   */
  litFraction: number;
  /** Colour of the glass in a lit window. Cold and reflective by day. */
  windowLit: string;
  /** Whether the drawing gets the warm spill around its lit windows. */
  glow: boolean;
  /** Faint stars behind everything. Night only, and barely visible then. */
  stars: boolean;
  /** Which side the light falls from — flips the shading on every facade. */
  sunFrom: 'left' | 'right';
};

export const sky: Record<SkyPhase, SkyPreset> = {
  /* 5–8 a.m. The staff shift. Low warm light from the east, most windows
     still dark, a handful of kitchens on. */
  dawn: {
    label: 'Early morning',
    gradient: ['#FBF4EF', '#F7F1EE', '#F1EEEF'],
    orb: { color: '#FFD9A8', halo: 'rgba(255, 196, 122, 0.30)', size: 132, x: 0.16, y: 0.1 },
    litFraction: 0.3,
    windowLit: '#FFD79B',
    glow: true,
    stars: false,
    sunFrom: 'left',
  },

  /* 8 a.m.–5 p.m. Flat overhead light, glass reflecting sky rather than
     showing rooms. The most neutral the canvas ever gets, which is the
     original design's grey almost exactly. */
  day: {
    label: 'Daytime',
    gradient: ['#F7F8F9', '#F3F4F5', '#EFF0F2'],
    orb: { color: '#FFF3D4', halo: 'rgba(255, 232, 176, 0.24)', size: 150, x: 0.8, y: 0.05 },
    litFraction: 0.1,
    windowLit: '#E8EEF5',
    glow: false,
    stars: false,
    sunFrom: 'right',
  },

  /* 5–8 p.m. The busy hour: people coming home, deliveries, visitors. The
     warmest the canvas gets, and the point at which the windows take over
     from the sky as the source of light in the drawing. */
  dusk: {
    label: 'Evening',
    gradient: ['#F9F1E9', '#F4ECE9', '#EDEAEE'],
    orb: { color: '#FFC79A', halo: 'rgba(255, 156, 106, 0.28)', size: 138, x: 0.84, y: 0.13 },
    litFraction: 0.6,
    windowLit: '#FFCE8A',
    glow: true,
    stars: false,
    sunFrom: 'right',
  },

  /* 8 p.m.–5 a.m. Cool and still. Fewer windows than at dusk, because half the
     building has gone to bed — which is the honest picture and also the one
     that makes the lit ones mean something. */
  night: {
    label: 'Night',
    gradient: ['#EFF1F6', '#EAECF2', '#E5E8EF'],
    orb: { color: '#E4EAF8', halo: 'rgba(160, 178, 214, 0.26)', size: 108, x: 0.78, y: 0.08 },
    litFraction: 0.42,
    windowLit: '#FFC97F',
    glow: true,
    stars: true,
    sunFrom: 'right',
  },
};

/** Which sky it is. Same boundaries as the dashboard greeting. */
export function phaseAt(date: Date = new Date()): SkyPhase {
  const h = date.getHours();
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

/**
 * The floor a flat is on, read off its label.
 *
 * "A-402" is the fourth floor, "B-12" the first, "C-7" the ground. Used to
 * decide which window in the drawn tower belongs to the household looking at
 * it — the one thing that turns a generic illustration into *their* building.
 *
 * Returns null for anything it cannot read rather than guessing, because a
 * highlighted window on the wrong floor is worse than none.
 */
export function floorOf(label: string): number | null {
  const number = label.match(/(\d{2,4})\s*$/)?.[1];
  if (!number) return null;
  /* The last two digits are the flat, everything before them the floor —
     the convention every society in the brief uses. A two-digit number is
     therefore floor zero-something: 12 is flat 12 on the first floor. */
  const floor = number.length <= 2 ? Math.floor(Number(number) / 10) : Number(number.slice(0, -2));
  return Number.isFinite(floor) ? floor : null;
}
