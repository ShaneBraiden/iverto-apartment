/**
 * Pre-approved guests.
 *
 * A code the guest carries, so the resident is not interrupted when they
 * arrive. Sharing is the OS share sheet's problem, not ours — the app's job
 * ends at issuing something short enough to read down a phone line, scannable
 * when reading it out is not on, and revocable the moment plans change.
 *
 * Every passcode has both credentials: six digits and a `qrToken`, either of
 * which the gate accepts. `GuestPass` draws them together, because the resident
 * sending it cannot know which one will be easier at the barrier.
 *
 * There is no guest name here, and its absence is deliberate rather than an
 * omission. The service stores a code, a window and a use count; it has no
 * field for who the code is for. Asking for a name and then dropping it would
 * put a label on the screen of the phone that issued it and nowhere else — so
 * the code identifies itself, and `API.md` records the missing field.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Share } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, TopBar } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { GuestPass } from '@/components/GuestPass';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loader,
  Note,
  SectionHeader,
} from '@/components/ui';
import { colors, font, radius, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useMutation, useQuery } from '@/lib/api';
import { useAuth, useUnitContext } from '@/lib/auth';
import { clockTime, dayLabel, relative } from '@/lib/datetime';
import type { Passcode } from '@/types';

export default function Passcodes() {
  const context = useUnitContext();
  const { can, societyName } = useAuth();
  const unitId = context.unitId;

  const passcodesQuery = useQuery(keys.passcodes(unitId), () => api.getPasscodes(unitId));
  const passcodes = passcodesQuery.data ?? [];
  const [creating, setCreating] = useState(false);
  const [hours, setHours] = useState(6);
  const [maxUses, setMaxUses] = useState(1);
  const [issued, setIssued] = useState<Passcode | null>(null);
  /* The pass held open for a guest to scan, as against the one just minted. */
  const [showing, setShowing] = useState<Passcode | null>(null);

  const mayCreate = can('passcode.create');
  const live = (p: Passcode) =>
    !p.revoked && p.usesCount < p.maxUses && new Date(p.validUntil).getTime() > Date.now();

  /* The code is minted server-side — a six-digit code a client chose is a code
     a client can predict. */
  const create = useMutation(() => api.createPasscode(unitId, { hours, maxUses }), {
    invalidates: [keys.passcodes(unitId)],
    onSuccess: (pc) => {
      setCreating(false);
      setIssued(pc);
    },
  });

  const revoke = useMutation((id: string) => api.revokePasscode(unitId, id), {
    invalidates: [keys.passcodes(unitId)],
  });

  const share = (pc: Passcode) => {
    const where = societyName ? `${context.label}, ${societyName}` : context.label;
    Share.share({
      message: `Your entry code for ${where}: ${pc.code}. Valid until ${dayLabel(
        pc.validUntil,
      )} ${clockTime(pc.validUntil)}. Show it at the gate.`,
    }).catch(() => {});
  };

  /** Why a code is not usable — said specifically, because "expired" is three
      different situations and only one of them means "issue another one". */
  const deadReason = (pc: Passcode) => {
    if (pc.revoked) return 'Cancelled';
    if (pc.usesCount >= pc.maxUses) return `All ${pc.maxUses} uses spent`;
    return `Expired ${relative(pc.validUntil)}`;
  };

  return (
    <>
      <TopBar
        title="Guest passcodes"
        subtitle={context.label}
        rightIcon={mayCreate ? 'add' : undefined}
        onRight={() => setCreating(true)}
      />
      <Screen clearTabBar={false}>
        <Note
          icon="information-circle-outline"
          tone="brand"
          text="A guest with a valid code walks in without your phone ringing. The guard still photographs them, and the entry still lands in your log."
        />

        <SectionHeader title={passcodes.length ? 'Issued' : 'No codes yet'} />

        {passcodesQuery.loading ? <Loader label="Loading your codes…" /> : null}
        {passcodesQuery.error && !passcodes.length ? (
          <ErrorState error={passcodesQuery.error} onRetry={passcodesQuery.refetch} />
        ) : null}

        {!passcodesQuery.loading && !passcodesQuery.error && passcodes.length === 0 ? (
          <Card>
            <EmptyState
              icon="qr-code-outline"
              title="Nobody expected"
              message="Issue a code when someone is coming over and you would rather not be interrupted at the door."
            />
          </Card>
        ) : (
          passcodes.map((pc) => {
            const active = live(pc);
            return (
              <Card key={pc.id}>
                <View style={{ gap: spacing.md }}>
                  <View style={styles.row}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>
                        {active ? 'Active code' : deadReason(pc)}
                      </Text>
                      <Text style={[type.small, { color: colors.textMuted }]}>
                        {active
                          ? `Valid until ${dayLabel(pc.validUntil)} ${clockTime(pc.validUntil)}`
                          : `Issued ${relative(pc.createdAt ?? pc.validFrom)}`}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.codeBox,
                        !active && {
                          backgroundColor: colors.neutralBg,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.code, { color: active ? colors.primary : colors.textFaint }]}
                      >
                        {pc.code}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.usesRow}>
                    <Ionicons name="ticket-outline" size={14} color={colors.textMuted} />
                    <Text style={[type.small, { color: colors.textMuted }]}>
                      Used {pc.usesCount} of {pc.maxUses}
                    </Text>
                  </View>

                  {active ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <Button
                        label="Show pass"
                        variant="secondary"
                        icon="qr-code-outline"
                        style={{ flex: 1 }}
                        onPress={() => setShowing(pc)}
                      />
                      <Button
                        label="Cancel code"
                        variant="danger"
                        icon="close"
                        style={{ flex: 1 }}
                        disabled={revoke.loading}
                        onPress={() => revoke.mutate(pc.id)}
                      />
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          })
        )}
      </Screen>

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="Invite a guest"
        subtitle="They show the code at the gate"
      >
        <View style={{ gap: spacing.lg }}>
          <View style={{ gap: spacing.sm }}>
            <Text style={[type.smallMed, { color: colors.textMuted }]}>Valid for</Text>
            <View style={styles.chipRow}>
              {[2, 6, 12, 24].map((h) => (
                <Chip
                  key={h}
                  label={h === 24 ? '1 day' : `${h} hours`}
                  selected={hours === h}
                  onPress={() => setHours(h)}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={[type.smallMed, { color: colors.textMuted }]}>How many entries</Text>
            <View style={styles.chipRow}>
              {[1, 2, 5].map((n) => (
                <Chip
                  key={n}
                  label={n === 1 ? 'Once' : `${n} times`}
                  selected={maxUses === n}
                  onPress={() => setMaxUses(n)}
                />
              ))}
            </View>
          </View>

          <Note
            icon="reader-outline"
            tone="info"
            text={`One code, good for ${
              maxUses === 1 ? 'a single entry' : `${maxUses} entries`
            }, until ${dayLabel(
              new Date(Date.now() + hours * 3_600_000).toISOString(),
            )} ${clockTime(new Date(Date.now() + hours * 3_600_000).toISOString())}.`}
          />

          <Button
            label="Issue code"
            icon="qr-code-outline"
            loading={create.loading}
            disabled={create.loading}
            onPress={() => create.mutate()}
          />
        </View>
      </Sheet>

      {/* Shown once, immediately after issuing — the moment the resident
          actually wants to send it, before they have navigated anywhere. */}
      <Sheet
        visible={!!issued}
        onClose={() => setIssued(null)}
        title="Code issued"
        subtitle="Send it to your guest"
      >
        {issued ? (
          <View style={{ gap: spacing.lg }}>
            <GuestPass passcode={issued} />
            <Button
              label="Send it to them"
              icon="share-outline"
              onPress={() => {
                share(issued);
                setIssued(null);
              }}
            />
          </View>
        ) : null}
      </Sheet>

      {/* The pass on demand, for a guest already at the barrier: somebody who
          cannot get six digits heard over a gate's traffic needs something to
          hold up to a camera instead. */}
      <Sheet
        visible={!!showing}
        onClose={() => setShowing(null)}
        title="Guest pass"
        subtitle="Scan it at the gate, or read out the digits"
      >
        {showing ? (
          <View style={{ gap: spacing.lg }}>
            <GuestPass passcode={showing} />
            <Button
              label="Send it to them"
              variant="secondary"
              icon="share-outline"
              onPress={() => share(showing)}
            />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  usesRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeBox: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    flexShrink: 0,
  },
  /* Wide tracking: this is read out loud down a phone line as often as it is
     shown, so the digits have to be separable. */
  code: { fontFamily: font.bold, fontSize: 18, letterSpacing: 2 },
});
