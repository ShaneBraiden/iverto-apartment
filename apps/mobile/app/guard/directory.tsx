/**
 * The unit directory, as a guard is allowed to see it.
 *
 * Names and a masked number, and nothing else. Guard turnover is high and their
 * device is the least trusted in the system, so the directory is deliberately
 * not a contact list: enough to confirm you are calling the right flat, not
 * enough to walk out with.
 *
 * The search runs on the server. That is the endpoint's design and it is the
 * right one here — a society's whole roll pulled down and filtered on the
 * handset is a copy of the roll on the handset, which is the thing the masking
 * above exists to prevent.
 */
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, TopBar } from '@/components/Screen';
import { DoorPlate } from '@/components/building';
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  ListTile,
  Loader,
  Note,
  SectionHeader,
} from '@/components/ui';
import { colors, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useQuery } from '@/lib/api';
import { useGateContext } from '@/lib/auth';
import { directoryRefusal } from '@/lib/errors';
import { maskPhone, ROLE_LABEL } from '@/lib/rbac';
import { staffTypeIcon, staffTypeLabel } from '@/lib/status';

/**
 * Long enough that typing a flat number does not fire five requests, short
 * enough that a guard with somebody at the barrier does not notice it.
 */
const DEBOUNCE_MS = 300;

export default function GuardDirectory() {
  const context = useGateContext();
  const gateId = context.gateId;

  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const unitsQuery = useQuery(keys.gateDirectory(gateId, term), () =>
    api.getGateDirectory(gateId, term),
  );
  /* The society register at the gate. Documented but not deployed, so `null`
     means "this backend has no such route" and the section is not drawn at all
     — an empty "Registered staff · 0" would read as a society with no staff. */
  const staffQuery = useQuery(keys.gateStaff(gateId), () => api.getGateStaff(gateId));

  const refusal = directoryRefusal(unitsQuery.error);
  const units = unitsQuery.data ?? [];
  const staff = staffQuery.data ?? [];
  const staffAvailable = staffQuery.data !== null;

  const matchedStaff = staff.filter(
    (s) => !term || s.name.toLowerCase().includes(term.toLowerCase()),
  );

  return (
    <>
      <TopBar title="Directory" subtitle={context.sublabel} back={false} />
      <Screen>
        <Field
          icon="search-outline"
          placeholder="Flat number or resident name"
          autoCorrect={false}
          autoCapitalize="none"
          value={search}
          onChangeText={setSearch}
        />

        {unitsQuery.loading ? <Loader label="Loading the directory…" /> : null}

        {unitsQuery.error && !units.length ? (
          /* A refusal is worded for the guard rather than for whoever wrote the
             role table — see `directoryRefusal`. Everything else keeps the
             ordinary copy, including its retry. */
          refusal ? (
            <ErrorState title={refusal.title} message={refusal.message} />
          ) : (
            <ErrorState error={unitsQuery.error} onRetry={unitsQuery.refetch} />
          )
        ) : null}

        {unitsQuery.loading || (unitsQuery.error && !units.length) ? null : (
          <>
            <SectionHeader title={`Homes · ${units.length}`} />
            {units.length === 0 ? (
              <Card>
                <EmptyState
                  icon="home-outline"
                  title={term ? 'No match' : 'Nothing to show'}
                  message={
                    term
                      ? 'Try the flat number instead of the name.'
                      : 'This gate has no homes attached to it yet.'
                  }
                />
              </Card>
            ) : (
              <Card padded={false}>
                <View style={{ padding: spacing.sm }}>
                  {/* Doors, not rows. The flat number is what a guard is
                      searching for and what they will read back down a phone,
                      so it leads the row on a plate instead of sitting in the
                      same type as the names beside it — forty identical house
                      glyphs told them nothing anyway. */}
                  {units.map((u) => (
                    <ListTile
                      key={u.unitId}
                      icon="home-outline"
                      lead={<DoorPlate label={u.unitNumber} compact />}
                      title={
                        u.residents.map((r) => r.name).join(', ') || 'No resident registered'
                      }
                      subtitle={
                        u.residents.length
                          ? u.residents.map((r) => ROLE_LABEL[r.role].toLowerCase()).join(' · ')
                          : (u.buildingName ?? '')
                      }
                      right={
                        <Text style={[type.caption, { color: colors.textFaint }]}>
                          {maskPhone(u.residents[0]?.phone ?? '')}
                        </Text>
                      }
                      onPress={() =>
                        router.push({ pathname: '/new-entry', params: { unitId: u.unitId } })
                      }
                    />
                  ))}
                </View>
              </Card>
            )}

            {staffAvailable && matchedStaff.length > 0 ? (
              <>
                <SectionHeader title={`Registered staff · ${matchedStaff.length}`} />
                <Card padded={false}>
                  <View style={{ padding: spacing.sm }}>
                    {matchedStaff.map((s) => (
                      <ListTile
                        key={s.id}
                        icon={staffTypeIcon(s.staffType) as never}
                        title={s.name}
                        subtitle={`${staffTypeLabel(s.staffType)}${
                          s.facePersonRef ? ` · enrolled ${s.facePersonRef}` : ' · not enrolled'
                        }`}
                        right={
                          <Text style={[type.caption, { color: colors.textFaint }]}>
                            {maskPhone(s.phone ?? '')}
                          </Text>
                        }
                      />
                    ))}
                  </View>
                </Card>
              </>
            ) : null}
          </>
        )}

        <Note
          icon="eye-off-outline"
          tone="info"
          text="Full phone numbers are not shown on this device. If you need to reach a resident, dial through the society office."
        />
      </Screen>
    </>
  );
}
