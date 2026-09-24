/**
 * Where push is plugged into the app. Renders nothing.
 *
 * It exists as a component rather than a call inside `AuthProvider` for one
 * reason: `usePushNotifications` routes, and routing needs the router. A hook
 * called from the provider itself would run above the navigator — and above
 * `useRootNavigationState`, which is how it knows the navigator is there at
 * all. Mounted here, it sits inside both.
 *
 * The three inputs it needs are the three things a push cannot be handled
 * without: whether there is a usable session, whether the router is up, and
 * which homes this person holds — the last so a visitor alert for the second
 * flat switches to that flat before it opens the queue.
 */
import React from 'react';
import { useRootNavigationState } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { usePushNotifications } from '@/lib/push';

export function Push() {
  const { user, mustChangePassword, contexts, setContext } = useAuth();
  const navigation = useRootNavigationState();

  usePushNotifications({
    /* Not merely "signed in". An account still on its onboarding password
       reaches exactly one screen, and asking it for notification permission —
       Android 13 gives an app one chance at that dialog — would spend the
       prompt on somebody who has not seen the app yet. */
    enabled: !!user && !mustChangePassword,
    navigationReady: !!navigation?.key,
    contexts,
    setContext,
  });

  return null;
}
