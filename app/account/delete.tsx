import { DeleteAccountScreen } from '@features/settings/DeleteAccountScreen';

// reads no param: a link to this route opens the screen at most, never deletes (ADR-0018)
export default function DeleteAccountRoute() {
  return <DeleteAccountScreen />;
}
