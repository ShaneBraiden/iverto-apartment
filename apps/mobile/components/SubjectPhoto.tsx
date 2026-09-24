/**
 * The face on a card, or the icon that stands in for one.
 *
 * The photo lives behind an authenticated endpoint that streams JPEG bytes,
 * so it cannot be a bare URI — the bearer token rides on the image request
 * itself (`entryPhotoSource`). Everything about that is in `endpoints.ts`; what
 * is here is the fallback.
 *
 * **Nothing in the API says whether a photo exists.** Not on an entry event,
 * not on an approval — the request is the question and a 404 is the answer. So
 * the photo is asked for optimistically and `onError` swaps in the icon.
 *
 * That is a wasted round trip when there is no photo, and it is worth it: the
 * household is being asked to admit a stranger, and a face is the whole basis
 * of that decision. Showing an icon when a photo existed is the expensive
 * mistake; one 404 against a gate's wifi is the cheap one.
 *
 * `expectPhoto` is how a caller with a long list opts out of that trade — see
 * `expectsPhoto` in `lib/status.ts`, which the log uses to keep a screen of
 * staff scans from firing twenty requests for photos nobody took.
 */
import React, { useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { IconTile } from '@/components/ui';
import { colors, radius } from '@/theme';
import * as api from '@/lib/api';
import { subjectIcon } from '@/lib/status';

export function SubjectPhoto({
  entryEventId,
  expectPhoto,
  subjectType,
  size = 54,
  bg,
  tint,
}: {
  entryEventId: string | null | undefined;
  /**
   * Whether it is worth asking. `undefined` means "ask" — no response ever
   * tells us, so the default is the optimistic one.
   */
  expectPhoto?: boolean;
  subjectType?: string | null;
  size?: number;
  /** So a fallback icon matches the tile the caller would have drawn itself. */
  bg?: string;
  tint?: string;
}) {
  const [failed, setFailed] = useState(false);

  const source =
    entryEventId && expectPhoto !== false && !failed
      ? api.entryPhotoSource(entryEventId)
      : undefined;

  if (!source) {
    return (
      <IconTile
        icon={subjectIcon(subjectType) as never}
        size={size}
        bg={bg ?? colors.primarySoft}
        tint={tint}
      />
    );
  }

  return (
    <Image
      source={source}
      onError={() => setFailed(true)}
      style={[styles.photo, { width: size, height: size }]}
    />
  );
}

const styles = StyleSheet.create({
  photo: { borderRadius: radius.md, backgroundColor: colors.neutralBg },
});
