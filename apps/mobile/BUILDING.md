# Building Iverto Gate for Android

The Android project is checked in (bare workflow, per §2 of
`gate-management-architecture.md`), so every build here is a local Gradle build.
No Expo account, no EAS, no cloud queue, no network beyond dependency download.

There are four artifacts you can produce, and they differ only in *which key
signs them* and *what container they ship in*:

| Artifact | Command | Key | Installable? | Uploadable to Play? |
|---|---|---|---|---|
| Debug APK | `gradlew assembleDebug` | debug key (checked in) | yes | no |
| Release APK, no keystore | `gradlew assembleRelease` | debug key (fallback) | yes | no |
| **Signed release APK** | `gradlew assembleRelease` | your release key | yes | no — Play wants an AAB |
| **Signed release AAB** | `gradlew bundleRelease` | your release key | no — see §9 | yes |

Every Android artifact is signed by *something*. There is no such thing as
shipping an unsigned APK — Android refuses to install one
(`INSTALL_PARSE_FAILED_NO_CERTIFICATES`). "Signing a release" therefore means
*swapping the throwaway debug key for a key you control and never lose*, which
is what §5 onward is about.

---

## 1. Prerequisites

| Need | Version | Check |
|---|---|---|
| JDK | 17 | `java -version` |
| Android SDK platform | 36 | `%ANDROID_HOME%\platforms\android-36` |
| Build tools | 36.0.0 | `%ANDROID_HOME%\build-tools\36.0.0` |
| NDK + CMake | installed via SDK manager | `%ANDROID_HOME%\ndk`, `%ANDROID_HOME%\cmake` |
| Node modules | — | `npm install` in `apps/mobile` |

The native toolchain is not optional: React Native 0.81 on the new architecture
compiles C++ per ABI. This project builds `armeabi-v7a` and `arm64-v8a` only
(`reactNativeArchitectures` in `android/gradle.properties`) — x86 emulator
images will not run these builds.

Point Gradle at the SDK one of two ways:

```bash
# either an environment variable
export ANDROID_HOME=/c/Users/you/AppData/Local/Android/Sdk

# or android/local.properties (not committed)
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

`JAVA_HOME` must point at the JDK 17 install even if a different `java` comes
first on your `PATH` — the Gradle wrapper reads `JAVA_HOME`, not `PATH`. That
is the usual explanation for `Unsupported class file major version`.

On Windows run `.\gradlew.bat` from PowerShell. The examples below write
`./gradlew`; substitute as needed. All of them run from `apps/mobile/android`.

---

## 2. Debug APK

```bash
cd android
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Signed with `android/app/debug.keystore` — a key that ships with the repo, whose
password is literally `android` and whose alias is `androiddebugkey`. Everyone
who has ever built an Android app holds the same key. That is the point: it
makes the APK installable and nothing else.

A debug APK expects Metro and loads its JS bundle over the network. For
day-to-day work you want `npx expo run:android` (from `apps/mobile`), which
builds this same APK, installs it, and starts Metro for you. Use
`assembleDebug` on its own only when you want the file.

---

## 3. Release APK

```bash
cd android
./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

Release differs from debug in three ways that matter: the JS bundle is compiled
in (no Metro needed), Hermes bytecode is precompiled, and the release signing
config applies.

**With no keystore configured this build still succeeds** — `app/build.gradle`
falls back to the debug key when `android/keystore.properties` is absent, so a
fresh clone still produces a running APK. It just produces one nobody can ship.
To find out which key you actually got, verify it (§7): a debug-key APK's
certificate says `CN=Android Debug`.

Two things are compiled in that you cannot change afterwards:

- **The API URL.** `EXPO_PUBLIC_API_URL` from the build environment if set,
  otherwise `expo.extra.apiUrl` from `app.json`. Check which one you are
  shipping before you ship it.
- **R8 / minification**, currently off
  (`android.enableMinifyInReleaseBuilds=false` in `gradle.properties`). Turning
  it on shrinks the APK substantially and needs the proguard rules reviewed
  first.

---

## 4. Release AAB

```bash
cd android
./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

An **Android App Bundle** is not an app — it is the *publishing format*. It
carries every ABI, density and language in one file and hands Play the job of
generating per-device APKs. Each user downloads only the slice that fits their
phone, which is why the AAB on disk is larger than the APK while the install is
smaller.

Consequences worth knowing before you pick a format:

- **Play requires an AAB** for new apps and updates. `assembleRelease` output is
  not accepted.
- **An AAB cannot be installed with `adb install`.** To test one on a device you
  generate APKs from it first — §9.
- **Sideloading, internal QA and direct download want the APK.** For the pilot,
  the APK is the artifact that actually goes on phones.

Build both in one invocation:

```bash
./gradlew assembleRelease bundleRelease
```

> **Do not add `clean` to that line.** `clean` deletes the library modules'
> codegen output, and `:app:externalNativeBuildCleanRelease` then re-runs CMake
> against directories that no longer exist:
> `add_subdirectory given source .../react-native-gesture-handler/android/build/generated/source/codegen/jni/ which is not an existing directory`.
> If you need a clean build, delete `android/app/build` and `android/app/.cxx`
> by hand, or run `./gradlew clean` on its own and then build in a *second*
> invocation.

---

## 5. Creating a keystore

A keystore is an encrypted file holding one or more key pairs. Android signs
your APK/AAB with the private key and embeds the matching certificate in it.
Android's update rule is simple and unforgiving: **an update must be signed by
the same key as the install it replaces.** A different key is a different app.

Create one with `keytool`, which ships with the JDK:

```bash
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore iverto-gate-release.keystore \
  -alias iverto-gate \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

| Flag | Why this value |
|---|---|
| `-genkeypair` | generates a private key plus a self-signed certificate |
| `-storetype PKCS12` | the standard format; JKS is legacy and `keytool` nags about it |
| `-keystore` | the file to create |
| `-alias` | names the key *inside* the store — you need it again in `keystore.properties` |
| `-keyalg RSA -keysize 2048` | what Play accepts; 2048 is the floor |
| `-validity 10000` | ~27 years. **Play requires validity past 22 Oct 2033**, and an expired key means you can never update the app again. Do not shorten this. |

It prompts for a store password, then the certificate fields (name, org, city,
state, two-letter country), then asks you to confirm. The distinguished name is
cosmetic — nobody validates it — but it is what shows up whenever anyone
inspects your signature, so use the real organisation.

Non-interactively, for CI or for scripting a re-issue:

```bash
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore iverto-gate-release.keystore \
  -alias iverto-gate \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "your-store-password" \
  -keypass "your-key-password" \
  -dname "CN=Iverto.ai Gate, OU=Engineering, O=Iverto.ai, L=Bengaluru, ST=Karnataka, C=IN"
```

With PKCS12 the store password and the key password must match; `keytool` will
say so if they differ.

### Where it goes, and the rules around it

This project keeps it at `android/app/iverto-gate-release.keystore`, and
`android/.gitignore` excludes `app/*.keystore` with an explicit exception for
`debug.keystore`. Three rules:

1. **Never commit the keystore, and never commit its password.** Both are
   already excluded here — `keystore.properties` and `app/*.keystore`. Confirm
   with `git status` after creating one.
2. **Back it up somewhere that survives this laptop.** A password manager or the
   company secret store, not a Slack DM. Losing the keystore means losing the
   ability to update the app under that identity, and there is no recovery path
   outside Play App Signing (§10).
3. **`npx expo prebuild --clean` deletes `android/` and everything in it.** If
   you regenerate the native project, move the keystore out first — or keep it
   outside the repo entirely and point `storeFile` at an absolute path.

### The key this project already uses

A keystore already exists here, so you do not need to create one to build the
pilot. You need §5 when the key has to be re-issued or handed over.

```
File     android/app/iverto-gate-release.keystore
Alias    iverto-gate
Owner    CN=Iverto.ai Gate, OU=Engineering, O=Iverto.ai, L=Bengaluru, ST=Karnataka, C=IN
Valid    28 Aug 2026 → 13 Jan 2054
SHA-256  E5:EC:7F:F0:3C:1D:A7:D7:C7:E1:A6:D2:29:6C:1F:31:03:A0:9B:8B:A0:E2:07:25:B7:69:ED:0C:C4:17:98:49
SHA-1    10:71:28:47:B7:B9:1B:7C:07:74:4D:C7:E5:C7:8D:78:C6:7B:F4:28
```

Any build claiming to be an Iverto Gate release should print that SHA-256 when
verified (§7). If it prints anything else, it was signed by the wrong key.

---

## 6. Wiring the keystore into the build

Two files. Both already exist in this project; here is what they hold and why.

**`android/keystore.properties`** — the credentials, uncommitted:

```properties
storeFile=iverto-gate-release.keystore
storePassword=your-store-password
keyAlias=iverto-gate
keyPassword=your-key-password
```

`storeFile` resolves relative to `android/app/`, because it is handed to
`file()` inside the `app` module. An absolute path works too, and is the right
answer when the keystore lives outside the repo.

**`android/app/build.gradle`** — reads that file, falls back to debug:

```gradle
signingConfigs {
    release {
        def props = new Properties()
        def propsFile = rootProject.file('keystore.properties')
        if (propsFile.exists()) {
            propsFile.withInputStream { props.load(it) }
            storeFile file(props['storeFile'])
            storePassword props['storePassword']
            keyAlias props['keyAlias']
            keyPassword props['keyPassword']
        } else {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        // …
    }
}
```

The indirection is the whole point: the password never enters `build.gradle`, so
it never enters git and never ends up compiled into anything that gets shared.
CI reads the same `keystore.properties` — it just writes the file from a secret
first (§12), so nothing about the build itself changes between a laptop and a
runner.

**With those two in place, the commands in §3 and §4 produce signed artifacts.
There is no separate signing step and no extra flag:**

```bash
cd android
./gradlew assembleRelease bundleRelease
# → app/build/outputs/apk/release/app-release.apk       (signed)
# → app/build/outputs/bundle/release/app-release.aab    (signed)
```

Gradle also zipaligns the APK and applies APK Signature Scheme v2 for you.
Nothing needs to be run over the output. (v1 JAR signing is off, which is
correct — `minSdkVersion` is 24 and v1 is only needed below API 24.)

---

## 7. Verifying what signed a build

Never assume. The failure mode — shipping a debug-key APK because
`keystore.properties` was missing — produces a perfectly working install and
stays invisible until Play rejects it or an update refuses to install.

**APK:**

```bash
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs --verbose \
  app/build/outputs/apk/release/app-release.apk
```

Read `Signer #1 certificate DN:` — it should name your organisation, not
`CN=Android Debug, OU=Android, O=Android, L=Mountain View, ST=California, C=US`
— and check `Signer #1 certificate SHA-256 digest:` against the fingerprint in
§5. Confirm `Verified using v2 scheme (APK Signature Scheme v2): true` while you
are there; `v1 scheme … false` is expected and fine at `minSdkVersion` 24.

The current release APK verifies as:

```
Verified using v2 scheme (APK Signature Scheme v2): true
Signer #1 certificate DN: CN=Iverto.ai Gate, OU=Engineering, O=Iverto.ai, L=Bengaluru, ST=Karnataka, C=IN
Signer #1 certificate SHA-256 digest: e5ec7ff03c1da7d7c7e1a6d2296c1f3103a09b8ba0e20725b769ed0cc4179849
```

**AAB** — `apksigner` does not read bundles; an AAB is jar-signed:

```bash
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
```

Or, for full verification rather than just the certificate:

```bash
jarsigner -verify -verbose:summary -certs \
  app/build/outputs/bundle/release/app-release.aab
```

**A keystore's own fingerprint**, to compare against, without building anything:

```bash
keytool -list -v -keystore android/app/iverto-gate-release.keystore -alias iverto-gate
```

---

## 8. Signing an artifact you already have

You do not need this for a Gradle build — §6 covers that. It applies when an
artifact arrives unsigned, or was signed with the wrong key and has to be
re-signed.

**APK.** Align first, then sign. The order matters: `apksigner` refuses to sign
a misaligned APK, and aligning after signing breaks the signature.

```bash
BT="$ANDROID_HOME/build-tools/36.0.0"

"$BT/zipalign" -v -p 4 app-unsigned.apk app-aligned.apk

"$BT/apksigner" sign \
  --ks android/app/iverto-gate-release.keystore \
  --ks-key-alias iverto-gate \
  --out app-release-signed.apk \
  app-aligned.apk

"$BT/apksigner" verify --print-certs app-release-signed.apk
```

Omit `--ks-pass` / `--key-pass` and it prompts, which keeps the password out of
your shell history. For CI: `--ks-pass env:KEYSTORE_PASSWORD`.

To re-sign an already-signed APK, strip `META-INF/*.RSA`, `*.SF` and `*.MF`
from the zip first — `apksigner` will not overwrite an existing v1 signature.

**AAB.** `apksigner` does not handle bundles; use `jarsigner`:

```bash
jarsigner -verbose \
  -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore android/app/iverto-gate-release.keystore \
  app-release.aab iverto-gate
```

The alias goes last, as a bare argument.

---

## 9. Testing an AAB before uploading it

An AAB is not installable. To get one onto a real device, generate an APK set
from it with **bundletool** — download `bundletool-all-<version>.jar` from
<https://github.com/google/bundletool/releases>. It is not part of the SDK.

**Device-specific set, installed straight onto a connected phone:**

```bash
java -jar bundletool.jar build-apks \
  --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=gate.apks \
  --ks=android/app/iverto-gate-release.keystore \
  --ks-key-alias=iverto-gate \
  --connected-device

java -jar bundletool.jar install-apks --apks=gate.apks
```

**Universal APK** — one fat APK carrying every ABI, for passing around:

```bash
java -jar bundletool.jar build-apks \
  --bundle=app-release.aab \
  --output=gate-universal.apks \
  --mode=universal \
  --ks=android/app/iverto-gate-release.keystore \
  --ks-key-alias=iverto-gate

unzip -p gate-universal.apks universal.apk > gate-universal.apk
adb install -r gate-universal.apk
```

A `.apks` file is just a zip. This is also how you find out what Play will
actually serve: `bundletool get-size total --apks=gate.apks` prints the download
size per device configuration, which is the number that matters — not the AAB's
size on disk.

---

## 10. Play App Signing

When you upload to Play, Google offers — and for new apps requires — to hold the
**app signing key** itself. Your keystore then becomes the **upload key**:

- You sign the AAB with your upload key.
- Play verifies it came from you, strips your signature, and re-signs with the
  app signing key it holds before serving anything.
- Users' devices only ever see Google's signature.

Which changes the stakes considerably:

- **Lose the upload key** → request a reset in Play Console, register a new one,
  carry on. Recoverable.
- **Lose the app signing key while not enrolled** → the app is dead. You cannot
  update it, ever. A new listing under a new package name is the only path, and
  every existing install is stranded.

Enrol. The keystore in §5 is then an upload key, and the fingerprint your users'
devices report will be Google's, not the one printed above — which matters the
moment you register SHA-256 fingerprints for Firebase, Maps, or an OAuth client.
Take those from **Play Console → Setup → App integrity**, not from your local
keystore.

---

## 11. Version numbers

Two fields, and Play treats them very differently:

| Field | Where | Rule |
|---|---|---|
| `versionCode` | `app.json` → `expo.android.versionCode` | integer, **must increase** on every upload; users never see it |
| `versionName` | `app.json` → `expo.version` | the string humans see (`0.1.0`); no constraint |

Both currently read `3` and `0.3.0`, and both are mirrored into
`android/app/build.gradle`. Because the native project is checked in, editing
`app.json` alone does not change a Gradle build — either edit
`android/app/build.gradle` as well, or re-run `npx expo prebuild` to regenerate
(which rewrites `android/`, so re-read the warning in §5 first).

Play rejects any upload whose `versionCode` is not greater than everything
previously uploaded to that track, including artifacts you later deactivated.

---

## 12. Building in CI

Do not commit the keystore. Base64 it into a secret, decode it at build time,
and write `keystore.properties` from environment variables — the build then
reads exactly what it reads locally.

```bash
# once, locally, to produce the secret value
base64 -w0 android/app/iverto-gate-release.keystore > keystore.b64
```

```yaml
# GitHub Actions
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: '17' }

- name: Restore signing material
  run: |
    echo "${{ secrets.RELEASE_KEYSTORE_B64 }}" | base64 -d \
      > apps/mobile/android/app/iverto-gate-release.keystore
    printf '%s\n' \
      'storeFile=iverto-gate-release.keystore' \
      'storePassword=${{ secrets.RELEASE_STORE_PASSWORD }}' \
      'keyAlias=iverto-gate' \
      'keyPassword=${{ secrets.RELEASE_KEY_PASSWORD }}' \
      > apps/mobile/android/keystore.properties

- name: Build
  working-directory: apps/mobile/android
  run: ./gradlew assembleRelease bundleRelease
  env:
    EXPO_PUBLIC_API_URL: ${{ vars.API_URL }}
```

Delete both files in a final `always()` step if the runner is not ephemeral, and
never `cat` the properties file into a log.

---

## 13. Installing and distributing

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

`-r` reinstalls over an existing copy — but only when the signature matches.
Going from a debug-key build to a signed one on the same device fails with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`; uninstall first (`adb uninstall
com.iverto.gate`), which also wipes the app's stored session tokens.

For pilot distribution, rename the artifact so the version is legible on
someone's phone before they tap it:

```bash
cp app/build/outputs/apk/release/app-release.apk ../../../iverto-gate-v0.1.0.apk
```

---

## 14. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `INSTALL_PARSE_FAILED_NO_CERTIFICATES` | the APK is genuinely unsigned | sign it (§8) |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | installed copy signed with a different key | `adb uninstall com.iverto.gate` first |
| `Keystore was tampered with, or password was incorrect` | wrong `storePassword`, or a JKS/PKCS12 mismatch | re-check `keystore.properties`; PKCS12 wants store and key passwords equal |
| `Failed to read key <alias> from store` | that alias is not in the keystore | `keytool -list -keystore <file>` to see the real alias |
| Certificate DN reads `CN=Android Debug` | `keystore.properties` missing or unreadable | it belongs in `android/`, not `android/app/` — check the path and filename |
| `add_subdirectory given source … which is not an existing directory` | `clean` ran in the same invocation as the build | see the warning in §4 |
| `SDK location not found` | no `ANDROID_HOME`, no `local.properties` | §1 |
| `Unsupported class file major version` | Gradle picked a JDK other than 17 | set `JAVA_HOME`; `PATH` is not consulted |
| Play: "signed with the wrong key" | signed with something other than the registered upload key | verify per §7, compare against Play Console → App integrity |
| Play: "You uploaded an APK" | `assembleRelease` output instead of `bundleRelease` | upload the `.aab` |
| Play: "Version code 1 has already been used" | `versionCode` not incremented | §11 |

---

## Appendix — command reference

```bash
cd apps/mobile/android

./gradlew assembleDebug                     # debug APK, debug key
./gradlew assembleRelease                   # release APK, release key
./gradlew bundleRelease                     # release AAB, release key
./gradlew assembleRelease bundleRelease     # both
./gradlew tasks --group build               # everything available

# create a keystore
keytool -genkeypair -v -storetype PKCS12 \
  -keystore app/iverto-gate-release.keystore \
  -alias iverto-gate -keyalg RSA -keysize 2048 -validity 10000

# inspect a keystore
keytool -list -v -keystore app/iverto-gate-release.keystore

# verify an APK, and an AAB
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --print-certs app-release.apk
keytool -printcert -jarfile app-release.aab

# install
adb install -r app/build/outputs/apk/release/app-release.apk
```

Outputs:

```
android/app/build/outputs/apk/debug/app-debug.apk
android/app/build/outputs/apk/release/app-release.apk
android/app/build/outputs/bundle/release/app-release.aab
android/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip
```

That last one is the native symbol file. Upload it alongside the AAB so Play can
symbolicate native crash reports — without it, an NDK stack trace is addresses.
