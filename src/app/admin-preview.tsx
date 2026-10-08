import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AdminScreen } from '@/components/admin-ui';
import { ChoiceRow, FeatureBlock, useAdminFeatures } from '@/components/feature-admin';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, Spacing } from '@/constants/theme';
import { PREVIEW_MODE_LABEL, SEASON_CHOICE_LABEL, type PreviewMode } from '@/domain/features';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';

/**
 * Admin › „Nur für mich“: Funktionen für das EIGENE Konto an- oder ausschalten
 * und Saison-Themen ansehen – niemand sonst merkt etwas davon.
 *
 * „Wie für alle“ heißt: Es gilt, was unter „Funktionen für alle“ eingestellt
 * ist. Mit „Aus“ lässt sich gegenprüfen, wie die App ohne eine Funktion aussieht.
 */
export default function AdminPreviewScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { state, busy, error, run } = useAdminFeatures();

  const modes: { value: PreviewMode; label: string }[] = (['inherit', 'on', 'off'] as const).map((m) => ({ value: m, label: PREVIEW_MODE_LABEL[m] }));

  return (
    <AdminScreen title="Nur für mich">
      <Card tone="soft" style={styles.intro}>
        <Icon name="eye" size={20} color={colors.tint} />
        <Text style={[styles.introText, { color: colors.textSecondary }]}>
          Vorschau nur für dein Konto. Andere Nutzer sehen weiter, was unter „Funktionen für alle“ eingestellt ist.
        </Text>
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {state ? (
        <View style={{ gap: Spacing.three }}>
          <FeatureBlock
            icon="grid"
            title="Stadt-Bingo"
            hint="Für dich an- oder ausschalten – zum Ausprobieren, bevor es für alle kommt."
            status={`Für alle: ${state.global.bingo.enabled ? 'an' : 'aus'} · Bei dir gerade: ${state.effective.bingo ? 'an' : 'aus'}`}>
            <ChoiceRow
              options={modes}
              value={state.preview.bingo.mode}
              onChange={(mode) => void run('bingo', (token) => api.admin.features.setPreview(token, 'bingo', { mode }))}
              busy={busy === 'bingo'}
            />
            {state.effective.bingo ? <Button title="Bingo öffnen" icon="grid" variant="secondary" size="small" onPress={() => router.push('/bingo')} /> : null}
          </FeatureBlock>

          <FeatureBlock
            icon="sparkles"
            title="Saison-Thema ansehen"
            hint="Wie sieht die App an Weihnachten aus, wie im Sommer? Deko und Goennis Look wechseln sofort."
            status={`Für alle: ${SEASON_CHOICE_LABEL[state.global.season.value] ?? state.global.season.value} · Bei dir gerade: ${state.effective.season ? SEASON_CHOICE_LABEL[state.effective.season] : 'nach Datum'}`}>
            <ChoiceRow
              options={[
                { value: 'inherit', label: 'Wie für alle' },
                ...(state.definitions.find((d) => d.key === 'season')?.choices ?? ['auto']).map((c) => ({ value: c, label: SEASON_CHOICE_LABEL[c] ?? c })),
              ]}
              value={state.preview.season.value ?? 'inherit'}
              onChange={(value) => void run('season', (token) => api.admin.features.setPreview(token, 'season', { value }))}
              busy={busy === 'season'}
            />
          </FeatureBlock>
        </View>
      ) : null}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  introText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 13.5, lineHeight: 19 },
  error: { color: '#dc2626', fontFamily: FontFamily.semibold },
});
