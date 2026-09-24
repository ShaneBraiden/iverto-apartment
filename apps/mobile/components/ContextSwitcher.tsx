/**
 * The hat switcher (§4.3).
 *
 * One install, one login, every role. Picking a row here swaps the entire
 * navigation graph — a person who owns A-402, rents B-101 and administers the
 * society moves between three different apps without signing out of anything.
 *
 * Guards never see this. Their context is fixed by the shift they are on, and
 * a switcher on the gate tablet is a way for the wrong screen to be open when
 * someone is standing at the barrier.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Sheet } from '@/components/Sheet';
import { IconTile } from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme';
import { ROLE_LABEL } from '@/lib/rbac';
import { useAuth } from '@/lib/auth';
import type { Context } from '@/types';

const ICON: Record<Context['type'], React.ComponentProps<typeof Ionicons>['name']> = {
  UNIT: 'home-outline',
  GATE: 'shield-checkmark-outline',
  SOCIETY: 'business-outline',
};

export function ContextSwitcher({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { contexts, context, setContext } = useAuth();

  const pick = (next: Context) => {
    onClose();
    if (next.id === context?.id) return;
    setContext(next.id);
    /* `replace` to the front door rather than `push`: the previous shell's
       stack is not somewhere the user should be able to swipe back into once
       they are wearing a different hat. */
    router.replace('/');
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Switch"
      subtitle="One account, every role you hold"
    >
      <View style={{ gap: spacing.sm }}>
        {contexts.map((c) => {
          const active = c.id === context?.id;
          return (
            <Pressable
              key={c.id}
              onPress={() => pick(c)}
              style={({ pressed }) => [
                styles.row,
                active && styles.rowActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <IconTile
                icon={ICON[c.type]}
                bg={active ? colors.primarySoft : colors.neutralBg}
                tint={active ? colors.primary : colors.textMuted}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.bodyMed, { color: colors.text }]} numberOfLines={1}>
                  {c.label}
                </Text>
                <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={1}>
                  {ROLE_LABEL[c.role]} · {c.sublabel}
                </Text>
              </View>
              {active ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              )}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.glassSoft,
  },
  rowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
});
