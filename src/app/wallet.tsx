import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useCreditsSheet } from '@/components/credits-sheet';
import { Mascot } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CountUp } from '@/components/ui/count-up';
import { Icon } from '@/components/ui/icon';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, MaxContentWidth, Night, Spacing } from '@/constants/theme';
import { creditsValueCents, formatCredits, formatEuro } from '@/domain/club';
import { formatDateTime } from '@/domain/date-format';
import type { UiIconName } from '@/domain/ui-icon';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type CreditTransaction } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

const KIND_ICON: Record<CreditTransaction['kind'], UiIconName> = {
  purchase: 'coin',
  voucher: 'gift',
  stamp_reward: 'stamp',
  monthly: 'crown',
  booking: 'ticket',
  refund: 'refresh',
  admin: 'sparkles',
};

/**
 * Das Credit-Konto: Stand, Gutschein einlösen, Kontoauszug.
 *
 * Der Gutschein steht hier und nicht im Kauf-Blatt, weil er ein Textfeld braucht
 * – und Tastaturen in Blättern auf Android unzuverlässig sind.
 */
export default function WalletScreen() {
  const colors = useTheme();
  const { token, user } = useAuth();
  const market = useMarket();
  const credits = useCreditsSheet();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.wallet(token);
      setTransactions(data.transactions);
      market.setCredits(data.balance);
    } catch {
      // Der Stand oben kommt dann aus dem Konto.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const balance = user?.credits_balance ?? 0;

  const redeem = async () => {
    if (!token || !code.trim()) return;
    setRedeeming(true);
    setError(null);
    try {
      const { data } = await api.redeemVoucher(token, code);
      market.setCredits(data.balance);
      setAdded(data.added);
      setCode('');
      feedback.achieved();
      void load();
    } catch (e) {
      feedback.failed();
      setError(errorMessage(e));
    } finally {
      setRedeeming(false);
    }
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
            <Text style={styles.heroHint}>entspricht {formatEuro(creditsValueCents(CLUB_RULES, balance))} beim Kauf</Text>
          </View>
          <Mascot mood={added ? 'cheer' : 'happy'} size={70} jumpKey={added ?? 0} waves={!!added} />
        </Card>

        <Button title="Credits kaufen" icon="coin" onPress={() => credits.open(() => void load())} />

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
                  <Text style={[styles.txMeta, { color: colors.textSecondary }]}>{formatDateTime(t.created_at)}</Text>
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
