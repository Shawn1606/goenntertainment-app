import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AdminScreen, numberOrNull } from '@/components/admin-ui';
import { PlanBadge } from '@/components/plan-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Spacing } from '@/constants/theme';
import { formatCredits } from '@/domain/club';
import { formatDateTimeCompact } from '@/domain/date-format';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type AdminUser } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { pickImage } from '@/lib/pick-image';

/** Kurze Sperren als Schnellwahl – alles andere ist ein Bann. */
const TIMEOUTS = [
  { label: '1 Tag', minutes: 60 * 24 },
  { label: '7 Tage', minutes: 60 * 24 * 7 },
  { label: '30 Tage', minutes: 60 * 24 * 30 },
];

/**
 * Nutzer suchen und verwalten: Credits gutschreiben (Kulanz, Gewinnspiel),
 * umbenennen, auf Zeit oder dauerhaft sperren, löschen.
 */
export default function AdminUsers() {
  const colors = useTheme();
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(
    async (q = query) => {
      if (!token) return;
      try {
        setUsers((await api.admin.users(token, q)).data);
      } catch (e) {
        await notifyUser('Laden fehlgeschlagen', errorMessage(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      void load('');
    }, [load]),
  );

  const replace = (u: AdminUser) => setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)));

  return (
    <AdminScreen title="Nutzer">
      <TextField
        label="Suchen"
        value={query}
        onChangeText={setQuery}
        placeholder="Name, Benutzername oder E-Mail"
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={() => load(query)}
      />
      {users.map((u) => (
        <Card key={u.id} onPress={() => setOpen(open === u.id ? null : u.id)} accessibilityLabel={u.name}>
          <View style={styles.head}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.name, { color: colors.text }]}>
                {u.name}
                {u.is_admin ? ' · Admin' : ''}
              </Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {u.username ? `@${u.username} · ` : ''}
                {u.email}
              </Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {formatCredits(u.credits_balance)} Credits · {u.bookings_count} Buchungen · {u.groups_count} Gruppen · seit {formatDateTimeCompact(u.created_at)}
              </Text>
              {u.banned ? (
                <Text style={[styles.meta, { color: '#e11d48' }]}>
                  {u.banned_permanent ? 'Gebannt' : `Gesperrt bis ${formatDateTimeCompact(u.banned_until)}`}: {u.ban_reason}
                </Text>
              ) : null}
            </View>
            <PlanBadge plan={u.club_plan} size="small" />
          </View>
          {open === u.id && token ? <Actions user={u} token={token} onChanged={replace} onDeleted={() => setUsers((p) => p.filter((x) => x.id !== u.id))} /> : null}
        </Card>
      ))}
    </AdminScreen>
  );
}

function Actions({ user, token, onChanged, onDeleted }: { user: AdminUser; token: string; onChanged: (u: AdminUser) => void; onDeleted: () => void }) {
  const colors = useTheme();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [username, setUsername] = useState(user.username ?? '');

  const grant = async () => {
    try {
      onChanged((await api.admin.grantCredits(token, user.id, numberOrNull(amount) ?? 0, note.trim())).data);
      setAmount('');
      setNote('');
    } catch (e) {
      await notifyUser('Nicht gebucht', errorMessage(e));
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
    } catch (e) {
      await notifyUser('Nicht gesperrt', errorMessage(e));
    }
  };

  const unban = async () => {
    await api.admin.unbanUser(token, user.id);
    onChanged({ ...user, banned: false, banned_until: null, ban_reason: null });
  };

  const rename = async () => {
    try {
      const res = await api.admin.renameUser(token, user.id, username.trim());
      onChanged({ ...user, username: res.username });
    } catch (e) {
      await notifyUser('Nicht umbenannt', errorMessage(e));
    }
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
    <View style={[styles.actions, { borderTopColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.text }]}>Credits gutschreiben (Minus = abziehen)</Text>
      <View style={styles.pair}>
        <View style={{ width: 110 }}>
          <TextField label="Credits" value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Grund (steht im Auszug)" value={note} onChangeText={setNote} />
        </View>
      </View>
      <Button title="Buchen" icon="coin" variant="secondary" size="small" onPress={grant} disabled={!amount || note.trim().length < 3} />

      <Text style={[styles.label, { color: colors.text }]}>Benutzername</Text>
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <TextField value={username} onChangeText={setUsername} autoCapitalize="none" />
        </View>
        <Button title="Ändern" size="small" variant="secondary" onPress={rename} disabled={!username.trim() || username === user.username} />
      </View>

      <Text style={[styles.label, { color: colors.text }]}>Sperren</Text>
      {user.banned ? (
        <Button title="Sperre aufheben" size="small" variant="secondary" onPress={unban} />
      ) : (
        <>
          <TextField label="Grund" value={reason} onChangeText={setReason} />
          <View style={styles.wrap}>
            {TIMEOUTS.map((t) => (
              <Button key={t.label} title={t.label} size="small" variant="secondary" onPress={() => sanction(t.minutes)} />
            ))}
            <Button title="Dauerhaft" size="small" variant="danger" onPress={() => sanction(null)} />
          </View>
        </>
      )}

      <Button title="Konto löschen" variant="danger" size="small" icon="trash" onPress={remove} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  name: { fontFamily: FontFamily.bold, fontSize: 15.5 },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  actions: { borderTopWidth: 1, marginTop: Spacing.three, paddingTop: Spacing.three, gap: Spacing.two },
  label: { fontFamily: FontFamily.bold, fontSize: 13.5, marginTop: Spacing.two },
  pair: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
