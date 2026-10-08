import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BingoCard } from '@/components/bingo-card';
import { useCelebrate } from '@/components/celebration';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import type { TestphaseClaim } from '@/domain/testphase';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import { useFeatures } from '@/lib/features-context';
import { useMarket } from '@/lib/market-context';
import { goBack } from '@/lib/navigation';

/**
 * Stadt-Bingo – die Monatskarte für alle, sobald ein Admin sie freischaltet
 * (Admin › „Funktionen für alle"). Ist es aus, sagt der Bildschirm das freundlich
 * statt einer leeren Seite.
 */
export default function BingoScreen() {
  const colors = useTheme();
  const { token } = useAuth();
  const market = useMarket();
  const celebrate = useCelebrate();
  const { features, bingo, setBingo, refreshBingo } = useFeatures();
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Laden gescheitert: Fehler mit „Nochmal" statt eines Kreisels, der nie endet. */
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(!(await refreshBingo()));
  }, [refreshBingo]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const claim = async (c: TestphaseClaim) => {
    if (!token || busy) return;
    setBusy(c.key);
    try {
      const res = await api.claimBingo(token, c.key);
      setBingo(res.data);
      market.setCredits(res.balance);
      celebrate({ title: 'Bingo!', subtitle: c.label, credits: res.credits, kind: 'coins' });
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
    setBusy(null);
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Stadt-Bingo' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.tint}
          />
        }>
        {!features.bingo ? (
          <Card>
            <MascotEmpty mood="sleepy">
              <Text style={[styles.title, { color: colors.text }]}>Gerade kein Bingo</Text>
              <Text style={[styles.text, { color: colors.textSecondary }]}>Das Stadt-Bingo läuft zweimal im Jahr. Wir sagen Bescheid, wenn es wieder losgeht!</Text>
              <Button title="Zurück" variant="secondary" size="small" onPress={() => goBack()} />
            </MascotEmpty>
          </Card>
        ) : bingo ? (
          <>
            <BingoCard bingo={bingo} busy={busy} onClaim={claim} />
            <Text style={[styles.note, { color: colors.textSecondary }]}>
              Partner-Felder erledigst du mit einem Besuch in diesem Monat, Aufgaben-Felder mit der Sache, die darauf steht. Belohnungen gibt es als Credits.
            </Text>
          </>
        ) : failed ? (
          <MascotError detail="Das Bingo ließ sich gerade nicht laden." onRetry={load} />
        ) : (
          <ActivityIndicator color={colors.tint} style={{ marginTop: Spacing.six }} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  title: { fontFamily: FontFamily.bold, fontSize: 19 },
  text: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.two },
  note: { fontFamily: FontFamily.medium, fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
});
