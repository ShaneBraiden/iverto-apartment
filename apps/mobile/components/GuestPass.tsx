/**
 * The pass a guest is shown, or sent.
 *
 * One passcode, two credentials, and the gate takes either: six digits that can
 * be read down a phone line, and a `qrToken` UUID for a scan. Drawn together
 * because a resident sending this has no idea which one the gate they are
 * sending someone to will find easier — and a guest holding both never has to.
 *
 * The QR is deliberately black on white regardless of the app's palette. It is
 * not decoration; it is machine-read off a phone screen at arm's length by a
 * camera that has the sun behind it, and every point of contrast is one the
 * scanner does not have to recover.
 *
 * When the service minted no `qrToken` — an older deployment — the digits stand
 * alone and the card says so, rather than drawing a QR of something that would
 * fail at the barrier.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import QRCode from 'react-native-qrcode-svg';
import { colors, font, radius, spacing, type } from '@/theme';
import { clockTime, dayLabel } from '@/lib/datetime';
import type { Passcode } from '@/types';

const QR_SIZE = 208;

export function GuestPass({ passcode }: { passcode: Passcode }) {
  const token = passcode.qrToken?.trim();

  return (
    <View style={{ gap: spacing.lg, alignItems: 'center' }}>
      {token ? (
        <View style={styles.qrFrame}>
          <QRCode
            value={token}
            size={QR_SIZE}
            backgroundColor="#FFFFFF"
            color="#000000"
            /* Level M: a phone screen is a clean, flat, well-lit surface, so the
               error correction a printed sticker needs would only buy denser
               modules — which is the thing that actually fails at arm's length. */
            ecl="M"
          />
        </View>
      ) : null}

      <View style={styles.codeBox}>
        <Text style={styles.code}>{passcode.code}</Text>
      </View>

      <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>
        {token
          ? 'The guard can scan this or type the digits. Either one works.'
          : 'Read the digits out at the gate — this code has no scannable pass.'}
      </Text>

      <View style={styles.meta}>
        <Ionicons name="time-outline" size={14} color={colors.textMuted} />
        <Text style={[type.small, { color: colors.textMuted }]}>
          Valid until {dayLabel(passcode.validUntil)} {clockTime(passcode.validUntil)} ·{' '}
          {passcode.maxUses === 1
            ? 'single use'
            : `${passcode.usesCount} of ${passcode.maxUses} used`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* White padding is part of the code, not styling: a QR needs a quiet zone
     around it or the scanner cannot find its edges. */
  qrFrame: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeBox: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  /* Wide tracking: these digits are read out loud as often as they are shown. */
  code: { fontFamily: font.bold, fontSize: 34, letterSpacing: 6, color: colors.primary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
