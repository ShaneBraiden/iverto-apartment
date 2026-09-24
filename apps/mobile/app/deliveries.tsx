/**
 * Per-home, per-platform delivery rules (§6.3).
 *
 * The fix for the forced-auto-approval complaint: the household grants the
 * permission, one platform at a time, inside hours it picks, and the default
 * for anything it has not spoken about is to ask. Nobody's phone rings at 11pm
 * because a third party wired an integration in behind their back — and
 * equally, nobody gets let in at 11pm because of a rule they set at noon.
 *
 * Every rule reads its own consequence back in a sentence before it is saved,
 * because a grid of chips is easy to set wrong and hard to check.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Switch, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, TopBar } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import {
  Button,
  Card,
  Chip,
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
import {
  DELIVERY_MODES,
  PLATFORMS,
  deliverySummary,
  modeLabel,
  platformLabel,
} from '@/lib/status';
import type { DeliveryMode, DeliveryPermission, Platform } from '@/types';

/** A rule being edited, before it is committed. */
type Draft = {
  platform: Platform;
  mode: DeliveryMode;
  windowStart: string | null;
  windowEnd: string | null;
  silent: boolean;
};

export default function Deliveries() {
  const context = useUnitContext();
  const { can } = useAuth();
  const unitId = context.unitId;

  const rulesQuery = useQuery(keys.deliveryPermissions(unitId), () =>
    api.getDeliveryPermissions(unitId),
  );
  const rules = rulesQuery.data ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const mayEdit = can('delivery_perm.edit');

  /**
   * Saving is a `PUT` per platform, ASK_ME included.
   *
   * ASK_ME would ideally be the *absence* of a rule — a stored "ask me" reads
   * as a granted permission in any later audit of who allowed what — but this
   * service has no delete on the resource, so it is written as a row like any
   * other. Screens that count permissions therefore filter ASK_ME out rather
   * than counting rows; see `app/resident/settings.tsx`.
   */
  const save = useMutation(
    (rule: DeliveryPermission) => api.setDeliveryPermission(unitId, rule),
    {
      invalidates: [keys.deliveryPermissions(unitId)],
      onSuccess: () => setDraft(null),
    },
  );

  const open = (platform: Platform) => {
    const existing = rules.find((r) => r.platform === platform);
    setDraft(
      existing
        ? { ...existing }
        : { platform, mode: 'ASK_ME', windowStart: null, windowEnd: null, silent: false },
    );
  };

  return (
    <>
      <TopBar title="Delivery rules" subtitle={context.label} />
      <Screen clearTabBar={false}>
        <Note
          icon="shield-checkmark-outline"
          tone="brand"
          text="Everything asks you first unless you say otherwise here. Rules apply to this home only, and lapse back to asking outside the hours you set."
        />

        {rulesQuery.loading ? <Loader label="Loading your rules…" /> : null}
        {rulesQuery.error && !rules.length ? (
          <ErrorState error={rulesQuery.error} onRetry={rulesQuery.refetch} />
        ) : null}

        <SectionHeader title="Platforms" />
        {PLATFORMS.map((p) => {
          const rule = rules.find((r) => r.platform === p.value);
          const active = !!rule && rule.mode !== 'ASK_ME';
          return (
            <Card key={p.value} onPress={mayEdit ? () => open(p.value) : undefined}>
              <View style={styles.row}>
                <IconTile
                  icon={p.icon as never}
                  size={40}
                  bg={active ? colors.primarySoft : colors.neutralBg}
                  tint={active ? colors.primary : colors.textMuted}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.bodyMed, { color: colors.text }]}>{p.label}</Text>
                  <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={2}>
                    {rule
                      ? deliverySummary(rule)
                      : 'Always ask before letting anyone in.'}
                  </Text>
                </View>
                {active ? (
                  <View style={styles.tag}>
                    <Text style={[type.caption, { color: colors.primary }]} numberOfLines={1}>
                      {modeLabel(rule!.mode).toUpperCase()}
                    </Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                )}
              </View>
            </Card>
          );
        })}

        {!mayEdit ? (
          <Note
            icon="lock-closed-outline"
            tone="info"
            text="Only the owner or tenant of this home can change these."
          />
        ) : null}
      </Screen>

      <Sheet
        visible={!!draft}
        onClose={() => setDraft(null)}
        title={draft ? platformLabel(draft.platform) : ''}
        subtitle={`What should the guard do — ${context.label}`}
      >
        {draft ? (
          <View style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.sm }}>
              {DELIVERY_MODES.map((m) => {
                const selected = draft.mode === m.value;
                return (
                  <Card
                    key={m.value}
                    onPress={() => setDraft({ ...draft, mode: m.value })}
                    style={selected ? styles.selected : undefined}
                  >
                    <View style={styles.row}>
                      <IconTile
                        icon={m.icon as never}
                        size={38}
                        bg={selected ? colors.primarySoft : colors.neutralBg}
                        tint={selected ? colors.primary : colors.textMuted}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[type.bodyMed, { color: colors.text }]}>{m.label}</Text>
                        <Text style={[type.small, { color: colors.textMuted }]}>{m.hint}</Text>
                      </View>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                      ) : null}
                    </View>
                  </Card>
                );
              })}
            </View>

            {/* Only shown once a mode can actually bypass you — a window on
                ASK_ME would be a control with no effect. */}
            {draft.mode !== 'ASK_ME' ? (
              <>
                <View style={{ gap: spacing.sm }}>
                  <Text style={[type.smallMed, { color: colors.textMuted }]}>
                    Only between these hours
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
                  >
                    {(
                      [
                        { label: 'Any time', start: null, end: null },
                        { label: '8am – 10pm', start: '08:00', end: '22:00' },
                        { label: '9am – 7pm', start: '09:00', end: '19:00' },
                        { label: '7am – 11am', start: '07:00', end: '11:00' },
                      ] as const
                    ).map((w) => (
                      <Chip
                        key={w.label}
                        label={w.label}
                        selected={draft.windowStart === w.start && draft.windowEnd === w.end}
                        onPress={() =>
                          setDraft({ ...draft, windowStart: w.start, windowEnd: w.end })
                        }
                      />
                    ))}
                  </ScrollView>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="From"
                        placeholder="08:00"
                        icon="time-outline"
                        value={draft.windowStart ?? ''}
                        onChangeText={(t) => setDraft({ ...draft, windowStart: t || null })}
                        maxLength={5}
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="To"
                        placeholder="22:00"
                        icon="time-outline"
                        value={draft.windowEnd ?? ''}
                        onChangeText={(t) => setDraft({ ...draft, windowEnd: t || null })}
                        maxLength={5}
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.switchRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.bodyMed, { color: colors.text }]}>Do not buzz me</Text>
                    <Text style={[type.small, { color: colors.textMuted }]}>
                      It still appears in your log — you just are not interrupted.
                    </Text>
                  </View>
                  <Switch
                    value={draft.silent}
                    onValueChange={(v) => setDraft({ ...draft, silent: v })}
                    trackColor={{ true: colors.primary, false: colors.borderStrong }}
                    thumbColor={colors.surface}
                  />
                </View>
              </>
            ) : null}

            {/* The rule, in a sentence, before it is saved. */}
            <Note icon="reader-outline" tone="info" text={deliverySummary(draft)} />

            <Button
              label="Save rule"
              icon="checkmark"
              loading={save.loading}
              disabled={save.loading}
              onPress={() => save.mutate({ unitId, ...draft })}
            />
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    flexShrink: 0,
    maxWidth: 110,
  },
  selected: { borderRadius: radius.xl, borderWidth: 1, borderColor: colors.primary },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
