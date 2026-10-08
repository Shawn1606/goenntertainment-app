/**
 * Blockierte Konten – ansehen und freigeben.
 *
 * ## Warum es diesen Screen überhaupt gibt
 *
 * Blockieren lässt die Person für dich verschwinden: Ihre Nachrichten in den
 * Gruppen-Chats siehst du nicht mehr. Genau deshalb wäre es ohne diese Liste eine
 * Einbahnstraße – man käme an keine Stelle mehr, an der ein „Freigeben" stehen könnte.
 */
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomeBackground } from '@/components/home-background';
import { MascotEmpty, MascotError } from '@/components/mascot';
import { ThemedText } from '@/components/themed-text';
import { Entrance } from '@/components/ui/entrance';
import { GlassCard, GlassChip } from '@/components/ui/glass';
import { FontFamily, MaxContentWidth, Spacing } from '@/constants/theme';
import { useBrandSurface, useGlass } from '@/hooks/use-theme';
import { ApiError, api, type BlockedPerson } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { BackButton } from '@/components/ui/icon-button';

/** Erste Buchstaben des Namens – Rückfallbild ohne Profilbild. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function BlockedScreen() {
  const insets = useSafeAreaInsets();
  const surface = useBrandSurface();
  const glass = useGlass();
  const { token } = useAuth();

  const [people, setPeople] = useState<BlockedPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await api.blocks(token);
      setPeople(res.data);
    } catch {
      setError('Die Liste ließ sich gerade nicht laden.');
    }
    setLoading(false);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    feedback.tapped();
    await load();
    setRefreshing(false);
  }, [load]);

  async function unblock(person: BlockedPerson) {
    if (!token) return;
    const ok = await confirmAction(
      'Blockierung aufheben',
      `Du siehst die Nachrichten von ${person.name} danach wieder.`,
      'Aufheben',
    );
    if (!ok) return;

    try {
      await api.unblockUser(token, person.id);
      feedback.selected();
      setPeople((prev) => prev.filter((row) => row.id !== person.id));
    } catch (err) {
      feedback.failed();
      setError(err instanceof ApiError ? err.firstError() : 'Das hat nicht geklappt.');
    }
  }

  return (
    <HomeBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={surface.accent}
            colors={[surface.accent]}
          />
        }>
        <View style={styles.header}>
          <BackButton />
          <View style={styles.headerText}>
            <ThemedText style={styles.title}>Blockierte Konten</ThemedText>
            <ThemedText type="small" style={{ color: surface.textMuted }}>
              Wer hier steht, sieht dich nicht und kann dich nicht anfragen.
            </ThemedText>
          </View>
        </View>

        {error ? <MascotError detail={error} onRetry={loading ? undefined : load} /> : null}

        {!loading && people.length === 0 && !error ? (
          <GlassCard tone="accent">
            <MascotEmpty mood="cheer" size={80}>
              <ThemedText style={{ color: surface.text }}>Niemand blockiert.</ThemedText>
              <ThemedText type="small" style={[styles.centered, { color: surface.textMuted }]}>
                {'Wenn dich jemand nervt: „Blockieren" findest du an jeder Nachricht im Chat und bei den Mitgliedern einer Gruppe.'}
              </ThemedText>
            </MascotEmpty>
          </GlassCard>
        ) : null}

        {people.map((person, index) => (
          <Entrance key={person.id} index={index}>
            <GlassCard tone="card" style={styles.row}>
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: surface.chipBgSolid, borderColor: glass.border },
                ]}>
                {person.avatar ? (
                  <Image source={{ uri: person.avatar }} style={styles.avatarImage} contentFit="cover" />
                ) : (
                  <ThemedText style={[styles.initials, { color: surface.accent }]}>
                    {initialsOf(person.name)}
                  </ThemedText>
                )}
              </View>
              <View style={styles.rowText}>
                <ThemedText type="smallBold" style={{ color: surface.text }} numberOfLines={1}>
                  {person.name}
                </ThemedText>
                <ThemedText type="small" style={{ color: surface.textMuted }} numberOfLines={1}>
                  {person.username ? `@${person.username}` : 'blockiert'}
                </ThemedText>
              </View>
              <GlassChip label="Freigeben" onPress={() => unblock(person)} />
            </GlassCard>
          </Entrance>
        ))}
      </ScrollView>
    </HomeBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  headerText: { flex: 1, gap: Spacing.half },
  title: { fontSize: 24, lineHeight: 31, fontWeight: '800', letterSpacing: -0.5 },
  centered: { textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  initials: { fontSize: 14, fontWeight: '800', fontFamily: FontFamily.bold },
  rowText: { flex: 1, gap: 1 },
  pressed: { opacity: 0.7 },
});
