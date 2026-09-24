/**
 * The place, as a card.
 *
 * `components/building.tsx` draws the shapes; this puts them on a dashboard
 * with the numbers they are drawn from. Three of them, one per shell, and each
 * answers the question its role opens the app with:
 *
 *   BuildingCard — "what is happening in my home?"     (resident)
 *   GateCard     — "what is happening at my gate?"     (guard)
 *   SocietyCard  — "what is happening in the society?" (admin)
 *
 * THE DRAWING IS THE DATA. A lit window is a person inside, an open gate is a
 * decision that came back ALLOW. Nothing in here is illustration for its own
 * sake — if the count changes, the picture changes, and a card whose picture
 * disagreed with the number printed under it would be worse than no picture.
 *
 * That is also the constraint on adding to this file: a shape earns its place
 * by being wired to something real, or it does not go in.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ApartmentTower, GateGraphic, useSkyPhase, type GateState } from '@/components/building';
import { Card } from '@/components/ui';
import { colors, spacing, type } from '@/theme';
import { sky, type SkyPhase } from '@/theme/sky';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** A line of the card's right-hand column: one icon, one sentence. */
export type Fact = {
  icon: IconName;
  text: string;
  tone?: 'brand' | 'info' | 'warning' | 'success' | 'muted';
};

const TONE: Record<NonNullable<Fact['tone']>, string> = {
  brand: colors.primary,
  info: colors.info,
  warning: colors.warning,
  success: colors.success,
  muted: colors.textFaint,
};

const PHASE_ICON: Record<SkyPhase, IconName> = {
  dawn: 'partly-sunny-outline',
  day: 'sunny-outline',
  dusk: 'partly-sunny-outline',
  night: 'moon-outline',
};

/* ----------------------------------------------------------------- Shared */

function Facts({ facts }: { facts: Fact[] }) {
  return (
    <View style={{ gap: 5 }}>
      {facts.map((fact, i) => (
        <View key={i} style={styles.factRow}>
          <Ionicons
            name={fact.icon}
            size={13}
            color={TONE[fact.tone ?? 'muted']}
            style={{ flexShrink: 0 }}
          />
          {/* Facts are generated sentences — "2 staff inside, 1 expected" —
              so they wrap rather than truncate. The column is narrow by
              design and an ellipsis in the middle of a count is useless. */}
          <Text style={[type.small, { color: colors.textMuted, flex: 1 }]} numberOfLines={2}>
            {fact.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The strip along the bottom: what hour the drawing is showing, and one thing
 * about it. It exists so nobody has to wonder why the building went warm at
 * five o'clock — the card says so.
 */
function Hour({ note }: { note?: string }) {
  const phase = useSkyPhase();
  return (
    <View style={styles.hour}>
      <Ionicons name={PHASE_ICON[phase]} size={13} color={colors.textFaint} />
      <Text style={[type.caption, { color: colors.textFaint, flexShrink: 1 }]} numberOfLines={1}>
        {sky[phase].label.toUpperCase()}
        {note ? ` · ${note.toUpperCase()}` : ''}
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------- BuildingCard */

/**
 * The household's own block, with a light on for every person inside it.
 *
 * `highlightFloor` is what makes it *theirs* rather than a stock illustration:
 * the flat's own floor is ticked in crimson on the facade, read off the unit
 * label by `floorOf()`. A resident on the fourth floor sees the fourth floor
 * marked, which is a small thing that no amount of generic artwork buys.
 */
export function BuildingCard({
  headline,
  caption,
  facts = [],
  lit,
  highlightFloor,
  floors = 5,
  seed = 3,
  note,
}: {
  headline: string;
  caption?: string;
  facts?: Fact[];
  /** People currently inside. One window each. */
  lit?: number;
  highlightFloor?: number | null;
  floors?: number;
  seed?: number;
  note?: string;
}) {
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={styles.row}>
          {/* Four windows across at 72 points wide keeps a five-storey block
              inside about 150 points of height — tall enough to be a building,
              short enough to sit on a dashboard above three counters. Every
              other dimension in the drawing follows from that one number. */}
          <ApartmentTower
            width={72}
            floors={floors}
            columns={4}
            seed={seed}
            lit={lit}
            highlightFloor={highlightFloor}
          />
          <View style={styles.column}>
            <Text style={[type.h3, { color: colors.text }]} numberOfLines={2}>
              {headline}
            </Text>
            {caption ? (
              <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={2}>
                {caption}
              </Text>
            ) : null}
            {facts.length ? <Facts facts={facts} /> : null}
          </View>
        </View>
        <Hour note={note} />
      </View>
    </Card>
  );
}

/* -------------------------------------------------------------- GateCard */

/**
 * The gate, in whatever state the queue has put it in.
 *
 * The picture is the rule from §6.2 made visible: while anything is pending
 * the leaves strain but do not part, because no decision means no admission.
 * A guard glancing at this from two metres away gets the answer before they
 * have read a word of it — which is the distance this screen is actually read
 * from most of the day.
 */
export function GateCard({
  state,
  headline,
  caption,
  facts = [],
  note,
}: {
  state: GateState;
  headline: string;
  caption?: string;
  facts?: Fact[];
  note?: string;
}) {
  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ alignItems: 'center' }}>
          <GateGraphic state={state} width={224} />
        </View>
        <View style={{ gap: 4, alignItems: 'center' }}>
          <Text style={[type.h3, { color: colors.text, textAlign: 'center' }]} numberOfLines={2}>
            {headline}
          </Text>
          {caption ? (
            <Text
              style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}
              numberOfLines={3}
            >
              {caption}
            </Text>
          ) : null}
        </View>
        {facts.length ? <Facts facts={facts} /> : null}
        <Hour note={note} />
      </View>
    </Card>
  );
}

/* ----------------------------------------------------------- SocietyCard */

/**
 * The whole society: a short terrace of blocks, lit by how many people are
 * currently inside it.
 *
 * The lights are dealt across the towers rather than piled into the first one,
 * because a society with six people inside is six people spread over a
 * campus — and a single blazing block beside two dark ones would be a picture
 * of something that is not happening.
 */
export function SocietyCard({
  headline,
  caption,
  facts = [],
  lit = 0,
  towers = 3,
  note,
}: {
  headline: string;
  caption?: string;
  facts?: Fact[];
  lit?: number;
  towers?: number;
  note?: string;
}) {
  /* Different heights, fixed per position, so the terrace is a skyline rather
     than a bar chart — and the same skyline on every launch. */
  const shape = [
    { floors: 4, width: 52, seed: 21 },
    { floors: 6, width: 60, seed: 34 },
    { floors: 5, width: 48, seed: 47 },
    { floors: 3, width: 56, seed: 52 },
  ].slice(0, Math.max(1, Math.min(4, towers)));

  const share = shape.map((_, i) =>
    Math.floor(lit / shape.length) + (i < lit % shape.length ? 1 : 0)
  );

  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={styles.terrace}>
          {shape.map((block, i) => (
            <ApartmentTower
              key={block.seed}
              width={block.width}
              floors={block.floors}
              columns={4}
              seed={block.seed}
              lit={share[i]}
            />
          ))}
        </View>
        <View style={{ gap: 4 }}>
          <Text style={[type.h3, { color: colors.text }]} numberOfLines={2}>
            {headline}
          </Text>
          {caption ? (
            <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={2}>
              {caption}
            </Text>
          ) : null}
        </View>
        {facts.length ? <Facts facts={facts} /> : null}
        <Hour note={note} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  /* `minWidth: 0` so a long society name wraps inside the column instead of
     widening it and squeezing the drawing into a sliver. */
  column: { flex: 1, minWidth: 0, gap: 4, paddingBottom: spacing.xs },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  terrace: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  hour: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
