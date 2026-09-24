/**
 * The mandatory first-login reset.
 *
 * The society office onboards a resident with a temporary password built from
 * their phone number, and the account comes back from sign-in carrying
 * `mustChangePassword`. Until that is cleared this is the only screen the
 * router will show — not because the app is being strict for its own sake, but
 * because a password anybody who knows your phone number can guess is a
 * password that can approve a stranger at your gate.
 *
 * There is no "skip", and no back gesture out of it. The only other way off
 * this screen is signing out.
 */
import React, { useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  type TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BrandLockup } from '@/components/Logo';
import { Button, Card, Field, Note } from '@/components/ui';
import { Appear, Stagger, useShake } from '@/components/motion';
import { KeyboardAwareScroll } from '@/components/KeyboardAware';
import { colors, spacing, type } from '@/theme';
import { useAuth } from '@/lib/auth';
import { errorCopy } from '@/lib/errors';

/** Eight characters is the floor; everything above it is advice, not a gate. */
const MIN_LENGTH = 8;

export default function ChangePassword() {
  const { user, completePasswordChange, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<TextInput>(null);
  const shake = useShake(error);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= MIN_LENGTH && confirm === password;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await completePasswordChange(password);
      router.replace('/');
    } catch (e) {
      setError(errorCopy(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <KeyboardAwareScroll extraBottomSpace={spacing.xxl}>
          <View style={styles.body}>
            <Stagger>
              <Appear distance={12}>
                <BrandLockup size={30} layout="row" style={styles.lockup} />
              </Appear>

              <Animated.View style={shake}>
                <Card>
                  <View style={{ gap: spacing.lg }}>
                    <View>
                      <Text style={[type.h2, { color: colors.text }]}>Choose a password</Text>
                      <Text style={[type.small, { color: colors.textMuted, marginTop: 4 }]}>
                        {user?.name ? `${user.name}, your` : 'Your'} account is still on the
                        temporary password the society office issued. Replace it before going in.
                      </Text>
                    </View>

                    <View>
                      <Field
                        label="New password"
                        icon="lock-closed-outline"
                        placeholder="At least 8 characters"
                        secureTextEntry={!reveal}
                        autoComplete="new-password"
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={password}
                        onChangeText={setPassword}
                        returnKeyType="next"
                        onSubmitEditing={() => confirmRef.current?.focus()}
                        hint={tooShort ? `${MIN_LENGTH - password.length} more to go.` : undefined}
                      />
                      <Pressable
                        onPress={() => setReveal((v) => !v)}
                        hitSlop={10}
                        style={styles.revealRow}
                      >
                        <Ionicons
                          name={reveal ? 'eye-off-outline' : 'eye-outline'}
                          size={14}
                          color={colors.primary}
                        />
                        <Text style={[type.smallMed, { color: colors.primary }]}>
                          {reveal ? 'Hide' : 'Show'}
                        </Text>
                      </Pressable>
                    </View>

                    <Field
                      label="Type it again"
                      icon="checkmark-circle-outline"
                      placeholder="Confirm"
                      secureTextEntry={!reveal}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={confirm}
                      onChangeText={setConfirm}
                      inputRef={confirmRef}
                      returnKeyType="go"
                      onSubmitEditing={submit}
                      hint={mismatch ? 'These two do not match yet.' : undefined}
                    />

                    {error ? (
                      <Note icon="alert-circle-outline" tone="danger" text={error} />
                    ) : null}

                    <Button
                      label="Save and continue"
                      icon="arrow-forward"
                      loading={busy}
                      disabled={!ready || busy}
                      onPress={submit}
                    />
                  </View>
                </Card>
              </Animated.View>

              <Note
                icon="shield-checkmark-outline"
                tone="brand"
                text="This password approves visitors at your gate. Pick one nobody who knows your phone number could guess."
              />

              <Pressable
                onPress={async () => {
                  await signOut();
                  router.replace('/login');
                }}
                hitSlop={8}
                style={styles.signOutRow}
              >
                <Ionicons name="log-out-outline" size={14} color={colors.textMuted} />
                <Text style={[type.smallMed, { color: colors.textMuted }]}>
                  Sign in as someone else
                </Text>
              </Pressable>
            </Stagger>
          </View>
        </KeyboardAwareScroll>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  body: { padding: spacing.lg, paddingTop: spacing.xxl, gap: spacing.xl },
  lockup: { alignSelf: 'center' },
  revealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    paddingTop: spacing.xs,
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
