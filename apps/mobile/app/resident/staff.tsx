/**
 * The household's side of the staff table.
 *
 * One person can serve eight homes, and each of those homes decides
 * independently whether to be told when they arrive. That per-household mute is
 * the switch on every row — muting it here does not affect anybody else's
 * subscription, and it never stops the arrival being *logged*, which is the
 * distinction the copy under the switch has to carry.
 *
 * Two things this screen used to show and no longer does, because the service
 * does not send them: whether someone is inside right now, and how many homes
 * they serve. Both were real facts in the design and are absent from the
 * response, and a screen that fills that in from nothing is a screen that will
 * be confidently wrong about who is in the building.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Switch } from 'react-native';
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
  SectionHeader,
} from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useMutation, useQuery } from '@/lib/api';
import { useAuth, useUnitContext } from '@/lib/auth';
import { relative } from '@/lib/datetime';
import { maskPhone } from '@/lib/rbac';
import { staffTypeIcon, staffTypeLabel } from '@/lib/status';

export default function ResidentStaff() {
  const context = useUnitContext();
  const { can } = useAuth();
  const unitId = context.unitId;

  const mineQuery = useQuery(keys.unitStaff(unitId), () => api.getUnitStaff(unitId));

  /* The society register is only needed to fill the "add" sheet, so it is not
     fetched until the sheet is opened — a resident who never adds anyone never
     pays for a list of every staff member in the society. */
  const [adding, setAdding] = useState(false);
  const rosterQuery = useQuery(
    keys.unitStaffRoster(unitId),
    () => api.getSocietyStaffRoster(unitId),
    { enabled: adding },
  );

  const mine = mineQuery.data ?? [];
  /* `null` is not `[]` here. The register endpoint is documented but not
     deployed, and it answers 404 — which `getSocietyStaffRoster` turns into
     null so this screen can say "unavailable" rather than "nobody is
     registered", which is a different and much more misleading sentence. */
  const rosterUnavailable = rosterQuery.data === null && !rosterQuery.loading;
  const roster = rosterQuery.data ?? [];
  const [search, setSearch] = useState('');

  const invalidates = [keys.unitStaff(unitId)];
  const setNotify = useMutation(
    (staffId: string, notify: boolean) => api.setStaffNotify(unitId, staffId, notify),
    { invalidates },
  );
  const remove = useMutation((staffId: string) => api.unassignStaff(unitId, staffId), {
    invalidates,
  });
  const add = useMutation((staffId: string) => api.assignStaff(unitId, staffId), { invalidates });

  const mayAssign = can('staff.assign');
  const mineIds = useMemo(() => new Set(mine.map((s) => s.staffId)), [mine]);
  const available = roster.filter(
    (s) =>
      !mineIds.has(s.id) &&
      s.status === 'ACTIVE' &&
      s.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <>
      <TopBar title="Your staff" subtitle={context.label} back={false} />
      <Screen>
        <SectionHeader
          title={mine.length ? `${mine.length} subscribed` : 'Nobody subscribed'}
          actionLabel={mayAssign ? 'Add' : undefined}
          onAction={() => setAdding(true)}
        />

        {mineQuery.loading ? <Loader label="Loading your staff…" /> : null}

        {mineQuery.error && !mine.length ? (
          <ErrorState error={mineQuery.error} onRetry={mineQuery.refetch} />
        ) : null}

        {!mineQuery.loading && !mineQuery.error && mine.length === 0 ? (
          <Card>
            <EmptyState
              icon="people-outline"
              title="No staff subscribed"
              message={
                mayAssign
                  ? 'Add the help who works in this home and you will know the moment they scan in at the gate.'
                  : 'Only the owner or tenant of this home can subscribe to staff.'
              }
            />
          </Card>
        ) : (
          mine.map((s) => (
            <Card key={s.assignmentId}>
              <View style={{ gap: spacing.md }}>
                <View style={styles.head}>
                  <IconTile
                    icon={staffTypeIcon(s.staffType) as never}
                    size={44}
                    bg={s.notify ? colors.primarySoft : colors.neutralBg}
                    tint={s.notify ? colors.primary : colors.textMuted}
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
                  {s.status !== 'ACTIVE' ? (
                    <View style={[styles.tag, { backgroundColor: colors.neutralBg }]}>
                      <Text style={[type.caption, { color: colors.textMuted }]}>
                        {s.status}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Text style={[type.small, { color: colors.textFaint }]}>
                  Working in this home since {relative(s.activeFrom)}.
                  {!s.facePersonRef
                    ? ' Not enrolled on the face terminal — the office has to do that before arrivals are detected automatically.'
                    : ''}
                </Text>

                <View style={styles.switchRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.bodyMed, { color: colors.text }]}>Notify me</Text>
                    <Text style={[type.small, { color: colors.textMuted }]}>
                      {s.notify
                        ? 'Your phone buzzes when they scan in or out.'
                        : 'Silent. Arrivals are still written to your log.'}
                    </Text>
                  </View>
                  <Switch
                    value={s.notify}
                    disabled={!mayAssign || setNotify.loading}
                    onValueChange={(v) => {
                      void setNotify.mutate(s.staffId, v);
                    }}
                    trackColor={{ true: colors.primary, false: colors.borderStrong }}
                    thumbColor={colors.surface}
                  />
                </View>

                {mayAssign ? (
                  <Button
                    label="Remove from this home"
                    variant="secondary"
                    icon="person-remove-outline"
                    loading={remove.loading}
                    onPress={() => remove.mutate(s.staffId)}
                  />
                ) : null}
              </View>
            </Card>
          ))
        )}

        <Note
          icon="information-circle-outline"
          tone="info"
          text="Staff are registered once by the society and subscribed to by each home. Muting someone here changes nothing for the other homes they work in."
        />
      </Screen>

      <Sheet
        visible={adding}
        onClose={() => setAdding(false)}
        title="Add staff"
        subtitle="Everyone the society has registered"
      >
        <View style={{ gap: spacing.md }}>
          <Field
            icon="search-outline"
            placeholder="Search by name"
            value={search}
            onChangeText={setSearch}
          />
          {rosterQuery.loading ? (
            <Loader label="Loading the society register…" />
          ) : rosterUnavailable ? (
            /* Named precisely, because "no staff found" would send a resident
               to the office to ask a question the office cannot answer. */
            <Note
              icon="construct-outline"
              tone="warning"
              text="This society's backend does not serve the staff register to the app yet, so there is nobody to pick from here. Ask the society office to attach staff to your home — they will appear in the list above."
            />
          ) : rosterQuery.error ? (
            <ErrorState error={rosterQuery.error} onRetry={rosterQuery.refetch} />
          ) : available.length === 0 ? (
            <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>
              {search
                ? 'Nobody by that name is registered.'
                : 'Everyone registered is already subscribed to this home.'}
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {available.map((s) => (
                <View key={s.id} style={styles.pickRow}>
                  <IconTile icon={staffTypeIcon(s.staffType) as never} size={38} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.bodyMed, { color: colors.text }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={[type.small, { color: colors.textMuted }]}>
                      {staffTypeLabel(s.staffType)}
                    </Text>
                  </View>
                  <Chip
                    label="Add"
                    icon="add"
                    onPress={() => {
                      add.mutate(s.id);
                      setAdding(false);
                      setSearch('');
                    }}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </Sheet>
    </>
  );
}

const styles = {
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  switchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pickRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    padding: spacing.sm,
  },
};
