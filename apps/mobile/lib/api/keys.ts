/**
 * Cache keys, in one place.
 *
 * Every key is a path from the broadest scope inward — `['unit', id, 'staff']`
 * — because invalidation is by prefix. A socket frame saying "something about
 * A-402 changed" invalidates `['unit', 'unit-a402']` and every query underneath
 * it refetches, without the realtime module needing to know which screens exist
 * or what they asked for.
 *
 * That ordering is the whole design. Getting it wrong (`['staff', unitId]`)
 * still works for reads and quietly breaks invalidation, which is the kind of
 * bug that only shows up as "the guard's screen didn't update".
 */
export type QueryKey = readonly (string | number | boolean | null | undefined)[];

export const keys = {
  /* Me */
  contexts: () => ['me', 'contexts'] as const,

  /* Unit scope — the resident shell */
  unit: (unitId: string) => ['unit', unitId] as const,
  unitPending: (unitId: string) => ['unit', unitId, 'pending'] as const,
  /* Page *and* limit are both in the key. The home screen asks for twenty and
     the log asks for however many the reader has scrolled to; sharing one entry
     between them would truncate the log every time the home screen refetched. */
  unitEvents: (unitId: string, page = 1, limit = 20) =>
    ['unit', unitId, 'events', page, limit] as const,
  unitStaff: (unitId: string) => ['unit', unitId, 'staff'] as const,
  /** The society register as this unit may add from. Unit-scoped on the wire. */
  unitStaffRoster: (unitId: string) => ['unit', unitId, 'roster'] as const,
  deliveryPermissions: (unitId: string) => ['unit', unitId, 'delivery-permissions'] as const,
  passcodes: (unitId: string) => ['unit', unitId, 'passcodes'] as const,

  /* Gate scope — the guard shell */
  gatePending: (gateId: string) => ['gate', gateId, 'pending'] as const,
  /* The search term is part of the key: two different searches are two
     different answers, and sharing one entry between them would show the
     previous query's results for as long as the new one is in flight. */
  gateDirectory: (gateId: string, query: string) =>
    ['gate', gateId, 'directory', query] as const,
  gateStaff: (gateId: string) => ['gate', gateId, 'staff'] as const,

  /* Society scope — the admin shell */
  units: (societyId: string) => ['society', societyId, 'units'] as const,
  societyStaff: (societyId: string) => ['society', societyId, 'staff'] as const,
  devices: (societyId: string) => ['society', societyId, 'devices'] as const,
  societyEvents: (societyId: string) => ['society', societyId, 'events'] as const,
  dashboard: (societyId: string) => ['society', societyId, 'dashboard'] as const,
};

/** Everything scoped to one unit — what a per-unit realtime frame invalidates. */
export const unitScope = (unitId: string): QueryKey => ['unit', unitId];

/** Everything scoped to one gate. */
export const gateScope = (gateId: string): QueryKey => ['gate', gateId];

/** Everything scoped to one society. */
export const societyScope = (societyId: string): QueryKey => ['society', societyId];
