import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { AdminScreen, SectionTitle, numberOrNull } from '@/components/admin-ui';
import { MascotError } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Spacing } from '@/constants/theme';
import { formatCredits, formatEuro, packPriceCents } from '@/domain/club';
import { formatDay } from '@/domain/date-format';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, fetchText, type VoucherBatch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { notifyUser } from '@/lib/confirm';
import { shareText } from '@/lib/share';

/**
 * Gutscheinkarten für den Handel: Auflage anlegen (z. B. 500 × 100 Credits für
 * REWE), Codes als CSV für die Druckerei holen, einzelne Codes sperren.
 */
export default function AdminVouchers() {
  const colors = useTheme();
  const { token } = useAuth();
  /** `null`, solange noch nichts geladen ist – „Noch keine" nur, wenn es stimmt. */
  const [batches, setBatches] = useState<VoucherBatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [retailer, setRetailer] = useState('');
  const [credits, setCredits] = useState('100');
  const [quantity, setQuantity] = useState('100');
  const [expires, setExpires] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    api.admin
      .voucherBatches(token)
      .then(({ data }) => {
        setBatches(data);
        setLoadError(null);
      })
      .catch((e) => setLoadError(errorMessage(e, 'Die Auflagen ließen sich nicht laden.')));
  }, [token]);

  useFocusEffect(load);

  const create = async () => {
    if (!token) return;
    setSaving(true);
    // Vor dem `try`: Bedingungen darin kann der React Compiler nicht übersetzen.
    const input = {
      label: label.trim(),
      retailer: retailer.trim() || null,
      credits: numberOrNull(credits) ?? 0,
      quantity: numberOrNull(quantity) ?? 0,
      expires_at: expires.trim() || null,
    };
    try {
      await api.admin.createVoucherBatch(token, input);
      setLabel('');
      load();
      await notifyUser('Auflage erstellt', 'Die Codes kannst du jetzt als CSV holen.');
    } catch (e) {
      await notifyUser('Nicht erstellt', errorMessage(e));
    }
    setSaving(false);
  };

  const exportCsv = async (batch: VoucherBatch) => {
    if (!token) return;
    const inBrowser = Platform.OS === 'web' && typeof document !== 'undefined';
    try {
      const csv = await fetchText(token, api.admin.voucherCsvPath(batch.id));
      if (inBrowser) {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `gutscheine-${batch.id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await shareText(csv, `Gutscheine ${batch.label}`);
      }
    } catch (e) {
      await notifyUser('Export fehlgeschlagen', errorMessage(e));
    }
  };

  const disable = async () => {
    if (!token || !disableCode.trim()) return;
    try {
      await api.admin.disableVoucher(token, disableCode.trim());
      setDisableCode('');
      await notifyUser('Gesperrt', 'Der Code lässt sich nicht mehr einlösen.');
    } catch (e) {
      await notifyUser('Nicht gesperrt', errorMessage(e));
    }
  };

  const value = numberOrNull(credits) ?? 0;

  return (
    <AdminScreen title="Gutscheine">
      <Card style={styles.form}>
        <Text style={[styles.title, { color: colors.text }]}>Neue Auflage</Text>
        <TextField label="Name der Auflage *" value={label} onChangeText={setLabel} placeholder="z. B. REWE Herbst 2026" />
        <TextField label="Handelspartner" value={retailer} onChangeText={setRetailer} placeholder="REWE, Kaufland, Edeka …" />
        <View style={styles.pair}>
          <View style={styles.flex}>
            <TextField label="Credits pro Karte" value={credits} onChangeText={setCredits} keyboardType="number-pad" />
          </View>
          <View style={styles.flex}>
            <TextField label="Anzahl Karten" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
          </View>
        </View>
        <TextField label="Gültig bis (JJJJ-MM-TT, leer = unbegrenzt)" value={expires} onChangeText={setExpires} autoCapitalize="none" />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {value > 0 ? `Gegenwert je Karte beim Credit-Preis: ${formatEuro(packPriceCents(CLUB_RULES, value))}.` : ''} Maximal 5.000 Karten pro Auflage.
        </Text>
        <Button title="Codes erzeugen" icon="gift" onPress={create} loading={saving} disabled={!label.trim()} />
      </Card>

      <SectionTitle>Auflagen</SectionTitle>
      {loadError ? <MascotError detail={loadError} onRetry={load} /> : null}
      {batches === null && !loadError ? <ActivityIndicator color={colors.tint} /> : null}
      {batches?.length === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Noch keine.</Text> : null}
      {(batches ?? []).map((b) => (
        <Card key={b.id} style={styles.batch}>
          <Text style={[styles.title, { color: colors.text }]}>{b.label}</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {b.retailer ? `${b.retailer} · ` : ''}
            {b.created_count} × {formatCredits(b.credits)} Credits · {b.redeemed_count} eingelöst
            {b.expires_at ? ` · gültig bis ${formatDay(b.expires_at)}` : ''}
          </Text>
          <Button title="Codes als CSV" icon="document" variant="secondary" size="small" onPress={() => exportCsv(b)} />
        </Card>
      ))}

      <SectionTitle>Code sperren</SectionTitle>
      <Card style={styles.form}>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Für verlorene oder gestohlene Kartenpakete.</Text>
        <TextField label="Code" value={disableCode} onChangeText={setDisableCode} autoCapitalize="characters" />
        <Button title="Sperren" variant="danger" onPress={disable} disabled={!disableCode.trim()} />
      </Card>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: Spacing.three },
  pair: { flexDirection: 'row', gap: Spacing.two },
  title: { fontFamily: FontFamily.bold, fontSize: 16 },
  hint: { fontFamily: FontFamily.medium, fontSize: 13, lineHeight: 18 },
  batch: { gap: Spacing.two },
});
