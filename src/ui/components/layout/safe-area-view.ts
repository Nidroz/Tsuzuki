import { cssInterop } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';

// the safe area view is not a react native core component: nativewind styles it once registered.
// registered once here for every primitive that uses it (Screen, Sheet)
cssInterop(SafeAreaView, { className: 'style' });

export { SafeAreaView };
export type { Edge } from 'react-native-safe-area-context';
