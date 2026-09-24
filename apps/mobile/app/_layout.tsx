import React, { useCallback } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import { Ambience } from '@/components/Ambience';
import { AuthProvider } from '@/lib/auth';
import { Push } from '@/components/Push';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });

  const onReady = useCallback(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  /* A font error is not fatal — the system face is a worse-looking app, not a
     broken one — so the layout renders either way and only a still-pending
     load holds the splash. */
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onReady}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/* The society, painted once at the root: the sky at whatever hour it
            is, and the rooftops along the bottom. Every glass surface in the
            app is semi-transparent, so this is not a backdrop behind the UI —
            it is what the UI is made of. Mounted outside the navigator so a
            screen push does not restart the sunrise. */}
        <View style={{ flex: 1 }}>
          <Ambience />
          {/* The session lives above the navigator because the active context
              decides which of the three shells the router is even allowed to
              show — see `app/index.tsx`. */}
          <AuthProvider>
            {/* FCM. Inside the provider because it needs the session, and
                inside the navigator because a tapped notification has to have
                somewhere to go — see `components/Push.tsx`. */}
            <Push />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'transparent' },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              {/* No swipe back and no header: while `mustChangePassword` is
                  set this is the only screen the front door will route to, and
                  a gesture that slips behind it would land on a shell whose
                  every request the service may refuse. */}
              <Stack.Screen name="change-password" options={{ gestureEnabled: false }} />
              <Stack.Screen name="resident" />
              <Stack.Screen name="guard" />
              <Stack.Screen name="admin" />
            </Stack>
          </AuthProvider>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
