/**
 * The household's home screen.
 *
 * Ordered by what can't wait. Anything pending is the top of the screen and
 * everything else moves down; with nothing pending the screen leads with the
 * household's own block, lit for the entries that have crossed its door today.
 *
 * The drawing is not decoration — it reads the same array the counter does, so
 * the two can never disagree, and a glance settles it without anybody parsing a
 * figure.
 *
 * What this screen deliberately no longer claims: who is *inside* right now.
 * The staff response carries no presence and no last-seen time, and the entry
 * log is a page rather than the whole history, so any "3 staff inside" here
 * would be a number the app made up. Today's crossings are a fact the response
 * supports; presence is not.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ShellHeader } from '@/components/ShellHeader';
import { ApprovalCard } from '@/components/ApprovalCard';
import { BuildingCard } from '@/components/place';
import { ApartmentTower } from '@/components/building';
import { EntryRow } from '@/components/EntryList';
import {
  Card,
  EmptyState,
  ErrorState,
  ListTile,
  Note,
  SectionHeader,
  SkeletonCard,
  SkeletonRows,
  SkeletonStats,
  StatCard,
} from '@/components/ui';
import { colors, spacing, type } from '@/theme';
import { floorOf } from '@/theme/sky';
import * as api from '@/lib/api';
import { keys, useMutation, useQuery } from '@/lib/api';
import { useUnitContext } from '@/lib/auth';
import { relative } from '@/lib/datetime';
import { staffTypeIcon, staffTypeLabel } from '@/lib/status';

export default function ResidentHome() {
  const context = useUnitContext();
  const unitId = context.unitId;

  /* One pending call serves this screen and the tab badge — they read the same
     cache entry, so they cannot disagree about how many people are waiting. */
  const pendingQuery = useQuery(keys.unitPending(unitId), () => api.getUnitPending(unitId));
  const staffQuery = useQuery(keys.unitStaff(unitId), () => api.getUnitStaff(unitId));
  const eventsQuery = useQuery(keys.unitEvents(unitId), () =>
    api.getUnitEntryEvents(unitId, 1, 20),
  );

  const pending = pendingQuery.data ?? [];
  const staff = staffQuery.data ?? [];
  const events = eventsQuery.data?.items ?? [];
  /* The server's count of everything ever, not the length of the page it sent. */
  const totalEvents = eventsQuery.data?.total ?? events.length;

  const today = events.filter(
    (e) => new Date(e.occurredAt).toDateString() === new Date().toDateString(),
  );
  const arrivalsToday = today.filter((e) => e.direction === 'IN');

  /**
   * The decision.
   *
   * The server decides who won — first write against a still-pending row — and
   * returns the approval as it now stands, which is written straight into the
   * cache so the card leaves the screen on the same frame as the tap. A 409 (a
   * family member answered first) still lands as an alert saying so, which is
   * the truth and is what the resident needs to know.
   */
  const decide = useMutation(
    (id: string, decision: 'APPROVED' | 'REJECTED') =>
      api.decideApproval(unitId, id, decision),
    {
      onSuccess: (decided) =>
        api.setQueryData<typeof pending>(keys.unitPending(unitId), (prev) =>
          (prev ?? []).filter((a) => a.id !== decided.id),
        ),
      invalidates: [keys.unitPending(unitId), keys.unitEvents(unitId)],
    },
  );

  /* Nothing to draw yet and no cached copy — the whole screen is one request
     away from being meaningful, so it waits rather than rendering five zeros. */
  const firstLoad = staffQuery.loading && eventsQuery.loading && pendingQuery.loading;
  const failed = staffQuery.error ?? eventsQuery.error ?? pendingQuery.error;

  return (
    <>
      <ShellHeader
        icon="home-outline"
        meta={`${staff.length} staff · ${today.length} entries today`}
        badgeCount={pending.length}
        onBell={() => router.push('/resident/log')}
      />
      <Screen>
        {/* The shape of the screen, not a spinner in the middle of an empty
            one: the building card, the counters and the staff list all land in
            the space already reserved for them, so nothing jumps. */}
        {firstLoad ? (
          <>
            <SkeletonCard lines={3} />
            <SkeletonStats />
            <SkeletonRows rows={3} />
          </>
        ) : null}
        {!firstLoad && failed && !staff.length && !events.length ? (
          <ErrorState
            error={failed}
            onRetry={() => {
              pendingQuery.refetch();
              staffQuery.refetch();
              eventsQuery.refetch();
            }}
          />
        ) : null}

        {pending.length > 0 ? (
          <View style={{ gap: spacing.md }}>
            <SectionHeader
              title={
                pending.length === 1
                  ? 'Someone is at the gate'
                  : `${pending.length} people at the gate`
              }
            />
            {pending.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                audience="resident"
                onApprove={() => decide.mutate(a.id, 'APPROVED')}
                onReject={() => decide.mutate(a.id, 'REJECTED')}
              />
            ))}
          </View>
        ) : null}

        {firstLoad ? null : (
          <BuildingCard
            headline={context.label}
            caption={
              arrivalsToday.length
                ? `${arrivalsToday.length} ${
                    arrivalsToday.length === 1 ? 'person has' : 'people have'
                  } come to your door today.`
                : 'Nobody has come to your door today.'
            }
            /* One window per arrival today, capped so a busy morning does not
               ask the drawing for more flats than it has. */
            lit={Math.min(arrivalsToday.length, 12)}
            /* Read off "A-402" — the fourth floor is ticked on the facade, and
               the block is drawn one storey taller than the household lives, so
               their floor is never the roof. Between four and eight storeys:
               below that it stops reading as a block of flats, above it the
               drawing is taller than the card it sits in. */
            highlightFloor={floorOf(context.label)}
            floors={Math.min(8, Math.max(4, (floorOf(context.label) ?? 4) + 1))}
            /* Every household gets its own building rather than the same stock
               one: the unit id seeds which flats have their lights on, so two
               neighbours comparing phones see two different blocks. */
            seed={unitId.length + unitId.charCodeAt(0)}
            facts={[
              {
                icon: 'swap-vertical-outline',
                text: `${today.length} ${today.length === 1 ? 'entry' : 'entries'} at your door today`,
                tone: 'brand',
              },
              pending.length
                ? {
                    icon: 'hourglass-outline',
                    text: `${pending.length} waiting on your answer`,
                    tone: 'warning' as const,
                  }
                : {
                    icon: 'shield-checkmark-outline',
                    text: 'Nothing waiting at the gate',
                    tone: 'success' as const,
                  },
            ]}
            note={context.buildingName ?? context.sublabel}
          />
        )}

        {firstLoad ? null : (
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'stretch' }}>
            <StatCard
              label="Your staff"
              value={String(staff.length)}
              icon="people-outline"
              fg={colors.info}
              bg={colors.infoBg}
              onPress={() => router.push('/resident/staff')}
            />
            <StatCard
              label="Entries today"
              value={String(today.length)}
              icon="swap-vertical-outline"
              fg={colors.primary}
              bg={colors.primarySoft}
              onPress={() => router.push('/resident/log')}
            />
            <StatCard
              label="Waiting on you"
              value={String(pending.length)}
              icon="time-outline"
              fg={colors.warning}
              bg={colors.warningBg}
            />
          </View>
        )}

        {firstLoad ? null : (
          <View style={{ gap: spacing.sm }}>
            <SectionHeader
              title="Your staff"
              actionLabel={staff.length ? 'Manage' : undefined}
              onAction={() => router.push('/resident/staff')}
            />
            <Card padded={false}>
              <View style={{ padding: spacing.sm }}>
                {staff.length === 0 ? (
                  <EmptyState
                    icon="people-outline"
                    /* A building with every light off. The sentence explains
                       what to do about it; the drawing is what "nobody comes to
                       this flat yet" actually looks like. */
                    art={<ApartmentTower width={104} floors={4} columns={3} lit={0} seed={7} />}
                    title="No staff yet"
                    message="Ask the society office to register your help, then subscribe here to be told when they arrive."
                  />
                ) : (
                  staff.map((s) => (
                    <ListTile
                      key={s.assignmentId}
                      icon={staffTypeIcon(s.staffType) as never}
                      title={s.name}
                      subtitle={`${staffTypeLabel(s.staffType)} · with you since ${relative(
                        s.activeFrom,
                      )}`}
                      right={
                        <Text
                          style={[
                            type.caption,
                            { color: s.notify ? colors.primary : colors.textFaint },
                          ]}
                        >
                          {s.notify ? 'NOTIFIES' : 'MUTED'}
                        </Text>
                      }
                      onPress={() => router.push('/resident/staff')}
                    />
                  ))
                )}
              </View>
            </Card>
          </View>
        )}

        {events.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <SectionHeader
              title="Recent activity"
              actionLabel={totalEvents > 4 ? 'See all' : undefined}
              onAction={() => router.push('/resident/log')}
            />
            <Card padded={false}>
              <View style={{ padding: spacing.sm }}>
                {events.slice(0, 4).map((e) => (
                  <EntryRow key={e.id} event={e} />
                ))}
              </View>
            </Card>
          </View>
        ) : null}

        {/* The one thing a resident can do about push reliability, said once,
            where they will see it. */}
        <Note
          icon="phone-portrait-outline"
          tone="brand"
          text="Approvals arrive as a full-screen alert. If your phone kills background apps, allow Iverto Gate to autostart — otherwise a visitor request can arrive minutes late."
        />
      </Screen>
    </>
  );
}
