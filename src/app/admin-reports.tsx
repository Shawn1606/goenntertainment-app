import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AdminScreen } from '@/components/admin-ui';
import { MascotError } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Spacing, Stroke } from '@/constants/theme';
import { formatDateTimeCompact } from '@/domain/date-format';
import { isUrgent, reportReasonLabel, reportTargetLabel } from '@/domain/report-reason';
import { describeSnapshot } from '@/domain/report-snapshot';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type AdminReport } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';

/** Länge eines Gruppennamens – gleiche Zahl wie `Group::MAX_NAME` im Server. */
const MAX_GROUP_NAME = 60;

/**
 * Meldungen der Nutzer:innen. Der Meldeweg ist die Gegenseite zum
 * Haftungsausschluss – ohne diesen Ort wäre der Melde-Knopf eine Attrappe.
 *
 * Jede Meldung zeigt, was im Moment der Meldung da stand (`snapshot`) – auch wenn
 * es danach gelöscht oder umbenannt wurde – und darunter, was man damit tun kann:
 * eine Nachricht löschen, eine Gruppe umbenennen oder löschen, das Konto der
 * Verfasserin oder des Verfassers öffnen (dort: Profil zurücksetzen, sperren).
 */
export default function AdminReports() {
  const colors = useTheme();
  const { token } = useAuth();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  /** `null`, solange noch nichts geladen ist – „Nichts zu tun" darf nie eine ungeladene Liste verdecken. */
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    api.admin
      .reports(token, filter)
      .then(({ data }) => {
        setReports(data);
        setLoadError(null);
      })
      .catch((e) => setLoadError(errorMessage(e, 'Die Meldungen ließen sich nicht laden.')));
  }, [token, filter]);

  useFocusEffect(load);

  const decide = async (report: AdminReport, status: AdminReport['status']) => {
    if (!token) return;
    const settled = (list: AdminReport[]) =>
      filter === 'open' && status !== 'open' ? list.filter((r) => r.id !== report.id) : list.map((r) => (r.id === report.id ? { ...r, status } : r));
    try {
      await api.admin.updateReport(token, report.id, status);
      setReports((prev) => (prev ? settled(prev) : prev));
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
  };

  /**
   * Nach dem Löschen oder Umbenennen: Die Meldung ist erledigt, und die Liste lädt neu –
   * andere Meldungen zu demselben Inhalt zeigen dann „inzwischen gelöscht".
   */
  const moderated = async (report: AdminReport) => {
    if (report.status === 'open') await decide(report, 'reviewed');
    load();
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
      {loadError ? <MascotError detail={loadError} onRetry={load} /> : null}
      {reports === null && !loadError ? <ActivityIndicator color={colors.tint} /> : null}
      {reports?.length === 0 ? <Text style={[styles.meta, { color: colors.textSecondary, textAlign: 'center' }]}>Nichts zu tun.</Text> : null}
      {token
        ? (reports ?? []).map((r) => <ReportCard key={r.id} report={r} token={token} onDecide={(status) => decide(r, status)} onModerated={() => moderated(r)} />)
        : null}
    </AdminScreen>
  );
}

type CardProps = {
  report: AdminReport;
  token: string;
  onDecide: (status: AdminReport['status']) => Promise<void>;
  onModerated: () => Promise<void>;
};

function ReportCard({ report, token, onDecide, onModerated }: CardProps) {
  const colors = useTheme();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const target = reportTargetLabel(report.target_type);
  const shown = describeSnapshot(report.target_type, report.snapshot);
  /** Der gemeldete Inhalt ist inzwischen weg – dann gibt es nichts mehr zu löschen. */
  const gone = report.target === null;
  /** Wie es heute heißt, wenn es sich seit der Meldung geändert hat (etwa umbenannt). */
  const now = shown && report.target !== null && !shown.quote.startsWith(report.target) ? report.target : null;
  const type = report.target_type;

  /** Wen man sich als Nächstes ansehen will: Verfasser:in, Besitzer:in oder das gemeldete Konto. */
  const person =
    type === 'message'
      ? { id: report.snapshot?.author?.id, label: 'Verfasser:in ansehen' }
      : type === 'group'
        ? { id: report.snapshot?.owner?.id, label: 'Besitzer:in ansehen' }
        : type === 'user' && !gone
          ? { id: report.target_id, label: 'Konto ansehen' }
          : null;
  const open: { href: Href; label: string } | null =
    gone || (type !== 'partner' && type !== 'offer')
      ? null
      : type === 'partner'
        ? { href: { pathname: '/admin-partner', params: { id: String(report.target_id) } }, label: 'Partner ansehen' }
        : { href: { pathname: '/admin-offer', params: { id: String(report.target_id) } }, label: 'Angebot ansehen' };

  /** Eine Moderations-Handlung nach Rückfrage – danach ist die Meldung erledigt. */
  const moderate = async (title: string, detail: string, confirmLabel: string, action: () => Promise<unknown>) => {
    if (!(await confirmAction(title, detail, confirmLabel, true))) return;
    setBusy(true);
    try {
      await action();
      await onModerated();
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
    setBusy(false);
  };

  const deleteMessage = () =>
    moderate('Nachricht löschen?', 'Sie verschwindet für alle in der Gruppe. Die Meldung behält, was dastand.', 'Löschen', () =>
      api.admin.deleteMessage(token, report.target_id),
    );

  const deleteGroup = () =>
    moderate('Gruppe löschen?', 'Chat, Mitglieder und Abstimmungen gehen mit. Buchungen bleiben, nur ohne Gruppe.', 'Gruppe löschen', () =>
      api.admin.deleteGroup(token, report.target_id),
    );

  const clearDescription = () =>
    moderate('Beschreibung leeren?', 'Der Name der Gruppe bleibt.', 'Leeren', () => api.admin.updateGroup(token, report.target_id, { description: null }));

  const rename = async () => {
    const next = name.trim();
    if (!next) return;
    setBusy(true);
    try {
      await api.admin.updateGroup(token, report.target_id, { name: next });
      setRenaming(false);
      setName('');
      await onModerated();
    } catch (e) {
      await notifyUser('Nicht umbenannt', errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Icon name={target.icon} size={20} color={isUrgent(report.reason) ? '#e11d48' : colors.tint} />
        <Text style={[styles.title, { color: colors.text }]}>
          {target.label} #{report.target_id} · {reportReasonLabel(report.reason)}
        </Text>
      </View>

      {shown ? (
        <View style={styles.snapshot}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Zum Zeitpunkt der Meldung</Text>
          <Text style={[styles.quote, { color: colors.text, borderColor: colors.border }]}>{shown.quote}</Text>
          {shown.details.map((line) => (
            <Text key={line} style={[styles.meta, { color: colors.textSecondary }]}>
              {line}
            </Text>
          ))}
          {gone ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Inzwischen gelöscht.</Text> : null}
          {now ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Heute: {now}</Text> : null}
        </View>
      ) : (
        <Text style={[styles.quote, { color: colors.text, borderColor: colors.border }]}>{report.target ?? 'Inhalt nicht mehr vorhanden'}</Text>
      )}

      {report.note ? <Text style={[styles.meta, { color: colors.text }]}>„{report.note}“</Text> : null}
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        von {report.reporter_name ?? 'gelöschtem Konto'} · {formatDateTimeCompact(report.created_at)}
        {report.handled_by_name ? ` · bearbeitet von ${report.handled_by_name}` : ''}
      </Text>

      {renaming ? (
        <View style={styles.pair}>
          <View style={styles.grow}>
            <TextField label="Neuer Gruppenname" value={name} onChangeText={setName} maxLength={MAX_GROUP_NAME} autoFocus />
          </View>
          <Button title="Speichern" size="small" onPress={rename} loading={busy} disabled={!name.trim()} />
          <Button title="Abbrechen" size="small" variant="ghost" onPress={() => setRenaming(false)} disabled={busy} />
        </View>
      ) : null}

      <View style={styles.wrap}>
        {type === 'message' && !gone ? <Button title="Nachricht löschen" size="small" variant="danger" icon="trash" onPress={deleteMessage} disabled={busy} /> : null}
        {type === 'group' && !gone && !renaming ? (
          <Button title="Umbenennen" size="small" variant="secondary" icon="edit" onPress={() => setRenaming(true)} disabled={busy} />
        ) : null}
        {type === 'group' && !gone && report.snapshot?.description ? (
          <Button title="Beschreibung leeren" size="small" variant="secondary" onPress={clearDescription} disabled={busy} />
        ) : null}
        {type === 'group' && !gone ? <Button title="Gruppe löschen" size="small" variant="danger" icon="trash" onPress={deleteGroup} disabled={busy} /> : null}
        {person?.id ? (
          <Button
            title={person.label}
            size="small"
            variant="ghost"
            onPress={() => router.push({ pathname: '/admin-user', params: { id: String(person.id) } })}
          />
        ) : null}
        {open ? <Button title={open.label} size="small" variant="ghost" onPress={() => router.push(open.href)} /> : null}
      </View>

      {report.status === 'open' ? (
        <View style={styles.actions}>
          <Button title="Erledigt" size="small" icon="check" onPress={() => onDecide('reviewed')} style={styles.flex} disabled={busy} />
          <Button title="Verwerfen" size="small" variant="secondary" onPress={() => onDecide('dismissed')} style={styles.flex} disabled={busy} />
        </View>
      ) : (
        <Button title="Wieder öffnen" size="small" variant="ghost" onPress={() => onDecide('open')} />
      )}
    </Card>
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
  snapshot: { gap: 4 },
  label: { fontFamily: FontFamily.semibold, fontSize: 12 },
  quote: { fontFamily: FontFamily.regular, fontSize: 14, borderLeftWidth: 3, paddingLeft: Spacing.two },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  pair: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end', flexWrap: 'wrap' },
  // minWidth 0: Im Web hat ein Eingabefeld sonst eine Mindestbreite und schiebt die Reihe über die Karte.
  grow: { flex: 1, minWidth: 0, flexBasis: 180 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two },
});
