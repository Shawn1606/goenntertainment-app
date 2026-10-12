import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AvatarStack } from '@/components/ui/avatar-stack';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type Offer } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';
import * as feedback from '@/lib/feedback';
import { useMarket } from '@/lib/market-context';

/**
 * „In Gruppe teilen": Das Angebot landet als Karte im Gruppenchat, und man
 * springt gleich hinterher – dort wird abgestimmt, wer mitkommt.
 *
 * Ohne Gruppe gibt es statt einer leeren Liste den Weg zur ersten Gruppe.
 */
export function ShareOfferSheet({ offer, visible, onClose }: { offer: Pick<Offer, 'id' | 'title'>; visible: boolean; onClose: () => void }) {
  const colors = useTheme();
  const router = useRouter();
  const { token } = useAuth();
  const market = useMarket();
  const [sending, setSending] = useState<number | null>(null);

  const share = async (groupId: number, name: string) => {
    if (!token || sending !== null) return;
    setSending(groupId);
    try {
      await api.sendMessage(token, groupId, { offerId: offer.id });
      feedback.achieved();
      onClose();
      router.push({ pathname: '/chat', params: { group: String(groupId), title: name } });
    } catch (e) {
      feedback.failed();
      await notifyUser('Teilen hat nicht geklappt', errorMessage(e));
    }
    setSending(null);
  };

  const toGroups = () => {
    onClose();
    // Die Gruppen sind ein Tab: zurück unter die Tabs, nicht obendrauf stapeln.
    router.dismissTo('/groups');
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="In Gruppe teilen" subtitle={offer.title}>
      {market.groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Du bist noch in keiner Gruppe. Gründe eine und lade deine Leute per Link ein – dann könnt ihr Angebote zusammen aussuchen und günstiger buchen.
          </Text>
          <Button title="Gruppe gründen" icon="users" onPress={toGroups} />
        </View>
      ) : (
        <View style={styles.list}>
          {market.groups.map((g) => (
            <PressableScale
              key={g.id}
              onPress={() => share(g.id, g.name)}
              disabled={sending !== null}
              haptic="tap"
              scaleTo={0.98}
              accessibilityRole="button"
              accessibilityLabel={`An ${g.name} senden`}
              style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <AvatarStack people={g.members.slice(0, 3)} size={30} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                  {g.name}
                </Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {g.members_count} {g.members_count === 1 ? 'Person' : 'Personen'}
                </Text>
              </View>
              {sending === g.id ? <ActivityIndicator color={colors.tint} /> : <Icon name="send" size={18} color={colors.tint} />}
            </PressableScale>
          ))}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: { gap: Spacing.three, paddingBottom: Spacing.two },
  emptyText: { fontFamily: FontFamily.medium, fontSize: 14.5, lineHeight: 21 },
  list: { gap: Spacing.two, paddingBottom: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: Stroke, borderRadius: Radius.card, padding: Spacing.three },
  name: { fontFamily: FontFamily.bold, fontSize: 15.5 },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
});
