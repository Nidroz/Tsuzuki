import { useTranslation, type Translation } from '@core/i18n/index';
import { TabBarIcon, type TabIconName } from '@ui/index';
import { Tabs, type BottomTabNavigationOptions } from 'expo-router/js-tabs';
import { useMemo } from 'react';

interface Tab {
  /** the route file in app/(tabs)/ */
  name: string;
  /** the meaning of the tab: its icon, translation key and test id */
  id: TabIconName;
}

// the order of the tab bar. discover is the index route, the path /
const TABS: readonly Tab[] = [
  { name: 'index', id: 'discover' },
  { name: 'search', id: 'search' },
  { name: 'library', id: 'library' },
  { name: 'favorites', id: 'favorites' },
  { name: 'settings', id: 'settings' },
];

const tabOptions = (id: TabIconName, t: Translation['t']): BottomTabNavigationOptions => {
  const title = t(`tabs.${id}`);
  return {
    title,
    tabBarLabel: title,
    tabBarButtonTestID: `tab-${id}`,
    tabBarIcon: ({ focused }) => <TabBarIcon icon={id} focused={focused} />,
  };
};

export default function TabsLayout() {
  const { t } = useTranslation();
  const screens = useMemo(
    () => TABS.map(({ name, id }) => ({ name, options: tabOptions(id, t) })),
    [t],
  );

  return (
    <Tabs>
      {screens.map(({ name, options }) => (
        <Tabs.Screen key={name} name={name} options={options} />
      ))}
    </Tabs>
  );
}
