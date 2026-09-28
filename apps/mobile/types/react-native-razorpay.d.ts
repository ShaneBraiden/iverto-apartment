/** `react-native-razorpay` ships plain JS. Only the surface this app calls is typed. */
declare module 'react-native-razorpay' {
  export type CheckoutOptions = {
    key: string;
    amount: number;
    currency: string;
    order_id: string;
    name?: string;
    description?: string;
    image?: string;
    prefill?: { name?: string; email?: string; contact?: string };
    notes?: Record<string, string>;
    theme?: { color?: string };
  };

  export type CheckoutSuccess = {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  };

  /** What the SDK rejects with — `code` 0 is the resident closing the sheet. */
  export type CheckoutError = {
    code?: number;
    description?: string;
    error?: { description?: string; reason?: string } | string;
  };

  const RazorpayCheckout: {
    open(options: CheckoutOptions): Promise<CheckoutSuccess>;
  };
  export default RazorpayCheckout;
}
