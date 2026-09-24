/**
 * The API surface, as screens see it.
 *
 * `import * as api from '@/lib/api'` gets every endpoint; the hooks come in by
 * name. A screen reads one list like this:
 *
 *   const staff = useQuery(keys.unitStaff(unitId), () => api.getUnitStaff(unitId));
 *
 * and writes one like this:
 *
 *   const mute = useMutation(
 *     (id: string, on: boolean) => api.setStaffNotify(unitId, id, on),
 *     { invalidates: [keys.unitStaff(unitId)] },
 *   );
 *
 * Nothing above this folder knows about tokens, the `/api/v1` prefix, retries,
 * or the socket.
 */
export * from './endpoints';
export * from './keys';
export * from './query';
export { ApiError, isMissingRoute, isOffline } from './http';
export {
  API_CONFIGURED,
  API_URL,
  APPROVAL_WINDOW_SECONDS,
  WS_URL,
} from './config';
export {
  applyServerEvent,
  setRealtimeScopes,
  startRealtime,
  stopRealtime,
  useConnection,
  type ConnectionState,
  type ServerEvent,
} from './realtime';
export {
  clearTokens,
  loadToken,
  loadUser,
  onSessionExpired,
  saveUser,
  setToken,
} from './tokens';
