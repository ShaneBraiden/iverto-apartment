/**
 * The guard tab tree.
 *
 * Three tabs and no switcher. A guard's device is the least trusted in the
 * system and their screen has to be predictable — the queue is always one tap
 * away, and there is no route out of the shell for the length of the shift.
 */
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { tabIcon, useTabScreenOptions } from '@/components/TabBar';
import { useAuth } from '@/lib/auth';
import * as api from '@/lib/api';
import { keys, useQuery } from '@/lib/api';

export default function GuardLayout() {
  const options = useTabScreenOptions();
  const { context } = useAuth();
  const gateId = context?.type === 'GATE' ? context.gateId : null;

  /* §6.2's safety net: the badge is the gate's own pending list, refetched on
     every socket frame and on foreground, so a guard who was looking at the
     directory when a request came in still sees it waiting. */
  const pending = useQuery(
    keys.gatePending(gateId ?? ''),
    () => api.getGatePending(gateId!),
    { enabled: !!gateId },
  );
  const count = pending.data?.length ?? 0;

  if (!gateId) return <Redirect href="/" />;

  return (
    <Tabs screenOptions={options}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Gate',
          tabBarIcon: tabIcon('shield-checkmark-outline'),
          tabBarBadge: count || undefined,
        }}
      />
      <Tabs.Screen
        name="directory"
        options={{ title: 'Directory', tabBarIcon: tabIcon('search-outline') }}
      />
      {/* "My log", not "Log". The service has no gate-wide entry feed, so this
          tab shows what this device raised and nothing else — and a tab
          labelled "Log" on a gate screen is a promise the app cannot keep. */}
      <Tabs.Screen
        name="log"
        options={{ title: 'My log', tabBarIcon: tabIcon('list-outline') }}
      />
    </Tabs>
  );
}
