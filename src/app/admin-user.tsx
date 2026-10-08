import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AdminScreen, Kpi, SectionTitle } from '@/components/admin-ui';
import { PlanBadge } from '@/components/plan-badge';
import { StampCard } from '@/components/stamp-card';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits } from '@/domain/club';
import { formatDateTime, formatDateTimeCompact } from '@/domain/date-format';
import { initialsOf } from '@/domain/initials';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type AdminUserDetail } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { useMarket } from '@/lib/market-context';
import { pickImage } from '@/lib/pick-image';

/** Kurze Sperren als Schnellwahl – alles andere ist ein Bann. */
const TIMEOUTS = [
  { label: '1 Tag', minutes: 60 * 24 },
  { label: '7 Tage', minutes: 60 * 24 * 7 },
  { label: '30 Tage', minutes: 60 * 24 * 30 },
];

const CREDIT_STEPS = [10, 50, 100, 500];

/**
 * Ein Konto im Admin-Bereich: Überblick, Credits und Stempel korrigieren,
 * Kontoauszug – und für fremde Konten Umbenennen, Sperren, Löschen.
 *
 * Beim eigenen Konto gibt es nur Credits und Stempel: Sich selbst zu sperren
 * oder zu löschen, verweigert auch der Server.
 */
export default function AdminUserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const colors = useTheme();
  const router = useRouter();
  const { token, patchUser } = useAuth();
  const market = useMarket();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !userId) return;
    try {
      setUser((await api.admin.user(token, userId)).data);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [token, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Neuer Stand vom Server – beim eigenen Konto auch Kopfzeile und Club. */
  const apply = (next: AdminUserDetail) => {
    setUser(next);
    if (next.is_self) {
      patchUser({ credits_balance: next.credits_balance });
      market.setCredits(next.credits_balance);
      void market.refreshClub();
    }
  };

  if (!user) {
    return (
      <AdminScreen title="Konto">
        {error ? <Text style={[styles.text, { color: colors.textSecondary }]}>{error}</Text> : <ActivityIndicator color={colors.tint} />}
      </AdminScreen>
    );
  }

  return (
    <AdminScreen title={user.is_self ? 'Dein Konto' : user.name}>
      <Card style={styles.hero}>
        <View style={[styles.avatar, { backgroundColor: colors.backgroundSelected }]}>
          <Text style={[styles.initials, { color: colors.tint }]}>{initialsOf(user.name)}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {user.name}
          </Text>
          <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>
            {user.username ? `@${user.username} · ` : ''}
            {user.email}
          </Text>
          <Text style={[styles.small, { color: colors.textSecondary }]}>Dabei seit {formatDateTimeCompact(user.created_at)}</Text>
          <View style={styles.badges}>
            <PlanBadge plan={user.club_plan} size="small" />
            {user.is_admin ? <Badge text="Admin" /> : null}
            {user.banned ? <Badge text={user.banned_permanent ? 'Gebannt' : 'Gesperrt'} danger /> : null}
          </View>
        </View>
      </Card>

      <View style={styles.kpis}>
        <Kpi label="Credits" value={formatCredits(user.credits_balance)} icon="coin" />
        <Kpi label={`Stempel (${user.stamps.completed_cards}× voll)`} value={`${user.stamps.filled}/${user.stamps.fields}`} icon="stamp" />
        <Kpi label="Buchungen" value={String(user.bookings_count)} icon="ticket" />
        <Kpi label="Gruppen" value={String(user.groups_count)} icon="users" />
      </View>

      {token ? <CreditsPanel user={user} token={token} onChanged={apply} /> : null}
      {token ? <StampsPanel user={user} token={token} onChanged={apply} /> : null}

      <SectionTitle>Kontoauszug</SectionTitle>
      {user.transactions.length === 0 ? (
        <Text style={[styles.text, { color: colors.textSecondary }]}>Noch keine Credit-Bewegungen.</Text>
      ) : (
        <Card padded={false}>
          {user.transactions.map((t, i) => (
            <View key={t.id} style={[styles.tx, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.txTitle, { color: colors.text }]} numberOfLines={2}>
                  {t.description}
                </Text>
                <Text style={[styles.small, { color: colors.textSecondary }]}>
                  {formatDateTime(t.created_at)} · Stand {formatCredits(t.balance_after)}
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

      {!user.is_self && token ? (
        <ModerationPanel user={user} token={token} onChanged={(next) => setUser(next)} onDeleted={() => router.back()} />
      ) : null}
    </AdminScreen>
  );
}

function Badge({ text, danger = false }: { text: string; danger?: boolean }) {
  const colors = useTheme();
  return (
    <View style={[styles.badge, { borderColor: danger ? '#e11d48' : colors.borderStrong }]}>
      <Text style={[styles.badgeText, { color: danger ? '#e11d48' : colors.text }]}>{text}</Text>
    </View>
  );
}

/** Credits gutschreiben oder abziehen – mit Grund, der im Kontoauszug steht. */
function CreditsPanel({ user, token, onChanged }: { user: AdminUserDetail; token: string; onChanged: (u: AdminUserDetail) => void }) {
  const colors = useTheme();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const value = Math.floor(Number(amount.replace(/\D/g, '')) || 0);
  const ready = value > 0 && note.trim().length >= 3;

  const submit = async () => {
    if (!ready) return;
    const signed = mode === 'add' ? value : -value;
    const ok = await confirmAction(
      mode === 'add' ? `${formatCredits(value)} Credits gutschreiben?` : `${formatCredits(value)} Credits abziehen?`,
      `${user.is_self ? 'Dein Konto' : user.name}: ${formatCredits(user.credits_balance)} → ${formatCredits(Math.max(0, user.credits_balance + signed))} Credits.\nGrund im Kontoauszug: „${note.trim()}"`,
      mode === 'add' ? 'Gutschreiben' : 'Abziehen',
      mode === 'remove',
    );
    if (!ok) return;
    setBusy(true);
    try {
      onChanged((await api.admin.adjustCredits(token, user.id, signed, note.trim())).data);
      setAmount('');
      setNote('');
    } catch (e) {
      await notifyUser('Nicht gebucht', errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <Card style={styles.panel}>
      <PanelHead icon="coin" title="Credits anpassen" hint={`Aktuell ${formatCredits(user.credits_balance)} Credits`} />
      <Segmented
        value={mode}
        options={[
          { key: 'add', label: 'Gutschreiben', icon: 'plus' },
          { key: 'remove', label: 'Abziehen', icon: 'minus' },
        ]}
        onChange={setMode}
      />
      <View style={styles.steps}>
        {CREDIT_STEPS.map((step) => (
          <PressableScale
            key={step}
            onPress={() => setAmount(String(step))}
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel={`${step} Credits`}
            style={[styles.step, { borderColor: value === step ? colors.tint : colors.border, backgroundColor: value === step ? colors.backgroundSelected : colors.background }]}>
            <Text style={[styles.stepText, { color: colors.text }]}>{formatCredits(step)}</Text>
          </PressableScale>
        ))}
      </View>
      <View style={styles.pair}>
        <View style={{ width: 120 }}>
          <TextField label="Anzahl" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="0" />
        </View>
        <View style={styles.grow}>
          <TextField label="Grund (im Kontoauszug)" value={note} onChangeText={setNote} placeholder="z. B. Kulanz, Gewinnspiel" />
        </View>
      </View>
      <Button
        title={mode === 'add' ? 'Gutschreiben' : 'Abziehen'}
        icon={mode === 'add' ? 'plus' : 'minus'}
        variant={mode === 'add' ? 'primary' : 'danger'}
        onPress={submit}
        loading={busy}
        disabled={!ready}
      />
    </Card>
  );
}

/** Stempel gutschreiben (volle Karte bringt Credits) oder die jüngsten abziehen. */
function StampsPanel({ user, token, onChanged }: { user: AdminUserDetail; token: string; onChanged: (u: AdminUserDetail) => void }) {
  const [busy, setBusy] = useState<number | null>(null);

  const change = async (amount: number) => {
    const ok = await confirmAction(
      amount > 0 ? `${amount} Stempel gutschreiben?` : `${-amount} Stempel abziehen?`,
      amount > 0
        ? 'Wird die Karte dadurch voll, gibt es die Credits wie bei einem echten Besuch.'
        : 'Es werden die jüngsten Stempel entfernt. Schon ausgezahlte Credits bleiben.',
      amount > 0 ? 'Gutschreiben' : 'Abziehen',
      amount < 0,
    );
    if (!ok) return;
    setBusy(amount);
    try {
      const res = await api.admin.adjustStamps(token, user.id, amount);
      onChanged(res.data);
      if (res.reward_credits > 0) {
        await notifyUser('Karte voll!', `${formatCredits(res.reward_credits)} Credits wurden gutgeschrieben.`);
      }
    } catch (e) {
      await notifyUser('Nicht geändert', errorMessage(e));
    }
    setBusy(null);
  };

  return (
    <Card style={styles.panel}>
      <PanelHead icon="stamp" title="Stempel" hint={`${user.stamps_total} insgesamt · ${user.stamps.completed_cards}× volle Karte`} />
      <StampCard card={user.stamps} />
      <View style={styles.stampButtons}>
        <Button title="−1" accessibilityLabel="Einen Stempel abziehen" variant="secondary" size="small" onPress={() => change(-1)} loading={busy === -1} disabled={user.stamps_total === 0} style={styles.stampButton} />
        <Button title="+1" accessibilityLabel="Einen Stempel gutschreiben" variant="secondary" size="small" onPress={() => change(1)} loading={busy === 1} style={styles.stampButton} />
        <Button title="+5" accessibilityLabel="Fünf Stempel gutschreiben" variant="secondary" size="small" onPress={() => change(5)} loading={busy === 5} style={styles.stampButton} />
      </View>
    </Card>
  );
}

/** Umbenennen, sperren, löschen – nur bei fremden Konten. */
function ModerationPanel({ user, token, onChanged, onDeleted }: { user: AdminUserDetail; token: string; onChanged: (u: AdminUserDetail) => void; onDeleted: () => void }) {
  const [reason, setReason] = useState('');
  const [username, setUsername] = useState(user.username ?? '');

  const rename = async () => {
    try {
      const res = await api.admin.renameUser(token, user.id, username.trim());
      onChanged({ ...user, username: res.username });
      await notifyUser('Umbenannt', `Neuer Benutzername: @${res.username}`);
    } catch (e) {
      await notifyUser('Nicht umbenannt', errorMessage(e));
    }
  };

  const sanction = async (minutes: number | null) => {
    if (reason.trim().length < 3) {
      await notifyUser('Grund fehlt', 'Bitte einen Grund angeben (wird der Person beim Login gezeigt).');
      return;
    }
    const withImage = await confirmAction('Beweisbild anhängen?', 'Ein Screenshot hilft, die Sperre später nachzuvollziehen.', 'Bild wählen');
    const image = withImage ? await pickImage('Beweisbild', 'beweis') : null;
    try {
      if (minutes === null) await api.admin.banUser(token, user.id, reason.trim(), image);
      else await api.admin.timeoutUser(token, user.id, minutes, reason.trim(), image);
      onChanged({ ...user, banned: true, banned_permanent: minutes === null, ban_reason: reason.trim() });
      setReason('');
    } catch (e) {
      await notifyUser('Nicht gesperrt', errorMessage(e));
    }
  };

  const unban = async () => {
    await api.admin.unbanUser(token, user.id);
    onChanged({ ...user, banned: false, banned_until: null, ban_reason: null });
  };

  const remove = async () => {
    if (!(await confirmAction(`${user.name} löschen?`, 'Konto, Credits und Stempel verschwinden endgültig. Buchungen bleiben als Beleg.', 'Endgültig löschen', true))) return;
    try {
      await api.admin.deleteUser(token, user.id);
      onDeleted();
    } catch (e) {
      await notifyUser('Nicht gelöscht', errorMessage(e));
    }
  };

  return (
    <>
      <Card style={styles.panel}>
        <PanelHead icon="user" title="Benutzername" />
        <View style={styles.pair}>
          <View style={styles.grow}>
            <TextField value={username} onChangeText={setUsername} autoCapitalize="none" />
          </View>
          <Button title="Ändern" size="small" variant="secondary" onPress={rename} disabled={!username.trim() || username === user.username} />
        </View>
      </Card>

      <Card style={styles.panel}>
        <PanelHead icon="ban" title="Sperren" hint={user.banned ? `${user.banned_permanent ? 'Gebannt' : `Gesperrt bis ${formatDateTimeCompact(user.banned_until)}`}: ${user.ban_reason ?? ''}` : undefined} />
        {user.banned ? (
          <Button title="Sperre aufheben" variant="secondary" onPress={unban} />
        ) : (
          <>
            <TextField label="Grund (sieht die Person beim Login)" value={reason} onChangeText={setReason} />
            <View style={styles.wrap}>
              {TIMEOUTS.map((t) => (
                <Button key={t.label} title={t.label} size="small" variant="secondary" onPress={() => sanction(t.minutes)} />
              ))}
              <Button title="Dauerhaft" size="small" variant="danger" onPress={() => sanction(null)} />
            </View>
          </>
        )}
      </Card>

      <Button title="Konto löschen" variant="danger" icon="trash" onPress={remove} />
    </>
  );
}

function PanelHead({ icon, title, hint }: { icon: 'coin' | 'stamp' | 'user' | 'ban'; title: string; hint?: string }) {
  const colors = useTheme();
  return (
    <View style={styles.panelHead}>
      <View style={[styles.panelIcon, { backgroundColor: colors.backgroundSelected }]}>
        <Icon name={icon} size={18} color={colors.tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.panelTitle, { color: colors.text }]}>{title}</Text>
        {hint ? <Text style={[styles.small, { color: colors.textSecondary }]}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function Segmented<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: { key: K; label: string; icon: 'plus' | 'minus' }[];
  onChange: (key: K) => void;
}) {
  const colors = useTheme();
  return (
    <View style={[styles.segment, { borderColor: colors.border, backgroundColor: colors.backgroundElement }]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <PressableScale
            key={o.key}
            onPress={() => onChange(o.key)}
            haptic="select"
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segmentItem, active && { backgroundColor: colors.background, borderColor: colors.borderStrong }]}>
            <Icon name={o.icon} size={15} color={active ? colors.text : colors.textSecondary} />
            <Text style={[styles.segmentText, { color: active ? colors.text : colors.textSecondary }]}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FontFamily.bold, fontSize: 21 },
  name: { fontFamily: FontFamily.bold, fontSize: 19 },
  text: { fontFamily: FontFamily.medium, fontSize: 14 },
  small: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  badge: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontFamily: FontFamily.bold, fontSize: 11 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  panel: { gap: Spacing.three },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  panelIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { fontFamily: FontFamily.bold, fontSize: 16 },
  steps: { flexDirection: 'row', gap: Spacing.two },
  step: { flex: 1, alignItems: 'center', borderWidth: Stroke, borderRadius: Radius.field, paddingVertical: 10 },
  stepText: { fontFamily: FontFamily.bold, fontSize: 14 },
  pair: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  // minWidth 0: Im Web hat ein Eingabefeld sonst eine Mindestbreite und schiebt die Reihe über die Karte.
  grow: { flex: 1, minWidth: 0 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stampButtons: { flexDirection: 'row', gap: Spacing.two },
  stampButton: { flex: 1 },
  tx: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  txTitle: { fontFamily: FontFamily.semibold, fontSize: 14 },
  txAmount: { fontFamily: FontFamily.bold, fontSize: 16 },
  segment: { flexDirection: 'row', borderWidth: Stroke, borderRadius: Radius.field, padding: 3 },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: Radius.field - 3,
    borderWidth: Stroke,
    borderColor: 'transparent',
  },
  segmentText: { fontFamily: FontFamily.bold, fontSize: 14 },
});
