/**
 * Permission grants — §4.1 of the architecture, transcribed.
 *
 * The rule the backend enforces is `(user, action, scope)`, never
 * `(user, role)`. The app mirrors it so the UI hides what the API would refuse
 * anyway, and so a screen never has to ask "is this person an owner?" — it
 * asks "may this person decide approvals here?", which survives a role being
 * renamed or a grant moving.
 *
 * This is a *convenience*, not a control. The server checks every call again,
 * because the client is not trusted with its own permissions. What this file
 * buys is a UI that doesn't show a guard a button that would 403.
 */
import type { Context, Role, ScopeType } from '@/types';

/** Everything anyone can do. One flat vocabulary across all three shells. */
export type Action =
  | 'approval.decide'
  | 'approval.request'
  | 'staff.assign'
  | 'staff.manage'
  | 'passcode.create'
  | 'passcode.verify'
  | 'delivery_perm.edit'
  | 'entry.view'
  | 'entry.create'
  | 'photo.capture'
  | 'member.invite'
  | 'member.manage'
  | 'unit.manage'
  | 'device.manage'
  | 'notice.post'
  | 'complaint.create'
  | 'complaint.manage'
  | 'guard.roster'
  | 'directory.read';

/** `"approval.decide@UNIT"` — an action bound to the scope it applies in. */
export type Grant = `${Action}@${ScopeType}`;

const GUARD: Grant[] = [
  'entry.create@GATE',
  'photo.capture@GATE',
  'approval.request@GATE',
  'passcode.verify@GATE',
  'directory.read@SOCIETY',
  'entry.view@GATE',
];

export const ROLE_GRANTS: Record<Role, Grant[]> = {
  OWNER: [
    'approval.decide@UNIT',
    'staff.assign@UNIT',
    'passcode.create@UNIT',
    'delivery_perm.edit@UNIT',
    'entry.view@UNIT',
    'member.invite@UNIT',
    'complaint.create@UNIT',
  ],
  TENANT: [
    'approval.decide@UNIT',
    'staff.assign@UNIT',
    'passcode.create@UNIT',
    'delivery_perm.edit@UNIT',
    'entry.view@UNIT',
    'complaint.create@UNIT',
  ],
  /* Family members decide and invite, but do not restructure the household:
     no staff assignment, no delivery rules, no inviting further members. */
  FAMILY: ['approval.decide@UNIT', 'passcode.create@UNIT', 'entry.view@UNIT'],
  GUARD,
  GUARD_SUPERVISOR: [...GUARD, 'guard.roster@SOCIETY', 'entry.view@SOCIETY'],
  SOCIETY_ADMIN: [
    'unit.manage@SOCIETY',
    'member.manage@SOCIETY',
    'staff.manage@SOCIETY',
    'device.manage@SOCIETY',
    'notice.post@SOCIETY',
    'entry.view@SOCIETY',
    'complaint.manage@SOCIETY',
    'directory.read@SOCIETY',
  ],
};

/**
 * May the active context perform this action?
 *
 * The scope is taken from the grant rather than passed in: a context carries
 * exactly one scope, so `can(ctx, 'entry.view')` is unambiguous — it asks
 * whether this hat, in the place it applies, permits the action.
 */
export function can(context: Context | null, action: Action): boolean {
  if (!context) return false;
  return ROLE_GRANTS[context.role].some((g) => g.startsWith(`${action}@`));
}

/**
 * Which shell a context routes into.
 *
 * Three trees plus an honest fourth answer. The guard shell is reachable only
 * from a GATE context, because every call it makes is `/mobile/gates/{gateId}/…`
 * and a guard without a gate id has no screen that can load. A society role of
 * GUARD with no gate posting is therefore `unassigned` — a state the front door
 * names in a sentence rather than a shell that renders five failed requests.
 */
export type Shell = 'resident' | 'guard' | 'admin' | 'unassigned';

export function shellFor(context: Context): Shell {
  if (context.type === 'UNIT') return 'resident';
  if (context.type === 'GATE') return 'guard';
  if (context.role === 'SOCIETY_ADMIN') return 'admin';
  return 'unassigned';
}

/** The label a header shows for the hat currently being worn. */
export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner',
  TENANT: 'Tenant',
  FAMILY: 'Family member',
  GUARD: 'Security guard',
  GUARD_SUPERVISOR: 'Guard supervisor',
  SOCIETY_ADMIN: 'Society admin',
};

/**
 * Guards see a masked number and nothing else (§10). Masking here rather than
 * at each call site means a new screen cannot leak a full number by forgetting.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '•••••';
  return `+91 ••••• •${digits.slice(-4)}`;
}
