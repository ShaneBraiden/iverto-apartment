/**
 * Entry log rows, grouped by day.
 *
 * The log is append-only (§10) and read in two ways — "who is here now" and
 * "who came on Tuesday" — so rows lead with the clock time and the list breaks
 * on the day. No row is editable, anywhere, by anyone: a correction is a new
 * row, which is a backend concern the UI simply never offers a way to violate.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, IconTile } from '@/components/ui';
import { SubjectPhoto } from '@/components/SubjectPhoto';
import { colors, radius, spacing, type } from '@/theme';
import { clockTime, dayLabel } from '@/lib/datetime';
import { entrySubtitle, entryTitle, expectsPhoto, subjectIcon } from '@/lib/status';
import type { EntryEvent } from '@/types';

export function EntryRow({ event, right }: { event: EntryEvent; right?: React.ReactNode }) {
  const isIn = event.direction === 'IN';
  return (
    <View style={styles.row}>
      {/* The face where one was captured, the subject's icon otherwise. No
          response says which, so `expectsPhoto` keeps a log of staff scans from
          spending a request a line — and the fallback is handed the same
          colours the icon branch draws, so a wrong guess is invisible. */}
      {expectsPhoto(event) ? (
        <SubjectPhoto
          entryEventId={event.id}
          subjectType={event.subjectType}
          size={38}
          bg={isIn ? colors.infoBg : colors.neutralBg}
          tint={isIn ? colors.info : colors.textMuted}
        />
      ) : (
        <IconTile
          icon={subjectIcon(event.subjectType) as never}
          size={38}
          bg={isIn ? colors.infoBg : colors.neutralBg}
          tint={isIn ? colors.info : colors.textMuted}
        />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.bodyMed, { color: colors.text }]} numberOfLines={1}>
          {entryTitle(event)}
        </Text>
        <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={1}>
          {entrySubtitle(event)}
        </Text>
      </View>
      {right ?? (
        <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
          <Text style={[type.smallMed, { color: colors.text }]}>
            {clockTime(event.occurredAt)}
          </Text>
          <View style={styles.dirRow}>
            <Ionicons
              name={isIn ? 'arrow-down-outline' : 'arrow-up-outline'}
              size={11}
              color={isIn ? colors.info : colors.textFaint}
            />
            <Text style={[type.caption, { color: isIn ? colors.info : colors.textFaint }]}>
              {isIn ? 'IN' : 'OUT'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * The log itself.
 *
 * Grouped by day rather than paginated by count, because "everything that
 * happened today" is the question people actually arrive with and a page
 * boundary that falls in the middle of a morning answers it badly.
 */
export function EntryList({
  events,
  renderRight,
}: {
  events: EntryEvent[];
  renderRight?: (event: EntryEvent) => React.ReactNode;
}) {
  const groups: { day: string; items: EntryEvent[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.occurredAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <View style={{ gap: spacing.lg }}>
      {groups.map((g) => (
        <View key={g.day} style={{ gap: spacing.sm }}>
          <Text style={[type.caption, { color: colors.textFaint, marginLeft: spacing.xs }]}>
            {g.day.toUpperCase()}
          </Text>
          <Card padded={false}>
            <View style={{ padding: spacing.sm }}>
              {g.items.map((e, i) => (
                <View key={e.id}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <EntryRow event={e} right={renderRight?.(e)} />
                </View>
              ))}
            </View>
          </Card>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  dirRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 38 + spacing.md + spacing.sm },
  card: { borderRadius: radius.xl },
});
