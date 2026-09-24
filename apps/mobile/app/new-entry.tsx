/**
 * Guard raises a visitor or a delivery.
 *
 * Three things this screen refuses to let the guard skip:
 *   • the unit — an entry with no household is an entry nobody is accountable
 *     for, and the whole log is worth less for it
 *   • the photo — it is the household's only evidence of who asked to come in
 *   • the wait — once raised, the result screen is the pending card, which has
 *     no dismiss
 *
 * The delivery branch is resolved by the server, not here. The guard sends the
 * platform; the response either comes back auto-approved with an instruction
 * ("leave it at the gate"), or with a pending approval and a countdown. A rule
 * this app evaluated locally would be a rule a modified app could ignore, and
 * the guard's device is the least trusted in the system.
 *
 * The photo goes up inline, base64, in the same request as the entry. That is
 * the service's shape — there is no presigned upload — which is why the frame
 * is downscaled before it is encoded and why this call gets the long timeout.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Screen, TopBar } from '@/components/Screen';
import { ApprovalCard } from '@/components/ApprovalCard';
import { DoorPlate } from '@/components/building';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  IconTile,
  Loader,
  Note,
  SectionHeader,
} from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme';
import * as api from '@/lib/api';
import { idempotencyKey, keys, useMutation, useQuery } from '@/lib/api';
import { useGateContext } from '@/lib/auth';
import { directoryRefusal } from '@/lib/errors';
import { recordEntry } from '@/lib/gateSession';
import { entryOutcome, PLATFORMS } from '@/lib/status';
import type { EntryEventResult, Platform } from '@/types';

type Kind = 'VISITOR' | 'DELIVERY';

const DEBOUNCE_MS = 300;

/**
 * The longest edge the photo is allowed to have, in pixels.
 *
 * The camera's `quality` option compresses; it does not downscale. A phone
 * hands back the sensor's full frame — twelve megapixels is ordinary — and at
 * that size even a hard-compressed JPEG is most of a megabyte before base64
 * inflates it by a third. That body is what the service answered with `413
 * request entity too large`.
 *
 * 1024 is sized to what the photo is actually for: a face, shown to a resident
 * in a push notification and on an approval card, on a phone. It leaves a
 * frame of roughly 100–200KB, which is also the difference between the
 * household seeing that face in two seconds and in twenty on gate wifi.
 */
const MAX_EDGE = 1024;

/** Re-encode quality, applied once, after the downscale. */
const COMPRESSION = 0.5;

export default function NewEntry() {
  const context = useGateContext();
  const gateId = context.gateId;
  /* Arriving from the directory with a flat already chosen — the guard tapped a
     door there and should not have to find it again here. */
  const params = useLocalSearchParams<{ unitId?: string }>();

  const [kind, setKind] = useState<Kind>('VISITOR');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [unitId, setUnitId] = useState<string | null>(params.unitId ?? null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [platform, setPlatform] = useState<Platform | null>(null);
  /* Always JPEG: whatever the camera hands back is re-encoded on the way
     through `takePhoto`, so the mime type is not carried per-photo. */
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  /* The downscale is native work on a full-resolution frame and takes long
     enough to look like a dead shutter. The card says what is happening. */
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [raised, setRaised] = useState<EntryEventResult | null>(null);
  /**
   * Generated once per attempt, not per request.
   *
   * If the first POST times out on a bad gate connection and the guard presses
   * again, the same key goes up. The service does not act on it yet — see
   * `http.ts` — so today this is a discipline the client keeps and the server
   * has still to honour; it is kept because retrofitting keys after the fact,
   * to a screen that admits people, is not work anybody should be doing later.
   */
  const [attemptKey, setAttemptKey] = useState(() => idempotencyKey('entry'));

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const unitsQuery = useQuery(keys.gateDirectory(gateId, term), () =>
    api.getGateDirectory(gateId, term),
  );
  const refusal = directoryRefusal(unitsQuery.error);
  const units = unitsQuery.data ?? [];
  const matches = units.slice(0, 8);
  const unit = units.find((u) => u.unitId === unitId) ?? null;

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const shot = await ImagePicker.launchCameraAsync({
      /* Deliberately *not* asked for base64 here, and not hard-compressed
         here either. This frame is an intermediate on disk: the one that
         goes on the wire is re-encoded below, and squeezing it twice only
         spends detail. `quality` is the camera's compression, and it does
         not change the pixel dimensions — the downscale is what keeps the
         body under the service's limit. */
      quality: 0.7,
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.back,
    });
    const asset = shot.assets?.[0];
    if (shot.canceled || !asset) return;

    setPreparing(true);
    setPhotoError(null);
    try {
      /* Resize by whichever edge is the long one, so a portrait frame is
         bounded by its height rather than left at 1024×1365. Passing one
         dimension keeps the aspect ratio. An already-small frame is left
         alone: resizing up would cost bytes and add nothing. */
      const longest = Math.max(asset.width, asset.height);
      const context = ImageManipulator.manipulate(asset.uri);
      if (longest > MAX_EDGE) {
        context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
      }
      const rendered = await context.renderAsync();
      const out = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: COMPRESSION,
        base64: true,
      });
      if (!out.base64) throw new Error('no base64');
      setPhoto({ uri: out.uri, base64: out.base64 });
    } catch {
      /* The frame was taken and could not be prepared. Saying so is the whole
         job — the entry cannot be sent without a photo, and a guard staring at
         an empty card with someone at the barrier needs to know to try again
         rather than to wonder whether the button works. */
      setPhotoError('That photo could not be prepared. Take it again.');
    } finally {
      setPreparing(false);
    }
  };

  const ready =
    !!unitId &&
    !!photo &&
    !preparing &&
    (kind === 'DELIVERY' ? !!platform : name.trim().length > 1);

  const raise = useMutation(
    () =>
      api.createEntryEvent(
        gateId,
        {
          unitId: unitId!,
          visitorName:
            kind === 'DELIVERY'
              ? (PLATFORMS.find((p) => p.value === platform)?.label ?? 'Delivery')
              : name.trim(),
          visitorPhone: phone.trim() || null,
          subjectType: kind,
          platform: kind === 'DELIVERY' ? platform : null,
          /* The documented body wants the data URI, prefix included. JPEG is
             not a guess: `takePhoto` re-encodes every frame as one. */
          photoBase64: photo ? `data:image/jpeg;base64,${photo.base64}` : null,
          mimeType: photo ? 'image/jpeg' : null,
        },
        attemptKey,
      ),
    {
      invalidates: [keys.gatePending(gateId)],
      onSuccess: (result) => {
        setRaised(result);
        /* The only record of this event id the guard will get: there is no
           endpoint that lists a gate's entries, so without this the exit
           button has nothing to act on. See `lib/gateSession.ts`. */
        if (result.entryEvent) recordEntry(gateId, result.entryEvent);
        /* The next entry is a different person and must not reuse this key. */
        setAttemptKey(idempotencyKey('entry'));
      },
    },
  );

  /* Once raised, the screen becomes the outcome. Either a standing rule
     answered it and the guard has an instruction, or the household is being
     asked and the card counts down with no way to clear it. */
  if (raised) {
    const auto = raised.autoApproved;
    /* The sentence the guard acts on. The service stopped writing it; it is
       composed in one place from what the service *did* say — see
       `entryOutcome`. */
    const outcome = entryOutcome(raised);
    /* The card wants a door number and no response carries one. This screen is
       the one place that already knows which flat was chosen. */
    const approval = raised.approvalRequest
      ? {
          ...raised.approvalRequest,
          unitNumber: raised.approvalRequest.unitNumber ?? unit?.unitNumber ?? null,
        }
      : null;
    return (
      <>
        <TopBar title={outcome.status} back={false} />
        <Screen clearTabBar={false}>
          {auto ? (
            <Card>
              <View style={{ gap: spacing.md, alignItems: 'center' }}>
                <IconTile
                  icon="checkmark-circle-outline"
                  size={56}
                  bg={colors.successBg}
                  tint={colors.success}
                />
                <Text style={[type.h2, { color: colors.success, textAlign: 'center' }]}>
                  {outcome.title}
                </Text>
                <Text style={[type.body, { color: colors.text, textAlign: 'center' }]}>
                  {outcome.sentence}
                </Text>
                <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>
                  The household was not disturbed. It is in their log either way.
                </Text>
              </View>
            </Card>
          ) : approval ? (
            <>
              <ApprovalCard approval={approval} audience="guard" />
              <Note icon="hourglass-outline" tone="info" text={outcome.sentence} />
            </>
          ) : (
            <Card>
              <View style={{ gap: spacing.md, alignItems: 'center' }}>
                <IconTile icon="information-circle-outline" size={56} />
                <Text style={[type.body, { color: colors.text, textAlign: 'center' }]}>
                  {outcome.sentence}
                </Text>
              </View>
            </Card>
          )}

          <Button
            label="Back to the gate"
            variant="secondary"
            icon="arrow-back"
            onPress={() => router.replace('/guard')}
          />
        </Screen>
      </>
    );
  }

  return (
    <>
      <TopBar title="New entry" subtitle={context.label} />
      <Screen clearTabBar={false}>
        <View style={styles.chipRow}>
          <Chip
            label="Visitor"
            icon="person-add-outline"
            selected={kind === 'VISITOR'}
            onPress={() => setKind('VISITOR')}
          />
          <Chip
            label="Delivery"
            icon="cube-outline"
            selected={kind === 'DELIVERY'}
            onPress={() => setKind('DELIVERY')}
          />
        </View>

        <SectionHeader title="Which home" />
        <Field
          icon="search-outline"
          placeholder="Flat number or resident name"
          autoCorrect={false}
          autoCapitalize="none"
          value={search}
          onChangeText={setSearch}
        />
        {unitsQuery.loading ? <Loader label="Searching homes…" /> : null}
        {unitsQuery.error && !units.length ? (
          /* A refused directory is the one failure this screen cannot work
             around: the entry body needs the flat's `unitId`, and the search is
             the only route on this service that hands a guard one. So it is
             named for what it is rather than left as the server's sentence
             about permission scopes — see `directoryRefusal`. */
          refusal ? (
            <ErrorState title={refusal.title} message={refusal.message} />
          ) : (
            <ErrorState error={unitsQuery.error} onRetry={unitsQuery.refetch} />
          )
        ) : null}
        <View style={styles.chipRow}>
          {matches.map((u) => (
            <Chip
              key={u.unitId}
              label={u.unitNumber}
              selected={unitId === u.unitId}
              onPress={() => setUnitId(u.unitId)}
            />
          ))}
        </View>
        {unit ? (
          /* The chosen home, shown as the door it is. This is the field the
             screen refuses to let a guard skip, and a plate is harder to
             mis-read at a barrier than a flat number inside a sentence. */
          <View style={styles.doorRow}>
            <DoorPlate label={unit.unitNumber} />
            <Text style={[type.small, { color: colors.textMuted, flex: 1 }]} numberOfLines={2}>
              {unit.residents.map((r) => r.name).join(', ') || unit.buildingName || ''}
            </Text>
          </View>
        ) : null}

        {kind === 'DELIVERY' ? (
          <>
            <SectionHeader title="Which service" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.lg }}
            >
              {PLATFORMS.map((p) => (
                <Chip
                  key={p.value}
                  label={p.label}
                  icon={p.icon as never}
                  selected={platform === p.value}
                  onPress={() => setPlatform(p.value)}
                />
              ))}
            </ScrollView>
          </>
        ) : (
          <>
            <SectionHeader title="Who is it" />
            <Field
              label="Name"
              icon="person-outline"
              placeholder="As they give it"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          </>
        )}

        {/* Sent for both kinds. It is the household's way to check a story and
            the office's way to trace a parcel, and it is the only field on this
            screen the service keeps that the guard can get from the person
            standing in front of them. */}
        <Field
          label="Their number"
          hint="Optional. Goes to the household with the request."
          icon="call-outline"
          placeholder="98765 43210"
          keyboardType="phone-pad"
          autoCorrect={false}
          maxLength={16}
          value={phone}
          onChangeText={setPhone}
        />

        <SectionHeader title="Photo" />
        <Pressable onPress={takePhoto} disabled={preparing}>
          {preparing ? (
            <Card>
              <Loader label="Preparing the photo…" />
            </Card>
          ) : photo ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photo.uri }} style={styles.photo} />
              <View style={styles.retake}>
                <Ionicons name="camera-reverse-outline" size={16} color={colors.onPrimary} />
                <Text style={[type.smallMed, { color: colors.onPrimary }]}>Retake</Text>
              </View>
            </View>
          ) : (
            <Card>
              <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md }}>
                <IconTile icon="camera-outline" size={52} />
                <Text style={[type.bodyMed, { color: colors.text }]}>Photograph them</Text>
                <Text style={[type.small, { color: colors.textMuted, textAlign: 'center' }]}>
                  Required. The household decides on a face, not on a name.
                </Text>
              </View>
            </Card>
          )}
        </Pressable>

        {photoError ? <Note icon="alert-circle-outline" tone="danger" text={photoError} /> : null}

        <Button
          label={
            raise.loading
              ? 'Sending…'
              : kind === 'DELIVERY'
                ? 'Check the rule'
                : 'Ask the resident'
          }
          icon="paper-plane-outline"
          loading={raise.loading}
          disabled={!ready || raise.loading}
          onPress={() => raise.mutate()}
        />

        {!ready ? (
          <Text style={[type.small, { color: colors.textFaint, textAlign: 'center' }]}>
            {!unitId
              ? 'Pick the home first.'
              : kind === 'DELIVERY' && !platform
                ? 'Pick the service.'
                : kind === 'VISITOR' && name.trim().length <= 1
                  ? 'Enter their name.'
                  : preparing
                    ? 'One moment — the photo is still being prepared.'
                    : 'A photo is required before this can be sent.'}
          </Text>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  doorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoWrap: { borderRadius: radius.xl, overflow: 'hidden' },
  photo: { width: '100%', height: 240, backgroundColor: colors.neutralBg },
  retake: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay,
  },
});
