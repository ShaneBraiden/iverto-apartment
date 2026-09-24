/**
 * The staff registry — one row per person, N assignments.
 *
 * This is the table the whole product rests on, and this screen is where its
 * shape becomes visible: a person is registered once, bound once to a face
 * enrolment, and subscribed to by however many households want to hear about
 * them.
 *
 * The count of *how many* households — the number no incumbent can show — used
 * to sit beside every name here. It is gone, because the service does not
 * return it and there is no endpoint that lists one person's assignments. A
 * number the app made up would be the single most misleading thing on this
 * screen. `API.md` records both gaps.
 *
 * What is left is what the register is for: register a person, and bind them to
 * the enrolment the terminal gave them. The second step is the one that fails
 * silently, so it is the one this screen is loudest about.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, TopBar } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  IconTile,
  Loader,
  Note,
} from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useMutation, useQuery } from '@/lib/api';
import { useSocietyContext } from '@/lib/auth';
import { maskPhone } from '@/lib/rbac';
import { STAFF_TYPES, staffTypeIcon, staffTypeLabel } from '@/lib/status';
import type { Staff, StaffType } from '@/types';

export default function AdminStaff() {
  const context = useSocietyContext();
  const societyId = context.societyId;

  const staffQuery = useQuery(keys.societyStaff(societyId), () => api.getSocietyStaff(societyId));
  const staff = staffQuery.data ?? [];

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [staffType, setStaffType] = useState<StaffType>('MAID');

  const [binding, setBinding] = useState<Staff | null>(null);
  const [personRef, setPersonRef] = useState('');

  const unbound = staff.filter((s) => !s.facePersonRef);

  const create = useMutation(
    () =>
      api.createStaff(societyId, {
        name: name.trim(),
        phone: phone.replace(/\s+/g, ''),
        staffType,
      }),
    {
      invalidates: [keys.societyStaff(societyId)],
      onSuccess: () => {
        setCreating(false);
        setName('');
        setPhone('');
      },
    },
  );

  const bind = useMutation(() => api.bindFaceRef(societyId, binding!.id, personRef), {
    invalidates: [keys.societyStaff(societyId)],
    onSuccess: () => {
      setBinding(null);
      setPersonRef('');
    },
  });

  return (
    <>
      <TopBar
        title="Staff"
        subtitle={context.label}
        back={false}
        rightIcon="person-add-outline"
        onRight={() => setCreating(true)}
      />
      <Screen>
        <Note
          icon="git-network-outline"
          tone="brand"
          text="One person, one row, many homes. A single face scan fans out to every household subscribed to them — which is why they are registered here and subscribed to there."
        />

        {unbound.length > 0 ? (
          <Note
            icon="warning-outline"
            tone="warning"
            text={`${unbound.length} of ${staff.length} have no face enrolment bound. Their arrivals resolve to nobody and notify nobody — and nothing else in the app will tell you.`}
          />
        ) : null}

        {staffQuery.loading ? <Loader label="Loading the register…" /> : null}
        {staffQuery.error && !staff.length ? (
          <ErrorState error={staffQuery.error} onRetry={staffQuery.refetch} />
        ) : null}

        {!staffQuery.loading && !staffQuery.error && staff.length === 0 ? (
          <Card>
            <EmptyState
              icon="people-outline"
              title="Nobody registered"
              message="Register the society's staff here, then bind each one to their enrolment on the face terminal."
            />
          </Card>
        ) : (
          staff.map((s) => (
            <Card key={s.id}>
              <View style={{ gap: spacing.md }}>
                <View style={styles.row}>
                  <IconTile
                    icon={staffTypeIcon(s.staffType) as never}
                    size={44}
                    bg={s.facePersonRef ? colors.successBg : colors.warningBg}
                    tint={s.facePersonRef ? colors.success : colors.warning}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={[type.small, { color: colors.textMuted }]}>
                      {staffTypeLabel(s.staffType)}
                      {s.phone ? ` · ${maskPhone(s.phone)}` : ''}
                    </Text>
                  </View>
                </View>

                <View style={styles.tagRow}>
                  <View
                    style={[
                      styles.tag,
                      {
                        backgroundColor:
                          s.status === 'ACTIVE' ? colors.infoBg : colors.neutralBg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        type.caption,
                        { color: s.status === 'ACTIVE' ? colors.info : colors.textMuted },
                      ]}
                    >
                      {s.status}
                    </Text>
                  </View>
                  {s.facePersonRef ? (
                    <View style={[styles.tag, { backgroundColor: colors.successBg }]}>
                      <Text style={[type.caption, { color: colors.success }]}>
                        {s.facePersonRef}
                      </Text>
                    </View>
                  ) : (
                    <Chip
                      label="Bind face enrolment"
                      icon="link-outline"
                      onPress={() => setBinding(s)}
                    />
                  )}
                </View>
              </View>
            </Card>
          ))
        )}
      </Screen>

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="Register staff"
        subtitle="They are enrolled on the terminal separately"
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            icon="person-outline"
            placeholder="Full name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Field
            label="Phone"
            icon="call-outline"
            placeholder="98765 43210"
            keyboardType="phone-pad"
            autoCorrect={false}
            maxLength={16}
            value={phone}
            onChangeText={setPhone}
          />
          <View style={{ gap: spacing.sm }}>
            <Text style={[type.smallMed, { color: colors.textMuted }]}>What they do</Text>
            <View style={styles.tagRow}>
              {STAFF_TYPES.map((t) => (
                <Chip
                  key={t.value}
                  label={t.label}
                  icon={t.icon as never}
                  selected={staffType === t.value}
                  onPress={() => setStaffType(t.value)}
                />
              ))}
            </View>
          </View>
          <Note
            icon="information-circle-outline"
            tone="info"
            text="Registering them does not notify anyone yet. Households subscribe from their own Staff screen, and the face terminal has to be bound before arrivals are detected."
          />
          <Button
            label="Register"
            icon="checkmark"
            loading={create.loading}
            disabled={!name.trim() || !phone.trim() || create.loading}
            onPress={() => create.mutate()}
          />
        </View>
      </Sheet>

      <Sheet
        visible={!!binding}
        onClose={() => setBinding(null)}
        title="Bind face enrolment"
        subtitle={binding?.name}
      >
        <View style={{ gap: spacing.lg }}>
          <Note
            icon="scan-outline"
            tone="info"
            text="Enrol them at the terminal using the vendor's own screen, then type the person ID it assigned. Unbound enrolments notify nobody."
          />
          <Field
            label="Person reference"
            icon="finger-print-outline"
            placeholder="M50-STAFF-10492"
            value={personRef}
            onChangeText={setPersonRef}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <Button
            label="Bind"
            icon="link-outline"
            loading={bind.loading}
            disabled={!personRef.trim() || bind.loading}
            onPress={() => bind.mutate()}
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});
