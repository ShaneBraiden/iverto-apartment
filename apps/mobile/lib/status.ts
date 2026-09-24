/**
 * Domain state → what the app draws.
 *
 * Everything that turns an approval status, a direction or a delivery mode
 * into a colour, an icon and a label lives here. No screen maps a state to a
 * colour by hand, so a status changing meaning is one edit rather than a hunt.
 */
import { colors } from '@/theme';
import type {
  ApprovalStatus,
  DeliveryMode,
  Direction,
  EntryEvent,
  EntryEventResult,
  Platform,
  StaffType,
} from '@/types';

export type Tone = 'pending' | 'approved' | 'active' | 'rejected' | 'expired' | 'neutral';

const TONE_STYLE: Record<Tone, { fg: string; bg: string; icon: string }> = {
  pending: { fg: colors.warning, bg: colors.warningBg, icon: 'time-outline' },
  approved: { fg: colors.success, bg: colors.successBg, icon: 'checkmark-circle-outline' },
  active: { fg: colors.info, bg: colors.infoBg, icon: 'walk-outline' },
  rejected: { fg: colors.danger, bg: colors.dangerBg, icon: 'close-circle-outline' },
  expired: { fg: colors.textFaint, bg: colors.neutralBg, icon: 'hourglass-outline' },
  neutral: { fg: colors.textFaint, bg: colors.neutralBg, icon: 'ellipse-outline' },
};

const APPROVAL_TONE: Record<ApprovalStatus, Tone> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  AUTO_APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  PENDING: 'Waiting on you',
  APPROVED: 'Approved',
  /* Named differently from APPROVED on purpose: a resident should be able to
     tell at a glance which entries their standing delivery rule let through
     without asking them, and which ones they actually decided. */
  AUTO_APPROVED: 'Auto-approved',
  REJECTED: 'Denied',
  EXPIRED: 'No response',
};

const APPROVAL_EXPLAINER: Record<ApprovalStatus, string> = {
  PENDING: 'The guard is holding them at the gate until someone decides.',
  APPROVED: 'The guard was told to let them in.',
  AUTO_APPROVED: 'Your standing delivery rule allowed this without asking.',
  REJECTED: 'The guard was told not to admit them.',
  EXPIRED: 'Nobody answered in ninety seconds. The guard was asked to call.',
};

/** Everything a pill, a banner or a stat tile needs for one approval status. */
export function approvalInfo(status: ApprovalStatus | string) {
  const tone = APPROVAL_TONE[status as ApprovalStatus] ?? 'neutral';
  return {
    tone,
    label: APPROVAL_LABEL[status as ApprovalStatus] ?? humanise(status),
    explainer: APPROVAL_EXPLAINER[status as ApprovalStatus] ?? '',
    ...TONE_STYLE[tone],
  };
}

/**
 * Whether someone is inside the gate right now.
 *
 * `IN` reads as active rather than as success — a maid being on the premises
 * is a live fact, not an achievement, and colouring it green would put a
 * dozen green ticks on a household's staff list every morning.
 */
export function presenceInfo(direction: Direction) {
  return direction === 'IN'
    ? {
        tone: 'active' as Tone,
        label: 'Inside',
        explainer: '',
        ...TONE_STYLE.active,
        icon: 'enter-outline',
      }
    : {
        tone: 'neutral' as Tone,
        label: 'Left',
        explainer: '',
        ...TONE_STYLE.neutral,
        icon: 'exit-outline',
      };
}

/** The generic entry point `StatusPill` uses — approvals and direction. */
export function statusInfo(status: string) {
  if (status in APPROVAL_TONE) return approvalInfo(status);
  if (status === 'IN' || status === 'OUT') return presenceInfo(status as Direction);
  if (status === 'ACTIVE') {
    return { tone: 'active' as Tone, label: 'Active', explainer: '', ...TONE_STYLE.active };
  }
  return {
    tone: 'neutral' as Tone,
    label: humanise(status),
    explainer: '',
    ...TONE_STYLE.neutral,
  };
}

/* ------------------------------------------------------------- Deliveries */

export const DELIVERY_MODES: {
  value: DeliveryMode;
  label: string;
  hint: string;
  icon: string;
}[] = [
  {
    value: 'ASK_ME',
    label: 'Ask me',
    hint: 'Your phone rings before anyone is let in. The default, always.',
    icon: 'help-circle-outline',
  },
  {
    value: 'LEAVE_AT_GATE',
    label: 'Leave at gate',
    hint: 'The guard is told to take it. Nobody comes up.',
    icon: 'cube-outline',
  },
  {
    value: 'ALLOW_TO_DOOR',
    label: 'Send to my door',
    hint: 'Let through without asking, straight to your flat.',
    icon: 'home-outline',
  },
];

export const PLATFORMS: { value: Platform; label: string; icon: string }[] = [
  { value: 'BLINKIT', label: 'Blinkit', icon: 'flash-outline' },
  { value: 'ZEPTO', label: 'Zepto', icon: 'bicycle-outline' },
  { value: 'SWIGGY', label: 'Swiggy', icon: 'fast-food-outline' },
  { value: 'INSTAMART', label: 'Instamart', icon: 'basket-outline' },
  { value: 'AMAZON', label: 'Amazon', icon: 'cube-outline' },
  { value: 'FLIPKART', label: 'Flipkart', icon: 'bag-handle-outline' },
  { value: 'OTHER', label: 'Anything else', icon: 'ellipsis-horizontal-outline' },
];

export const platformLabel = (p: Platform) =>
  PLATFORMS.find((x) => x.value === p)?.label ?? humanise(p);
export const platformIcon = (p: Platform) =>
  PLATFORMS.find((x) => x.value === p)?.icon ?? 'cube-outline';
export const modeLabel = (m: DeliveryMode) =>
  DELIVERY_MODES.find((x) => x.value === m)?.label ?? humanise(m);

/**
 * The sentence a resident reads back to confirm a rule does what they meant.
 *
 * Written out in full rather than assembled from chips because the window is
 * the part people get wrong, and "outside those hours we ask you first" is the
 * reassurance that makes anything other than ASK_ME safe to pick.
 */
export function deliverySummary(p: {
  mode: DeliveryMode;
  windowStart: string | null;
  windowEnd: string | null;
  silent: boolean;
}): string {
  if (p.mode === 'ASK_ME') return 'Always ask before letting anyone in.';
  const action = p.mode === 'LEAVE_AT_GATE' ? 'left at the gate' : 'sent to your door';
  const when =
    p.windowStart && p.windowEnd
      ? `between ${p.windowStart} and ${p.windowEnd}`
      : 'at any hour';
  const notice = p.silent
    ? 'A silent log entry, no buzz.'
    : 'You are notified as it happens.';
  return `Orders ${when} are ${action}. Outside those hours we ask you first. ${notice}`;
}

/* ----------------------------------------------------------------- Staff */

export const STAFF_TYPES: { value: StaffType; label: string; icon: string }[] = [
  { value: 'MAID', label: 'House help', icon: 'sparkles-outline' },
  { value: 'COOK', label: 'Cook', icon: 'restaurant-outline' },
  { value: 'DRIVER', label: 'Driver', icon: 'car-outline' },
  { value: 'NANNY', label: 'Nanny', icon: 'happy-outline' },
  { value: 'OTHER', label: 'Other', icon: 'person-outline' },
];

export const staffTypeLabel = (t: StaffType) =>
  STAFF_TYPES.find((x) => x.value === t)?.label ?? humanise(t);
export const staffTypeIcon = (t: StaffType) =>
  STAFF_TYPES.find((x) => x.value === t)?.icon ?? 'person-outline';

/* -------------------------------------------------------------- Subjects */

export function subjectIcon(subject: string | null | undefined): string {
  switch (subject) {
    case 'STAFF':
      return 'people-outline';
    case 'DELIVERY':
      return 'cube-outline';
    case 'RESIDENT':
      return 'home-outline';
    default:
      return 'person-add-outline';
  }
}

const SUBJECT_NOUN: Record<string, string> = {
  STAFF: 'Household staff',
  VISITOR: 'Visitor',
  DELIVERY: 'Delivery',
  RESIDENT: 'Resident',
};

const SOURCE_LABEL: Record<string, string> = {
  M50_DEVICE: 'Face terminal',
  GUARD_APP: 'Logged by the guard',
  PASSCODE: 'Guest passcode',
};

/**
 * Whether it is worth asking for this event's photo.
 *
 * No response says whether a photo exists — there is no flag on an entry event
 * and never was one on an approval — so the only way to find out is to request
 * it and read the 404. Asking for every row would spend a request per line of a
 * log that is mostly staff scans, so this narrows it to the rows the guard app
 * and the passcode desk actually photograph: someone arriving who is not known
 * to the building.
 *
 * Wrong in the cheap direction on purpose. A guess of `false` where a photo
 * existed costs a face nobody sees; a guess of `true` where none did costs one
 * 404 and shows the same icon either way.
 */
export function expectsPhoto(event: {
  subjectType?: string | null;
  eventSource?: string | null;
}): boolean {
  if (event.eventSource === 'M50_DEVICE') return false;
  return event.subjectType === 'VISITOR' || event.subjectType === 'DELIVERY';
}

/**
 * The two sentences a guard reads after raising someone at the gate.
 *
 * The service used to write this prose and send it back as `message`; it now
 * sends the facts and no sentence. Composing it here rather than in the screen
 * keeps one wording for one outcome — and keeps the *decision* where it has
 * always been, on the server: this function reads what the rule already
 * resolved to and never resolves anything itself.
 *
 * `LEAVE_AT_GATE` and `ALLOW_TO_DOOR` are deliberately worded as two different
 * instructions. They are the whole difference between a parcel that stops at
 * the barrier and a stranger walking to a door, and a guard who reads them as
 * the same word is the reason that distinction exists.
 *
 * `status` is the same outcome in the two or three words a title bar has room
 * for; `title` is the instruction. They are separate so that a screen showing
 * both does not print the same sentence twice.
 */
export function entryOutcome(result: EntryEventResult): {
  status: string;
  title: string;
  sentence: string;
} {
  if (result.autoApproved) {
    if (result.mode === 'LEAVE_AT_GATE') {
      return {
        status: 'Allowed',
        title: 'Leave it at the gate',
        sentence:
          'A standing rule allows this delivery, to the gate only. Take the parcel — nobody goes up.',
      };
    }
    if (result.mode === 'ALLOW_TO_DOOR') {
      return {
        status: 'Allowed',
        title: 'Send them up',
        sentence: 'A standing rule allows this delivery straight to the door.',
      };
    }
    return {
      status: 'Allowed',
      title: 'Standing rule allows this',
      sentence: 'A standing rule allowed this without asking the household.',
    };
  }

  if (result.approvalRequest) {
    return {
      status: 'Asking the resident',
      title: 'Asking the resident',
      sentence:
        'The household has ninety seconds to answer. Hold them at the gate until it does.',
    };
  }

  return {
    status: 'Logged',
    title: 'Logged at the gate',
    sentence: 'Recorded at the gate. Nobody had to be asked about this one.',
  };
}

/**
 * The two lines a log row draws.
 *
 * The service sends `visitorName` on every kind of event and nothing else that
 * names a person, so a staff scan with no name attached arrives as a null. The
 * fallbacks are here rather than at each call site so that the same crossing
 * reads identically in the household's log, the guard's list and an approval
 * card — three screens wording a null three ways is how the same event starts
 * looking like three different events.
 */
export function entryTitle(event: {
  visitorName?: string | null;
  subjectType?: string | null;
}): string {
  const name = event.visitorName?.trim();
  if (name) return name;
  return SUBJECT_NOUN[event.subjectType ?? ''] ?? 'Someone at the gate';
}

export function entrySubtitle(event: Pick<EntryEvent, 'subjectType' | 'platform' | 'eventSource'>) {
  const parts: string[] = [];
  if (event.platform) parts.push(platformLabel(event.platform));
  else if (event.subjectType) parts.push(SUBJECT_NOUN[event.subjectType] ?? humanise(event.subjectType));
  if (event.eventSource) parts.push(SOURCE_LABEL[event.eventSource] ?? humanise(event.eventSource));
  return parts.join(' · ');
}

/** `LEAVE_AT_GATE` → `Leave at gate`, for anything this build does not know. */
function humanise(value: string) {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
