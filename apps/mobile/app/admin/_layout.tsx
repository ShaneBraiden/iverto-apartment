/**
 * The society admin tab tree.
 *
 * Three tabs: the state of the society, the staff registry that everything
 * else depends on, and the gates with their terminals.
 *
 * There was a fourth — a simulator that fabricated face scans against the
 * in-memory store. It went out with the mock. Gate events are ingested from
 * the bridge under a per-device token scoped to `gate-events` (§10), so an
 * admin session cannot post one even if the screen still existed; simulating a
 * terminal is now the bridge's own test harness, on the other side of the API.
 */
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { tabIcon, useTabScreenOptions } from '@/components/TabBar';
import { useAuth } from '@/lib/auth';

export default function AdminLayout() {
  const options = useTabScreenOptions();
  const { context } = useAuth();

  if (context?.type !== 'SOCIETY') return <Redirect href="/" />;

  return (
    <Tabs screenOptions={options}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Society', tabBarIcon: tabIcon('business-outline') }}
      />
      <Tabs.Screen
        name="staff"
        options={{ title: 'Staff', tabBarIcon: tabIcon('people-outline') }}
      />
      <Tabs.Screen
        name="gates"
        options={{ title: 'Gates', tabBarIcon: tabIcon('hardware-chip-outline') }}
      />
    </Tabs>
  );
}
