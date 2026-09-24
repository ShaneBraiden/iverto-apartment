/**
 * The resident tab tree.
 *
 * Four tabs, and their order is the order of urgency: the thing you must
 * answer, the people you expect, the record of both, and the rules that govern
 * them. Nothing here is reachable without a UNIT context — the router picks
 * this subtree only for one (see `app/index.tsx`).
 */
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { tabIcon, useTabScreenOptions } from '@/components/TabBar';
import { useAuth } from '@/lib/auth';
import * as api from '@/lib/api';
import { keys, useQuery } from '@/lib/api';

export default function ResidentLayout() {
  const options = useTabScreenOptions();
  const { context } = useAuth();
  const unitId = context?.type === 'UNIT' ? context.unitId : null;

  /* The badge is server truth, not a count of pushes received — so it is this
     home's pending queue, refetched on foreground and on every approval frame
     from the socket, rather than a number this app increments itself. The home
     screen reads the same cache entry, so the badge and the cards below it
     cannot disagree.

     It is per-unit because that is the only pending endpoint the service has.
     Someone with two homes sees the badge for the one they are acting as,
     which is also the only one whose approvals they could answer without
     switching hats first. */
  const pending = useQuery(
    keys.unitPending(unitId ?? ''),
    () => api.getUnitPending(unitId!),
    { enabled: !!unitId },
  );
  const count = pending.data?.length ?? 0;

  if (!unitId) return <Redirect href="/" />;

  return (
    <Tabs screenOptions={options}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: tabIcon('home-outline'),
          tabBarBadge: count || undefined,
        }}
      />
      <Tabs.Screen
        name="staff"
        options={{ title: 'Staff', tabBarIcon: tabIcon('people-outline') }}
      />
      <Tabs.Screen
        name="log"
        options={{ title: 'Log', tabBarIcon: tabIcon('list-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('options-outline') }}
      />
    </Tabs>
  );
}
