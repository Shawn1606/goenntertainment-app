/**
 * Credits kaufen – das Blatt hinter der Münze in der Kopfzeile.
 *
 * Von überall erreichbar (`useCreditsSheet().open()`), deshalb als Provider um
 * die ganze App: Die Kopfzeile jedes Tabs öffnet dasselbe Blatt, und ein Kauf
 * aktualisiert überall denselben Stand (useMarket().setCredits).
 *
 * Die Preise rechnet die App aus shared/club.json – 10 Credits = 75 Cent –, der
 * Server rechnet beim Kauf dasselbe noch einmal.
 */
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { CountUp } from '@/components/ui/count-up';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits, formatEuro, packPriceCents } from '@/domain/club';
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

/** Das beliebteste Paket bekommt die Markierung – Orientierung statt Qual der Wahl. */
const HIGHLIGHT = 200;

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
  const { setCredits, club } = useMarket();
  const [buying, setBuying] = useState<number | null>(null);
  const [cheer, setCheer] = useState(0);

  const balance = user?.credits_balance ?? 0;
  const testMode = (club?.payments_mode ?? 'test') === 'test';

  const buy = async (credits: number) => {
    if (!token) return;
    const price = formatEuro(packPriceCents(CLUB_RULES, credits));
    const ok = await confirmAction(
      `${formatCredits(credits)} Credits kaufen`,
      testMode
        ? `Für ${price}. Testmodus: Es wird kein echtes Geld abgebucht.`
        : `Für ${price}.`,
      'Zahlungspflichtig kaufen',
    );
    if (!ok) return;
    setBuying(credits);
    try {
      const { data } = await api.buyCredits(token, credits);
      setCredits(data.balance);
      onPurchased();
      setCheer((c) => c + 1);
      feedback.achieved();
    } catch (e) {
      feedback.failed();
      await notifyUser('Kauf hat nicht geklappt', errorMessage(e));
    } finally {
      setBuying(null);
    }
  };

  const go = (path: '/wallet' | '/club') => {
    onClose();
    setTimeout(() => router.push(path), 180);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Deine Credits" subtitle="Bezahl bei Partnern mit Credits – 10 Credits = 75 Cent">
      <View style={[styles.balance, { borderColor: colors.border, backgroundColor: colors.backgroundElement }]}>
        <Mascot mood={cheer > 0 ? 'cheer' : 'happy'} size={56} jumpKey={cheer} waves={cheer > 0} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.balanceLabel, { color: colors.textSecondary }]}>Kontostand</Text>
          <View style={styles.balanceRow}>
            <Icon name="coin" size={22} color="#e3a60b" />
            <CountUp value={balance} format={formatCredits} style={[styles.balanceValue, { color: colors.text }]} />
          </View>
        </View>
      </View>

      <View style={styles.packs}>
        {CLUB_RULES.credits.packs.map((credits) => {
          const highlight = credits === HIGHLIGHT;
          return (
            <View key={credits} style={styles.packWrap}>
            <PressableScale
              onPress={() => buy(credits)}
              disabled={buying !== null}
              accessibilityRole="button"
              accessibilityLabel={`${formatCredits(credits)} Credits für ${formatEuro(packPriceCents(CLUB_RULES, credits))} kaufen`}
              style={[
                styles.pack,
                { borderColor: highlight ? colors.tint : colors.border, backgroundColor: colors.background },
                highlight && styles.packHighlight,
              ]}>
              {highlight ? (
                <View style={[styles.flag, { backgroundColor: colors.tint }]}>
                  <Text style={styles.flagText}>Beliebt</Text>
                </View>
              ) : null}
              <Icon name="coin" size={26} color="#e3a60b" />
              <Text style={[styles.packCredits, { color: colors.text }]}>{formatCredits(credits)}</Text>
              <Text style={[styles.packLabel, { color: colors.textSecondary }]}>Credits</Text>
              <View style={[styles.price, { backgroundColor: highlight ? colors.tint : colors.backgroundSelected }]}>
                <Text style={[styles.priceText, { color: highlight ? '#ffffff' : colors.text }]}>
                  {buying === credits ? '…' : formatEuro(packPriceCents(CLUB_RULES, credits))}
                </Text>
              </View>
            </PressableScale>
            </View>
          );
        })}
      </View>

      {testMode ? (
        <View style={[styles.note, { borderColor: colors.border }]}>
          <Icon name="info" size={16} color={colors.textSecondary} />
          <Text style={[styles.noteText, { color: colors.textSecondary }]}>
            Testmodus: Käufe werden sofort gutgeschrieben, es fließt kein Geld.
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button title="Gutschein" accessibilityLabel="Gutschein einlösen" icon="gift" variant="secondary" onPress={() => go('/wallet')} style={styles.action} />
        <Button title="Club-Vorteile" icon="crown" variant="secondary" onPress={() => go('/club')} style={styles.action} />
      </View>
      <Button title="Kontoauszug ansehen" variant="ghost" size="small" onPress={() => go('/wallet')} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: Stroke,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  balanceLabel: { fontFamily: FontFamily.semibold, fontSize: 13 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balanceValue: { fontFamily: FontFamily.bold, fontSize: 30, lineHeight: 36 },
  packs: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'space-between' },
  // Breite an der Huelle, nicht am PressableScale: dessen style liegt innen.
  packWrap: { width: '31.5%', minWidth: 96, flexGrow: 1 },
  pack: {
    borderWidth: Stroke,
    borderRadius: Radius.card,
    alignItems: 'center',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.two,
    gap: 2,
  },
  packHighlight: { borderWidth: 2 },
  flag: { position: 'absolute', top: -1, right: -1, borderBottomLeftRadius: 10, borderTopRightRadius: Radius.card, paddingHorizontal: 8, paddingVertical: 3 },
  flagText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 10.5 },
  packCredits: { fontFamily: FontFamily.bold, fontSize: 22, marginTop: 4 },
  packLabel: { fontFamily: FontFamily.medium, fontSize: 12 },
  price: { marginTop: Spacing.two, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'stretch', alignItems: 'center' },
  priceText: { fontFamily: FontFamily.bold, fontSize: 14 },
  note: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', borderWidth: Stroke, borderStyle: 'dashed', borderRadius: Radius.field, padding: Spacing.two },
  noteText: { flex: 1, fontFamily: FontFamily.medium, fontSize: 13 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
