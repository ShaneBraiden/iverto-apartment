/**
 * Time, written the way a person at a gate would say it.
 *
 * Entry logs are read in two modes: "what is happening right now", where
 * relative time is the only useful form, and "what happened on Tuesday", where
 * it is useless. So both exist and screens pick per context rather than one
 * format being bent to cover both.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** `7:14 AM` — the clock time an event is logged at. */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const meridiem = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${m} ${meridiem}`;
}

/** `Tue 26 Aug` — the day, without a year that nobody is asking about. */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - DAY);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** `2 min ago`, `3 h ago`, then it gives up and names the day. */
export function relative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < MIN) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MIN)} min ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h ago`;
  if (delta < 2 * DAY) return 'yesterday';
  return dayLabel(iso);
}

/**
 * `1:24` — seconds remaining, as a countdown.
 *
 * Returns `0:00` rather than a negative once the window has passed, because a
 * card that has run out and one that is about to should not look different by
 * a minus sign.
 */
export function countdown(iso: string, now = Date.now()): string {
  const remaining = Math.max(0, new Date(iso).getTime() - now);
  const total = Math.ceil(remaining / 1000);
  const m = Math.floor(total / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Fraction of the approval window still left, for the countdown ring.
 *
 * `createdAt` is optional because an approval nested in a create-entry response
 * carries only its deadline. Without a start the window falls back to
 * `windowSeconds` — the ring then drains at the right rate even though it began
 * mid-sweep, which is a better answer than a ring that sits full or empty.
 */
export function remainingFraction(
  createdAt: string | null | undefined,
  expiresAt: string,
  now = Date.now(),
  windowSeconds = 90,
) {
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return 0;
  const start = createdAt ? new Date(createdAt).getTime() : end - windowSeconds * 1000;
  if (!(end > start)) return 0;
  return Math.max(0, Math.min(1, (end - now) / (end - start)));
}

/** `4 h 12 m` — how long someone has been inside. Used by the overstay list. */
export function durationSince(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const h = Math.floor(delta / HOUR);
  const m = Math.floor((delta % HOUR) / MIN);
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

/** Morning / afternoon / evening, for the dashboard greeting. */
export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
