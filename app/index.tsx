import { StyleSheet, View } from 'react-native';

// temporary blank home screen, replaced by the tabs shell in F-07
export default function IndexScreen() {
  return <View testID="home-screen" collapsable={false} style={styles.screen} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
