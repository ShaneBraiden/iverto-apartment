/**
 * What this device has logged.
 *
 * It is not the gate's log, and the screen says so before it says anything
 * else. The service has no endpoint that reads entry events back for a gate —
 * they can be created and closed, not listed — so the only rows this app can
 * honestly show a guard are the ones it created itself since launch.
 *
 * The alternative would have been to leave the tab showing an empty list, which
 * on a gate screen reads as "nothing has happened today". That is the one
 * sentence this screen must never accidentally say.
 *
 * Read-only, as it would be either way. Entry events are append-only facts — a
 * guard who could edit the log could also erase the record of who they let in,
 * which is the one thing the log exists to prevent. A correction is an exit
 * row, never a change to an entry.
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, TopBar } from '@/components/Screen';
import { EntryList } from '@/components/EntryList';
import { Button, Card, Chip, EmptyState, Note, SectionHeader } from '@/components/ui';
import { colors, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useMutation } from '@/lib/api';
import { useGateContext } from '@/lib/auth';
import { durationSince } from '@/lib/datetime';
import { recordExit, useGateSession } from '@/lib/gateSession';
import type { EntryEvent } from '@/types';

export default function GuardLog() {
  const context = useGateContext();
  const gateId = context.gateId;
  const [showOpen, setShowOpen] = useState(false);

  const session = useGateSession(gateId);
  const open = session.filter((e) => !e.exitedAt && e.event.direction === 'IN');
  const shown = (showOpen ? open : session).map((e) => e.event);
  const openIds = new Set(open.map((e) => e.event.id));

  const exit = useMutation((entryEventId: string) => api.markExit(gateId, entryEventId), {
    invalidates: [keys.gatePending(gateId)],
    onSuccess: (_result, entryEventId) => recordExit(entryEventId),
  });

  const exitAction = (e: EntryEvent) =>
    openIds.has(e.id) ? (
      <View style={{ alignItems: 'flex-end', flexShrink: 0, gap: 4 }}>
        <Text style={[type.caption, { color: colors.textFaint }]}>
          {durationSince(e.occurredAt).toUpperCase()}
        </Text>
        <Button
          label="Mark out"
          variant="secondary"
          full={false}
          disabled={exit.loading}
          onPress={() => exit.mutate(e.id)}
        />
      </View>
    ) : undefined;

  return (
    <>
      <TopBar title="This device" subtitle={context.label} back={false} />
      <Screen>
        {/* First, before any list. A guard reading a short list on a gate
            screen will assume it is the gate's list unless told otherwise, and
            that assumption is how somebody gets waved through. */}
        <Note
          icon="information-circle-outline"
          tone="warning"
          text="This is only what you logged on this phone since opening the app — not the gate's full record. Face-terminal scans, the previous shift, and other devices are not here. The society office has the complete log."
        />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip label="Everything" selected={!showOpen} onPress={() => setShowOpen(false)} />
          <Chip
            label={`Still open · ${open.length}`}
            icon="enter-outline"
            selected={showOpen}
            onPress={() => setShowOpen(true)}
          />
        </View>

        {showOpen && open.length > 0 ? (
          <Note
            icon="time-outline"
            tone="warning"
            text="Everyone here came in through you and has no exit recorded. Close them out before you hand over — the list is gone when the app restarts."
          />
        ) : null}

        {shown.length === 0 ? (
          <Card>
            <EmptyState
              icon="file-tray-outline"
              title={showOpen ? 'Nothing left open' : 'Nothing logged yet on this phone'}
              message={
                showOpen
                  ? 'Every entry you raised has been marked out.'
                  : 'Raise a visitor from the gate screen and it will appear here so you can close them out later.'
              }
            />
          </Card>
        ) : (
          <>
            <SectionHeader title={`${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}`} />
            <EntryList events={shown} renderRight={exitAction} />
          </>
        )}
      </Screen>
    </>
  );
}
