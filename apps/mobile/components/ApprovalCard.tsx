/**
 * The approval card — the one screen the product turns on.
 *
 * Two audiences, one component, because they must never disagree. The resident
 * sees the buttons; the guard sees the same card without them and, once a
 * decision lands, a verdict banner they cannot dismiss. Drawing these as two
 * components is how the category's worst failure happens — a resident rejects
 * someone and the guard's screen still shows "pending".
 *
 * The countdown is real. It runs to `expiresAt`, which is the server's deadline
 * and the only authority on it, rendered as a ring that empties — because a
 * guard has to be able to tell at a glance whether to keep waiting or to pick
 * up the phone.
 *
 * The flat is on a door plate rather than in the meta line. A guard holding
 * someone at the barrier is reading one thing off this card — which door to
 * send them to, or which door is refusing them.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import { Button, Card, StatusPill } from '@/components/ui';
import { DoorPlate } from '@/components/building';
import { SubjectPhoto } from '@/components/SubjectPhoto';
import { LiveDot } from '@/components/motion';
import { colors, radius, spacing, type } from '@/theme';
import { countdown, clockTime, relative, remainingFraction } from '@/lib/datetime';
import { approvalInfo, entryTitle, platformLabel } from '@/lib/status';
import { APPROVAL_WINDOW_SECONDS, useNow } from '@/lib/api';
import type { ApprovalRequest } from '@/types';

/**
 * A ring that drains over the life of the request.
 *
 * Turns red under a sixth of the window. The number alone is legible but not
 * *glanceable* — colour is what a guard reads across a desk while talking to
 * the person at the barrier.
 */
function CountdownRing({ fraction, label }: { fraction: number; label: string }) {
  const size = 54;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const urgent = fraction < 0.17;
  const tint = urgent ? colors.danger : colors.primary;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.hairline}
          strokeWidth={stroke}
          fill="none"
        />
        {/* Rotated so the arc starts at twelve o'clock; without it the ring
            drains from three, which reads as an arbitrary shape rather than
            as a clock. */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tint}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={[type.smallMed, { color: tint }]}>{label}</Text>
    </View>
  );
}

/** The second line: what kind of arrival this is, and their number if given. */
function subtitleOf(approval: ApprovalRequest): string {
  const parts: string[] = [];
  if (approval.platform) parts.push(`${platformLabel(approval.platform)} delivery`);
  else if (approval.subjectType === 'DELIVERY') parts.push('Delivery');
  else parts.push('Visitor at the gate');
  if (approval.visitorPhone) parts.push(approval.visitorPhone);
  return parts.join(' · ');
}

export function ApprovalCard({
  approval,
  onApprove,
  onReject,
  onCall,
  audience,
}: {
  approval: ApprovalRequest;
  onApprove?: () => void;
  onReject?: () => void;
  /** The timeout fallback — the OS dialer, not an IVR. */
  onCall?: () => void;
  /** 'resident' gets the buttons; 'guard' gets the verdict. */
  audience: 'resident' | 'guard';
}) {
  const now = useNow();
  const pending = approval.status === 'PENDING';
  const info = approvalInfo(approval.status);
  const fraction = remainingFraction(
    approval.createdAt,
    approval.expiresAt,
    now,
    APPROVAL_WINDOW_SECONDS,
  );
  const expired = pending && fraction <= 0;
  /* The flat, or an honest stand-in. Nothing on the wire carries it — the gate
     queue joins it on from the directory, and the resident already knows which
     home they are looking at — so a card can legitimately arrive without one. */
  const door = approval.unitNumber?.trim() || 'this home';

  return (
    <Card>
      <View style={{ gap: spacing.lg }}>
        <View style={styles.head}>
          <SubjectPhoto
            entryEventId={approval.entryEventId}
            subjectType={approval.subjectType}
            size={54}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>
              {entryTitle(approval)}
            </Text>
            <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={2}>
              {subtitleOf(approval)}
            </Text>
            <View style={styles.metaRow}>
              {pending && !expired ? <LiveDot color={colors.warning} /> : null}
              <DoorPlate label={door} compact />
              <Text
                style={[type.caption, { color: colors.textFaint, flexShrink: 1 }]}
                numberOfLines={1}
              >
                {clockTime(approval.createdAt)}
              </Text>
            </View>
          </View>
          {pending && !expired ? (
            <CountdownRing fraction={fraction} label={countdown(approval.expiresAt, now)} />
          ) : (
            <StatusPill status={approval.status} small />
          )}
        </View>

        {/* The guard's half. A decided request keeps its verdict on screen in
            the strongest form the card has — full-width, coloured, worded as an
            instruction rather than as a status ("do not admit", not
            "rejected"), because that is what has to survive being read in a
            hurry. */}
        {audience === 'guard' && !pending ? (
          <View style={[styles.verdict, { backgroundColor: info.bg, borderColor: info.fg }]}>
            <Ionicons name={info.icon as never} size={22} color={info.fg} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.h3, { color: info.fg }]}>
                {approval.status === 'REJECTED'
                  ? 'DENY — do not admit'
                  : approval.status === 'EXPIRED'
                    ? 'No response'
                    : 'ALLOW — let them in'}
              </Text>
              <Text style={[type.small, { color: colors.textMuted }]}>
                {approval.decidedAt
                  ? `${door} answered ${relative(approval.decidedAt)}.`
                  : info.explainer}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Still waiting, and the guard cannot make it go away. The card is
            deliberately not dismissible while PENDING — no decision, no
            admission, enforced by there being no button that closes it. */}
        {audience === 'guard' && pending && !expired ? (
          <View style={styles.waiting}>
            <Ionicons name="hourglass-outline" size={16} color={colors.warning} />
            <Text style={[type.small, { color: colors.textMuted, flex: 1 }]}>
              Hold them at the gate. This cannot be cleared until {door} answers.
            </Text>
          </View>
        ) : null}

        {audience === 'guard' && expired ? (
          <Button
            label={`No response — call ${door}`}
            variant="secondary"
            icon="call-outline"
            onPress={onCall}
          />
        ) : null}

        {audience === 'resident' && pending && !expired ? (
          <View style={styles.actions}>
            <Button
              label="Deny"
              variant="danger"
              icon="close"
              style={{ flex: 1 }}
              onPress={onReject}
            />
            <Button label="Allow" icon="checkmark" style={{ flex: 1 }} onPress={onApprove} />
          </View>
        ) : null}

        {audience === 'resident' && !pending ? (
          <Text style={[type.small, { color: colors.textMuted }]}>
            {approval.decidedAt ? `Answered ${relative(approval.decidedAt)}.` : info.explainer}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.warningBg,
  },
});
