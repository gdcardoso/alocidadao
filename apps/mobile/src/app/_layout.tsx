import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Alô Cidadão' }} />
        <Stack.Screen name="laboratorio/index" options={{ title: 'Laboratório' }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
