import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AdminScreen } from '@/components/admin-ui';
import { MascotError } from '@/components/mascot';
import { PartnerLogo } from '@/components/partner-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { FontFamily, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type AdminPartner } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** Alle Partner – aktive und pausierte. */
export default function AdminPartners() {
  const router = useRouter();
  const colors = useTheme();
  const { token } = useAuth();
  /** `null`, solange noch nichts geladen ist – „Noch keine Partner" nur, wenn es stimmt. */
  const [partners, setPartners] = useState<AdminPartner[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    api.admin
      .partners(token)
      .then(({ data }) => {
        setPartners(data);
        setLoadError(null);
      })
      .catch((e) => setLoadError(errorMessage(e, 'Die Partner ließen sich nicht laden.')));
  }, [token]);

  useFocusEffect(load);

  return (
    <AdminScreen title="Partner">
      <Button title="Neuer Partner" icon="plus" onPress={() => router.push('/admin-partner')} />
      {loadError ? <MascotError detail={loadError} onRetry={load} /> : null}
      {partners === null && !loadError ? <ActivityIndicator color={colors.tint} /> : null}
      {partners?.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Noch keine Partner. Lege den ersten an, sobald der Vertrag steht.
        </Text>
      ) : null}
      {(partners ?? []).map((p) => (
        <Card key={p.id} onPress={() => router.push({ pathname: '/admin-partner', params: { id: String(p.id) } })} accessibilityLabel={p.name}>
          <View style={[styles.row, !p.is_active && styles.paused]}>
            <PartnerLogo name={p.name} uri={p.logo_url} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.text }]}>{p.name}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {p.city ?? 'ohne Ort'} · {p.offers_count} Angebote · {p.staff_count} im Team
                {p.is_active ? '' : ' · pausiert'}
                {p.is_featured ? ' · hervorgehoben' : ''}
              </Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.textSecondary} />
          </View>
        </Card>
      ))}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  empty: { fontFamily: FontFamily.medium, fontSize: 14, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  paused: { opacity: 0.55 },
  name: { fontFamily: FontFamily.bold, fontSize: 16 },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
});
