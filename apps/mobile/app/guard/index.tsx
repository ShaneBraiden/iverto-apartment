/**
 * The gate screen.
 *
 * This is the one screen in the product that someone stands in front of all
 * day, so it is built around a single rule: a pending card cannot be cleared.
 * No swipe, no dismiss, no "skip for now". No decision, no admission — enforced
 * by there being no control that closes it.
 *
 * The barrier itself is on the screen, in the state the queue has put it in:
 * shut when nothing is waiting, straining but shut while a household is being
 * asked. One gate, drawn once — not one per card — because there is one gate,
 * and five drawings of it would be five claims about the same barrier.
 *
 * Decisions arrive from the household over the socket, which invalidates this
 * gate's queue and makes the card redraw with the verdict. When the socket is
 * down the same screen is carried by the foreground refetch and the guard's own
 * pull — the card does not know which path fed it, which is why the connection
 * banner exists: a screen that has quietly stopped updating looks exactly like
 * a gate where nothing is happening.
 *
 * Two things are absent because the service has no endpoint behind them, and
 * they are absent rather than approximated. There is no gate-wide log and no
 * server-side still-inside list, so what this screen shows under "logged here"
 * is only what this device raised since it was opened, labelled as exactly
 * that. See `lib/gateSession.ts`.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ShellHeader } from '@/components/ShellHeader';
import { ApprovalCard } from '@/components/ApprovalCard';
import { GateCard } from '@/components/place';
import type { GateState } from '@/components/building';
import { EntryRow } from '@/components/EntryList';
import { Sheet } from '@/components/Sheet';
import { QrScanner } from '@/components/QrScanner';
import {
  Button,
  Card,
  ErrorState,
  Field,
  IconTile,
  Note,
  SectionHeader,
  SkeletonCard,
  StatCard,
} from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { idempotencyKey, keys, useConnection, useMutation, useQuery } from '@/lib/api';
import { useGateContext } from '@/lib/auth';
import { durationSince } from '@/lib/datetime';
import { recordExit, useGateSession } from '@/lib/gateSession';
import type { PasscodeVerification } from '@/types';

export default function GuardGate() {
  const context = useGateContext();
  const gateId = context.gateId;
  const connection = useConnection();

  const pendingQuery = useQuery(keys.gatePending(gateId), () => api.getGatePending(gateId));
  const pending = pendingQuery.data ?? [];

  /* Not a query. See the file header and `lib/gateSession.ts`. */
  const session = useGateSession(gateId);
  const inside = session.filter((e) => !e.exitedAt && e.event.direction === 'IN');

  const [verifying, setVerifying] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<PasscodeVerification | null>(null);
  /* One key per code typed, so a retry after a dropped connection does not
     spend a second use of a multi-use code. */
  const [checkKey, setCheckKey] = useState(() => idempotencyKey('pcv'));

  /* Marking someone out writes an OUT event. The queue is invalidated because
     an exit can resolve an approval the server was still holding. */
  const exit = useMutation((entryEventId: string) => api.markExit(gateId, entryEventId), {
    invalidates: [keys.gatePending(gateId)],
    onSuccess: (_result, entryEventId) => recordExit(entryEventId),
  });

  /**
   * Verifying spends one of the code's uses and writes an entry event, so it is
   * a mutation, not a lookup. A rejected code is still an answer — `valid:
   * false` with the server's own sentence, see `verifyPasscode` — and only a
   * transport failure or a rate limit raises.
   *
   * The idempotency key travels as an argument rather than being read from
   * state, because the typed path and the scanned path are two different
   * attempts and each has to carry its own.
   */
  const check = useMutation(
    (value: string, key: string) => api.verifyPasscode(gateId, value, key),
    {
      invalidates: [keys.gatePending(gateId)],
      onSuccess: (verification) => setResult(verification),
    },
  );

  /* What the barrier is doing, read from the queue rather than from a state
     this screen keeps: anything pending holds it shut — no decision, no
     admission. There is no recently-decided endpoint, so it does not claim to
     be open; it is shut or it is being asked. */
  const gateState: GateState = pending.length ? 'waiting' : 'closed';

  const call = () => {
    /* The OS dialer, not an IVR. The resident's real number is never on this
       device — the backend places the call through a masked number, and until
       that endpoint exists this opens an empty dialer. */
    Linking.openURL('tel:').catch(() => {});
  };

  return (
    <>
      <ShellHeader
        icon="shield-checkmark-outline"
        meta={`${session.length} logged on this device`}
        badgeCount={pending.length}
      />
      <Screen>
        {/* A guard who cannot reach the server must be *told*, not left to infer
            it from a screen that stopped changing — the guard who infers it
            wrong waves people through. */}
        {connection === 'offline' ? (
          <Note
            icon="cloud-offline-outline"
            tone="danger"
            text="OFFLINE — live approvals are unavailable. Phone the resident before admitting anyone. Anything you log now will fail rather than queue, and you will be told."
          />
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'stretch' }}>
          <StatCard
            label="Waiting"
            value={String(pending.length)}
            icon="hourglass-outline"
            fg={colors.warning}
            bg={colors.warningBg}
          />
          <StatCard
            label="Open here"
            value={String(inside.length)}
            icon="enter-outline"
            fg={colors.info}
            bg={colors.infoBg}
          />
          <StatCard
            label="Logged"
            value={String(session.length)}
            icon="swap-vertical-outline"
            fg={colors.primary}
            bg={colors.primarySoft}
          />
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button
            label="New visitor"
            icon="person-add-outline"
            style={{ flex: 1 }}
            onPress={() => router.push('/new-entry')}
          />
          <Button
            label="Check code"
            variant="secondary"
            icon="keypad-outline"
            style={{ flex: 1 }}
            onPress={() => setVerifying(true)}
          />
        </View>

        {/* Not shown until the first answer has landed: "nothing is waiting"
            and "we have not asked yet" look identical on a gate screen and mean
            opposite things. */}
        {!pendingQuery.loading && !(pendingQuery.error && !pending.length) ? (
          <GateCard
            state={gateState}
            headline={
              pending.length
                ? pending.length === 1
                  ? 'One person held at the gate'
                  : `${pending.length} people held at the gate`
                : 'Gate clear'
            }
            caption={
              pending.length
                ? 'The barrier stays shut until the household answers. Hold them where they are.'
                : 'Nothing waiting. Raise a visitor when someone arrives, or check a guest code.'
            }
            facts={[
              {
                icon: 'enter-outline',
                text: `${inside.length} of yours still open`,
                tone: 'info',
              },
              {
                icon: 'swap-vertical-outline',
                text: `${session.length} logged since you opened the app`,
                tone: 'brand',
              },
            ]}
            note={connection === 'offline' ? 'offline' : context.label}
          />
        ) : null}

        {pending.length > 0 ? (
          <View style={{ gap: spacing.md }}>
            <SectionHeader title="Held at the gate" />
            {pending.map((a) => (
              <ApprovalCard key={a.id} approval={a} audience="guard" onCall={call} />
            ))}
          </View>
        ) : null}

        {/* The gate card's own space, held while the queue is still being
            fetched — see the note on that card about why "nothing waiting" must
            never be shown before the first answer lands. */}
        {pendingQuery.loading ? <SkeletonCard lines={2} /> : null}

        {pendingQuery.error && !pending.length ? (
          <ErrorState error={pendingQuery.error} onRetry={pendingQuery.refetch} />
        ) : null}

        {inside.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <SectionHeader title={`Still open · ${inside.length}`} />
            <Note
              icon="information-circle-outline"
              tone="info"
              text="Only what you logged on this device since opening the app. It is not the gate's full list — close these out before you hand over."
            />
            <Card padded={false}>
              <View style={{ padding: spacing.sm }}>
                {inside.slice(0, 8).map(({ event }) => (
                  <EntryRow
                    key={event.id}
                    event={event}
                    right={
                      <View style={{ alignItems: 'flex-end', flexShrink: 0, gap: 4 }}>
                        <Text style={[type.caption, { color: colors.textFaint }]}>
                          {durationSince(event.occurredAt).toUpperCase()}
                        </Text>
                        <Button
                          label="Mark out"
                          variant="secondary"
                          full={false}
                          disabled={exit.loading}
                          onPress={() => exit.mutate(event.id)}
                        />
                      </View>
                    }
                  />
                ))}
              </View>
            </Card>
          </View>
        ) : null}
      </Screen>

      <Sheet
        visible={verifying}
        onClose={() => {
          setVerifying(false);
          setScanning(false);
          setCode('');
          setResult(null);
          setCheckKey(idempotencyKey('pcv'));
        }}
        title="Guest code"
        subtitle="Scan the guest's pass, or type the digits"
      >
        {scanning ? (
          /* One scan, then straight to the check: a guard holding a phone up at
             a barrier should not have to find a button afterwards. The scanned
             value is a `qrToken` UUID rather than six digits, and the same
             endpoint takes either. */
          <QrScanner
            onScan={(value) => {
              setScanning(false);
              setCode(value);
              setResult(null);
              const key = idempotencyKey('pcv');
              setCheckKey(key);
              check.mutate(value, key);
            }}
            onCancel={() => setScanning(false)}
          />
        ) : (
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Code"
            icon="keypad-outline"
            placeholder="••••••"
            keyboardType="number-pad"
            autoCorrect={false}
            maxLength={12}
            value={code}
            onChangeText={(t) => {
              setCode(t);
              setResult(null);
              /* A different code is a different attempt. */
              setCheckKey(idempotencyKey('pcv'));
            }}
            autoFocus
          />
          {result ? (
            <View
              style={[
                styles.verdict,
                {
                  backgroundColor: result.valid ? colors.successBg : colors.dangerBg,
                  borderColor: result.valid ? colors.success : colors.danger,
                },
              ]}
            >
              <IconTile
                icon={result.valid ? 'checkmark-circle-outline' : 'close-circle-outline'}
                size={40}
                bg="transparent"
                tint={result.valid ? colors.success : colors.danger}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.h3, { color: result.valid ? colors.success : colors.danger }]}>
                  {result.valid ? 'Let them in' : 'Do not admit'}
                </Text>
                <Text style={[type.small, { color: colors.textMuted }]}>{result.message}</Text>
              </View>
            </View>
          ) : null}

          {result && !result.valid ? (
            <Button
              label="Raise as a normal visitor instead"
              variant="secondary"
              icon="person-add-outline"
              onPress={() => {
                setVerifying(false);
                setCode('');
                setResult(null);
                setCheckKey(idempotencyKey('pcv'));
                router.push('/new-entry');
              }}
            />
          ) : (
            <>
              <Button
                label="Check"
                icon="search-outline"
                loading={check.loading}
                disabled={code.trim().length < 4 || check.loading}
                onPress={() => check.mutate(code, checkKey)}
              />
              <Button
                label="Scan their pass instead"
                variant="secondary"
                icon="qr-code-outline"
                disabled={check.loading}
                onPress={() => {
                  setResult(null);
                  setScanning(true);
                }}
              />
            </>
          )}
        </View>
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
});
