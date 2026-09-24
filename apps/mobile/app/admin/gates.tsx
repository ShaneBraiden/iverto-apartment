/**
 * Gates and their terminals.
 *
 * The terminal is a sensor, not a decision-maker — it answers "who is this, and
 * when" and every policy decision happens in the cloud. So this screen shows
 * exactly two things about each device: whether it is talking, and what it is.
 * There is nothing to configure here, and that is the point.
 *
 * Five minutes of silence is the threshold. A dead gate device that nobody
 * notices for three days is a pilot-killer, so the state is stated plainly
 * rather than buried in a green dot.
 *
 * The list is devices rather than gates, because `GET /web/societies/{id}/devices`
 * is what the service serves — there is no gate resource of its own. A gate
 * with no terminal fitted therefore does not appear here at all, which is worth
 * knowing before reading the count as a count of gates.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, TopBar } from '@/components/Screen';
import {
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  Loader,
  Note,
  Row,
  SectionHeader,
} from '@/components/ui';
import { LiveDot } from '@/components/motion';
import { colors, radius, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useNow, useQuery } from '@/lib/api';
import { useSocietyContext } from '@/lib/auth';
import { relative } from '@/lib/datetime';

export default function AdminGates() {
  const context = useSocietyContext();
  const societyId = context.societyId;

  const devicesQuery = useQuery(keys.devices(societyId), () => api.getDevices(societyId));
  const eventsQuery = useQuery(keys.societyEvents(societyId), () =>
    api.getSocietyEntryEvents(societyId),
  );
  const devices = devicesQuery.data ?? [];
  const events = eventsQuery.data ?? [];

  /* This is the screen an admin leaves open while someone walks to the gate to
     look at the box, so the silence counter has to keep moving on its own
     rather than freezing at whatever it read when the page loaded. */
  useNow(30_000);

  return (
    <>
      <TopBar title="Gates" subtitle={context.label} back={false} />
      <Screen>
        {devicesQuery.loading ? <Loader label="Loading terminals…" /> : null}
        {devicesQuery.error && !devices.length ? (
          <ErrorState error={devicesQuery.error} onRetry={devicesQuery.refetch} />
        ) : null}

        <Note
          icon="hardware-chip-outline"
          tone="info"
          text="Each gate has a bridge that speaks the terminal's own protocol and buffers to local storage when the connection drops. Nothing is lost while a gate is offline — it arrives late, with the original timestamp."
        />

        {!devicesQuery.loading && !devicesQuery.error && devices.length === 0 ? (
          <Card>
            <EmptyState
              icon="hardware-chip-outline"
              title="No terminals paired"
              message="Nothing is reporting to this society yet, so every arrival has to be logged by a guard by hand."
            />
          </Card>
        ) : null}

        {devices.map((d) => {
          const health = api.deviceHealth(d);
          const today = events.filter(
            (e) =>
              e.gateId === d.gateId &&
              new Date(e.occurredAt).toDateString() === new Date().toDateString(),
          );

          return (
            <Card key={d.id}>
              <View style={{ gap: spacing.md }}>
                <View style={styles.row}>
                  <IconTile
                    icon="hardware-chip-outline"
                    size={44}
                    bg={health.ok ? colors.successBg : colors.dangerBg}
                    tint={health.ok ? colors.success : colors.danger}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.h3, { color: colors.text }]}>
                      {d.gateName ?? d.serialNo ?? 'Terminal'}
                    </Text>
                    <View style={styles.statusRow}>
                      {health.ok ? <LiveDot color={colors.success} /> : null}
                      <Text
                        style={[
                          type.small,
                          { color: health.ok ? colors.success : colors.danger },
                        ]}
                      >
                        {health.ok
                          ? 'Reporting normally'
                          : health.minutesSilent === null
                            ? 'Never reported in'
                            : `Silent for ${health.minutesSilent} minutes`}
                      </Text>
                    </View>
                  </View>
                </View>

                {!health.ok ? (
                  <Note
                    icon="warning-outline"
                    tone="danger"
                    text="Face arrivals at this gate are not reaching the app. Guards should log staff by hand until it is back."
                  />
                ) : null}

                <View style={styles.details}>
                  <Row icon="business-outline" label="Vendor" value={d.vendor ?? '—'} />
                  <Row icon="barcode-outline" label="Serial" value={d.serialNo ?? '—'} />
                  <Row
                    icon="pulse-outline"
                    label="Last heartbeat"
                    value={relative(d.lastHeartbeatAt)}
                    color={health.ok ? colors.success : colors.danger}
                  />
                  <Row icon="code-working-outline" label="Status" value={d.status ?? '—'} />
                  <Row
                    icon="swap-vertical-outline"
                    label="Entries today"
                    value={String(today.length)}
                  />
                </View>
              </View>
            </Card>
          );
        })}

        <SectionHeader title="How a gate event travels" />
        <Card>
          <View style={{ gap: spacing.md }}>
            {[
              {
                icon: 'scan-outline',
                title: 'Terminal',
                text: 'Matches the face locally. Works with no internet at all.',
              },
              {
                icon: 'git-commit-outline',
                title: 'Bridge',
                text: "Normalises the vendor payload and buffers it to disk.",
              },
              {
                icon: 'cloud-upload-outline',
                title: 'Cloud',
                text: 'Deduplicates the event, then resolves who it was.',
              },
              {
                icon: 'git-network-outline',
                title: 'Fan-out',
                text: 'Every household subscribed to that person is notified at once.',
              },
            ].map((step, i) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepIndex}>
                  <Text style={[type.caption, { color: colors.primary }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.bodyMed, { color: colors.text }]}>{step.title}</Text>
                  <Text style={[type.small, { color: colors.textMuted }]}>{step.text}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  details: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepIndex: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
