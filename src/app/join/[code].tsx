import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Mascot, MascotError } from '@/components/mascot';
import { ReportSheet } from '@/components/report-sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type GroupPreview } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';
import { goBack } from '@/lib/navigation';

/**
 * Ziel eines Einladungslinks (`…/g/<code>` bzw. `goenntertainmentapp://join/<code>`):
 * erst zeigen, wohin man eingeladen wurde, dann beitreten. Ohne Vorschau wäre ein
 * Link ein Klick ins Ungewisse.
 */
export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const colors = useTheme();
  const { token } = useAuth();
  const market = useMarket();
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  /** Name und Beschreibung einer fremden Gruppe sind Inhalte von Nutzern – meldbar, bevor man beitritt. */
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .previewInvite(token, code)
      .then(({ data }) => {
        if (data.is_member && data.id) router.replace({ pathname: '/group/[id]', params: { id: String(data.id) } });
        else setPreview(data);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [token, code, router]);

  const join = async () => {
    if (!token) return;
    setJoining(true);
    try {
      const { data } = await api.joinGroup(token, code);
      feedback.joined();
      await market.refreshGroups();
      router.replace({ pathname: '/group/[id]', params: { id: String(data.id), created: '1' } });
    } catch (e) {
      setError(errorMessage(e));
    }
    setJoining(false);
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Einladung' }} />
      <View style={styles.content}>
        {error ? (
          <MascotError detail={error} />
        ) : !preview ? (
          <ActivityIndicator color={colors.tint} />
        ) : (
          <Card style={styles.card}>
            <Mascot mood="cheer" gesture="wave" size={90} waves />
            <Text style={[styles.kicker, { color: colors.textSecondary }]}>
              {preview.owner_name ? `${preview.owner_name} lädt dich ein` : 'Du wurdest eingeladen'}
            </Text>
            <Text style={[styles.name, { color: colors.text }]}>{preview.name}</Text>
            {preview.description ? <Text style={[styles.text, { color: colors.textSecondary }]}>{preview.description}</Text> : null}
            <Text style={[styles.text, { color: colors.textSecondary }]}>
              {preview.members_count} {preview.members_count === 1 ? 'Person ist' : 'Personen sind'} schon dabei. Zusammen bekommt ihr Gruppenrabatt.
            </Text>
            <Button title="Beitreten" icon="users" onPress={join} loading={joining} style={styles.button} />
            <Button title="Nicht jetzt" variant="ghost" size="small" onPress={() => goBack('/groups')} />
            {preview.id ? <Button title="Gruppe melden" variant="ghost" size="small" icon="flag" onPress={() => setReporting(true)} /> : null}
          </Card>
        )}
      </View>
      <ReportSheet
        target={reporting && preview?.id ? { type: 'group', id: preview.id, label: preview.name } : null}
        onClose={() => setReporting(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1, padding: Spacing.three, justifyContent: 'center', width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  card: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five },
  kicker: { fontFamily: FontFamily.semibold, fontSize: 14 },
  name: { fontFamily: FontFamily.bold, fontSize: 26, textAlign: 'center' },
  text: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', maxWidth: 340 },
  button: { alignSelf: 'stretch', marginTop: Spacing.two },
});
