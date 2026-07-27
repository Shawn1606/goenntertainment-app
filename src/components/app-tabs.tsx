import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { useResolvedScheme } from '@/lib/theme-preference';

export default function AppTabs() {
  const scheme = useResolvedScheme();
  const colors = Colors[scheme];
  const { user } = useAuth();

  return (
    <NativeTabs
      backgroundColor={colors.background}
      tintColor={colors.tint}
      iconColor={{ default: colors.textSecondary, selected: colors.tint }}
      indicatorColor={colors.backgroundElement}
      labelStyle={{
        default: { color: colors.textSecondary },
        selected: { color: colors.tint },
      }}>
      <NativeTabs.Trigger name="index">
        <Label>Home</Label>
        <Icon src={require('@/assets/images/tabIcons/home.png')} selectedColor={colors.tint} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="map">
        <Label>Map</Label>
        <Icon src={require('@/assets/images/tabIcons/map.png')} selectedColor={colors.tint} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="my-activities">
        <Label>Aktivitäten</Label>
        {/* iOS: SF-Symbol (Listen-/Verlaufs-Optik), Android: vorhandenes PNG. */}
        <Icon
          sf="list.bullet.rectangle"
          androidSrc={require('@/assets/images/tabIcons/home.png')}
          selectedColor={colors.tint}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <Label>Einstellungen</Label>
        {/* iOS zeigt das SF-Symbol, Android das vorhandene PNG. */}
        <Icon
          sf="gearshape.fill"
          androidSrc={require('@/assets/images/tabIcons/explore.png')}
          selectedColor={colors.tint}
        />
      </NativeTabs.Trigger>

      {/* Nur für Admins sichtbar. Route + Backend prüfen zusätzlich (Defense in depth). */}
      {user?.is_admin ? (
        <NativeTabs.Trigger name="admin-panel">
          <Label>Admin</Label>
          <Icon
            sf="chart.bar.fill"
            androidSrc={require('@/assets/images/tabIcons/explore.png')}
            selectedColor={colors.tint}
          />
        </NativeTabs.Trigger>
      ) : null}
    </NativeTabs>
  );
}
