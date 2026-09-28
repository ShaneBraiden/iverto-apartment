/**
 * What this home owes the society, and what it has paid.
 *
 * Two sections, the way the web app splits it: bills still open, then history.
 * The list is fetched whole — the service does not paginate it, because a home
 * gets one bill a month — and sectioned here.
 *
 * Paying happens on the bill itself (`app/invoice/[id].tsx`), never from this
 * list. A resident should see what they are paying for before the checkout
 * opens, and there should be exactly one place in the app that runs the flow.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Screen, TopBar } from '@/components/Screen';
import {
  Card,
  EmptyState,
  ErrorState,
  ListTile,
  Note,
  SectionHeader,
  SkeletonCard,
  SkeletonRows,
  StatusPill,
} from '@/components/ui';
import { colors, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { keys, useQuery } from '@/lib/api';
import { useAuth, useUnitContext } from '@/lib/auth';
import { daysUntil, dueLabel, invoiceTitle, isPayable, outstanding, rupees } from '@/lib/billing';
import type { Invoice } from '@/types';

export default function ResidentBilling() {
  const context = useUnitContext();
  const { can } = useAuth();
  const unitId = context.unitId;

  const invoicesQuery = useQuery(keys.invoices(unitId), () => api.getInvoices(unitId));
  const invoices = invoicesQuery.data ?? [];

  /* Most urgent first: an overdue bill above one due next month, whatever
     order they were generated in. */
  const open = invoices
    .filter(isPayable)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const history = invoices.filter((i) => !isPayable(i));
  const owed = open.reduce((sum, i) => sum + outstanding(i), 0);
  const overdue = open.filter((i) => i.status === 'OVERDUE' || daysUntil(i.dueDate) < 0);
  const next = open[0];

  const openInvoice = (inv: Invoice) =>
    router.push({ pathname: '/invoice/[id]', params: { id: inv.id } });

  return (
    <>
      <TopBar title="Bills" subtitle={context.label} back={false} />
      <Screen>
        {invoicesQuery.loading ? (
          <>
            <SkeletonCard lines={2} />
            <SkeletonRows rows={3} />
          </>
        ) : null}

        {invoicesQuery.error && !invoices.length ? (
          <ErrorState error={invoicesQuery.error} onRetry={invoicesQuery.refetch} />
        ) : null}

        {invoicesQuery.data ? (
          <Card strong>
            <View style={{ gap: spacing.xs }}>
              <Text style={[type.caption, { color: colors.textFaint }]}>
                {owed > 0 ? 'OUTSTANDING' : 'BALANCE'}
              </Text>
              <Text
                style={[type.display, { color: overdue.length ? colors.danger : colors.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {rupees(owed)}
              </Text>
              <Text style={[type.small, { color: colors.textMuted }]}>
                {owed === 0
                  ? 'You are all paid up.'
                  : overdue.length
                    ? `${overdue.length} ${overdue.length === 1 ? 'bill is' : 'bills are'} overdue.`
                    : next
                      ? `${open.length} ${open.length === 1 ? 'bill' : 'bills'} open · next ${dueLabel(next).toLowerCase()}`
                      : ''}
              </Text>
            </View>
          </Card>
        ) : null}

        {invoicesQuery.data && !can('billing.pay') && open.length ? (
          <Note
            icon="lock-closed-outline"
            tone="info"
            text="You can see this home's bills as a family member. The owner or tenant pays them."
          />
        ) : null}

        {open.length ? (
          <View style={{ gap: spacing.sm }}>
            <SectionHeader title="To pay" />
            {open.map((inv) => (
              <Card key={inv.id} onPress={() => openInvoice(inv)}>
                <View style={{ gap: spacing.sm }}>
                  <View style={styles.row}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>
                        {invoiceTitle(inv)}
                      </Text>
                      <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={1}>
                        {inv.invoiceNumber}
                      </Text>
                    </View>
                    <StatusPill status={inv.status} kind="invoice" small />
                  </View>
                  <View style={styles.row}>
                    <Text
                      style={[
                        type.smallMed,
                        {
                          flex: 1,
                          color:
                            inv.status === 'OVERDUE' || daysUntil(inv.dueDate) < 0
                              ? colors.danger
                              : colors.textMuted,
                        },
                      ]}
                    >
                      {dueLabel(inv)}
                    </Text>
                    <Text style={[type.h2, { color: colors.text }]}>{rupees(outstanding(inv))}</Text>
                  </View>
                  {inv.status === 'PARTIALLY_PAID' ? (
                    <Text style={[type.small, { color: colors.textFaint }]}>
                      {rupees(inv.amountPaid)} of {rupees(inv.totalAmount)} already paid
                    </Text>
                  ) : null}
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        {invoicesQuery.data && !invoices.length ? (
          <Card>
            <EmptyState
              icon="receipt-outline"
              title="No bills yet"
              message="Maintenance bills from the society office appear here as soon as they are generated. You will get a notification too."
            />
          </Card>
        ) : null}

        {history.length ? (
          <View style={{ gap: spacing.sm }}>
            <SectionHeader title="History" />
            <Card padded={false}>
              <View style={{ padding: spacing.sm }}>
                {history.map((inv) => (
                  <ListTile
                    key={inv.id}
                    icon={inv.status === 'CANCELLED' ? 'close-circle-outline' : 'receipt-outline'}
                    tint={inv.status === 'PAID' ? colors.successBg : undefined}
                    title={`${invoiceTitle(inv)} · ${rupees(inv.totalAmount)}`}
                    subtitle={`${inv.invoiceNumber} · ${dueLabel(inv)}`}
                    onPress={() => openInvoice(inv)}
                  />
                ))}
              </View>
            </Card>
          </View>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
