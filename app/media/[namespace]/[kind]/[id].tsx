import { MediaDetailScreen } from '@features/media-detail/MediaDetailScreen';
import { useLocalSearchParams } from 'expo-router';

// the raw params go to the screen, which parses them: they may come from a deep link
export default function MediaDetailRoute() {
  const params = useLocalSearchParams();
  return <MediaDetailScreen params={params} />;
}
