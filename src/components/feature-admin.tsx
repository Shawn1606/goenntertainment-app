/**
 * Gemeinsame Teile der zwei Schalter-Bildschirme im Admin-Bereich:
 * „Funktionen für alle" (admin-features.tsx) und „Nur für mich"
 * (admin-preview.tsx). Laden, Speichern und die Auswahl-Chips liegen hier,
 * damit beide gleich aussehen und sich gleich verhalten.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import type { AdminFeatureState } from '@/domain/features';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useFeatures } from '@/lib/features-context';

/** Stand laden (bei jedem Öffnen) und nach jeder Änderung auch die App-Schalter neu holen. */
export function useAdminFeatures() {
  const { token } = useAuth();
  const { refresh, refreshBingo } = useFeatures();
  const [state, setState] = useState<AdminFeatureState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setState((await api.admin.features.state(token)).data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Die Schalter konnten nicht geladen werden.'));
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Eine Änderung schicken; danach gilt sie sofort auch in dieser App. */
  const run = async (key: string, call: (token: string) => Promise<{ data: AdminFeatureState }>) => {
    if (!token || busy) return;
    setBusy(key);
    try {
      setState((await call(token)).data);
      feedback.selected();
      await refresh();
      await refreshBingo();
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
    setBusy(null);
  };

  return { state, busy, error, load, run };
}

/** Eine Zeile je Funktion: Symbol, Name, Erklärung, darunter die Auswahl. */
export function FeatureBlock({ icon, title, hint, status, children }: { icon: UiIconName; title: string; hint: string; status?: string; children: React.ReactNode }) {
  const colors = useTheme();
  return (
    <View style={[styles.block, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: colors.backgroundSelected }]}>
          <Icon name={icon} size={20} color={colors.tint} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text>
        </View>
      </View>
      {children}
      {status ? <Text style={[styles.status, { color: colors.textSecondary }]}>{status}</Text> : null}
    </View>
  );
}

/** Auswahl-Chips (eine Option aktiv). */
export function ChoiceRow<T extends string>({
  options,
  value,
  onChange,
  busy,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  busy?: boolean;
}) {
  const colors = useTheme();
  return (
    <View style={styles.choices}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <PressableScale
            key={o.value}
            onPress={() => !active && onChange(o.value)}
            disabled={busy}
            haptic="none"
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: busy }}
            style={[styles.choice, { borderColor: active ? colors.tint : colors.border, backgroundColor: active ? colors.tint : colors.backgroundElement }, busy && styles.busy]}>
            {active ? <Icon name="check" size={13} color="#ffffff" /> : null}
            <Text style={[styles.choiceText, { color: active ? '#ffffff' : colors.text }]}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderWidth: Stroke, borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.three },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FontFamily.bold, fontSize: 16 },
  hint: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  status: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  choiceText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  busy: { opacity: 0.6 },
});
