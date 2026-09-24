/**
 * Everything that crossed the gate for this home.
 *
 * The filter chips are the three questions people arrive with — who worked
 * here, what was delivered, who visited — rather than a faithful rendering of
 * `subjectType`. "Deliveries" is the one that gets used, because it is the one
 * people go looking for when something is missing.
 *
 * The log is the one paginated list in the app, so the filters are applied to
 * the page that has been fetched and the count under them says so. Filtering
 * server-side would be a round trip per chip tap, and the log is read far more
 * often than it is filtered.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Screen, TopBar } from '@/components/Screen';
import { EntryList } from '@/components/EntryList';
import { Button, Card, Chip, EmptyState, ErrorState, Loader } from '@/components/ui';
import { colors, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useQuery } from '@/lib/api';
import { useUnitContext } from '@/lib/auth';
import type { SubjectType } from '@/types';

const PAGE = 20;

const FILTERS: { key: SubjectType | 'ALL'; label: string; icon: string }[] = [
  { key: 'ALL', label: 'Everything', icon: 'apps-outline' },
  { key: 'STAFF', label: 'Staff', icon: 'people-outline' },
  { key: 'DELIVERY', label: 'Deliveries', icon: 'cube-outline' },
  { key: 'VISITOR', label: 'Visitors', icon: 'person-add-outline' },
];

export default function ResidentLog() {
  const context = useUnitContext();
  const unitId = context.unitId;
  const [filter, setFilter] = useState<SubjectType | 'ALL'>('ALL');
  /* Grown rather than paged: the list is read as one scroll, and a page two
     that replaces page one loses the reader's place. Asking for a bigger first
     page is the same request the server was going to serve anyway. */
  const [limit, setLimit] = useState(PAGE);

  const eventsQuery = useQuery(keys.unitEvents(unitId, 1, limit), () =>
    api.getUnitEntryEvents(unitId, 1, limit),
  );

  const events = eventsQuery.data?.items ?? [];
  const total = eventsQuery.data?.total ?? events.length;
  const more = events.length < total;

  const shown = filter === 'ALL' ? events : events.filter((e) => e.subjectType === filter);

  return (
    <>
      <TopBar title="Entry log" subtitle={context.label} back={false} />
      <Screen>
        {/* Horizontal rather than wrapped: four chips fit a phone, and a row
            that never changes height keeps the list below from jumping when
            the filter changes. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              icon={f.icon as never}
              selected={filter === f.key}
              onPress={() => setFilter(f.key)}
            />
          ))}
        </ScrollView>

        {eventsQuery.loading ? <Loader label="Loading the log…" /> : null}

        {eventsQuery.error && !events.length ? (
          <ErrorState error={eventsQuery.error} onRetry={eventsQuery.refetch} />
        ) : null}

        {!eventsQuery.loading && !eventsQuery.error && shown.length === 0 ? (
          <Card>
            <EmptyState
              icon="file-tray-outline"
              title="Nothing here yet"
              message={
                filter === 'ALL'
                  ? 'Entries appear the moment someone scans in at the gate or a guard logs a visitor for this home.'
                  : 'No entries of that kind in what has been loaded so far.'
              }
            />
          </Card>
        ) : shown.length ? (
          <>
            {/* Says what is on screen against what exists, so a filter that
                finds nothing on page one does not read as an empty history. */}
            <Text style={[type.small, { color: colors.textFaint, marginLeft: spacing.xs }]}>
              {filter === 'ALL'
                ? `Showing ${events.length} of ${total}`
                : `${shown.length} of the ${events.length} loaded`}
            </Text>
            <EntryList events={shown} />
          </>
        ) : null}

        {more && !eventsQuery.loading ? (
          <Button
            label={`Load ${Math.min(PAGE, total - events.length)} more`}
            variant="secondary"
            icon="chevron-down"
            loading={eventsQuery.refreshing}
            onPress={() => setLimit((n) => n + PAGE)}
          />
        ) : null}
      </Screen>
    </>
  );
}
