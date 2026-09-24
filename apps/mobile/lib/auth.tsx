/**
 * Session, contexts, and the active hat.
 *
 * The session is one token in the keystore. The *interesting* state is
 * `context` — which of the person's roles they are currently acting as —
 * because that is what decides which navigation tree renders and what every
 * permission check in the app resolves against.
 *
 * Four rules this provider enforces:
 *   • roles are never read from the token — they come from
 *     `GET /mobile/me/contexts`, and are refetched, because a tenancy can end
 *     while a session is still alive
 *   • an account still carrying `mustChangePassword` reaches exactly one
 *     screen, and nothing is fetched for it until that is dealt with
 *   • a guard has no switcher; their context is fixed by their posting
 *   • when the token is refused, the session ends here rather than leaving
 *     screens to each discover their own 401
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import * as api from '@/lib/api';
import { clearGateSession } from '@/lib/gateSession';
import { forgetPushRegistration } from '@/lib/push';
import { can as canDo, shellFor, type Action, type Shell } from '@/lib/rbac';
import type { Context, User } from '@/types';

const CONTEXT_KEY = 'gate.context';

type AuthValue = {
  /** Undefined while the stored session is still being read off disk. */
  user: User | null | undefined;
  /**
   * True when this account is still on its onboarding password.
   *
   * Everything is gated behind it: the router sends the user to the
   * change-password screen and no context is fetched, because a session that
   * has not cleared this is a session the service may refuse anyway.
   */
  mustChangePassword: boolean;
  contexts: Context[];
  context: Context | null;
  /** True while the contexts fetch is in flight after a restored session. */
  loadingContexts: boolean;
  /** Set when the contexts fetch failed — the front door offers a retry. */
  contextsError: unknown;
  reloadContexts: () => void;
  shell: Shell | null;
  /** The society the active context belongs to. */
  societyId: string | null;
  /** Its name, for screen subtitles. Comes off the context, not a fetch. */
  societyName: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Replaces the onboarding password and adopts the fresh token it returns. */
  completePasswordChange: (newPassword: string) => Promise<void>;
  setContext: (id: string) => void;
  signOut: () => Promise<void>;
  /** `can('approval.decide')` — asks the active context, never a role name. */
  can: (action: Action) => boolean;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [contexts, setContexts] = useState<Context[]>([]);
  const [contextId, setContextId] = useState<string | null>(null);
  const [loadingContexts, setLoadingContexts] = useState(false);
  const [contextsError, setContextsError] = useState<unknown>(undefined);

  /**
   * Fetch the hats, then settle on one.
   *
   * The stored choice is honoured only if it is still in the list. Someone
   * whose tenancy ended comes back to their remaining context rather than to a
   * shell rendering a unit the server will now 403 on.
   */
  const loadContexts = useCallback(async () => {
    setLoadingContexts(true);
    setContextsError(undefined);
    try {
      const list = await api.getContexts();
      setContexts(list);
      const saved = await SecureStore.getItemAsync(CONTEXT_KEY).catch(() => null);
      setContextId((current) => {
        const keep = current ?? saved;
        return list.some((c) => c.id === keep) ? keep! : (list[0]?.id ?? null);
      });
    } catch (e) {
      setContextsError(e);
    } finally {
      setLoadingContexts(false);
    }
  }, []);

  const endSession = useCallback(async () => {
    await api.clearTokens();
    api.stopRealtime();
    api.clearCache();
    /* A gate tablet is handed between shifts. The outgoing guard's entries
       carry visitors' names and photos, and they must not still be on screen
       when the next guard signs in. */
    clearGateSession();
    /* The next person to sign in on this handset gets their own FCM
       registration. The service has no endpoint that deletes a token, so
       this only stops *this* app re-sending one it already registered — the
       backend must stop pushing to a signed-out device on its own. */
    forgetPushRegistration();
    setUser(null);
    setContexts([]);
    setContextId(null);
    setContextsError(undefined);
    await SecureStore.deleteItemAsync(CONTEXT_KEY).catch(() => {});
  }, []);

  /* Cold start: token off disk, then the hats off the network. The cached user
     is adopted immediately so the header is not blank while contexts load — it
     is only a display name, and the token is what actually authorises. */
  useEffect(() => {
    (async () => {
      const token = await api.loadToken();
      if (!token) {
        setUser(null);
        return;
      }
      const cached = await api.loadUser<User>();
      setUser(cached);
      /* A restored session that never cleared its onboarding password goes to
         that screen, and asking for contexts first would only be a request
         thrown away when it got there. */
      if (cached?.mustChangePassword) return;
      await loadContexts();
    })();
  }, [loadContexts]);

  /* The transport signals a refused token. Nothing is recoverable from there,
     so the session ends in one place instead of every screen showing its own
     401. */
  useEffect(() => {
    const unsubscribe = api.onSessionExpired(() => {
      void endSession();
    });
    return () => {
      unsubscribe();
    };
  }, [endSession]);

  const context = useMemo(
    () => contexts.find((c) => c.id === contextId) ?? null,
    [contexts, contextId],
  );

  /* The socket lives exactly as long as a usable session does. */
  const ready = !!user && !user.mustChangePassword;
  useEffect(() => {
    if (ready) api.startRealtime();
    else api.stopRealtime();
  }, [ready]);

  /* Rooms follow the active hat: a resident who switches to their second home
     should stop being told about the first one's gate traffic. */
  useEffect(() => {
    api.setRealtimeScopes({
      unitId: context?.type === 'UNIT' ? context.unitId : null,
      gateId: context?.type === 'GATE' ? context.gateId : null,
      societyId: context?.societyId ?? null,
    });
  }, [context]);

  const adopt = useCallback(
    async (session: { accessToken: string; user: User }) => {
      await api.setToken(session.accessToken);
      await api.saveUser(session.user);
      /* Any cache left from a previous account on this device belongs to
         someone else. Clear before the first fetch, not after. */
      api.clearCache();
      setUser(session.user);
      return session.user;
    },
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await api.login(email, password);
      const next = await adopt(session);
      if (!next.mustChangePassword) await loadContexts();
    },
    [adopt, loadContexts],
  );

  /**
   * Replace the onboarding password.
   *
   * The response carries a new token as well as the updated user, and adopting
   * it is not optional: keeping the old one leaves every later request
   * authenticated as an account that still has to change its password.
   */
  const completePasswordChange = useCallback(
    async (newPassword: string) => {
      const session = await api.changePassword(newPassword);
      await adopt({
        accessToken: session.accessToken,
        user: { ...session.user, mustChangePassword: false },
      });
      await loadContexts();
    },
    [adopt, loadContexts],
  );

  /**
   * Switching hats.
   *
   * The cache is dropped rather than kept per-context. Two households' data
   * living side by side in one cache is how the wrong flat's approval ends up
   * on screen, and the refetch it costs is four small GETs.
   */
  const setContext = useCallback((id: string) => {
    setContextId(id);
    api.clearCache();
    SecureStore.setItemAsync(CONTEXT_KEY, id).catch(() => {});
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      mustChangePassword: !!user?.mustChangePassword,
      contexts,
      context,
      loadingContexts,
      contextsError,
      reloadContexts: () => {
        void loadContexts();
      },
      shell: context ? shellFor(context) : null,
      societyId: context?.societyId ?? null,
      societyName: context
        ? context.type === 'SOCIETY'
          ? context.label
          : context.sublabel
        : null,
      signIn,
      completePasswordChange,
      setContext,
      signOut: endSession,
      can: (action: Action) => canDo(context, action),
    }),
    [
      user,
      contexts,
      context,
      loadingContexts,
      contextsError,
      loadContexts,
      signIn,
      completePasswordChange,
      setContext,
      endSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

/**
 * The unit the resident shell is currently acting for.
 *
 * Throws rather than returning null: every screen under `app/resident` is only
 * reachable with a UNIT context, so a null here is a routing bug and should
 * fail where it happens rather than render an empty screen somewhere else.
 */
export function useUnitContext() {
  const { context } = useAuth();
  if (!context || context.type !== 'UNIT') {
    throw new Error('This screen requires a UNIT context');
  }
  return context;
}

export function useGateContext() {
  const { context } = useAuth();
  if (!context || context.type !== 'GATE') {
    throw new Error('This screen requires a GATE context');
  }
  return context;
}

/**
 * The society scope for admin screens.
 *
 * Same reasoning as the two above: a SOCIETY screen without a society id is a
 * routing bug, and the alternative is threading `societyId!` through every call
 * in the admin shell.
 */
export function useSocietyContext() {
  const { context } = useAuth();
  if (!context || context.type !== 'SOCIETY') {
    throw new Error('This screen requires a SOCIETY context');
  }
  return context;
}
