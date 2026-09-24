/**
 * The household's controls.
 *
 * Grouped by who they affect: the rules that decide what happens without you,
 * then the account. Delivery rules sit at the top because they are the only
 * setting on this screen that can let somebody through the gate while your
 * phone is in your pocket.
 *
 * The complaints section that used to sit in the middle of this screen is gone.
 * There is no complaints endpoint on this service — not an empty one, none —
 * and a form that posts nowhere is worse than no form, because the person who
 * fills it in believes the office has been told.
 */
import React from 'react';
import { View, Text, Alert } from 'react-native';
import { router } from 'expo-router';
import { Screen, TopBar } from '@/components/Screen';
import { Card, ListTile, Note, PoweredBy, SectionHeader } from '@/components/ui';
import { colors, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useQuery } from '@/lib/api';
import { useAuth, useUnitContext } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/rbac';
import { modeLabel, platformLabel } from '@/lib/status';

export default function ResidentSettings() {
  const context = useUnitContext();
  const { user, can, signOut, societyName } = useAuth();
  const unitId = context.unitId;

  const rules =
    useQuery(keys.deliveryPermissions(unitId), () => api.getDeliveryPermissions(unitId)).data ?? [];
  const passcodes = useQuery(keys.passcodes(unitId), () => api.getPasscodes(unitId)).data ?? [];

  /* A rule that says ASK_ME is the default written down, not a permission
     granted — so it does not count towards "who gets in without asking". */
  const grants = rules.filter((r) => r.mode !== 'ASK_ME');
  const livePasscodes = passcodes.filter(
    (p) => !p.revoked && new Date(p.validUntil).getTime() > Date.now(),
  );

  return (
    <>
      <TopBar
        title="Settings"
        subtitle={`${context.label} · ${ROLE_LABEL[context.role]}`}
        back={false}
      />
      <Screen>
        <SectionHeader title="Who gets in without asking" />
        <Card padded={false}>
          <View style={{ padding: spacing.sm }}>
            <ListTile
              icon="cube-outline"
              title="Delivery rules"
              subtitle={
                grants.length
                  ? grants
                      .map((r) => `${platformLabel(r.platform)}: ${modeLabel(r.mode)}`)
                      .join(' · ')
                  : 'Everything asks you first'
              }
              onPress={() => router.push('/deliveries')}
            />
            <ListTile
              icon="qr-code-outline"
              title="Guest passcodes"
              subtitle={
                livePasscodes.length
                  ? `${livePasscodes.length} active`
                  : 'None active — invite a guest and skip the call'
              }
              onPress={() => router.push('/passcodes')}
            />
          </View>
        </Card>

        {!can('delivery_perm.edit') ? (
          <Note
            icon="lock-closed-outline"
            tone="info"
            text="You are a family member on this home, so you can decide who comes in but not change the standing rules. The owner or tenant sets those."
          />
        ) : null}

        <SectionHeader title="This home" />
        <Card padded={false}>
          <View style={{ padding: spacing.sm }}>
            <ListTile
              icon="home-outline"
              title={context.label}
              subtitle={
                context.buildingName
                  ? `${context.buildingName} · ${context.sublabel}`
                  : context.sublabel
              }
              right={
                context.isPrimary ? (
                  <Text style={[type.caption, { color: colors.primary }]}>PRIMARY</Text>
                ) : undefined
              }
            />
            <ListTile
              icon="person-outline"
              title={user?.name || 'You'}
              subtitle={ROLE_LABEL[context.role]}
            />
          </View>
        </Card>

        <SectionHeader title="Account" />
        <Card padded={false}>
          <View style={{ padding: spacing.sm }}>
            <ListTile icon="mail-outline" title={user?.email ?? '—'} subtitle="Your sign-in" />
            {user?.phone ? (
              <ListTile icon="call-outline" title={user.phone} subtitle="Registered number" />
            ) : null}
            <ListTile
              icon="log-out-outline"
              title="Sign out"
              subtitle="You will need your password again next time"
              danger
              onPress={() =>
                Alert.alert('Sign out?', 'You will need your email and password again.', [
                  { text: 'Stay', style: 'cancel' },
                  {
                    text: 'Sign out',
                    style: 'destructive',
                    onPress: async () => {
                      await signOut();
                      router.replace('/login');
                    },
                  },
                ])
              }
            />
          </View>
        </Card>

        <Note
          icon="business-outline"
          tone="info"
          text={`Anything the office should look at — a gate, a parking space, a complaint — goes to ${
            societyName ?? 'the society office'
          } directly. The app does not carry those yet.`}
        />

        <PoweredBy />
      </Screen>
    </>
  );
}
