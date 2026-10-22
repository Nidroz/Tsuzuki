import { ResetPasswordScreen } from '@features/auth/ResetPasswordScreen';
import { useLocalSearchParams } from 'expo-router';

// the recovery email link (tsuzuki://auth/reset-password): the raw params go to the screen, which
// parses them and writes nothing until a valid new password is submitted (ADR-0014)
export default function ResetPasswordRoute() {
  const params = useLocalSearchParams();
  return <ResetPasswordScreen params={params} />;
}
