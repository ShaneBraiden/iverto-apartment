/**
 * What this guard has logged since they opened the app.
 *
 * This exists because of a hole in the service, and it is worth being exact
 * about which hole. There is no endpoint that lists a gate's entry events:
 * `POST /mobile/gates/{gateId}/entry-events` creates one and
 * `POST …/{id}/exit` closes one, but nothing reads them back. So a guard has no
 * gate log, no still-inside list, and — worse — no way to reach the exit
 * endpoint at all, because marking someone out needs an entry event id and
 * there is no list to take one from.
 *
 * The one honest source of those ids is the create response itself. Every entry
 * this guard raises is kept here, in memory, so the exit button has something
 * to act on.
 *
 * What it is not:
 *
 *   • **not a gate log.** It holds what *this device* logged since launch —
 *     nothing from the previous shift, nothing from the tablet at the other
 *     gate, nothing from the face terminal. Every screen that renders it says
 *     so in those words, because a partial list that looks complete is how a
 *     guard concludes the building is empty.
 *   • **not persisted.** It is deliberately dropped on restart rather than
 *     written to disk. A stale list restored the next morning would show
 *     yesterday's visitors as still inside, and a guard acting on that is worse
 *     off than one with no list.
 *
 * Delete this file the day the service ships `GET /mobile/gates/{id}/entry-events`.
 */
import { useEffect, useState } from 'react';
import type { EntryEvent } from '@/types';

/** An entry this guard raised, and whether they have since marked it out. */
export type SessionEntry = {
  event: EntryEvent;
  /** Set when the exit call succeeded. */
  exitedAt: string | null;
};

let entries: SessionEntry[] = [];
let gateId: string | null = null;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

/**
 * Record an entry this guard just created.
 *
 * Scoped to a gate: a supervisor whose posting changes must not carry the
 * previous gate's entries onto the new gate's screen, so a different id clears
 * the list rather than appending to it.
 */
export function recordEntry(forGateId: string, event: EntryEvent) {
  if (gateId !== forGateId) {
    gateId = forGateId;
    entries = [];
  }
  entries = [{ event, exitedAt: null }, ...entries.filter((e) => e.event.id !== event.id)];
  notify();
}

/** Mark one as closed, after the exit call came back. */
export function recordExit(entryEventId: string) {
  entries = entries.map((e) =>
    e.event.id === entryEventId && !e.exitedAt
      ? { ...e, exitedAt: new Date().toISOString() }
      : e,
  );
  notify();
}

export function clearGateSession() {
  entries = [];
  gateId = null;
  notify();
}

/**
 * The session list for one gate, newest first.
 *
 * Returns nothing for a different gate than the one the entries belong to,
 * rather than the wrong gate's rows.
 */
export function useGateSession(forGateId: string): SessionEntry[] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return gateId === forGateId ? entries : [];
}
