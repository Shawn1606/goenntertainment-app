import { StyleSheet, Text, View } from 'react-native';

import { AdminScreen } from '@/components/admin-ui';
import { ChoiceRow, FeatureBlock, useAdminFeatures } from '@/components/feature-admin';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, Spacing } from '@/constants/theme';
import { SEASON_CHOICE_LABEL } from '@/domain/features';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';

/**
 * Admin › „Funktionen für alle“: Was hier an ist, sehen ALLE Nutzer.
 *
 * Zum Ausprobieren ohne Wirkung auf andere gibt es „Nur für mich“
 * (admin-preview.tsx). Einschalten für alle fragt einmal nach – das ist die
 * Stelle, an der eine Funktion live geht.
 */
export default function AdminFeaturesScreen() {
  const colors = useTheme();
  const { state, busy, error, run } = useAdminFeatures();

  const setBingo = async (on: boolean) => {
    if (on && !(await confirmAction('Stadt-Bingo für alle einschalten?', 'Alle Nutzer sehen das Bingo dann auf der Startseite und können Credits abholen.', 'Für alle einschalten'))) {
      return;
    }
    await run('bingo', (token) => api.admin.features.setGlobal(token, 'bingo', { enabled: on }));
  };

  const setSeason = (value: string) => run('season', (token) => api.admin.features.setGlobal(token, 'season', { value }));

  return (
    <AdminScreen title="Funktionen für alle">
      <Card tone="soft" style={styles.intro}>
        <Icon name="users" size={20} color={colors.tint} />
        <Text style={[styles.introText, { color: colors.textSecondary }]}>
          Änderungen hier gelten sofort für ALLE Nutzer. Erst für dich ausprobieren? Dafür gibt es „Nur für mich“.
        </Text>
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {state ? (
        <View style={{ gap: Spacing.three }}>
          <FeatureBlock
            icon="grid"
            title="Stadt-Bingo"
            hint="Monatsfeld mit Partnern und kleinen Aufgaben; volle Reihen bringen Credits. Läuft zweimal im Jahr."
            status={state.global.bingo.enabled ? 'Gerade AN für alle.' : 'Gerade aus – normale Nutzer sehen es nicht.'}>
            <ChoiceRow
              options={[
                { value: 'off', label: 'Aus' },
                { value: 'on', label: 'An für alle' },
              ]}
              value={state.global.bingo.enabled ? 'on' : 'off'}
              onChange={(v) => void setBingo(v === 'on')}
              busy={busy === 'bingo'}
            />
          </FeatureBlock>

          <FeatureBlock
            icon="sparkles"
            title="Saison-Thema"
            hint="Deko in der Kopfzeile und Goennis Look. „Automatisch“ richtet sich nach dem Datum."
            status={`Für alle: ${SEASON_CHOICE_LABEL[state.global.season.value] ?? state.global.season.value}`}>
            <ChoiceRow
              options={(state.definitions.find((d) => d.key === 'season')?.choices ?? ['auto']).map((c) => ({ value: c, label: SEASON_CHOICE_LABEL[c] ?? c }))}
              value={state.global.season.value}
              onChange={(v) => void setSeason(v)}
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
