/**
 * The society at a glance.
 *
 * Four numbers and two lists, chosen to answer the questions an admin is
 * actually asked: is the gate working, who is registered, what has crossed
 * today, and who has not been enrolled on the terminal yet. Anything that needs
 * a second screen to interpret does not belong on this one.
 *
 * The terrace at the top is the same answer in one glance: a block per corner
 * of the society, lit for the arrivals it has had today. The lights read the
 * same array as the count printed underneath, so the two cannot drift.
 *
 * Two sections that used to live here — notices and complaints — are gone. The
 * service has no endpoint for either, and a compose box that posts nowhere is
 * worse than no compose box, because the admin believes the society has been
 * told.
 *
 * Everything here reads `/web/societies/{id}/…`, which the deployment serves
 * but does not document a shape for. Every reader normalises defensively and
 * `API.md` says so plainly; if a field arrives named differently this screen
 * renders a dash rather than crashing.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ShellHeader } from '@/components/ShellHeader';
import { SocietyCard } from '@/components/place';
import { EntryRow } from '@/components/EntryList';
import {
  Card,
  EmptyState,
  ErrorState,
  ListTile,
  Note,
  PoweredBy,
  SectionHeader,
  SkeletonCard,
  SkeletonRows,
  SkeletonStats,
  StatCard,
} from '@/components/ui';
import { colors, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useQuery } from '@/lib/api';
import { useAuth, useSocietyContext } from '@/lib/auth';

export default function AdminHome() {
  const { user, signOut } = useAuth();
  const context = useSocietyContext();
  const societyId = context.societyId;

  const unitsQuery = useQuery(keys.units(societyId), () => api.getUnits(societyId));
  const staffQuery = useQuery(keys.societyStaff(societyId), () => api.getSocietyStaff(societyId));
  const eventsQuery = useQuery(keys.societyEvents(societyId), () =>
    api.getSocietyEntryEvents(societyId, 30),
  );
  const devicesQuery = useQuery(keys.devices(societyId), () => api.getDevices(societyId));

  const units = unitsQuery.data ?? [];
  const staff = staffQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const devices = devicesQuery.data ?? [];

  const today = events.filter(
    (e) => new Date(e.occurredAt).toDateString() === new Date().toDateString(),
  );
  const arrivalsToday = today.filter((e) => e.direction === 'IN');
  const unbound = staff.filter((s) => !s.facePersonRef);
  const sick = devices.filter((d) => !api.deviceHealth(d).ok);

  /* Four lists, one screen. It waits only on the two everything above the fold
     is counted from — the rest fill in underneath as they land. */
  const firstLoad = unitsQuery.loading && devicesQuery.loading;
  const failed = unitsQuery.error ?? devicesQuery.error;

  return (
    <>
      <ShellHeader
        icon="business-outline"
        meta={`${units.length} homes · ${devices.length} terminals`}
      />
      <Screen>
        {firstLoad ? (
          <>
            <SkeletonCard lines={3} />
            <SkeletonStats />
            <SkeletonRows rows={3} />
          </>
        ) : null}
        {failed && !units.length && !devices.length ? (
          <ErrorState
            error={failed}
            onRetry={() => {
              unitsQuery.refetch();
              devicesQuery.refetch();
            }}
          />
        ) : null}

        {sick.length > 0 ? (
          <Note
            icon="warning-outline"
            tone="danger"
            text={`${sick.length} of ${devices.length} terminals have stopped reporting. Staff arrivals are not being detected there — check the gates screen.`}
          />
        ) : null}

        {/* An enrolment that was never bound to a person is invisible to the
            whole fan-out, and it fails silently — so it is surfaced on the
            first screen rather than left in a queue nobody opens. */}
        {unbound.length > 0 ? (
          <Note
            icon="person-add-outline"
            tone="warning"
            text={`${unbound.length} registered ${
              unbound.length === 1 ? 'person has' : 'people have'
            } no face enrolment. Until they are bound, their arrivals notify nobody.`}
          />
        ) : null}

        {firstLoad ? null : (
          <SocietyCard
            headline={context.label}
            caption={`${units.length} ${units.length === 1 ? 'home' : 'homes'} across ${
              devices.length
            } ${devices.length === 1 ? 'terminal' : 'terminals'}.`}
            /* One window per arrival today, capped to what the drawing has. */
            lit={Math.min(arrivalsToday.length, 16)}
            facts={[
              {
                icon: 'swap-vertical-outline',
                text: `${today.length} ${
                  today.length === 1 ? 'entry' : 'entries'
                } across every gate today`,
                tone: 'brand',
              },
              sick.length
                ? {
                    icon: 'warning-outline',
                    text: `${sick.length} of ${devices.length} terminals have stopped reporting`,
                    tone: 'warning' as const,
                  }
                : {
                    icon: 'hardware-chip-outline',
                    text: devices.length
                      ? 'Every terminal is reporting in'
                      : 'No terminals paired yet',
                    tone: devices.length ? ('success' as const) : ('info' as const),
                  },
              unbound.length
                ? {
                    icon: 'person-add-outline',
                    text: `${unbound.length} staff awaiting face enrolment`,
                    tone: 'info' as const,
                  }
                : {
                    icon: 'checkmark-circle-outline',
                    text: `All ${staff.length} staff enrolled`,
                    tone: 'success' as const,
                  },
            ]}
            note={`${arrivalsToday.length} in today`}
          />
        )}

        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'stretch' }}>
          <StatCard
            label="Homes"
            value={String(units.length)}
            icon="home-outline"
            fg={colors.primary}
            bg={colors.primarySoft}
          />
          <StatCard
            label="Staff"
            value={String(staff.length)}
            icon="people-outline"
            fg={colors.info}
            bg={colors.infoBg}
            onPress={() => router.push('/admin/staff')}
          />
          <StatCard
            label="Entries today"
            value={String(today.length)}
            icon="swap-vertical-outline"
            fg={colors.success}
            bg={colors.successBg}
          />
        </View>

        <SectionHeader
          title="Terminals"
          actionLabel="Manage"
          onAction={() => router.push('/admin/gates')}
        />
        <Card padded={false}>
          <View style={{ padding: spacing.sm }}>
            {devices.length === 0 ? (
              <EmptyState
                icon="hardware-chip-outline"
                title="No terminals"
                message="Nothing is paired to this society yet, so no arrival is detected automatically."
              />
            ) : (
              devices.map((d) => {
                const health = api.deviceHealth(d);
                return (
                  <ListTile
                    key={d.id}
                    icon="hardware-chip-outline"
                    title={d.gateName ?? d.serialNo ?? 'Terminal'}
                    subtitle={
                      [d.vendor, d.serialNo].filter(Boolean).join(' · ') || 'No details recorded'
                    }
                    danger={!health.ok}
                    right={
                      <Text
                        style={[
                          type.caption,
                          { color: health.ok ? colors.success : colors.danger },
                        ]}
                      >
                        {health.ok
                          ? 'HEALTHY'
                          : health.minutesSilent === null
                            ? 'NO SIGNAL'
                            : `${health.minutesSilent}M SILENT`}
                      </Text>
                    }
                    onPress={() => router.push('/admin/gates')}
                  />
                );
              })
            )}
          </View>
        </Card>

        <SectionHeader title="Latest across all gates" />
        <Card padded={false}>
          <View style={{ padding: spacing.sm }}>
            {events.length === 0 ? (
              <EmptyState
                icon="file-tray-outline"
                title="Nothing logged yet"
                message="Entries appear here as soon as anyone scans in or a guard logs a visitor."
              />
            ) : (
              events.slice(0, 5).map((e) => <EntryRow key={e.id} event={e} />)
            )}
          </View>
        </Card>

        <Card padded={false}>
          <View style={{ padding: spacing.sm }}>
            <ListTile icon="mail-outline" title={user?.name || 'You'} subtitle={user?.email} />
            <ListTile
              icon="log-out-outline"
              title="Sign out"
              danger
              onPress={async () => {
                await signOut();
                router.replace('/login');
              }}
            />
          </View>
        </Card>

        <PoweredBy />
      </Screen>
    </>
  );
}
