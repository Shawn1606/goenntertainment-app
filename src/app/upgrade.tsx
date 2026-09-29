/**
 * Upgrade: der nächste Schritt – und nur der.
 *
 * ## Warum hier nicht mehr alle Stufen stehen
 *
 * Früher listete dieser Bildschirm alle vier Stufen mit ihren Vorzügen. Das ist
 * eine Preisliste, und Preislisten beantworten die Frage nicht, mit der man
 * hierherkommt: „Was bringt mir der nächste Schritt?" Wer Standard ist, kann mit
 * „Business Plus: 5 Events hervorheben" nichts anfangen – er darf noch nicht
 * einmal ein Event anlegen. Vier Angebote gleichzeitig führen außerdem dazu, dass
 * man keines nimmt.
 *
 * Deshalb gilt jetzt: **Standard sieht Creator, Creator sieht Business, Business
 * sieht Business Plus.** Die Stufe darüber wird nur als Ausblick genannt, ohne
 * Knopf – damit klar ist, dass es weitergeht, ohne dass es zwei Angebote gäbe.
 *
 * Die Stufen und ihre Vorzüge kommen weiter aus `src/domain/account.ts` – dieselbe
 * Quelle, aus der die App ableitet, wer Events erstellen darf und wer den
 * Business-Bereich sieht. Damit kann hier nichts versprochen werden, was der Code
 * nicht hält.
 *
 * Zwei Wege, absichtlich getrennt:
 *   - Admins schalten direkt um (PATCH /api/user, serverseitig auf Admins begrenzt).
 *   - Alle anderen fragen an. Die Anfrage landet im Admin-Panel
 *     (`admin-requests.tsx`), ein Admin bestätigt oder lehnt ab.
 *
 * ## Warum die Anfrage nicht mehr per Mail geht
 *
 * Früher öffnete der Knopf das Mail-Programm mit einem vorbereiteten Text an den
 * Support. Das hat funktioniert, aber danach wusste niemand mehr Bescheid: Die
 * Anfrage lag in einem Postfach, die Stufe in der Datenbank, und die Person
 * konnte nirgends nachsehen, ob ihre Mail angekommen war. Jetzt steht der Stand
 * hier – offen, bestätigt oder abgelehnt samt Grund – und im Panel gegenüber.
 *
 * ## Monat oder Jahr – die einzige Auswahl auf diesem Bildschirm
 *
 * Der Umschalter über dem Knopf ist KEIN zweites Angebot und widerspricht dem
 * Absatz oben nicht: Es bleibt eine Stufe, nur mit zwei Zahlungsrhythmen. Beide
 * Preise stehen gleichzeitig da, damit die Wahl eine Wahl ist – vorausgewählt
 * ist das Jahresabo, weil es das günstigere von beiden ist
 * (`DEFAULT_BILLING_PERIOD`). Wer monatlich zahlen will, sieht den Preis daneben
 * und tippt einmal.
 *
 * Gerechnet wird hier nichts. „2 Monate gratis" und „entspricht 6,66 € pro
 * Monat" kommen aus `src/domain/billing-period.ts` und damit aus denselben zwei
 * Zahlen, die die Stufe kosten – so kann im Etikett nicht stehen, was der Preis
 * nicht hergibt.
 *
 * Bezahlt wird dabei weiter nichts: Es gibt keine Zahlungen in dieser App. Der
 * Bildschirm nennt den Preis und gibt den gewählten Zeitraum mit der Anfrage
 * weiter – abgebucht wird nichts, und der Knopf heißt deshalb „anfragen" und
 * nicht „kaufen".
 *
 * Sobald der In-App-Kauf läuft, wird aus demselben Umschalter die Auswahl
 * zwischen zwei RevenueCat-Packages derselben Stufe; die angezeigten Preise
 * müssen dann vom Store kommen (begründet an `monthlyPriceCents` in
 * `src/domain/account.ts`).
 */
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { MascotEmpty } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { GlassButton, GlassCard, GlassSurface } from '@/components/ui/glass';
import { Icon } from '@/components/ui/icon';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { ACCOUNT_TIERS, accountLabel, nextTier, rankOf, tierFor, type AccountTier, type AccountType } from '@/domain/account';
import {
  DEFAULT_BILLING_PERIOD,
  billingPeriodAdverb,
  monthlyEquivalentLabel,
  periodsFor,
  priceLabel,
  savingsLabel,
  type BillingPeriod,
} from '@/domain/billing-period';
import { formatDay } from '@/domain/date-format';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import { ApiError, type UpgradeRequest, api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';

export default function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const glass = useGlass();
  const { user, token, updateProfile, refreshUser } = useAuth();

  const isAdmin = !!user?.is_admin;
  const current = tierFor(user?.account_type);
  const currentRank = rankOf(user?.account_type);

  /** Das eine Angebot. `null` auf der höchsten Stufe. */
  const target = nextTier(user?.account_type);
  /** Die Stufe danach – nur als Ausblick, ohne Knopf. */
  const beyond = ACCOUNT_TIERS[currentRank + 2] ?? null;

  /**
   * Monat oder Jahr. Vorausgewählt ist das Jahresabo – begründet an
   * `DEFAULT_BILLING_PERIOD`, damit die Entscheidung an einer Stelle steht und
   * nicht als `useState('yearly')` in einem Bildschirm versteckt ist.
   */
  const [period, setPeriod] = useState<BillingPeriod>(DEFAULT_BILLING_PERIOD);

  /** Die Rhythmen, die es für dieses Angebot gibt (Standard: keine). */
  const periods = periodsFor(target?.type);

  /**
   * Der Rhythmus, mit dem gerechnet wird.
   *
   * Nicht einfach `period`: Eine Stufe könnte es irgendwann nur im Monatsabo
   * geben. Dann steht die Auswahl auf 'yearly', es gibt aber keinen Jahrespreis –
   * und der Preis darunter hieße „kostenlos". Deshalb gilt die Auswahl nur,
   * solange sie im Angebot vorkommt.
   */
  const activePeriod: BillingPeriod = periods.some((option) => option.period === period)
    ? period
    : (periods[0]?.period ?? 'monthly');

  /** Welche Stufe gerade gespeichert wird (null = keine). */
  const [saving, setSaving] = useState<AccountType | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Die eigene Anfrage; null = noch keine gestellt. */
  const [request, setRequest] = useState<UpgradeRequest | null>(null);

  /**
   * `refreshUser` in einer Ref, NICHT in den Abhängigkeiten von `load`.
   *
   * Sonst dreht sich das im Kreis: `refreshUser` holt die eigenen Daten und
   * setzt sie im Auth-Context; damit ist `user` ein neues Objekt, der Context
   * baut seine Funktionen neu, `refreshUser` bekommt eine neue Identität – und
   * ein `useCallback([refreshUser])` samt `useFocusEffect` darauf würde beim
   * nächsten Rendern erneut laufen. Das Ergebnis wäre eine Endlos-Schleife aus
   * /api/user-Aufrufen, die nichts anzeigt und nur Netz verbraucht.
   */
  const refreshRef = useRef(refreshUser);
  useEffect(() => {
    refreshRef.current = refreshUser;
  }, [refreshUser]);

  /**
   * Beim Öffnen BEIDES holen: die eigene Anfrage und die eigenen Kontodaten.
   *
   * Das Konto kann sich ohne Zutun der Person geändert haben – genau dann, wenn
   * ein Admin die Anfrage bestätigt hat. Ohne den Abgleich stünde hier weiter
   * die alte Stufe und darunter „bestätigt", was sich widerspricht.
   */
  const load = useCallback(async () => {
    if (!token) return;
    await refreshRef.current();
    try {
      const res = await api.upgradeRequest(token);
      setRequest(res.data);
    } catch {
      // Kein Netz: Der Bildschirm bleibt benutzbar, die Anfrage ist dann nur
      // nicht zu sehen. Ein Fehlerband wäre hier lauter als der Nutzen.
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /**
   * Admin-Weg: Stufe sofort umstellen.
   *
   * Der gewählte Zeitraum spielt hier absichtlich keine Rolle: Ein Admin vergibt
   * die Stufe, es fließt kein Geld, und es entsteht keine Anfrage, an der ein
   * Rhythmus hängen könnte. Der Umschalter bleibt trotzdem sichtbar – ein Admin
   * muss sehen, was allen anderen angeboten wird.
   */
  async function onSwitch(tier: AccountTier) {
    if (saving) return;
    setSaving(tier.type);
    setError(null);
    try {
      await updateProfile({ account_type: tier.type });
      await notifyUser(
        'Kontotyp geändert',
        `Dein Konto ist jetzt ${tier.label}. ${tier.tagline}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.firstError() : 'Umstellen fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setSaving(null);
    }
  }

  /** Weg für alle anderen: Anfrage stellen, die im Admin-Panel landet. */
  async function onRequest(tier: AccountTier) {
    if (saving || !token) return;
    setSaving(tier.type);
    setError(null);
    try {
      const res = await api.requestUpgrade(token, tier.type, activePeriod);
      setRequest(res.data);
      await notifyUser(
        'Anfrage ist raus',
        `Wir haben deine Anfrage auf ${tier.label} (${priceLabel(tier.type, activePeriod)}) bekommen. Sobald sie bestätigt ist, ist die Stufe da – du musst nichts weiter tun.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.firstError() : 'Anfrage fehlgeschlagen. Bitte erneut versuchen.',
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <HomeBackground style={styles.screen}>
      <Stack.Screen options={{ headerShown: true, title: 'Upgrade' }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Spacing.four, paddingBottom: insets.bottom + Spacing.six },
        ]}
        showsVerticalScrollIndicator={false}>
        <GlassCard tone="accent" radius={Radius.panel} style={styles.intro}>
          <ThemedText style={[styles.introTitle, { color: surface.text }]}>
            Deine Stufe: {current.label}
          </ThemedText>
          <ThemedText type="small" style={{ color: surface.textMuted }}>
            {isAdmin
              ? 'Als Admin schaltest du hier direkt um – auch wieder zurück.'
              : 'Bezahlen kannst du hier noch nicht: Deine Anfrage geht mit dem gewählten Zeitraum an uns, und wir schalten die Stufe frei.'}
          </ThemedText>
        </GlassCard>

        {error ? (
          <ThemedText type="small" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        {/* Der Stand der eigenen Anfrage – vor dem Angebot, denn er beantwortet
            die Frage, mit der man wiederkommt: „Und, was ist draus geworden?"
            Admins sehen das nicht: Sie schalten selbst um, ihre Anfrage wäre
            eine Anfrage an sich selbst. */}
        {!isAdmin && request ? (
          <GlassCard
            tone={request.status === 'pending' ? 'accent' : 'card'}
            radius={Radius.panel}
            style={styles.statusCard}>
            <View style={styles.statusHead}>
              <Icon
                name={
                  request.status === 'pending' ? 'hourglass' : request.status === 'approved' ? 'check' : 'close'
                }
                size={16}
                color={
                  request.status === 'pending'
                    ? surface.accent
                    : request.status === 'approved'
                      ? '#22c55e'
                      : '#ef4444'
                }
              />
              <ThemedText type="smallBold" style={{ color: surface.text, flex: 1 }}>
                {request.status === 'pending'
                  ? // Mit Zeitraum: Ohne ihn stünde hier nicht, was angefragt
                    // wurde – „Business" ist zwei verschiedene Beträge.
                    `${accountLabel(request.requested_type)} ${billingPeriodAdverb(request.billing_period)} angefragt`
                  : request.status === 'approved'
                    ? `${accountLabel(request.requested_type)} ist freigeschaltet`
                    : `${accountLabel(request.requested_type)} wurde abgelehnt`}
              </ThemedText>
            </View>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {request.status === 'pending'
                ? `Deine Anfrage vom ${formatDay(request.created_at)} über ${priceLabel(request.requested_type, request.billing_period)} liegt bei uns. Du musst nichts weiter tun – sobald sie bestätigt ist, ist die Stufe da.`
                : request.status === 'approved'
                  ? 'Viel Spaß damit! Alles, was dazugehört, ist bereits aktiv.'
                  : request.decision_note
                    ? `Grund: ${request.decision_note}`
                    : 'Es wurde kein Grund angegeben. Du kannst es erneut versuchen.'}
            </ThemedText>
          </GlassCard>
        ) : null}

        {/* Bei einer offenen Anfrage kein zweiter Knopf: Er würde die Anfrage
            ersetzen, die gerade geprüft wird. */}
        {!isAdmin && request?.status === 'pending' ? null : target ? (
          /* Das Angebot. Als einzige Karte mit Verlaufs-Knopf auf diesem
             Bildschirm – es gibt genau einen nächsten Schritt. */
          <GlassCard tone="accent" radius={Radius.panel} style={styles.tierCard}>
            <View style={styles.tierHead}>
              <View style={styles.tierTitle}>
                <ThemedText style={[styles.tierLabel, { color: surface.text }]}>
                  {target.label}
                </ThemedText>
                <ThemedText type="small" style={{ color: surface.textMuted }}>
                  {target.tagline}
                </ThemedText>
              </View>
              <ThemedText
                type="small"
                style={[styles.badge, { color: surface.accent, backgroundColor: surface.chipBg }]}>
                DEIN NÄCHSTER SCHRITT
              </ThemedText>
            </View>

            {/* Nur, was NEU dazukommt: Was die aktuelle Stufe schon kann, ist
                kein Argument – es stünde nur als Füllung in der Liste. */}
            <View style={styles.perks}>
              {newPerks(target, current).map((perk) => (
                <View key={perk} style={styles.perkRow}>
                  <Icon name="check" size={15} color={surface.accent} />
                  <ThemedText type="small" style={[styles.perkText, { color: surface.textMuted }]}>
                    {perk}
                  </ThemedText>
                </View>
              ))}
            </View>

            {/* Monat oder Jahr. Beide Preise stehen gleichzeitig da – eine
                Auswahl, in der der zweite Preis erst nach dem Umschalten
                erscheint, ist keine.

                Erst ab zwei Möglichkeiten: Bei einer Stufe ohne Jahresabo wäre
                das eine Fläche mit einem Feld, die aussieht wie eine Wahl und
                nichts tut (`periodsFor`). */}
            {periods.length > 1 ? (
              /* `radiogroup`/`radio` und nicht `button` wie bei den Pillen in
                 glass.tsx: Genau eines von beiden gilt, und nur bei dieser Rolle
                 sagt die Vorlesehilfe auch, WELCHES.

                 Der Zustand steht als `aria-checked` an jedem Feld und NICHT als
                 `accessibilityState={{ checked }}`: Im Browser nachgemessen –
                 react-native-web 0.21 bringt `accessibilityState` nicht mehr ins
                 DOM (das Attribut fehlte ganz), `aria-checked` dagegen schon.
                 React Native macht daraus auf dem Handy wieder den
                 Vorlese-Zustand, es ist also derselbe Weg für beide Seiten. */
              <View style={styles.periodRow} accessibilityRole="radiogroup">
                {periods.map((option) => {
                  const selected = option.period === activePeriod;
                  // Das Etikett nur am Jahresabo, und nur wenn es wirklich etwas
                  // spart – gerechnet aus den zwei Preisen der Stufe.
                  const badge = option.period === 'yearly' ? savingsLabel(target.type) : null;
                  return (
                    <Pressable
                      key={option.period}
                      onPress={() => setPeriod(option.period)}
                      disabled={saving !== null}
                      accessibilityRole="radio"
                      aria-checked={selected}
                      accessibilityLabel={`${option.label}, ${priceLabel(target.type, option.period)}${badge ? `, ${badge}` : ''}`}
                      style={({ pressed }) => [styles.periodItem, pressed && styles.periodPressed]}>
                      <GlassSurface
                        tone={selected ? 'frost' : 'subtle'}
                        radius={Radius.field}
                        sheen={false}
                        style={[
                          styles.period,
                          { borderColor: selected ? surface.accent : glass.border },
                        ]}>
                        <ThemedText
                          type="smallBold"
                          style={{ color: selected ? surface.text : surface.textMuted }}>
                          {option.label}
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.periodPrice,
                            { color: selected ? surface.text : surface.textMuted },
                          ]}>
                          {priceLabel(target.type, option.period)}
                        </ThemedText>
                        {badge ? (
                          <ThemedText
                            type="small"
                            style={[
                              styles.periodBadge,
                              { color: surface.accent, backgroundColor: surface.chipBg },
                            ]}>
                            {badge}
                          </ThemedText>
                        ) : null}
                      </GlassSurface>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              /* Nur ein Rhythmus: dann steht der Preis als Zeile da, statt als
                 Auswahl ohne Alternative. */
              <ThemedText type="smallBold" style={{ color: surface.text }}>
                {priceLabel(target.type, activePeriod)}
              </ThemedText>
            )}

            {/* Der Vergleichspreis nur beim Jahresabo – beim Monatsabo stünde
                dort der Preis, der eine Zeile höher schon steht. */}
            {activePeriod === 'yearly' && monthlyEquivalentLabel(target.type) ? (
              <ThemedText type="small" style={{ color: surface.textMuted }}>
                {monthlyEquivalentLabel(target.type)}
              </ThemedText>
            ) : null}

            <GlassButton
              title={
                saving === target.type
                  ? isAdmin
                    ? 'Wird gespeichert …'
                    : 'Wird gesendet …'
                  : isAdmin
                    ? `Auf ${target.label} wechseln`
                    : // Nach einer Ablehnung heißt derselbe Knopf anders: „anfragen"
                      // würde verschweigen, dass hier schon einmal etwas lief.
                      request?.status === 'rejected' && request.requested_type === target.type
                      ? `${target.label} erneut anfragen`
                      : `${target.label} anfragen`
              }
              variant="primary"
              disabled={saving !== null}
              onPress={() => (isAdmin ? onSwitch(target) : onRequest(target))}
            />
          </GlassCard>
        ) : (
          <GlassCard tone="accent" radius={Radius.panel} style={styles.tierCard}>
            <MascotEmpty mood="cheer" size={88}>
              <ThemedText style={[styles.tierLabel, { color: surface.text }]}>
                Höchste Stufe erreicht
              </ThemedText>
              <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                {`${current.label} ist das Beste, was es gibt. Danke, dass du dabei bist!`}
              </ThemedText>
            </MascotEmpty>
          </GlassCard>
        )}

        {/* Ausblick auf die Stufe danach – ohne Knopf. Sie soll erkennbar
            existieren, aber nicht als zweites Angebot mit dem ersten
            konkurrieren. */}
        {beyond ? (
          <View style={styles.beyond}>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              {`Später geht es weiter mit ${beyond.label}: ${beyond.tagline}`}
            </ThemedText>
          </View>
        ) : null}

        {/* Nur Admins brauchen den Weg zurück – sie prüfen die Stufen. */}
        {isAdmin && currentRank > 0 ? (
          <GlassCard tone="card" radius={Radius.panel} style={styles.tierCard}>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Zum Prüfen: als Admin auf eine niedrigere Stufe zurückstellen.
            </ThemedText>
            {ACCOUNT_TIERS.slice(0, currentRank).map((tier) => (
              <GlassButton
                key={tier.type}
                title={saving === tier.type ? 'Wird gespeichert …' : `Zurück auf ${tier.label}`}
                variant="ghost"
                disabled={saving !== null}
                onPress={() => onSwitch(tier)}
              />
            ))}
          </GlassCard>
        ) : null}
      </ScrollView>
    </HomeBackground>
  );
}

/**
 * Was die nächste Stufe kann, das die aktuelle noch nicht kann.
 *
 * Rein textlicher Abgleich der `perks` – und das reicht, weil die Listen in
 * `src/domain/account.ts` bewusst wortgleich aufeinander aufbauen. Bleibt nichts
 * übrig (etwa weil eine Stufe nur „Alles aus Business" nennt), zeigen wir die
 * volle Liste: eine leere Vorzugsliste unter einem Angebot wäre schlimmer als
 * eine, in der eine Zeile doppelt steht.
 */
function newPerks(target: AccountTier, current: AccountTier): readonly string[] {
  const known = new Set(current.perks);
  const fresh = target.perks.filter((perk) => !known.has(perk));
  return fresh.length > 0 ? fresh : target.perks;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.four,
  },
  intro: { gap: Spacing.one, padding: Spacing.four },
  statusCard: { gap: Spacing.one, padding: Spacing.four },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  introTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.4 },
  error: { color: '#ef4444', textAlign: 'center' },
  tierCard: { gap: Spacing.three, padding: Spacing.four },
  tierHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  tierTitle: { flex: 1, gap: 2 },
  tierLabel: { fontSize: 18, lineHeight: 24, fontWeight: '800', letterSpacing: -0.3 },
  badge: {
    fontWeight: '800',
    letterSpacing: 1.1,
    fontSize: 10,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  /* Zwei gleich große Felder nebeneinander: Ein schmaleres Monatsfeld wäre eine
     Empfehlung, die nicht im Text steht. */
  periodRow: { flexDirection: 'row', gap: Spacing.two },
  periodItem: { flex: 1 },
  periodPressed: { opacity: 0.75 },
  /* Kein `borderWidth` – den bringt GlassSurface mit, hier wird nur die Farbe
     getauscht (genau wie bei der ausgewählten Pille in glass.tsx). */
  period: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    minHeight: 84,
  },
  periodPrice: { fontSize: 15, lineHeight: 20, fontWeight: '800', letterSpacing: -0.2 },
  periodBadge: {
    fontWeight: '800',
    letterSpacing: 0.4,
    fontSize: 9,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  perks: { gap: Spacing.one },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  perkText: { flex: 1 },
  centered: { textAlign: 'center' },
  beyond: { paddingHorizontal: Spacing.two },
});
