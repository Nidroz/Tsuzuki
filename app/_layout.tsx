import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// the header is hidden so no untranslated title is shown before i18n lands (F-06)
const screenOptions = { headerShown: false } as const;

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={screenOptions} />
      <StatusBar style="auto" />
    </>
  );
}
