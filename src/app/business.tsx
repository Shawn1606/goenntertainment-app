/**
 * Business-Bereich: Umsatz und Reichweite der eigenen Events.
 *
 * ## Warum das kein Tab mehr ist
 *
 * Androids untere Leiste fasst höchstens fünf Ziele; ab dem sechsten faltet sie
 * alles in ein „More"-Menü. Seit „Freunde" dazugekommen ist, sind die fünf mit
 * Home, Karte, Freunden, Aktivitäten und Einstellungen belegt – und die haben
 * ALLE Konten. Ein Bereich, den nur Business-Stufen sehen, kann dafür keinen
 * dauerhaften Platz beanspruchen.
 *
 * Er liegt jetzt als eigene Stack-Route und wird über das Konto-Blatt erreicht –
 * genau der Weg, den der Admin-Bereich aus demselben Grund schon geht (siehe
 * `src/components/account-widget.tsx`). Die Prüfung unten bleibt die
 * Sicherheitsleine für den Fall, dass jemand die Route direkt aufruft.
 *
 * Zwei Sichten in EINEM Screen und nicht zwei: Umsatz und Reichweite beantworten
 * dieselbe Frage aus zwei Richtungen, der Umschalter oben trennt sie sauber.
 *
 * Zum Umsatz: Die App kann noch keine Bezahl-Events, also steht hier auch kein
 * Umsatz – der Server sagt selbst, woran es liegt (`revenue.reason`), und wir
 * geben es weiter. Was ECHT ist, sind die Buchungen und die Reichweite: beides
 * aus den Beitritten und den Aufrufen der eigenen Events gezählt.
 */
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { GlassCard, GlassProgressBar, GlassSurface, SectionHeader } from '@/components/ui/glass';
import { Segmented } from '@/components/ui/segmented';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { accountAbilities } from '@/domain/account';
import { isBoosted } from '@/domain/recommendations';
import { useBrandSurface } from '@/hooks/use-theme';
import { ApiError, api, type BusinessEvent, type BusinessInsights, type BusinessMonthPoint } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Sight = 'revenue' | 'reach';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** '2026-07' → 'Jul 26'. Kurz, weil es in eine Zeile mit dem Balken muss. */
function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  return `${MONTHS_SHORT[Number(index) - 1] ?? month} ${year?.slice(2) ?? ''}`;
}

/**
 * Cent in „1.234,50 €". Bewusst von Hand statt mit `toLocaleString`: Die
 * Sprachdaten dafür sind auf Android nicht überall an Bord, und ein
 * durchgerutschtes „1234.5" sähe in einer Umsatzanzeige besonders schlecht aus.
 */
function euro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${rest} €`;
}

/** Datum kurz: „27. Jul". */
function shortDate(iso: string | null): string {
  if (!iso) return 'ohne Termin';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'ohne Termin';
  return `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

export default function BusinessScreen() {
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const { token, user } = useAuth();

  const abilities = accountAbilities(user);

  const [sight, setSight] = useState<Sight>('revenue');
  const [data, setData] = useState<BusinessInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Welches Event gerade hervorgehoben/zurückgesetzt wird. */
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setData(await api.businessInsights(token));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.firstError() : 'Zahlen konnten nicht geladen werden.',
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

  /**
   * Hervorheben an/aus. Danach wird neu geladen statt im Zustand nachgerechnet:
   * Die belegten Plätze hängen an allen Events, das rechnet der Server richtig
   * und wir müssen es nicht ein zweites Mal tun.
   */
  async function toggleBoost(event: BusinessEvent) {
    if (!token || busyId !== null) return;
    setBusyId(event.id);
    setError(null);
    try {
      if (isBoosted(event, new Date())) {
        await api.unboostActivity(token, event.id);
      } else {
        await api.boostActivity(token, event.id);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.firstError() : 'Das hat nicht geklappt.');
    } finally {
      setBusyId(null);
    }
  }

  // Sicherheitsleine für den direkten Aufruf (Web-Adresse, alter Verlauf): Der
  // Eintrag im Konto-Blatt fehlt bei kleineren Stufen, der Server antwortet mit 403.
  // Steht nach allen Hooks – ein früherer Ausstieg würde deren Reihenfolge ändern.
  if (!abilities.hasBusinessArea) {
    return (
      <HomeBackground style={styles.screen}>
        <Stack.Screen options={{ headerShown: true, title: 'Business' }} />
        <View style={[styles.locked, { paddingTop: insets.top + Spacing.six }]}>
          <Icon name="trend-up" size={44} color={surface.accent} />
          <ThemedText style={[styles.lockedTitle, { color: surface.text }]}>
            Business-Bereich
          </ThemedText>
          {/* Als Zeichenkette und nicht als JSX-Text: Die Anführungszeichen um
              „Upgrade" darf JSX so nicht direkt enthalten. */}
          <ThemedText type="small" style={[styles.centerText, { color: surface.textMuted }]}>
            {'Umsatz und Reichweite gehören zu den Business-Stufen. Das Upgrade findest du über ' +
              'das Feld „Upgrade" oben links auf der Startseite.'}
          </ThemedText>
        </View>
      </HomeBackground>
    );
  }

  return (
    <HomeBackground style={styles.screen}>
      {/* Eigene Kopfzeile mit Zurück-Pfeil: Als Stack-Route gibt es keine untere
          Leiste mehr, über die man wieder herauskäme. */}
      <Stack.Screen options={{ headerShown: true, title: 'Business' }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // Kein `BottomTabInset` mehr: Über diesem Screen liegt keine Tab-Leiste,
          // der Platz dafür wäre nur ein Loch am Ende der Liste.
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        showsVerticalScrollIndicator={false}>
        {/* Ohne eigene Überschrift: Seit das ein Stack-Screen ist, steht
            „Business" schon in der Kopfzeile darüber – zweimal wäre es ein
            Flüchtigkeitsfehler. */}
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary">
            Deine Zahlen aus {data ? `${data.months} Monaten` : 'den letzten Monaten'} – nur deine
            eigenen Events.
          </ThemedText>
        </View>

        <Segmented
          segments={[
            { value: 'revenue', label: 'Umsatz' },
            { value: 'reach', label: 'Reichweite' },
          ]}
          value={sight}
          onChange={setSight}
        />

        {error ? (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        {loading && !data ? (
          <View style={styles.state}>
            <ActivityIndicator color={surface.accent} />
          </View>
        ) : null}

        {data && sight === 'revenue' ? (
          <View style={styles.section}>
            <GlassCard tone="accent" radius={Radius.panel} style={styles.bigCard}>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                Umsatz über die App
              </ThemedText>
              <ThemedText style={[styles.bigValue, { color: surface.text }]}>
                {euro(data.revenue.gross_cents)}
              </ThemedText>
              {/* Der Grund kommt vom Server – keine erfundene Zahl, keine
                  erfundene Erklärung. */}
              {!data.revenue.available ? (
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  {data.revenue.reason}
                </ThemedText>
              ) : null}
            </GlassCard>

            <SectionHeader title="Buchungen" />
            <GlassCard style={styles.card}>
              <View style={styles.tileRow}>
                <Tile label="Buchungen" value={data.bookings.total} />
                <Tile label="Events" value={data.reach.events} />
                <Tile label="Besucher:innen" value={data.reach.visitors} />
              </View>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                Eine Buchung ist ein Beitritt zu einem deiner Events – dein eigener Platz zählt
                nicht mit. Sobald es Bezahl-Events gibt, wird daraus dein Umsatz.
              </ThemedText>
            </GlassCard>

            <Bars title="Buchungen je Monat" series={data.bookings.series} />
          </View>
        ) : null}

        {data && sight === 'reach' ? (
          <View style={styles.section}>
            <GlassCard tone="accent" radius={Radius.panel} style={styles.bigCard}>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                Aufrufe deiner Events
              </ThemedText>
              <ThemedText style={[styles.bigValue, { color: surface.text }]}>
                {data.reach.views}
              </ThemedText>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                von {data.reach.visitors} verschiedenen Leuten · {data.reach.events} Events
              </ThemedText>
            </GlassCard>

            <Bars title="Aufrufe je Monat" series={data.reach.series} />

            <SectionHeader
              title="Reichweite erweitern"
              action={
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  {data.boost.used}/{data.boost.slots} belegt
                </ThemedText>
              }
            />
            <GlassCard style={styles.card}>
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                Ein hervorgehobenes Event steht {data.boost.days} Tage weiter vorne in den
                Empfehlungen. Interessen der Leute wiegen weiter schwerer – wer Musik gewählt hat,
                sieht Musik zuerst.
              </ThemedText>
            </GlassCard>

            {data.events.length === 0 ? (
              <GlassCard tone="accent" style={styles.card}>
                <ThemedText style={{ color: surface.text }}>Noch keine eigenen Events.</ThemedText>
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  Sobald du ein Event erstellt hast, kannst du es hier hervorheben.
                </ThemedText>
              </GlassCard>
            ) : (
              data.events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  busy={busyId === event.id}
                  disabled={busyId !== null}
                  onToggle={() => toggleBoost(event)}
                />
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </HomeBackground>
  );
}

/** Eine Zahl mit Beschriftung – drei davon passen in eine Zeile. */
function Tile({ label, value }: { label: string; value: number }) {
  const surface = useBrandSurface();

  return (
    <View style={styles.tile}>
      <ThemedText style={[styles.tileValue, { color: surface.text }]}>{value}</ThemedText>
      <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * Monats-Balken. Liegende Balken statt stehender: Die Monatsnamen bleiben
 * lesbar, und der breiteste Balken ist immer der Vergleichsmaßstab.
 */
function Bars({ title, series }: { title: string; series: BusinessMonthPoint[] }) {
  const surface = useBrandSurface();
  const max = series.reduce((top, point) => Math.max(top, point.count), 0);

  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      <GlassCard style={styles.card}>
        {max === 0 ? (
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            In diesem Zeitraum ist noch nichts zusammengekommen.
          </ThemedText>
        ) : (
          series.map((point) => (
            <View key={point.month} style={styles.barRow}>
              <ThemedText type="small" style={[styles.barLabel, { color: surface.textMuted }]}>
                {monthLabel(point.month)}
              </ThemedText>
              <View style={styles.barTrack}>
                <GlassProgressBar progress={point.count / max} height={10} />
              </View>
              <ThemedText type="smallBold" style={[styles.barValue, { color: surface.text }]}>
                {point.count}
              </ThemedText>
            </View>
          ))
        )}
      </GlassCard>
    </View>
  );
}

/** Ein eigenes Event mit seinen Zahlen und dem Knopf zum Hervorheben. */
function EventRow({
  event,
  busy,
  disabled,
  onToggle,
}: {
  event: BusinessEvent;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const surface = useBrandSurface();
  const active = isBoosted(event, new Date());

  return (
    <GlassCard style={styles.eventCard}>
      <View style={styles.eventHead}>
        <View style={styles.eventTitle}>
          <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
            {event.title}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
            {shortDate(event.starts_at)} · {event.views} Aufrufe · {event.bookings} Buchungen
          </ThemedText>
        </View>

        <Pressable
          onPress={onToggle}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: active, disabled }}
          accessibilityLabel={active ? 'Hervorhebung wegnehmen' : 'Event hervorheben'}
          style={({ pressed }) => pressed && styles.pressed}>
          <GlassSurface
            tone="frost"
            radius={999}
            sheen={false}
            style={[
              styles.boostButton,
              {
                borderColor: active ? surface.accent : surface.chipBorder,
                backgroundColor: active ? surface.chipBg : undefined,
              },
            ]}>
            {busy ? (
              <ActivityIndicator size="small" color={surface.accent} />
            ) : (
              <>
                {/* Gefüllt = an, Kontur = aus. Der Unterschied liegt in der Form,
                    nicht nur in der Farbe – sonst wäre der Zustand für alle
                    unsichtbar, die den Farbwechsel nicht sehen. */}
                <Icon
                  name={active ? 'star-filled' : 'star'}
                  size={14}
                  color={active ? surface.accent : surface.textMuted}
                />
                <ThemedText type="small" style={{ color: active ? surface.accent : surface.textMuted }}>
                  {active ? 'hervorgehoben' : 'hervorheben'}
                </ThemedText>
              </>
            )}
          </GlassSurface>
        </Pressable>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
    gap: Spacing.four,
  },
  header: { gap: Spacing.half },
  section: { gap: Spacing.three },
  state: { paddingVertical: Spacing.six, alignItems: 'center' },
  error: { color: '#ef4444', textAlign: 'center' },
  card: { gap: Spacing.three, padding: Spacing.four },
  bigCard: { gap: Spacing.one, padding: Spacing.four },
  bigValue: { fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  tileRow: { flexDirection: 'row' },
  tile: { flex: 1, alignItems: 'center', gap: 1 },
  tileValue: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  barLabel: { width: 52 },
  barTrack: { flex: 1 },
  barValue: { minWidth: 28, textAlign: 'right' },
  eventCard: { padding: Spacing.three },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  eventTitle: { flex: 1, gap: 1 },
  boostButton: {
    minHeight: 36,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  pressed: { opacity: 0.7 },
  locked: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  lockedEmoji: { fontSize: 40, lineHeight: 46 },
  lockedTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  centerText: { textAlign: 'center' },
});
