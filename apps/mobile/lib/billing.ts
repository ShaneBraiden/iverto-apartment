/**
 * Maintenance bills — the arithmetic a screen needs, and the one payment flow.
 *
 * The rule this file keeps is the one §3.12.6 of the API document insists on:
 * **the client never decides how much is owed and never decides that a bill is
 * paid.** The amount comes from the order the server opened, in paise, and is
 * handed to Razorpay untouched. "Paid" is whatever `pay/verify` answers with —
 * a successful checkout sheet on its own is a claim, not a receipt.
 *
 * `outstanding` below exists only to *say* a number on screen before the
 * resident taps pay; nothing is ever charged from it.
 */
import { NativeModules, TurboModuleRegistry } from 'react-native';
import * as api from '@/lib/api';
import { colors } from '@/theme';
import type { Invoice, InvoiceDetail, RazorpayResult, User } from '@/types';

/* ------------------------------------------------------------------ Money */

/**
 * `3200` → `₹3,200`, `3200.5` → `₹3,200.50`, `125000` → `₹1,25,000`.
 *
 * Indian digit grouping by hand rather than through `Intl`: Hermes's locale
 * data varies by build, and a bill that reads `₹125,000` on one phone and
 * `₹1,25,000` on another is a bill somebody disputes.
 */
export function rupees(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  const negative = n < 0;
  const [whole, fraction] = Math.abs(n).toFixed(2).split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${negative ? '−' : ''}₹${grouped}${fraction === '00' ? '' : `.${fraction}`}`;
}

/** What is left to pay, for display. Never the amount charged — see the header. */
export const outstanding = (inv: Pick<Invoice, 'totalAmount' | 'amountPaid'>) =>
  Math.max(0, Math.round((Number(inv.totalAmount) - Number(inv.amountPaid)) * 100) / 100);

/** Whether "Pay now" belongs on this bill at all. The server has the last word. */
export const isPayable = (inv: Pick<Invoice, 'status' | 'totalAmount' | 'amountPaid'>) =>
  inv.status !== 'PAID' && inv.status !== 'CANCELLED' && outstanding(inv) > 0;

/** `"2026-09"` → `"September 2026"`. Falls back to whatever was sent. */
export function periodName(label: string | null | undefined): string | null {
  if (!label) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return label;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** The name a bill goes by in a list: its month, or its number for a one-off charge. */
export const invoiceTitle = (inv: Pick<Invoice, 'periodLabel' | 'invoiceNumber'>) => {
  const period = periodName(inv.periodLabel);
  return period ? `${period} bill` : inv.invoiceNumber;
};

/**
 * Whole days from today until a `YYYY-MM-DD` due date. Negative once past.
 *
 * Parsed as a local calendar date, not as an instant: `new Date('2026-09-10')`
 * is midnight UTC, which in India is half past five in the morning and would
 * make a bill due "today" read as due yesterday for anybody checking early.
 */
export function daysUntil(date: string, now = new Date()): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const due = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

const shortDate = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
};

/** One line about when a bill is due, worded for how urgent it is. */
export function dueLabel(inv: Pick<Invoice, 'status' | 'dueDate' | 'paidAt'>): string {
  if (inv.status === 'CANCELLED') return 'Cancelled by the society office';
  if (inv.status === 'PAID') {
    return inv.paidAt
      ? `Paid on ${new Date(inv.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'Paid';
  }
  if (!inv.dueDate) return 'No due date';
  const days = daysUntil(inv.dueDate);
  if (days < 0) return `Overdue by ${-days} ${-days === 1 ? 'day' : 'days'}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `Due in ${days} days`;
  return `Due ${shortDate(inv.dueDate)}`;
}

/* --------------------------------------------------------------- Checkout */

export type PayOutcome =
  /** Verified by the server. `invoice` is its answer and goes straight into the cache. */
  | { kind: 'paid'; invoice: InvoiceDetail }
  /** The resident closed the sheet. Nothing happened; nothing to say. */
  | { kind: 'cancelled' }
  /** Razorpay or the signature check refused it. Safe to start again from scratch. */
  | { kind: 'failed'; message: string }
  /**
   * Razorpay took the money but the app could not get the server to confirm it.
   * The result must be kept and verified again — **not** paid a second time.
   * The webhook will usually settle it anyway; see `confirmPayment`.
   */
  | { kind: 'unconfirmed'; result: RazorpayResult; error: unknown };

type Checkout = {
  open(options: Record<string, unknown>): Promise<RazorpayResult>;
};

/**
 * The native checkout, loaded on first use.
 *
 * Not a top-level import: the module builds a `NativeEventEmitter` the moment
 * it is evaluated, and in a binary built before `react-native-razorpay` was
 * added that throws — which at the top of this file would take the whole
 * resident shell down, not just the pay button.
 */
function loadCheckout(): Checkout | null {
  const linked =
    !!NativeModules.RNRazorpayCheckout ||
    !!(TurboModuleRegistry as { get?: (n: string) => unknown }).get?.('RNRazorpayCheckout');
  if (!linked) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-razorpay').default as Checkout;
  } catch {
    return null;
  }
}

/** Razorpay's error payload, which on Android is sometimes JSON inside a string. */
function checkoutError(e: unknown): { cancelled: boolean; message: string } {
  const err = (e ?? {}) as { code?: number; description?: unknown; error?: unknown };
  let description = err.description;
  if (typeof description === 'string') {
    try {
      const parsed = JSON.parse(description) as { error?: { description?: string; reason?: string } };
      description = parsed?.error?.description ?? description;
      if (parsed?.error?.reason === 'payment_cancelled') return { cancelled: true, message: '' };
    } catch {
      /* A plain sentence. Use it as is. */
    }
  }
  const text = typeof description === 'string' ? description : '';
  /* Code 0 is PAYMENT_CANCELLED on both platforms' SDKs. */
  const cancelled = err.code === 0 || /cancel/i.test(text);
  return {
    cancelled,
    message: text || 'The payment did not go through. You have not been charged.',
  };
}

const isTransient = (e: unknown) => {
  const status = (e as { status?: number } | null)?.status;
  return status === 0 || (typeof status === 'number' && status >= 500);
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tell the server about a payment Razorpay already took.
 *
 * Retried on a dropped connection or a 5xx, with the *same* result and so the
 * same idempotency key — a repeat for an applied payment is a no-op on the
 * server, so the only way retrying can go wrong is by not doing it. A 4xx is
 * not retried: a failed signature check is an answer.
 */
export async function confirmPayment(
  unitId: string,
  invoiceId: string,
  result: RazorpayResult,
  attempts = 3,
): Promise<InvoiceDetail> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await api.verifyPayment(unitId, invoiceId, result);
    } catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      if (i < attempts - 1) await wait(1_000 * (i + 1));
    }
  }
  throw last;
}

/**
 * Order → checkout → verify. §3.12.6, end to end.
 *
 * Failures *before* the sheet opens (no gateway configured, bill already paid,
 * a family member's 403) are thrown for the screen to word with `errorCopy`,
 * because they are about the bill or the account. Everything after the sheet
 * opens comes back as an outcome, because by then money may have moved and the
 * screen has to know exactly which of the four states it is in.
 */
export async function payInvoice(input: {
  unitId: string;
  invoice: Pick<Invoice, 'id' | 'invoiceNumber'>;
  /** Generated once per tap by the caller, so a retried order request is the same order. */
  attemptKey: string;
  user: User | null | undefined;
  societyName: string | null;
}): Promise<PayOutcome> {
  const checkout = loadCheckout();
  if (!checkout) {
    throw new api.ApiError(
      'Online payment is not available in this build of the app. Update the app, or pay at the society office.',
      400,
      'checkout_unavailable',
    );
  }

  const order = await api.createPaymentOrder(input.unitId, input.invoice.id, input.attemptKey);

  let result: RazorpayResult;
  try {
    result = await checkout.open({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: input.societyName ?? 'Society maintenance',
      description: `Invoice ${order.invoiceNumber}`,
      prefill: {
        name: input.user?.name ?? undefined,
        email: input.user?.email ?? undefined,
        contact: input.user?.phone ?? undefined,
      },
      theme: { color: colors.primary },
    });
  } catch (e) {
    const { cancelled, message } = checkoutError(e);
    return cancelled ? { kind: 'cancelled' } : { kind: 'failed', message };
  }

  try {
    const invoice = await confirmPayment(input.unitId, input.invoice.id, result);
    return { kind: 'paid', invoice };
  } catch (e) {
    if (isTransient(e)) return { kind: 'unconfirmed', result, error: e };
    const message =
      e instanceof Error && e.message
        ? e.message
        : 'The payment could not be confirmed. If you were charged, it will be refunded or applied automatically.';
    return { kind: 'failed', message };
  }
}
