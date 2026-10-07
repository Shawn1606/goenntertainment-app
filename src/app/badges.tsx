import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Mascot, MascotError } from '@/components/mascot';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatDay } from '@/domain/date-format';
import { isUiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Badge } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * Abzeichen: Meilensteine mit Datum – erster Stempel, volle Karte, fünf
 * Partner, ein Jahr dabei …
 *
 * Gerechnet wird auf dem Server aus dem, was es ohnehin gibt
 * (api/app/Support/Badges.php); hier wird nur gezeigt. Verdiente stehen oben,
 * die neuesten zuerst, darunter die offenen mit Fortschritt.
 */
export default function BadgesScreen() {
  const colors = useTheme();
  const { token } = useAuth();
  const [badges, setBadges] = useState<Badge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setBadges((await api.badges(token)).data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Die Abzeichen konnten nicht geladen werden.'));
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const earned = badges?.filter((b) => b.earned) ?? [];
  const open = badges?.filter((b) => !b.earned) ?? [];

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Abzeichen' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.tint}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }>
        {error && !badges ? <MascotError detail={error} onRetry={() => void load()} /> : null}

        {badges ? (
          <Card tone="night" style={styles.hero}>
            <Mascot mood={earned.length > 0 ? 'cheer' : 'happy'} size={72} lively />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.heroValue}>
                {earned.length} von {badges.length}
              </Text>
              <Text style={styles.heroText}>
                {earned.length === 0 ? 'Dein erstes Abzeichen wartet – ein Check-in beim Partner reicht.' : 'Abzeichen gesammelt. Weiter so!'}
              </Text>
            </View>
          </Card>
        ) : null}

        {earned.length > 0 ? <Text style={[styles.section, { color: colors.text }]}>Verdient</Text> : null}
        <View style={styles.grid}>
          {earned.map((b) => (
            <BadgeTile key={b.key} badge={b} />
          ))}
        </View>

        {open.length > 0 ? <Text style={[styles.section, { color: colors.text }]}>Noch offen</Text> : null}
        <View style={styles.grid}>
          {open.map((b) => (
            <BadgeTile key={b.key} badge={b} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function BadgeTile({ badge }: { badge: Badge }) {
  const colors = useTheme();
  const icon = isUiIconName(badge.icon) ? badge.icon : 'star';
  const ratio = badge.progress ? Math.min(1, badge.progress.current / Math.max(1, badge.progress.target)) : 0;

  return (
    <View
      accessible
      accessibilityLabel={`${badge.title}. ${badge.description}${badge.earned ? `. Verdient am ${formatDay(badge.earned_at)}` : ''}`}
      style={[
        styles.tile,
        {
          borderColor: badge.earned ? colors.tint : colors.border,
          backgroundColor: colors.background,
          opacity: badge.earned ? 1 : 0.75,
        },
      ]}>
      <View style={[styles.medal, { backgroundColor: badge.earned ? colors.tint : colors.backgroundSelected }]}>
        <Icon name={icon} size={24} color={badge.earned ? '#ffffff' : colors.textSecondary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {badge.title}
      </Text>
      <Text style={[styles.desc, { color: colors.textSecondary }]} numberOfLines={3}>
        {badge.description}
      </Text>
      {badge.earned ? (
        <Text style={[styles.date, { color: colors.tint }]}>{formatDay(badge.earned_at)}</Text>
      ) : badge.progress ? (
        <View style={{ alignSelf: 'stretch', gap: 3 }}>
          <View style={[styles.bar, { backgroundColor: colors.backgroundSelected }]}>
            <View style={[styles.barFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: colors.tint }]} />
          </View>
          <Text style={[styles.date, { color: colors.textSecondary }]}>
            {badge.progress.current} / {badge.progress.target}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroValue: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 26 },
  heroText: { color: '#e9d5ff', fontFamily: FontFamily.medium, fontSize: 13.5, lineHeight: 19 },
  section: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'space-between' },
  tile: {
    width: '48.5%',
    borderWidth: Stroke,
    borderRadius: Radius.card,
    padding: Spacing.three,
    alignItems: 'center',
    gap: 6,
  },
  medal: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FontFamily.bold, fontSize: 14.5, textAlign: 'center' },
  desc: { fontFamily: FontFamily.medium, fontSize: 12, textAlign: 'center', lineHeight: 16 },
  date: { fontFamily: FontFamily.semibold, fontSize: 12, textAlign: 'center' },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
});
