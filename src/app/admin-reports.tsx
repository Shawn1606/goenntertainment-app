import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AdminScreen } from '@/components/admin-ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, Spacing, Stroke } from '@/constants/theme';
import { formatDateTimeCompact } from '@/domain/date-format';
import { isUrgent, reportReasonLabel } from '@/domain/report-reason';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type AdminReport } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';

const TARGET: Record<string, { icon: UiIconName; label: string }> = {
  message: { icon: 'chat', label: 'Nachricht' },
  user: { icon: 'user', label: 'Konto' },
  group: { icon: 'users', label: 'Gruppe' },
  partner: { icon: 'building', label: 'Partner' },
  offer: { icon: 'ticket', label: 'Angebot' },
};

/**
 * Meldungen der Nutzer:innen. Der Meldeweg ist die Gegenseite zum
 * Haftungsausschluss – ohne diesen Ort wäre der Melde-Knopf eine Attrappe.
 */
export default function AdminReports() {
  const colors = useTheme();
  const { token } = useAuth();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [reports, setReports] = useState<AdminReport[]>([]);

  const load = useCallback(() => {
    if (token) api.admin.reports(token, filter).then(({ data }) => setReports(data));
  }, [token, filter]);

  useFocusEffect(load);

  const decide = async (report: AdminReport, status: AdminReport['status']) => {
    if (!token) return;
    try {
      await api.admin.updateReport(token, report.id, status);
      setReports((prev) => (filter === 'open' && status !== 'open' ? prev.filter((r) => r.id !== report.id) : prev.map((r) => (r.id === report.id ? { ...r, status } : r))));
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
  };

  return (
    <AdminScreen title="Meldungen">
      <View style={styles.tabs}>
        {(['open', 'all'] as const).map((f) => (
          <PressableScale
            key={f}
            onPress={() => setFilter(f)}
            haptic="select"
            style={[styles.tab, { borderColor: filter === f ? colors.tint : colors.border, backgroundColor: filter === f ? colors.tint : colors.background }]}>
            <Text style={[styles.tabText, { color: filter === f ? '#ffffff' : colors.text }]}>{f === 'open' ? 'Offen' : 'Alle'}</Text>
          </PressableScale>
        ))}
      </View>
      {reports.length === 0 ? <Text style={[styles.meta, { color: colors.textSecondary, textAlign: 'center' }]}>Nichts zu tun.</Text> : null}
      {reports.map((r) => {
        const target = TARGET[r.target_type] ?? { icon: 'flag' as const, label: r.target_type };
        return (
          <Card key={r.id} style={styles.card}>
            <View style={styles.head}>
              <Icon name={target.icon} size={20} color={isUrgent(r.reason) ? '#e11d48' : colors.tint} />
              <Text style={[styles.title, { color: colors.text }]}>
                {target.label} #{r.target_id} · {reportReasonLabel(r.reason)}
              </Text>
            </View>
            <Text style={[styles.quote, { color: colors.text, borderColor: colors.border }]}>{r.target ?? 'Inhalt nicht mehr vorhanden'}</Text>
            {r.note ? <Text style={[styles.meta, { color: colors.text }]}>„{r.note}“</Text> : null}
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              von {r.reporter_name ?? 'gelöschtem Konto'} · {formatDateTimeCompact(r.created_at)}
              {r.handled_by_name ? ` · bearbeitet von ${r.handled_by_name}` : ''}
            </Text>
            {r.status === 'open' ? (
              <View style={styles.actions}>
                <Button title="Erledigt" size="small" icon="check" onPress={() => decide(r, 'reviewed')} style={styles.flex} />
                <Button title="Verwerfen" size="small" variant="secondary" onPress={() => decide(r, 'dismissed')} style={styles.flex} />
              </View>
            ) : (
              <Button title="Wieder öffnen" size="small" variant="ghost" onPress={() => decide(r, 'open')} />
            )}
          </Card>
        );
      })}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabs: { flexDirection: 'row', gap: Spacing.two },
  tab: { borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  tabText: { fontFamily: FontFamily.semibold, fontSize: 14 },
  card: { gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { flex: 1, fontFamily: FontFamily.bold, fontSize: 15 },
  quote: { fontFamily: FontFamily.regular, fontSize: 14, borderLeftWidth: 3, paddingLeft: Spacing.two },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
