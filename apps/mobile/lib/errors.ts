/**
 * Turning a thrown thing into something a person can act on.
 *
 * A guard standing at a gate with a queue behind them does not benefit from
 * "Request failed with status code 503". They benefit from knowing whether to
 * press the button again or to pick up the phone — so every branch here
 * answers that one question, and `canRetry` is what the error state uses to
 * decide whether offering a retry would just waste their time.
 */

export type ErrorCopy = {
  title: string;
  message: string;
  icon: string;
  canRetry: boolean;
};

export function errorCopy(error?: unknown, override?: string): ErrorCopy {
  const status = statusOf(error);
  const text = override ?? messageOf(error);

  if (status === 401 || status === 403) {
    return {
      title: 'Not allowed',
      message: text ?? 'Your access to this changed. Sign out and back in if it persists.',
      icon: 'lock-closed-outline',
      /* Retrying a 403 produces another 403. Offering the button would be a lie. */
      canRetry: false,
    };
  }
  if (status === 404) {
    return {
      title: 'Not there any more',
      message: text ?? 'This was removed or has already been decided by someone else.',
      icon: 'help-circle-outline',
      canRetry: false,
    };
  }
  if (status && status >= 500) {
    return {
      title: 'The server had a problem',
      message: text ?? 'Nothing you did. Try again in a moment.',
      icon: 'cloud-offline-outline',
      canRetry: true,
    };
  }
  /* Status 0 is the transport's own code for "this never reached a server" —
     a dropped connection or a timed-out request. It has to be checked
     explicitly, because `0` is falsy and would otherwise fall through the
     status branches above into the generic message. */
  if (status === 0 || isOffline(error)) {
    return {
      title: 'You are offline',
      message: 'Approvals need a connection. Entries you log will queue and send when you reconnect.',
      icon: 'cloud-offline-outline',
      canRetry: true,
    };
  }
  return {
    title: 'Something went wrong',
    message: text ?? 'Try that again.',
    icon: 'alert-circle-outline',
    canRetry: true,
  };
}

function statusOf(error: unknown): number | null {
  if (error && typeof error === 'object' && 'status' in error) {
    const s = (error as { status: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return null;
}

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return undefined;
}

function isOffline(error: unknown): boolean {
  const m = messageOf(error)?.toLowerCase() ?? '';
  return m.includes('network') || m.includes('fetch') || m.includes('offline');
}

/**
 * The gate directory, refused.
 *
 * A 403 here is not the guard's mistake and is not fixable by retrying, and
 * the sentence the service sends — "Missing required permission:
 * directory.read on GATE" — is addressed to whoever configured the roles, not
 * to somebody standing at a barrier with a queue behind them. So it is
 * replaced with what a guard can actually act on, and the server's own words
 * are kept underneath for the person they were written for.
 *
 * The cause is a scope mismatch on the service: the route demands
 * `directory.read` at GATE scope while the guard's grant carries it at SOCIETY
 * scope (§4.1 of `gate-management-architecture.md`). Until that is fixed there
 * is no client-side route to a flat's `unitId`, so this screen cannot degrade
 * into a workaround — it can only say so honestly.
 *
 * Returns null for anything else, so callers fall through to `errorCopy`.
 */
export function directoryRefusal(error: unknown): ErrorCopy | null {
  const status = statusOf(error);
  if (status !== 401 && status !== 403) return null;
  const server = messageOf(error);
  return {
    title: 'The directory is closed to this account',
    message: `Your gate posting does not carry permission to search the resident list, so no home can be picked here. Ask the society office to check this guard's role. ${
      server ? `The server said: “${server}”.` : ''
    }`.trim(),
    icon: 'lock-closed-outline',
    canRetry: false,
  };
}
