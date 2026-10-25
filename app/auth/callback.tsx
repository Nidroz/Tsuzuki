import { EmailConfirmedScreen } from '@features/auth/EmailConfirmedScreen';
import { useLocalSearchParams } from 'expo-router';

// the confirmation email link (tsuzuki://auth/callback): the raw params go to the screen, which
// parses them and writes nothing until the user taps Continue (ADR-0014)
export default function EmailCallbackRoute() {
  const params = useLocalSearchParams();
  return <EmailConfirmedScreen params={params} />;
}
