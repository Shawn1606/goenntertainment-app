/**
 * Credits aufladen – das Blatt hinter der Münze in der Kopfzeile.
 *
 * Von überall erreichbar (`useCreditsSheet().open()`), deshalb als Provider um
 * die ganze App: Die Kopfzeile jedes Tabs öffnet dasselbe Blatt, und ein Kauf
 * aktualisiert überall denselben Stand (useMarket().setCredits).
 *
 * ## Was hier steht – und was bewusst nicht
 *
 * Jedes Paket zeigt seinen Mengenbonus ausdrücklich: „200 + 50". Beim
 * allerersten Kauf eines Kontos kommt der Erstkauf-Bonus dazu (+20 % der
 * Paketgröße, einmalig) – ob er noch zusteht, sagt der Server
 * (`club.first_purchase_bonus_percent`). Den Kurs
 * dahinter (Cent je Credit) und einen Euro-Gegenwert des Guthabens zeigt die
 * App nirgends – Credits sind Credits. Preise und Bonus kommen aus
 * shared/club.json; der Server rechnet beim Kauf dasselbe noch einmal.
 *
 * ## Nach dem Kauf
 *
 * Das Blatt wechselt ganz in den Erfolgs-Moment (`PurchaseSuccess`): Münzen
 * regnen, Goenni schlägt einen Salto, die gekauften Credits zählen groß hoch,
 * darunter, was davon Bonus ist und BIS WANN genau dieses Paket gilt (jede
 * Gutschrift verfällt für sich). Ein Overlay darüber ginge nicht, das Blatt ist
 * schon ein Modal. Schließt man das Blatt, jubelt Goenni unten im Dock noch
 * einmal (`useMascotDock().say`).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';

import { Burst } from '@/components/celebration';
import { Mascot } from '@/components/mascot';
import { useMascotDock } from '@/components/mascot-dock';
import { Button } from '@/components/ui/button';
import { CountUp } from '@/components/ui/count-up';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { FontFamily, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import {
  creditValidityFor,
  creditValidityLabel,
  firstPurchaseBonus,
  formatCredits,
  formatEuro,
  packBonus,
  packPriceCents,
  packTotalCredits,
} from '@/domain/club';
import { formatDay } from '@/domain/date-format';
import { purchaseLine } from '@/domain/mascot-lines';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction, notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/** `onPurchased` läuft nach einem erfolgreichen Kauf – z. B. um einen Kontoauszug nachzuladen. */
type CreditsSheetValue = { open: (onPurchased?: () => void) => void };

const CreditsSheetContext = createContext<CreditsSheetValue>({ open: () => {} });

export function useCreditsSheet(): CreditsSheetValue {
  return useContext(CreditsSheetContext);
}

/** Bis wann ein heute gekauftes Paket gilt – als ISO-Zeitpunkt für formatDay. */
function validUntilFromNow(validity: { days?: number; months?: number }): string {
  const until = new Date();
  if (validity.months) until.setMonth(until.getMonth() + validity.months);
  if (validity.days) until.setDate(until.getDate() + validity.days);
  return until.toISOString();
}

/** Orientierung statt Qual der Wahl: zwei Pakete bekommen ein Fähnchen. */
const FLAGS: Record<number, string> = { 200: 'Beliebt', 1000: 'Bester Wert' };

export function CreditsSheetProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const purchased = useRef<(() => void) | undefined>(undefined);
  const open = useCallback((onPurchased?: () => void) => {
    purchased.current = onPurchased;
    feedback.opened();
    setVisible(true);
  }, []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <CreditsSheetContext.Provider value={value}>
      {children}
      <CreditsSheet visible={visible} onClose={() => setVisible(false)} onPurchased={() => purchased.current?.()} />
    </CreditsSheetContext.Provider>
  );
}

function CreditsSheet({ visible, onClose, onPurchased }: { visible: boolean; onClose: () => void; onPurchased: () => void }) {
  const colors = useTheme();
  const router = useRouter();
  const { token, user } = useAuth();
  const { setCredits, club, refreshClub } = useMarket();
  const [buying, setBuying] = useState<number | null>(null);
  /** Der letzte Kauf – für Feier und Erfolgszeile; `key` zählt hoch. */
  const [success, setSuccess] = useState<{ added: number; bonus: number; key: number; until: string } | null>(null);
  const dock = useMascotDock();

  const balance = user?.credits_balance ?? 0;
  const testMode = (club?.payments_mode ?? 'test') === 'test';
  /** Erstkauf-Bonus in Prozent, solange das Konto noch nie ein Paket gekauft hat. */
  const firstPercent = club?.first_purchase_bonus_percent ?? 0;
  const firstBonusFor = (credits: number) => (firstPercent > 0 ? firstPurchaseBonus(CLUB_RULES, credits) : 0);
  const validity = creditValidityLabel(CLUB_RULES, user?.club_plan);

  const buy = async (credits: number) => {
    if (!token || buying !== null) return;
    const bonus = packBonus(CLUB_RULES, credits);
    const first = firstBonusFor(credits);
    const extra = bonus + first;
    const price = formatEuro(packPriceCents(CLUB_RULES, credits));
    const ok = await confirmAction(
      `${formatCredits(credits)}${extra ? ` + ${formatCredits(extra)}` : ''} Credits kaufen`,
      `Für ${price}.${extra ? ` Du bekommst insgesamt ${formatCredits(credits + extra)} Credits${first ? `, davon ${formatCredits(first)} Erstkauf-Bonus` : ''}.` : ''} Credits gelten ${validity} ab Kauf.${testMode ? '\n\nTestmodus: Es wird kein echtes Geld abgebucht.' : ''}`,
      'Zahlungspflichtig kaufen',
    );
    if (!ok) return;
    setBuying(credits);
    try {
      const { data } = await api.buyCredits(token, credits);
      setCredits(data.balance);
      onPurchased();
      const until = validUntilFromNow(creditValidityFor(CLUB_RULES, user?.club_plan));
      setSuccess((prev) => ({ added: data.added, bonus: (data.bonus ?? 0) + (data.first_purchase_bonus ?? 0), key: (prev?.key ?? 0) + 1, until }));
      dock.say(purchaseLine(data.added, formatDay(until)), 'flip');
      // Der Erstkauf-Bonus ist jetzt verbraucht – der Club-Stand weiß das erst nach dem Nachladen.
      if (data.first_purchase_bonus) void refreshClub();
      feedback.achieved();
    } catch (e) {
      feedback.failed();
      await notifyUser('Kauf hat nicht geklappt', errorMessage(e));
    } finally {
      setBuying(null);
    }
  };

  const close = () => {
    onClose();
    setSuccess(null);
  };

  const go = (path: '/wallet' | '/club') => {
    close();
    setTimeout(() => router.push(path), 180);
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={success ? 'Credits gutgeschrieben!' : 'Credits aufladen'}
      subtitle={success ? undefined : "Je größer das Paket, desto mehr Bonus-Credits gibt's gratis dazu."}>
      {success ? (
        <PurchaseSuccess
          key={success.key}
          added={success.added}
          bonus={success.bonus}
          balance={balance}
          until={success.until}
          onMore={() => setSuccess(null)}
          onDone={close}
          onWallet={() => go('/wallet')}
        />
      ) : (
        <>
      <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balance}>
        <Mascot mood="happy" size={64} lively />
        <View style={{ flex: 1 }}>
          <Text style={styles.balanceLabel}>Dein Guthaben</Text>
          <View style={styles.balanceRow}>
            <Icon name="coin" size={24} color="#ffd24a" />
            <CountUp value={balance} durationMs={900} format={formatCredits} style={styles.balanceValue} />
            <Text style={styles.balanceUnit}>Credits</Text>
          </View>
        </View>
      </LinearGradient>

      {firstPercent > 0 ? (
        <View style={styles.firstBanner} accessibilityRole="text">
          <Icon name="gift" size={18} color="#5b3a00" />
          <Text style={styles.firstBannerText}>Dein erster Kauf: +{firstPercent} % Credits extra – einmalig, auf jedes Paket.</Text>
        </View>
      ) : null}

      <View style={styles.packs}>
        {CLUB_RULES.credits.packs.map((credits) => {
          const bonus = packBonus(CLUB_RULES, credits);
          const first = firstBonusFor(credits);
          const flag = FLAGS[credits];
          const price = formatEuro(packPriceCents(CLUB_RULES, credits));
          return (
            <PressableScale
              key={credits}
              onPress={() => buy(credits)}
              disabled={buying !== null}
              scaleTo={0.98}
              accessibilityRole="button"
              accessibilityLabel={`${formatCredits(credits)}${bonus ? ` plus ${formatCredits(bonus)} Bonus` : ''}${first ? ` plus ${formatCredits(first)} Erstkauf-Bonus` : ''} Credits für ${price} kaufen`}
              style={[styles.pack, { borderColor: flag ? colors.tint : colors.border, backgroundColor: colors.background }, flag ? styles.packFlagged : null]}>
              {flag ? (
                <View style={[styles.flag, { backgroundColor: colors.tint }]}>
                  <Text style={styles.flagText}>{flag}</Text>
                </View>
              ) : null}
              <View style={[styles.packIcon, { backgroundColor: colors.backgroundSelected }]}>
                <Icon name="coin" size={24} color="#e3a60b" />
              </View>
              <View style={styles.packText}>
                <View style={styles.packAmount}>
                  <Text style={[styles.packCredits, { color: colors.text }]}>{formatCredits(credits)}</Text>
                  {bonus ? (
                    <View style={styles.bonus}>
                      <Text style={styles.bonusText}>+ {formatCredits(bonus)}</Text>
                    </View>
                  ) : null}
                  {first ? (
                    <View style={[styles.bonus, styles.firstChip]}>
                      <Text style={[styles.bonusText, styles.firstChipText]}>+ {formatCredits(first)}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.packLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                  {bonus || first ? `= ${formatCredits(packTotalCredits(CLUB_RULES, credits) + first)} Credits` : 'Credits'}
                </Text>
              </View>
              <View style={[styles.price, { backgroundColor: flag ? colors.tint : colors.backgroundSelected }]}>
                <Text style={[styles.priceText, { color: flag ? '#ffffff' : colors.text }]}>{buying === credits ? '…' : price}</Text>
              </View>
            </PressableScale>
          );
        })}
      </View>

      <Text style={[styles.valid, { color: colors.textSecondary }]}>Gekaufte Credits gelten {validity} ab Kauf.</Text>

      {testMode ? (
        <View style={[styles.note, { borderColor: colors.border }]}>
          <Icon name="info" size={16} color={colors.textSecondary} />
          <Text style={[styles.noteText, { color: colors.textSecondary }]}>Testmodus: Käufe werden sofort gutgeschrieben, es fließt kein Geld.</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button title="Gutschein" accessibilityLabel="Gutschein einlösen" icon="gift" variant="secondary" onPress={() => go('/wallet')} style={styles.action} />
        <Button title="Club" accessibilityLabel="Club-Vorteile ansehen" icon="crown" variant="secondary" onPress={() => go('/club')} style={styles.action} />
      </View>
      <Button title="Kontoauszug ansehen" variant="ghost" size="small" onPress={() => go('/wallet')} />
        </>
      )}
    </Sheet>
  );
}

/** Münzen, die über die Erfolgs-Fläche regnen – feste Bahnen, jede mit eigenem Takt. */
const RAIN = Array.from({ length: 16 }, (_, i) => ({
  x: ((i * 61) % 100) / 100,
  delay: (i * 137) % 900,
  duration: 1100 + ((i * 89) % 700),
  size: 14 + ((i * 7) % 10),
  spin: (i % 2 ? 1 : -1) * (180 + ((i * 53) % 300)),
}));

function RainCoin({ coin, height, width, run }: { coin: (typeof RAIN)[number]; height: number; width: number; run: SharedValue<number> }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withDelay(coin.delay, withRepeat(withTiming(1, { duration: coin.duration, easing: Easing.in(Easing.quad) }), 3, false)));
  }, [coin, t]);
  const style = useAnimatedStyle(() => ({
    opacity: run.value * interpolate(t.value, [0, 0.1, 0.85, 1], [0, 1, 1, 0]),
    transform: [{ translateX: coin.x * (width - coin.size) }, { translateY: -30 + t.value * (height + 40) }, { rotate: `${coin.spin * t.value}deg` }],
  }));
  return (
    <Animated.View style={[styles.rainCoin, { width: coin.size, height: coin.size, borderRadius: coin.size / 2 }, style]}>
      <View style={[styles.rainCoinInner, { width: coin.size * 0.45, height: coin.size * 0.45, borderRadius: coin.size }]} />
    </Animated.View>
  );
}

/**
 * Der Erfolgs-Moment nach dem Kauf. Groß, weil er groß ist: Man hat gerade Geld
 * ausgegeben und will sehen, dass es angekommen ist – und bis wann es gilt.
 */
function PurchaseSuccess({
  added,
  bonus,
  balance,
  until,
  onMore,
  onDone,
  onWallet,
}: {
  added: number;
  bonus: number;
  balance: number;
  until: string;
  onMore: () => void;
  onDone: () => void;
  onWallet: () => void;
}) {
  const colors = useTheme();
  const reduced = useReducedMotion();
  const run = useSharedValue(reduced ? 0 : 1);
  const pop = useSharedValue(reduced ? 1 : 0);
  const [trickKey, setTrickKey] = useState(0);

  useEffect(() => {
    if (reduced) return;
    pop.set(withTiming(1, { duration: 520, easing: Easing.out(Easing.back(2)) }));
    const timer = setTimeout(() => setTrickKey(1), 200);
    // Nach dem Regen langsam ausblenden.
    const fade = setTimeout(() => run.set(withTiming(0, { duration: 600 })), 4200);
    return () => {
      clearTimeout(timer);
      clearTimeout(fade);
    };
  }, [reduced, pop, run]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(pop.value, [0, 1], [0.6, 1]) }], opacity: Math.min(1, pop.value * 1.5) }));

  const W = 340;
  const H = 300;

  return (
    <View style={styles.successWrap}>
      <LinearGradient colors={[...Night.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.successPanel}>
        {reduced ? null : (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {RAIN.map((coin, i) => (
              <RainCoin key={i} coin={coin} width={W} height={H} run={run} />
            ))}
          </View>
        )}
        <Mascot mood="cheer" size={104} trick="flip" trickKey={trickKey} waves celebrate />
        <Animated.View style={[styles.successAmount, popStyle]} accessibilityLiveRegion="polite" accessible accessibilityLabel={`Plus ${formatCredits(added)} Credits`}>
          <Icon name="coin" size={34} color="#ffd24a" />
          <CountUp value={added} animateOnMount durationMs={1100} format={(v) => `+${formatCredits(v)}`} style={styles.successValue} />
        </Animated.View>
        <Text style={styles.successLine}>{bonus > 0 ? `Davon ${formatCredits(bonus)} Bonus-Credits geschenkt!` : 'Sind schon auf deinem Konto.'}</Text>
        <View style={styles.successUntil}>
          <Icon name="hourglass" size={16} color="#25f4ee" />
          <Text style={styles.successUntilText}>Dieses Paket gilt bis {formatDay(until)}</Text>
        </View>
        <Text style={styles.successBalance}>Neuer Stand: {formatCredits(balance)} Credits</Text>
        <Burst burstKey={1} kind="coins" radius={190} />
      </LinearGradient>
      <Text style={[styles.successNote, { color: colors.textSecondary }]}>Jedes Paket hat sein eigenes Ablaufdatum – was du später kaufst, gilt ab dann.</Text>
      <View style={styles.actions}>
        <Button title="Noch ein Paket" icon="plus" variant="secondary" onPress={onMore} style={styles.action} />
        <Button title="Fertig" icon="check" onPress={onDone} style={styles.action} />
      </View>
      <Button title="Was wann verfällt" variant="ghost" size="small" onPress={onWallet} />
    </View>
  );
}

const styles = StyleSheet.create({
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.panel,
    padding: Spacing.three,
    overflow: 'visible',
  },
  balanceLabel: { color: Night.textMuted, fontFamily: FontFamily.semibold, fontSize: 13 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balanceValue: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 30, lineHeight: 36 },
  balanceUnit: { color: Night.textMuted, fontFamily: FontFamily.semibold, fontSize: 14, marginTop: 6 },
  successWrap: { gap: Spacing.three },
  successPanel: { borderRadius: Radius.panel, padding: Spacing.four, alignItems: 'center', gap: Spacing.two, overflow: 'hidden', minHeight: 300 },
  successAmount: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  successValue: { color: '#ffd24a', fontFamily: FontFamily.bold, fontSize: 46, lineHeight: 54 },
  successLine: { color: '#ffffff', fontFamily: FontFamily.semibold, fontSize: 15, textAlign: 'center' },
  successUntil: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(37,244,238,0.14)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: Spacing.one,
  },
  successUntilText: { color: '#25f4ee', fontFamily: FontFamily.bold, fontSize: 13.5 },
  successBalance: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13 },
  successNote: { fontFamily: FontFamily.medium, fontSize: 12.5, textAlign: 'center' },
  rainCoin: { position: 'absolute', top: 0, left: 0, backgroundColor: '#ffd24a', borderWidth: 2, borderColor: '#e3a60b', alignItems: 'center', justifyContent: 'center' },
  rainCoinInner: { borderWidth: 1.5, borderColor: '#e3a60b' },
  packs: { gap: Spacing.two },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: Stroke,
    borderRadius: Radius.card,
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
  },
  packFlagged: { borderWidth: 2, marginTop: 6 },
  flag: { position: 'absolute', top: -10, left: Spacing.three, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  flagText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 10.5, letterSpacing: 0.3 },
  packIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  packText: { flex: 1, gap: 1 },
  packAmount: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  packCredits: { fontFamily: FontFamily.bold, fontSize: 22 },
  bonus: { backgroundColor: '#ffd24a', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  bonusText: { color: '#5b3a00', fontFamily: FontFamily.bold, fontSize: 13 },
  firstChip: { backgroundColor: '#34d399' },
  firstChipText: { color: '#053b2a' },
  firstBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#ffd24a',
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: Spacing.three,
  },
  firstBannerText: { flex: 1, color: '#5b3a00', fontFamily: FontFamily.bold, fontSize: 13.5 },
  packLabel: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  price: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minWidth: 84, alignItems: 'center' },
  priceText: { fontFamily: FontFamily.bold, fontSize: 15 },
  note: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', borderWidth: Stroke, borderStyle: 'dashed', borderRadius: Radius.field, padding: Spacing.two },
  noteText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 13 },
  valid: { fontFamily: FontFamily.medium, fontSize: 12.5, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
