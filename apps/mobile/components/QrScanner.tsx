/**
 * The camera, pointed at a guest's pass.
 *
 * The gate takes a six-digit code or a `qrToken` in the same field, so this is
 * the other half of `GuestPass`: what the resident's phone draws, the guard's
 * phone reads. Typing stays available beside it — a scan that will not focus in
 * the dark is a queue at the barrier, and the digits always work.
 *
 * Two things this is careful about:
 *
 *   • **One scan.** `onBarcodeScanned` fires every frame the code is in view,
 *     which at a barrier is dozens of times. Verification spends a use of the
 *     code, so the callback is locked after the first read and the parent
 *     unmounts this.
 *   • **The permission is asked for here, not at launch.** A guard who never
 *     scans is never prompted, and one who does is asked at the moment the
 *     reason is on screen in front of them.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, Note } from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme';

export function QrScanner({
  onScan,
  onCancel,
}: {
  onScan: (value: string) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  if (!permission) {
    return (
      <View style={{ gap: spacing.md }}>
        <Note icon="camera-outline" tone="info" text="Getting the camera ready…" />
        <Button label="Type it instead" variant="secondary" icon="keypad-outline" onPress={onCancel} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ gap: spacing.md }}>
        <Note
          icon="camera-outline"
          tone="info"
          text="Scanning needs the camera. It is used for this and for photographing visitors at the gate — nothing else, and never in the background."
        />
        <Button label="Allow the camera" icon="camera-outline" onPress={() => requestPermission()} />
        <Button label="Type it instead" variant="secondary" icon="keypad-outline" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.frame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (locked || !data) return;
            setLocked(true);
            onScan(data.trim());
          }}
        />
        {/* Where to hold the pass. A rectangle drawn over a live feed is the
            whole instruction — nobody at a gate reads a sentence about it. */}
        <View pointerEvents="none" style={styles.reticle} />
      </View>
      <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>
        Hold the guest's pass inside the square.
      </Text>
      <Button label="Type it instead" variant="secondary" icon="keypad-outline" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 260,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  reticle: {
    position: 'absolute',
    top: 40,
    left: 40,
    right: 40,
    bottom: 40,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: radius.md,
    opacity: 0.85,
  },
});
