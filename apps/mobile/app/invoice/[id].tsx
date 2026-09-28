/**
 * One bill: what it is for, what has been paid against it, and the pay button.
 *
 * This is the only screen that runs the Razorpay flow (`lib/billing.ts`), and
 * it is written around the one state that flow can leave behind which is not
 * simply "paid" or "not paid": Razorpay took the money, and the app could not
 * reach the server to confirm it. That case is shown as its own banner with its
 * own button, which re-sends the *same* confirmation — offering "Pay now" again
 * there would be inviting the resident to pay twice.
 *
 * Push lands here too: `BILL_GENERATED`, `PAYMENT_DUE` and `PAYMENT_CONFIRMED`
 * all carry an `invoiceId` and `lib/push.ts` routes a tap straight to it.
 */
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Screen, TopBar } from '@/components/Screen';
import {
  Button,
  Card,
  Divider,
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
import { errorCopy } from '@/lib/errors';
import { ROLE_LABEL } from '@/lib/rbac';
import {
  confirmPayment,
  dueLabel,
  invoiceTitle,
  isPayable,
  outstanding,
  payInvoice,
  rupees,
} from '@/lib/billing';
import { lineItemIcon, lineItemLabel, paymentMethodLabel } from '@/lib/status';
import type { InvoiceDetail, Payment, RazorpayResult } from '@/types';

/**
 * A push can open this screen while the person is wearing another hat — a
 * resident who is also a guard, on shift. Without a home in context there is no
 * bill to load, so the front door picks the shell instead of this screen
 * throwing.
 */
export default function InvoiceRoute() {
  const { context } = useAuth();
  if (context?.type !== 'UNIT') return <Redirect href="/" />;
  return <InvoiceScreen />;
}

function InvoiceScreen() {
  const context = useUnitContext();
  const { can, user, societyName } = useAuth();
  const unitId = context.unitId;
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = String(id ?? '');

  const invoiceQuery = useQuery(
    keys.invoice(unitId, invoiceId),
    () => api.getInvoice(unitId, invoiceId),
    { enabled: !!invoiceId },
  );
  const invoice = invoiceQuery.data;

  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  /* A payment Razorpay captured that the server has not yet confirmed. Held so
     the confirmation can be re-sent with exactly the same result. */
  const [unconfirmed, setUnconfirmed] = useState<RazorpayResult | null>(null);
  const [justPaid, setJustPaid] = useState(false);
  /* One key per tap on "Pay", reused if that tap's order request is retried.
     Cleared once the attempt settles, so the next tap opens a fresh order. */
  const attemptKey = useRef<string | null>(null);

  /** The server's answer *is* the bill now — write it in, and refresh the list. */
  const applied = (next: InvoiceDetail) => {
    api.setQueryData(keys.invoice(unitId, invoiceId), next);
    api.invalidate(keys.invoices(unitId));
    setUnconfirmed(null);
    setJustPaid(true);
  };

  const pay = async () => {
    if (!invoice || paying) return;
    attemptKey.current ??= api.idempotencyKey('pay');
    setPaying(true);
    setJustPaid(false);
    try {
      const outcome = await payInvoice({
        unitId,
        invoice,
        attemptKey: attemptKey.current,
        user,
        societyName,
      });
      attemptKey.current = null;
      switch (outcome.kind) {
        case 'paid':
          applied(outcome.invoice);
          break;
        case 'cancelled':
          break;
        case 'failed':
          Alert.alert('Payment not completed', outcome.message);
          invoiceQuery.refetch();
          break;
        case 'unconfirmed':
          setUnconfirmed(outcome.result);
          break;
      }
    } catch (e) {
      /* Before the checkout opened: the order was refused. A transient failure
         keeps the key, so tapping again asks for the same order. */
      const status = (e as { status?: number } | null)?.status;
      if (status !== 0 && !(typeof status === 'number' && status >= 500)) {
        attemptKey.current = null;
      }
      if (status === 503) {
        Alert.alert(
          'Online payments are not set up',
          `${societyName ?? 'Your society'} has not switched on online payments yet. Pay at the society office, or ask them to enable it.`,
        );
      } else {
        const copy = errorCopy(e);
        Alert.alert(status === 400 ? 'Cannot pay this bill' : copy.title, copy.message);
      }
      /* "Already paid" means this screen is out of date. */
      if (status === 400) invoiceQuery.refetch();
    } finally {
      setPaying(false);
    }
  };

  const retryConfirm = async () => {
    if (!unconfirmed) return;
    setConfirming(true);
    try {
      applied(await confirmPayment(unitId, invoiceId, unconfirmed));
    } catch (e) {
      const copy = errorCopy(e);
      Alert.alert(copy.title, copy.message);
    } finally {
      setConfirming(false);
    }
  };

  const shareReceipt = async () => {
    if (!invoice) return;
    setDownloading(true);
    try {
      const uri = await api.downloadReceipt(unitId, invoice.id, invoice.invoiceNumber);
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Receipt saved', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: `Receipt ${invoice.invoiceNumber}`,
      });
    } catch (e) {
      const copy = errorCopy(e);
      Alert.alert(copy.title, copy.message);
    } finally {
      setDownloading(false);
    }
  };

  const due = invoice ? outstanding(invoice) : 0;
  const mayPay = !!invoice && isPayable(invoice) && can('billing.pay') && !unconfirmed;

  return (
    <>
      <TopBar
        title={invoice ? invoiceTitle(invoice) : 'Bill'}
        subtitle={invoice?.invoiceNumber ?? context.label}
      />
      <Screen clearTabBar={false}>
        {invoiceQuery.loading ? (
          <>
            <SkeletonCard lines={3} />
            <SkeletonRows rows={3} />
          </>
        ) : null}

        {invoiceQuery.error && !invoice ? (
          <ErrorState error={invoiceQuery.error} onRetry={invoiceQuery.refetch} />
        ) : null}

        {invoice ? (
          <>
            {justPaid ? (
              <Note
                icon="checkmark-circle-outline"
                tone="success"
                text="Payment received and applied to this bill. The society office has been notified."
              />
            ) : null}

            {unconfirmed ? (
              <Card>
                <View style={{ gap: spacing.md }}>
                  <Note
                    icon="cloud-offline-outline"
                    tone="warning"
                    text="Your payment went through with Razorpay, but we could not confirm it with the society yet. Do not pay again — confirm it once you are back online. It will also be applied automatically within a few minutes."
                  />
                  <Button
                    label="Confirm payment"
                    icon="refresh-outline"
                    loading={confirming}
                    disabled={confirming}
                    onPress={retryConfirm}
                  />
                </View>
              </Card>
            ) : null}

            <Card strong>
              <View style={{ gap: spacing.sm }}>
                <View style={styles.row}>
                  <Text style={[type.caption, { color: colors.textFaint, flex: 1 }]}>
                    {isPayable(invoice) ? 'TO PAY' : 'TOTAL'}
                  </Text>
                  <StatusPill status={invoice.status} kind="invoice" small />
                </View>
                <Text style={[type.display, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                  {rupees(isPayable(invoice) ? due : invoice.totalAmount)}
                </Text>
                <Text
                  style={[
                    type.smallMed,
                    { color: invoice.status === 'OVERDUE' ? colors.danger : colors.textMuted },
                  ]}
                >
                  {dueLabel(invoice)}
                  {invoice.source === 'IMMEDIATE' ? ' · One-off charge' : ''}
                </Text>

                {mayPay ? (
                  <Button
                    label={`Pay ${rupees(due)}`}
                    icon="card-outline"
                    loading={paying}
                    disabled={paying}
                    onPress={pay}
                    style={{ marginTop: spacing.sm }}
                  />
                ) : null}
                {isPayable(invoice) && !can('billing.pay') ? (
                  <Text style={[type.small, { color: colors.textFaint }]}>
                    The owner or tenant of {context.label} pays this bill.
                  </Text>
                ) : null}
              </View>
            </Card>

            <SectionHeader title="What it is for" />
            <Card padded={false}>
              <View style={{ padding: spacing.sm }}>
                {invoice.lineItems.map((li) => (
                  <ListTile
                    key={li.id}
                    icon={lineItemIcon(li.category) as never}
                    title={li.description}
                    subtitle={lineItemLabel(li.category)}
                    right={<Text style={[type.bodyMed, { color: colors.text }]}>{rupees(li.amount)}</Text>}
                  />
                ))}
                <View style={{ padding: spacing.md, gap: spacing.xs }}>
                  <Divider />
                  <Total label="Total" value={rupees(invoice.totalAmount)} strong />
                  <Total label="Paid" value={rupees(invoice.amountPaid)} color={colors.success} />
                  <Total
                    label="Outstanding"
                    value={rupees(due)}
                    color={due > 0 ? colors.danger : colors.success}
                  />
                </View>
              </View>
            </Card>

            {invoice.payments.length ? (
              <>
                <SectionHeader title="Payments" />
                <Card padded={false}>
                  <View style={{ padding: spacing.sm }}>
                    {invoice.payments.map((p) => (
                      <PaymentRow key={p.id} payment={p} />
                    ))}
                  </View>
                </Card>
              </>
            ) : null}

            <Button
              label="Download receipt"
              variant="secondary"
              icon="document-text-outline"
              loading={downloading}
              disabled={downloading}
              onPress={shareReceipt}
            />
          </>
        ) : null}
      </Screen>
    </>
  );
}

function Total({
  label,
  value,
  color,
  strong,
}: {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[strong ? type.bodyMed : type.small, { color: colors.textMuted, flex: 1 }]}>
        {label}
      </Text>
      <Text style={[strong ? type.h3 : type.smallMed, { color: color ?? colors.text }]}>{value}</Text>
    </View>
  );
}

/**
 * One attempt. Who paid is shown with their role on this home, because on a
 * rented flat "who settled this" is exactly the question the row is read for.
 */
function PaymentRow({ payment: p }: { payment: Payment }) {
  const role =
    p.paidByRole && p.paidByRole !== 'UNKNOWN' ? ROLE_LABEL[p.paidByRole] ?? null : null;
  const who = p.paidByName ? (role ? `${p.paidByName} (${role})` : p.paidByName) : null;
  const when = new Date(p.paidAt ?? p.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const reference = p.razorpayPaymentId ?? p.note ?? null;

  return (
    <View style={styles.payment}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.bodyMed, { color: colors.text }]}>
          {rupees(p.amount)} · {paymentMethodLabel(p.method)}
        </Text>
        <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={2}>
          {[when, who].filter(Boolean).join(' · ')}
        </Text>
        {reference ? (
          <Text style={[type.small, { color: colors.textFaint }]} numberOfLines={1}>
            Ref {reference}
          </Text>
        ) : null}
      </View>
      <StatusPill status={p.status} kind="payment" small />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  payment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
});
