/**
 * Admin: gemeldete Inhalte und Konten.
 *
 * ## Warum dieser Screen der Gegenpart zum Haftungsausschluss ist
 *
 * Die Nutzungsbedingungen sagen, dass die Inhalte von den Nutzer:innen kommen und
 * die Plattform für das Geschehen auf einem Event nicht haftet. Diese Aussage hält
 * nur, wenn es einen Weg gibt, von Problemen zu erfahren – und einen Ort, an dem
 * sie bearbeitet werden. Der Meldeknopf ist der Weg, dieser Screen ist der Ort.
 *
 * ## Bearbeiten heißt hier: abarbeiten, nicht löschen
 *
 * Es gibt „bearbeitet" und „verworfen" – kein „Inhalt löschen" und kein „Konto
 * sperren". Das steckt in den Werkzeugen, die es dafür schon gibt (Nutzerliste,
 * Storys, Moderation). Ein zweiter Löschknopf hier wäre ein zweiter Weg mit
 * eigenen Regeln, der irgendwann anders wirkt als der erste.
 *
 * Der Stand lässt sich zurücksetzen („wieder offen"): Wer zu früh abgehakt hat,
 * soll das rückgängig machen können, ohne dass die Person erneut melden muss.
 *
 * One exception: a reported comment (F-08) can be removed right here. There is no admin list of
 * comments to go to instead, and the chip calls the same delete route as the trash icon on the
 * comment row (admins may delete any comment there), so it is not a second way with its own
 * rules.
 */
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { GlassCard, GlassChip, SectionHeader } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { Segmented } from '@/components/ui/segmented';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { formatDateTimeCompact } from '@/domain/date-format';
import { REPORT_TARGET_LABELS, isCommentTarget, reportReasonLabel, isUrgent } from '@/domain/report-reason';
import type { UiIconName } from '@/domain/ui-icon';
import { useBrandSurface, useSignals } from '@/hooks/use-theme';
import { ApiError, api, type AdminReport } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { apiImageSource } from '@/lib/auth-image';
import { confirmAction } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { goBack } from '@/lib/go-back';

/** Welcher Stand gerade gezeigt wird. */
type Tab = 'open' | 'done';

/**
 * Symbol und Wort je Art des gemeldeten Gegenstands (src/domain/report-reason.ts). A kind this
 * app version does not know yet (a newer server) shows its key instead of breaking the list.
 */
function targetLabel(type: string): { icon: UiIconName; label: string } {
  return (REPORT_TARGET_LABELS as Record<string, { icon: UiIconName; label: string } | undefined>)[type] ?? {
    icon: 'flag',
    label: type,
  };
}

export default function AdminReportsScreen() {
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const signal = useSignals();
  const { token, user } = useAuth();

  const [reports, setReports] = useState<AdminReport[]>([]);
  const [open, setOpen] = useState(0);
  const [tab, setTab] = useState<Tab>('open');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.adminReports(token);
      setReports(res.data);
      setOpen(res.open);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Dieser Bereich ist nur für Admins.'
          : 'Die Meldungen ließen sich nicht laden.',
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    feedback.tapped();
    await load();
    setRefreshing(false);
  }, [load]);

  async function setStatus(report: AdminReport, status: 'open' | 'reviewed' | 'dismissed') {
    if (!token || busy !== null) return;
    setBusy(report.id);
    setError(null);
    try {
      await api.adminUpdateReport(token, report.id, status);
      feedback.selected();
      await load();
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Das hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Removes a reported comment through the route the comment row uses, then marks the report as
   * handled. Only for comments whose event or post is known (`context_id`).
   */
  async function removeComment(report: AdminReport) {
    const contextId = report.target?.context_id ?? null;
    if (!token || busy !== null || !isCommentTarget(report.target_type) || contextId === null) return;
    const ok = await confirmAction('Kommentar löschen', 'Der Kommentar verschwindet für alle.', 'Löschen', true);
    if (!ok) return;
    setBusy(report.id);
    setError(null);
    try {
      if (report.target_type === 'activity_comment') {
        await api.deleteActivityComment(token, contextId, report.target_id);
      } else {
        await api.deleteComment(token, report.target_id);
      }
      await api.adminUpdateReport(token, report.id, 'reviewed');
      feedback.selected();
      await load();
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Das hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  }

  const shown = useMemo(
    () => reports.filter((report) => (tab === 'open' ? report.status === 'open' : report.status !== 'open')),
    [reports, tab],
  );

  /** Dringende zuerst – „jemand ist in Gefahr" darf nicht auf Seite zwei stehen. */
  const sorted = useMemo(
    () =>
      [...shown].sort((a, b) => {
        const urgency = Number(isUrgent(b.reason)) - Number(isUrgent(a.reason));
        if (urgency !== 0) return urgency;
        return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      }),
    [shown],
  );

  const segments = useMemo(
    () => [
      { value: 'open' as const, label: 'Offen', count: reports.filter((r) => r.status === 'open').length },
      { value: 'done' as const, label: 'Erledigt', count: reports.filter((r) => r.status !== 'open').length },
    ],
    [reports],
  );

  if (!user?.is_admin) {
    return (
      <HomeBackground style={styles.screen}>
        <View style={[styles.content, { paddingTop: insets.top + Spacing.five }]}>
          <MascotError detail="Dieser Bereich ist nur für Admins." />
        </View>
      </HomeBackground>
    );
  }

  return (
    <HomeBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={surface.accent}
            colors={[surface.accent]}
          />
        }>
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Zurück"
            hitSlop={10}
            style={({ pressed }) => pressed && styles.pressed}>
            <Icon name="close" size={22} color={surface.textMuted} />
          </Pressable>
          <View style={styles.headerText}>
            <ThemedText style={styles.title}>Meldungen</ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {open === 0
                ? 'Nichts offen – gut.'
                : open === 1
                  ? 'Eine Meldung wartet.'
                  : `${open} Meldungen warten.`}
            </ThemedText>
          </View>
        </View>

        {error ? <MascotError detail={error} onRetry={loading ? undefined : load} /> : null}

        <Segmented segments={segments} value={tab} onChange={setTab} />

        {!loading && sorted.length === 0 && !error ? (
          <GlassCard tone="accent">
            <MascotEmpty mood="cheer" size={80}>
              <ThemedText style={{ color: surface.text }}>
                {tab === 'open' ? 'Keine offenen Meldungen.' : 'Noch nichts abgearbeitet.'}
              </ThemedText>
              <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                {tab === 'open'
                  ? 'Meldungen aus der App landen hier – offene zuerst.'
                  : 'Bearbeitete und verworfene Meldungen stehen hier.'}
              </ThemedText>
            </MascotEmpty>
          </GlassCard>
        ) : null}

        {sorted.map((report, index) => {
          const target = targetLabel(report.target_type);
          const urgent = isUrgent(report.reason);

          return (
            <Entrance key={report.id} index={index}>
              <GlassCard
                tone="card"
                style={[
                  styles.card,
                  // Dringende bekommen einen farbigen Rand. Farbe allein trägt die
                  // Information nicht – der Grund steht als Text daneben.
                  urgent && report.status === 'open'
                    ? { borderColor: signal.warnBorder, borderWidth: StyleSheet.hairlineWidth * 3 }
                    : null,
                ]}>
                <View style={styles.cardHead}>
                  <View
                    style={[
                      styles.typeIcon,
                      { backgroundColor: surface.chipBg, borderColor: surface.chipBorder },
                    ]}>
                    <Icon name={target.icon} size={18} color={surface.accent} />
                  </View>
                  <View style={styles.cardHeadText}>
                    <ThemedText type="smallBold" style={{ color: urgent ? signal.warn : surface.text }}>
                      {target.label} · {reportReasonLabel(report.reason)}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: surface.textMuted }}>
                      {[
                        report.reporter
                          ? `gemeldet von ${report.reporter.username ? `@${report.reporter.username}` : report.reporter.name}`
                          : 'gemeldet von einem gelöschten Konto',
                        formatDateTimeCompact(report.created_at),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </ThemedText>
                  </View>
                </View>

                {/* Der gemeldete Gegenstand. Fehlt er, ist er gelöscht – das ist
                    eine Auskunft und kein Fehler, deshalb steht sie als Text da. */}
                {report.target ? (
                  <View
                    style={[
                      styles.targetBox,
                      { backgroundColor: surface.chipBg, borderColor: surface.chipBorder },
                    ]}>
                    {report.target.image_url ? (
                      // A reported story's image is private (F-11): sent with the admin's token.
                      <Image
                        source={apiImageSource(report.target.image_url, token)}
                        style={styles.targetImage}
                        contentFit="cover"
                        cachePolicy="memory"
                      />
                    ) : null}
                    <View style={styles.targetText}>
                      <ThemedText type="small" style={{ color: surface.text }} numberOfLines={4}>
                        {report.target.label || '(ohne Text)'}
                      </ThemedText>
                      {report.target.author ? (
                        <ThemedText type="small" style={{ color: surface.textMuted }}>
                          von {report.target.author}
                          {report.target.detail
                            ? ` · ${formatDateTimeCompact(report.target.detail)}`
                            : ''}
                        </ThemedText>
                      ) : null}
                    </View>
                  </View>
                ) : (
                  <ThemedText type="small" style={{ color: surface.textMuted }}>
                    Der gemeldete Inhalt existiert nicht mehr.
                  </ThemedText>
                )}

                {report.note ? (
                  <ThemedText type="small" style={{ color: surface.text }}>
                    {`„${report.note}"`}
                  </ThemedText>
                ) : null}

                {report.status === 'open' ? (
                  <View style={styles.actions}>
                    <GlassChip
                      label={busy === report.id ? 'Moment …' : 'Bearbeitet'}
                      selected
                      onPress={() => setStatus(report, 'reviewed')}
                    />
                    <GlassChip label="Verworfen" onPress={() => setStatus(report, 'dismissed')} />
                    {isCommentTarget(report.target_type) && report.target?.context_id != null ? (
                      <GlassChip label="Kommentar löschen" onPress={() => removeComment(report)} />
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <ThemedText type="small" style={{ color: surface.textMuted }}>
                      {report.status === 'reviewed' ? 'Bearbeitet' : 'Verworfen'}
                      {report.admin_name ? ` von ${report.admin_name}` : ''}
                      {report.handled_at ? ` · ${formatDateTimeCompact(report.handled_at)}` : ''}
                    </ThemedText>
                    <GlassChip label="Wieder offen" onPress={() => setStatus(report, 'open')} />
                  </View>
                )}
              </GlassCard>
            </Entrance>
          );
        })}

        <SectionHeader title="" />
        <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
          Inhalte entfernen und Konten sperren geht über die Nutzerliste und die Storys – dort, wo
          es die Werkzeuge dafür schon gibt.
        </ThemedText>
      </ScrollView>
    </HomeBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  headerText: { flex: 1, gap: Spacing.half },
  title: { fontSize: 24, lineHeight: 31, fontWeight: '800', letterSpacing: -0.5 },
  centered: { textAlign: 'center' },
  card: { gap: Spacing.three },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  typeIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.field,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeadText: { flex: 1, gap: 1 },
  targetBox: {
    flexDirection: 'row',
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Radius.field,
    padding: Spacing.three,
  },
  targetImage: { width: 56, height: 56, borderRadius: Spacing.two },
  targetText: { flex: 1, gap: 2 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  pressed: { opacity: 0.7 },
});
