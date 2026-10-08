import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useCelebrate } from '@/components/celebration';
import { useCreditsSheet } from '@/components/credits-sheet';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Icon } from '@/components/ui/icon';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, MaxContentWidth, Night, Spacing } from '@/constants/theme';
import { expiryInfo } from '@/domain/booking-status';
import { formatCredits } from '@/domain/club';
import { formatDateTime, formatDay } from '@/domain/date-format';
import type { UiIconName } from '@/domain/ui-icon';
import { useSignals, useTheme } from '@/hooks/use-theme';
import { useNow } from '@/hooks/use-now';
import { api, errorMessage, type CreditLot, type CreditTransaction } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useMarket } from '@/lib/market-context';

const KIND_ICON: Record<CreditTransaction['kind'], UiIconName> = {
  purchase: 'coin',
  voucher: 'gift',
  stamp_reward: 'stamp',
  monthly: 'crown',
  booking: 'ticket',
  refund: 'refresh',
  admin: 'sparkles',
  expired: 'hourglass',
  challenge: 'trophy',
  feedback: 'chat',
  share: 'users',
};

/** Woher ein Paket kam – in Worten. */
const KIND_LABEL: Partial<Record<CreditTransaction['kind'], string>> = {
  purchase: 'Gekauft',
  voucher: 'Gutschein',
  stamp_reward: 'Volle Stempelkarte',
  monthly: 'Monats-Credits',
  refund: 'Erstattung',
  admin: 'Geschenk vom GÖ4Fun-Team',
  challenge: 'Challenge',
  feedback: 'Rückmeldung',
  share: 'Anteil aus der Gruppe',
};

/** So viele Pakete stehen zunächst da – der Rest auf Antippen. */
const LOTS_SHOWN = 4;

/**
 * Das Credit-Konto: Stand, was wann verfällt, Gutschein einlösen, Kontoauszug.
 *
 * Jede Gutschrift gilt je nach Club-Stufe 365 Tage, 18 oder 30 Monate
 * (shared/club.json, `validity_label` vom Server) und verfällt für
 * sich; bezahlt wird zuerst mit dem, was am frühesten verfällt. Die Karte
 * „Was wann verfällt" zeigt die nächsten Stichtage, damit niemand überrascht wird.
 *
 * Der Gutschein steht hier und nicht im Kauf-Blatt, weil er ein Textfeld braucht
 * – und Tastaturen in Blättern auf Android unzuverlässig sind.
 */
export default function WalletScreen() {
  const colors = useTheme();
  const signals = useSignals();
  const { token, user } = useAuth();
  const market = useMarket();
  const credits = useCreditsSheet();
  const celebrate = useCelebrate();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [lots, setLots] = useState<CreditLot[]>([]);
  const [validity, setValidity] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  // `setCredits` bleibt stabil: Neu geladen wird nur beim Zurückkommen und mit neuem Token.
  const { setCredits } = market;
  const load = useCallback(async () => {
    if (!token) return;
    // Ohne Antwort kommt der Stand oben aus dem Konto. (Kein try: Bedingungen darin
    // kann der React Compiler nicht übersetzen.)
    const data = await api
      .wallet(token)
      .then((res) => res.data)
      .catch(() => null);
    if (!data) return;
    setTransactions(data.transactions);
    setLots(data.lots ?? []);
    setValidity(data.validity_label ?? null);
    setCredits(data.balance);
  }, [token, setCredits]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const balance = user?.credits_balance ?? 0;
  const [allLots, setAllLots] = useState(false);
  const now = useNow();
  const shownLots = allLots ? lots : lots.slice(0, LOTS_SHOWN);

  const redeem = async () => {
    // Auch Enter (onSubmitEditing) läuft hier durch: nicht während des Einlösens und nicht mit zu kurzem Code.
    if (!token || redeeming || code.trim().length < 6) return;
    setRedeeming(true);
    setError(null);
    try {
      const { data } = await api.redeemVoucher(token, code);
      market.setCredits(data.balance);
      setAdded(data.added);
      setCode('');
      celebrate({ title: 'Gutschein eingelöst!', credits: data.added, kind: 'coins', subtitle: 'Die Credits sind schon auf deinem Konto.' });
      void load();
    } catch (e) {
      setError(errorMessage(e));
    }
    setRedeeming(false);
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Credits' }} />
      <KeyboardForm contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card tone="night" style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>Dein Kontostand</Text>
            <View style={styles.heroRow}>
              <Icon name="coin" size={30} color="#ffd24a" />
              <CountUp value={balance} format={formatCredits} style={styles.heroValue} />
            </View>
            <Text style={styles.heroHint}>Damit bezahlst du bei allen GÖ4Fun-Partnern.</Text>
          </View>
          <Mascot mood={added ? 'cheer' : 'happy'} size={70} lively />
        </Card>

        <Button title="Credits aufladen" icon="coin" onPress={() => credits.open(() => void load())} />

        {lots.length > 0 ? (
          <Card style={styles.expiry}>
            <View style={styles.voucherHead}>
              <Icon name="hourglass" size={22} color={colors.tint} />
              <Text style={[styles.title, { color: colors.text }]}>Deine Credit-Pakete</Text>
            </View>
            <Text style={[styles.text, { color: colors.textSecondary }]}>
              Jedes Paket verfällt für sich – {validity ?? '365 Tage'} nach dem Tag, an dem du es bekommen hast. Kaufst du später wieder, hat
              das neue Paket sein eigenes Datum. Bezahlt wird immer zuerst mit dem, was am frühesten verfällt.
            </Text>
            {shownLots.map((lot, i) => {
              const info = expiryInfo(lot.expires_at, now);
              const tone = info?.tone ?? 'ok';
              const warn = tone === 'urgent' || tone === 'soon';
              const amount = Math.max(lot.amount ?? lot.credits, lot.credits);
              const share = amount > 0 ? lot.credits / amount : 1;
              return (
                <View
                  key={`${lot.created_at}-${lot.expires_at}-${i}`}
                  style={[styles.lot, { borderColor: warn ? signals.warnBorder : colors.border, backgroundColor: warn ? signals.warnBg : colors.backgroundElement }]}>
                  <View style={styles.lotHead}>
                    <View style={[styles.lotIcon, { backgroundColor: colors.backgroundSelected }]}>
                      <Icon name={lot.kind ? (KIND_ICON[lot.kind] ?? 'coin') : 'coin'} size={16} color={colors.tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.lotTitle, { color: colors.text }]}>
                        {formatCredits(amount)} Credits{lot.kind && KIND_LABEL[lot.kind] ? ` · ${KIND_LABEL[lot.kind]}` : ''}
                      </Text>
                      <Text style={[styles.lotMeta, { color: colors.textSecondary }]}>Bekommen am {formatDay(lot.created_at)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.lotLeft, { color: colors.text }]}>{formatCredits(lot.credits)}</Text>
                      <Text style={[styles.lotMeta, { color: colors.textSecondary }]}>übrig</Text>
                    </View>
                  </View>
                  {amount > lot.credits ? (
                    <View style={[styles.lotTrack, { backgroundColor: colors.backgroundSelected }]}>
                      <View style={[styles.lotFill, { width: `${Math.max(4, share * 100)}%`, backgroundColor: colors.tint }]} />
                    </View>
                  ) : null}
                  <View style={styles.lotExpiry}>
                    <Icon name="hourglass" size={13} color={warn ? signals.warn : colors.textSecondary} />
                    <Text style={[styles.lotExpiryText, { color: warn ? signals.warn : colors.textSecondary }]}>
                      Verfällt am {formatDay(lot.expires_at)}
                      {info ? ` · ${info.tone === 'urgent' || info.days <= 1 ? info.label.replace('Verfällt ', '') : `noch ${info.days} Tage`}` : ''}
                    </Text>
                  </View>
                </View>
              );
            })}
            {lots.length > LOTS_SHOWN ? (
              <Button
                title={allLots ? 'Weniger anzeigen' : `Alle ${lots.length} Pakete anzeigen`}
                variant="ghost"
                size="small"
                onPress={() => setAllLots((v) => !v)}
              />
            ) : null}
          </Card>
        ) : null}

        <Card style={styles.voucher}>
          <View style={styles.voucherHead}>
            <Icon name="gift" size={22} color={colors.tint} />
            <Text style={[styles.title, { color: colors.text }]}>Gutschein einlösen</Text>
          </View>
          <Text style={[styles.text, { color: colors.textSecondary }]}>
            GÖ4Fun-Gutscheinkarten gibt&apos;s bei unseren Handelspartnern. Den Code findest du auf der Rückseite.
          </Text>
          <TextField
            label="Code"
            value={code}
            onChangeText={(v) => {
              setCode(v.toUpperCase());
              setError(null);
              setAdded(null);
            }}
            placeholder="ABCD-EFGH-JKLM"
            autoCapitalize="characters"
            autoCorrect={false}
            error={error ?? undefined}
            returnKeyType="done"
            onSubmitEditing={redeem}
          />
          {added ? (
            <View style={styles.success}>
              <Icon name="check" size={16} color="#059669" />
              <Text style={styles.successText}>{formatCredits(added)} Credits gutgeschrieben!</Text>
            </View>
          ) : null}
          <Button title="Einlösen" variant="secondary" onPress={redeem} loading={redeeming} disabled={code.trim().length < 6} />
        </Card>

        <Text style={[styles.section, { color: colors.text }]}>Kontoauszug</Text>
        {transactions.length === 0 ? (
          <Text style={[styles.text, { color: colors.textSecondary }]}>
            Noch keine Bewegungen. Stempel sammeln, Gutschein einlösen oder Credits kaufen – dann steht hier alles.
          </Text>
        ) : (
          <Card padded={false}>
            {transactions.map((t, i) => (
              <View key={t.id} style={[styles.tx, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <View style={[styles.txIcon, { backgroundColor: colors.backgroundSelected }]}>
                  <Icon name={KIND_ICON[t.kind] ?? 'coin'} size={18} color={colors.tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.txTitle, { color: colors.text }]} numberOfLines={2}>
                    {t.description}
                  </Text>
                  <Text style={[styles.txMeta, { color: colors.textSecondary }]}>
                    {formatDateTime(t.created_at)}
                    {t.amount > 0 && t.expires_at ? ` · gültig bis ${formatDay(t.expires_at)}` : ''}
                  </Text>
                </View>
                <Text style={[styles.txAmount, { color: t.amount > 0 ? '#059669' : colors.text }]}>
                  {t.amount > 0 ? '+' : '−'}
                  {formatCredits(Math.abs(t.amount))}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </KeyboardForm>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroLabel: { color: Night.textMuted, fontFamily: FontFamily.semibold, fontSize: 13 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heroValue: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 40, lineHeight: 48 },
  heroHint: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 12.5 },
  voucher: { gap: Spacing.three },
  expiry: { gap: Spacing.two },
  lot: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  lotHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  lotIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  lotTitle: { fontFamily: FontFamily.bold, fontSize: 14.5 },
  lotMeta: { fontFamily: FontFamily.medium, fontSize: 12 },
  lotLeft: { fontFamily: FontFamily.bold, fontSize: 17 },
  lotTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  lotFill: { height: '100%', borderRadius: 3 },
  lotExpiry: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  lotExpiryText: { fontFamily: FontFamily.semibold, fontSize: 12.5, flexShrink: 1 },
  voucherHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontFamily: FontFamily.bold, fontSize: 17 },
  text: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  success: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  successText: { color: '#059669', fontFamily: FontFamily.bold, fontSize: 14 },
  section: { fontFamily: FontFamily.bold, fontSize: 17, marginTop: Spacing.two },
  tx: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  txTitle: { fontFamily: FontFamily.semibold, fontSize: 14 },
  txMeta: { fontFamily: FontFamily.medium, fontSize: 12 },
  txAmount: { fontFamily: FontFamily.bold, fontSize: 16 },
});
