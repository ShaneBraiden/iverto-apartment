/**
 * The router's front door.
 *
 * Three shells exist and exactly one of them is legal at any moment, decided by
 * the active context. Doing that here — rather than nesting the choice inside a
 * navigator — is what makes the switch total: changing context changes which
 * subtree is mounted at all, so a guard cannot end up on a resident screen
 * through a stale back stack.
 *
 * It is also where the two blocking states are settled, in order: an account
 * still on its onboarding password gets exactly one screen, and only once that
 * is cleared does the contexts request decide which shell to mount. Guessing —
 * defaulting to the resident tree and correcting later — would flash the wrong
 * app at a guard on every cold start.
 */
import React from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import { ErrorState, Loader } from '@/components/ui';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const {
    user,
    mustChangePassword,
    shell,
    context,
    loadingContexts,
    contextsError,
    reloadContexts,
    contexts,
    signOut,
  } = useAuth();

  /* Undefined means the keystore read is still in flight. Redirecting now would
     bounce a signed-in user to the login screen for a frame. */
  if (user === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Loader />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  /* Before anything is fetched. The service may refuse a session that has not
     cleared this, and a shell drawn behind a mandatory dialog is a shell the
     user can see data in that they should not reach yet. */
  if (mustChangePassword) return <Redirect href="/change-password" />;

  if (loadingContexts) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Loader label="Loading your homes…" />
      </View>
    );
  }

  if (contextsError) {
    return (
      <Screen clearTabBar={false}>
        <ErrorState error={contextsError} onRetry={reloadContexts} />
      </Screen>
    );
  }

  /* Authenticated, and the server says this account belongs to nothing. A real
     state — someone is onboarded before their flat is linked — and one the app
     has to name, because every shell below would render empty. */
  if (!contexts.length) {
    return (
      <Screen clearTabBar={false}>
        <ErrorState
          title="Nothing linked to this account yet"
          message="Your society has not attached this login to a home or a gate. Ask the society office to add you, then reopen the app."
          onRetry={reloadContexts}
          secondaryLabel="Sign out"
          onSecondary={signOut}
        />
      </Screen>
    );
  }

  if (shell === 'guard') return <Redirect href="/guard" />;
  if (shell === 'admin') return <Redirect href="/admin" />;
  if (shell === 'resident') return <Redirect href="/resident" />;

  /* A society role that is not an admin — a guard whose posting carries no gate.
     Every screen in the guard shell is `/mobile/gates/{gateId}/…`, so there is
     nothing to render and no honest way to pretend otherwise: say which role it
     is and what is missing, rather than mounting five failing requests. */
  return (
    <Screen clearTabBar={false}>
      <ErrorState
        title="No gate assigned"
        message={`Your account is registered on ${
          context?.sublabel ?? 'this society'
        } but is not posted to a gate, so the guard screen has nothing to open. Ask the society office to assign you one.`}
        onRetry={reloadContexts}
        secondaryLabel="Sign out"
        onSecondary={signOut}
      />
    </Screen>
  );
}
