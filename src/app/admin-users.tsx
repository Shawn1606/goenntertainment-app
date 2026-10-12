import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AdminScreen, SectionTitle } from '@/components/admin-ui';
import { PlanBadge } from '@/components/plan-badge';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Spacing } from '@/constants/theme';
import { formatCredits } from '@/domain/club';
import { initialsOf } from '@/domain/initials';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type AdminUser } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';

/**
 * Nutzer finden. Jede Zeile öffnet die Detailseite (admin-user.tsx) – dort
 * stehen Credits, Stempel, Kontoauszug und alle Aktionen.
 *
 * Oben steht immer das eigene Konto: Credits und Stempel lassen sich auch dort
 * korrigieren.
 */
export default function AdminUsers() {
  const colors = useTheme();
  const router = useRouter();
  const { token, user: me } = useAuth();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (q: string) => {
      if (!token) return;
      setLoading(true);
      try {
        setUsers((await api.admin.users(token, q)).data);
      } catch (e) {
        await notifyUser('Laden fehlgeschlagen', errorMessage(e));
      }
      setLoading(false);
    },
    [token],
  );

  // Beim Zurückkommen neu laden – mit der Suche, die gerade im Feld steht, aber
  // nicht bei jedem Tastendruck (vorher lud es nach der Rückkehr ungefiltert).
  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);
  useFocusEffect(
    useCallback(() => {
      void load(latestQuery.current);
    }, [load]),
  );

  const open = (id: number) => router.push({ pathname: '/admin-user', params: { id: String(id) } });
  const self = users.find((u) => u.id === me?.id);
  const others = users.filter((u) => u.id !== me?.id);

  return (
    <AdminScreen title="Nutzer" refreshing={loading} onRefresh={() => load(query)}>
      <TextField
        label="Suchen"
        value={query}
        onChangeText={setQuery}
        placeholder="Name, Benutzername oder E-Mail"
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={() => load(query)}
      />

      {me ? (
        <>
          <SectionTitle>Dein Konto</SectionTitle>
          <UserRow user={self ?? null} fallbackName={me.name} onPress={() => open(me.id)} highlight />
        </>
      ) : null}

      <SectionTitle>{query.trim() ? `Treffer (${others.length})` : `Neueste (${others.length})`}</SectionTitle>
      {others.length === 0 && !loading ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>Niemand gefunden.</Text>
      ) : (
        <Card padded={false}>
          {others.map((u, i) => (
            <UserRow key={u.id} user={u} onPress={() => open(u.id)} divider={i > 0} />
          ))}
        </Card>
      )}
    </AdminScreen>
  );
}

function UserRow({
  user,
  fallbackName,
  onPress,
  divider = false,
  highlight = false,
}: {
  user: AdminUser | null;
  fallbackName?: string;
  onPress: () => void;
  divider?: boolean;
  highlight?: boolean;
}) {
  const colors = useTheme();
  const name = user?.name ?? fallbackName ?? '';
  const row = (
    <PressableScale
      onPress={onPress}
      scaleTo={0.99}
      accessibilityRole="button"
      accessibilityLabel={`${name} öffnen`}
      style={[styles.row, divider && { borderTopWidth: 1, borderTopColor: colors.border }]}>
      <View style={[styles.avatar, { backgroundColor: colors.backgroundSelected }]}>
        <Text style={[styles.initials, { color: colors.tint }]}>{initialsOf(name)}</Text>
      </View>
      <View style={styles.rowText}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          {user?.is_admin ? <Icon name="shield" size={14} color={colors.tint} /> : null}
          {user?.banned ? <Icon name="ban" size={14} color="#e11d48" /> : null}
        </View>
        {user ? (
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {user.username ? `@${user.username} · ` : ''}
            {user.email}
          </Text>
        ) : null}
        {user ? (
          <View style={styles.chips}>
            <Chip icon="coin" text={formatCredits(user.credits_balance)} />
            <Chip icon="stamp" text={`${user.stamps_total}`} />
            <Chip icon="ticket" text={`${user.bookings_count}`} />
          </View>
        ) : null}
      </View>
      {user ? <PlanBadge plan={user.club_plan} size="small" /> : null}
      <Icon name="chevron-right" size={18} color={colors.textSecondary} />
    </PressableScale>
  );
  return highlight ? <Card padded={false}>{row}</Card> : row;
}

function Chip({ icon, text }: { icon: 'coin' | 'stamp' | 'ticket'; text: string }) {
  const colors = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: colors.backgroundSelected }]}>
      <Icon name={icon} size={12} color={colors.textSecondary} />
      <Text style={[styles.chipText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 12, paddingHorizontal: Spacing.three },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FontFamily.bold, fontSize: 15 },
  rowText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontFamily: FontFamily.bold, fontSize: 15, flexShrink: 1 },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  chips: { flexDirection: 'row', gap: 6, marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  empty: { fontFamily: FontFamily.medium, fontSize: 14 },
});
