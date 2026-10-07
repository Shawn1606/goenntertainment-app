import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MascotEmpty } from '@/components/mascot';
import { Button } from '@/components/ui/button';
import { AvatarStack } from '@/components/ui/avatar-stack';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { KeyboardForm } from '@/components/ui/keyboard-form';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { discountFor, formatPercent } from '@/domain/club';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * Meine Gruppen – anlegen, per Code beitreten, öffnen.
 *
 * Eine Gruppe ist die Runde, mit der man unterwegs ist: Familie, Clique, Team.
 * Je mehr drin sind, desto größer der Rabatt beim gemeinsamen Buchen – das
 * steht an jeder Gruppe dran.
 */
export default function GroupsScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { token, user } = useAuth();
  const market = useMarket();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<{ field: 'name' | 'code'; text: string } | null>(null);

  useEffect(() => {
    void market.refreshGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    if (!token || !name.trim()) return;
    setBusy('create');
    setError(null);
    try {
      const { data } = await api.createGroup(token, name.trim());
      setName('');
      feedback.joined();
      await market.refreshGroups();
      router.push({ pathname: '/group/[id]', params: { id: String(data.id), created: '1' } });
    } catch (e) {
      setError({ field: 'name', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    if (!token || !code.trim()) return;
    setBusy('join');
    setError(null);
    try {
      const { data } = await api.joinGroup(token, code.trim());
      setCode('');
      feedback.joined();
      await market.refreshGroups();
      router.push({ pathname: '/group/[id]', params: { id: String(data.id) } });
    } catch (e) {
      setError({ field: 'code', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.backgroundElement }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Gruppen' }} />
      <KeyboardForm contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {market.groups.length === 0 ? (
          <Card>
            <MascotEmpty mood="cheer" gesture="wave">
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Zusammen wird&apos;s günstiger</Text>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Leg eine Gruppe an und schick den Code an deine Leute. Ab 2 Personen gibt&apos;s Gruppenrabatt.
              </Text>
            </MascotEmpty>
          </Card>
        ) : null}

        {market.groups.map((g) => {
          const d = discountFor(CLUB_RULES, user?.club_plan, g.members_count);
          return (
            <Card key={g.id} onPress={() => router.push({ pathname: '/group/[id]', params: { id: String(g.id) } })} accessibilityLabel={g.name}>
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <View style={styles.metaRow}>
                    <AvatarStack people={g.members} max={5} size={24} />
                    <Text style={[styles.meta, { color: colors.textSecondary }]}>
                      {g.members_count} {g.members_count === 1 ? 'Person' : 'Personen'}
                      {d.percent > 0 ? ` · bis −${formatPercent(d.percent)}` : ''}
                    </Text>
                  </View>
                </View>
                {g.unread > 0 ? (
                  <View style={[styles.unread, { backgroundColor: colors.tint }]}>
                    <Text style={styles.unreadText}>{g.unread > 9 ? '9+' : g.unread}</Text>
                  </View>
                ) : null}
                <Icon name="chevron-right" size={18} color={colors.textSecondary} />
              </View>
            </Card>
          );
        })}

        <Card style={styles.form}>
          <Text style={[styles.formTitle, { color: colors.text }]}>Neue Gruppe</Text>
          <TextField
            label="Name"
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            placeholder="z. B. Familie Müller, Donnerstagsrunde"
            maxLength={60}
            error={error?.field === 'name' ? error.text : undefined}
            returnKeyType="done"
            onSubmitEditing={create}
          />
          <Button title="Gruppe anlegen" icon="plus" onPress={create} loading={busy === 'create'} disabled={!name.trim()} />
        </Card>

        <Card style={styles.form}>
          <Text style={[styles.formTitle, { color: colors.text }]}>Einladungscode?</Text>
          <TextField
            label="Code oder Link"
            value={code}
            onChangeText={(v) => {
              setCode(v);
              setError(null);
            }}
            placeholder="ABCD-2345"
            autoCapitalize="characters"
            autoCorrect={false}
            error={error?.field === 'code' ? error.text : undefined}
            returnKeyType="done"
            onSubmitEditing={join}
          />
          <Button title="Beitreten" variant="secondary" icon="users" onPress={join} loading={busy === 'join'} disabled={code.trim().length < 4} />
        </Card>
      </KeyboardForm>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingBottom: Spacing.six },
  emptyTitle: { fontFamily: FontFamily.bold, fontSize: 19 },
  emptyText: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  name: { fontFamily: FontFamily.bold, fontSize: 16.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  meta: { fontFamily: FontFamily.medium, fontSize: 13 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 11 },
  form: { gap: Spacing.three },
  formTitle: { fontFamily: FontFamily.bold, fontSize: 17 },
});
