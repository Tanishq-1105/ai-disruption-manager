import { useFonts, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';

export function useAppFonts() {
  return useFonts({ SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });
}
