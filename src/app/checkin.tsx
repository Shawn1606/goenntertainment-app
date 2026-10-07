import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCelebrate } from '@/components/celebration';
import { Mascot } from '@/components/mascot';
import { PlanBadge } from '@/components/plan-badge';
import { StampCard } from '@/components/stamp-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { QrCode } from '@/components/ui/qr-code';
import { FontFamily, MaxContentWidth, Night, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits } from '@/domain/club';
import { formatClock } from '@/domain/date-format';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type CheckinMethod, type CheckinResult } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';
import { cancelNfc, nfcState, readSticker, type NfcState } from '@/lib/nfc';
import { loadOfflinePass, saveOfflinePass } from '@/lib/offline-cache';
import { currentCoords } from '@/lib/use-location';

type Mode = 'scan' | 'pass';

/**
 * Einchecken beim Partner – auf beiden Wegen:
 *
 *  - **Scannen:** Handy an den NFC-Aufkleber halten oder den QR-Code darauf
 *    scannen. Bringt den Stempel und löst auf Wunsch eine Buchung ein.
 *  - **Mein Pass:** ein QR-Code, den der Partner im Partner-Modus scannt. Er
 *    erneuert sich jede Minute; ein Screenshot nützt also niemandem.
 *
 * Welcher Weg sich im Alltag durchsetzt, entscheiden die Partner – deshalb sind
 * beide gleich gut erreichbar.
 */
export default function CheckinScreen() {
  const params = useLocalSearchParams<{ mode?: string; booking?: string; token?: string }>();
  const colors = useTheme();
  const [mode, setMode] = useState<Mode>(params.mode === 'pass' ? 'pass' : 'scan');

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: mode === 'pass' ? 'Mein Pass' : 'Einchecken' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.segment, { borderColor: colors.border, backgroundColor: colors.background }]}>
          {(['scan', 'pass'] as const).map((m) => {
            const active = mode === m;
            return (
              <PressableScale
                key={m}
                onPress={() => setMode(m)}
                haptic="select"
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.segmentItem, active && { backgroundColor: colors.tint }]}>
                <Icon name={m === 'scan' ? 'nfc' : 'qr'} size={17} color={active ? '#ffffff' : colors.text} />
                <Text style={[styles.segmentText, { color: active ? '#ffffff' : colors.text }]}>{m === 'scan' ? 'Scannen' : 'Mein Pass'}</Text>
              </PressableScale>
            );
          })}
        </View>
        {mode === 'scan' ? (
          <ScanPanel bookingId={params.booking ? Number(params.booking) : null} deepLinkToken={params.token ?? null} />
        ) : (
          <PassPanel />
        )}
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ Scannen */

function ScanPanel({ bookingId, deepLinkToken }: { bookingId: number | null; deepLinkToken: string | null }) {
  const colors = useTheme();
  const router = useRouter();
  const { token } = useAuth();
  const market = useMarket();
  const celebrate = useCelebrate();
  const [permission, requestPermission] = useCameraPermissions();
  const [nfc, setNfc] = useState<NfcState>('unsupported');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [sticker, setSticker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ein Scan wird genau einmal verarbeitet – der Scanner meldet denselben Code mehrfach pro Sekunde. */
  const handled = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    nfcState().then(setNfc);
    return () => {
      void cancelNfc();
    };
  }, []);

  const redeem = async (id: number, stickerToken: string, current: CheckinResult | null = result) => {
    if (!token) return;
    try {
      await api.redeemBooking(token, id, stickerToken);
      void market.refreshBookings();
      feedback.joined();
      if (current) setResult({ ...current, open_bookings: current.open_bookings.filter((b) => b.id !== id) });
      await notifyUser('Eingelöst!', 'Viel Spaß – zeig dem Partner kurz diesen Bildschirm.');
    } catch (e) {
      await notifyUser('Einlösen hat nicht geklappt', errorMessage(e));
    }
  };

  const submit = useCallback(
    async (scanned: string, method: CheckinMethod) => {
      if (!token || handled.current) return;
      handled.current = true;
      setDone(true);
      setBusy(true);
      setError(null);
      try {
        const coords = await currentCoords();
        const { data } = await api.checkin(token, { token: scanned, method, lat: coords?.lat ?? null, lng: coords?.lng ?? null });
        setResult(data);
        setSticker(scanned);
        if (typeof data.credits === 'number') market.setCredits(data.credits);
        void market.refreshClub();
        // Volle Karte = der große Moment; ein einzelner Stempel landet auf der Karte selbst.
        if (data.reward_credits > 0) {
          celebrate({ title: 'Stempelkarte voll!', credits: data.reward_credits, kind: 'coins', subtitle: 'Die Credits sind schon auf deinem Konto. Die neue Karte wartet.' });
        } else if (data.stamped) feedback.achieved();
        else feedback.tapped();

        // Kam man von einem Ticket: diese Buchung gleich einlösen, wenn sie hierher gehört.
        if (bookingId && data.open_bookings.some((b) => b.id === bookingId)) {
          await redeem(bookingId, scanned, data);
        }
      } catch (e) {
        feedback.failed();
        setError(errorMessage(e, 'Das hat nicht geklappt.'));
        handled.current = false;
        setDone(false);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, bookingId],
  );

  // Über einen Link geöffnet (Aufkleber mit normaler Kamera gescannt): gleich einchecken.
  useFocusEffect(
    useCallback(() => {
      if (deepLinkToken) void submit(deepLinkToken, 'qr');
    }, [deepLinkToken, submit]),
  );

  const tapNfc = async () => {
    setListening(true);
    setError(null);
    const value = await readSticker();
    setListening(false);
    if (value) await submit(value, 'nfc');
    else setError('Kein GÖ4Fun-Aufkleber erkannt. Nochmal versuchen oder den QR-Code scannen.');
  };

  if (result) {
    const freshIndex = result.stamped ? (result.stamps.filled === 0 ? result.stamps.fields - 1 : result.stamps.filled - 1) : null;
    return (
      <View style={styles.panel}>
        <View style={styles.resultHead}>
          <Mascot mood="cheer" gesture="wave" size={92} celebrate waves />
          <Text style={[styles.resultTitle, { color: colors.text }]}>
            {result.reward_credits > 0 ? `+${formatCredits(result.reward_credits)} Credits!` : result.stamped ? 'Stempel geholt!' : 'Eingecheckt!'}
          </Text>
          <Text style={[styles.resultText, { color: colors.textSecondary }]}>
            {result.reward_credits > 0
              ? 'Deine Stempelkarte war voll – die Credits sind schon auf deinem Konto. Die neue Karte wartet.'
              : result.stamped
                ? `Bei ${result.partner.name}. Noch ${result.stamps.remaining} bis ${result.stamps.reward_credits} Credits.`
                : `Heute hast du bei ${result.partner.name} schon gestempelt – morgen gibt's den nächsten.`}
          </Text>
          {result.bonus_stamp ? (
            <Text style={[styles.resultText, { color: colors.tint }]}>Erstbesuch: doppelter Stempel (Testphase)</Text>
          ) : null}
        </View>

        {/* Bei voller Karte zeigt die frische (leere) Karte nichts – dann die alte als voll. */}
        <StampCard
          card={result.reward_credits > 0 ? { ...result.stamps, filled: result.stamps.fields, remaining: 0 } : result.stamps}
          freshIndex={freshIndex}
        />

        {result.open_bookings.length > 0 && sticker ? (
          <Card style={styles.bookings}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Deine Buchungen hier</Text>
            {result.open_bookings.map((b) => (
              <View key={b.id} style={[styles.bookingRow, { borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.bookingTitle, { color: colors.text }]}>{b.offer_title}</Text>
                  <Text style={[styles.bookingMeta, { color: colors.textSecondary }]}>
                    {b.people} {b.people === 1 ? 'Person' : 'Personen'} · {b.code}
                  </Text>
                </View>
                <Button title="Einlösen" size="small" onPress={() => redeem(b.id, sticker)} />
              </View>
            ))}
          </Card>
        ) : null}

        <Button title="Zur Stempelkarte" icon="stamp" variant="secondary" onPress={() => router.replace('/stamps')} />
        <Button title="Fertig" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      {nfc === 'ready' ? (
        <Card tone="night" style={styles.nfcCard}>
          <Mascot mood={listening ? 'thinking' : 'happy'} gesture={listening ? 'look' : 'wave'} waves size={84} />
          <Text style={styles.nfcTitle}>{listening ? 'Halte dein Handy an den Aufkleber …' : 'Handy an den Aufkleber halten'}</Text>
          <Text style={styles.nfcText}>Der GÖ4Fun-Aufkleber klebt an der Kasse des Partners.</Text>
          <Button title={listening ? 'Warte auf Aufkleber …' : 'NFC starten'} icon="nfc" variant="light" onPress={tapNfc} loading={busy} disabled={listening} />
        </Card>
      ) : nfc === 'disabled' ? (
        <Card tone="soft">
          <Text style={[styles.hint, { color: colors.text }]}>NFC ist ausgeschaltet. Schalte es in den Einstellungen ein – oder scanne den QR-Code auf dem Aufkleber.</Text>
        </Card>
      ) : null}

      <Text style={[styles.cardTitle, { color: colors.text }]}>{nfc === 'ready' ? 'Oder QR-Code scannen' : 'QR-Code auf dem Aufkleber scannen'}</Text>
      <View style={[styles.cameraBox, { borderColor: colors.border }]}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={busy || done ? undefined : ({ data }) => submit(data, 'qr')}
          />
        ) : (
          <View style={styles.cameraAsk}>
            <Icon name="camera" size={34} color={colors.textSecondary} />
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Zum Scannen brauchen wir kurz deine Kamera.</Text>
            <Button title="Kamera erlauben" size="small" onPress={requestPermission} />
          </View>
        )}
        <View pointerEvents="none" style={styles.frame} />
      </View>

      {error ? (
        <View style={[styles.error, { borderColor: '#f59e0b' }]}>
          <Icon name="warning" size={18} color="#d97706" />
          <Text style={[styles.errorText, { color: colors.text }]}>{error}</Text>
        </View>
      ) : null}

      <Text style={[styles.small, { color: colors.textSecondary }]}>
        Für den Stempel prüfen wir einmal kurz deinen Standort – damit niemand mit einem Foto des Aufklebers von zu Hause stempelt.
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------------- Mein Pass */

function PassPanel() {
  const colors = useTheme();
  const { token, user } = useAuth();
  const [pass, setPass] = useState<string | null>(null);
  const [left, setLeft] = useState(60);
  const [error, setError] = useState<string | null>(null);
  /** Kein Netz: der länger gültige Offline-Pass – mit seinem Ablauf. */
  const [offlineUntil, setOfflineUntil] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await api.pass(token);
      setPass(data.token);
      setLeft(60);
      setError(null);
      setOfflineUntil(null);
      void saveOfflinePass(data).catch(() => undefined);
    } catch (e) {
      // Offline-Pass (Keller, Halle, Kino): der zuletzt beiseitegelegte, solange er gilt.
      const offline = await loadOfflinePass();
      if (offline) {
        setPass(offline.token);
        setOfflineUntil(offline.expires_at);
        setError(null);
      } else {
        setError(errorMessage(e));
      }
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Jede Minute ein frischer Pass – der alte gilt noch eine weitere Minute.
  useEffect(() => {
    const timer = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          void load();
          return 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <View style={styles.panel}>
      <Card tone="night" style={styles.passCard}>
        <Text style={styles.passName}>{user?.name}</Text>
        <PlanBadge plan={user?.club_plan} tone="night" />
        <View style={styles.qrBox}>{pass ? <QrCode value={pass} size={230} label="Dein GÖ4Fun-Pass" /> : <View style={{ width: 230, height: 230 }} />}</View>
        <View style={styles.timer}>
          <Icon name={offlineUntil ? 'clock' : 'refresh'} size={14} color={Night.textMuted} />
          <Text style={styles.timerText}>
            {offlineUntil ? `Offline-Pass – gilt bis ${formatClock(offlineUntil)} Uhr` : `erneuert sich in ${left} s`}
          </Text>
        </View>
      </Card>
      {error ? <Text style={[styles.errorText, { color: '#d97706' }]}>{error}</Text> : null}
      <View style={styles.passHint}>
        <Mascot mood="happy" gesture="nod" size={52} />
        <Text style={[styles.hint, { color: colors.text, flex: 1 }]}>
          Zeig diesen Code an der Kasse. Der Partner scannt ihn – du bekommst deinen Stempel, und deine Buchung wird eingelöst.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  segment: { flexDirection: 'row', borderWidth: Stroke, borderRadius: 999, padding: 4 },
  segmentItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 999 },
  segmentText: { fontFamily: FontFamily.bold, fontSize: 14.5 },
  panel: { gap: Spacing.three },
  nfcCard: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  nfcTitle: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 19, textAlign: 'center' },
  nfcText: { color: Night.textMuted, fontFamily: FontFamily.medium, fontSize: 13.5, textAlign: 'center', marginBottom: Spacing.two },
  cardTitle: { fontFamily: FontFamily.bold, fontSize: 16 },
  cameraBox: { width: '100%', aspectRatio: 1, maxHeight: 420, borderWidth: Stroke, borderRadius: Radius.panel, overflow: 'hidden', backgroundColor: '#0c0418' },
  cameraAsk: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four, backgroundColor: 'transparent' },
  frame: { position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '18%', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 18 },
  hint: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  small: { fontFamily: FontFamily.medium, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  error: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: Stroke, borderRadius: Radius.field, padding: Spacing.three, backgroundColor: 'rgba(245,158,11,0.08)' },
  errorText: { flex: 1, fontFamily: FontFamily.semibold, fontSize: 14 },
  resultHead: { alignItems: 'center', gap: 4 },
  resultTitle: { fontFamily: FontFamily.bold, fontSize: 28 },
  resultText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center', maxWidth: 360 },
  bookings: { gap: Spacing.two },
  bookingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderTopWidth: 1, paddingTop: Spacing.two },
  bookingTitle: { fontFamily: FontFamily.bold, fontSize: 15 },
  bookingMeta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  passCard: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  passName: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 20 },
  qrBox: { backgroundColor: '#ffffff', borderRadius: Radius.card, padding: Spacing.two, marginVertical: Spacing.two },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timerText: { color: Night.textMuted, fontFamily: FontFamily.semibold, fontSize: 13 },
  passHint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
