import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import { Mascot } from '@/components/mascot';
import { PartnerLogo } from '@/components/partner-logo';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatEuro } from '@/domain/club';
import { distanceKm, formatDistance } from '@/domain/distance';
import { partnerPlaces, type PartnerPlace } from '@/domain/partner-places';
import { useTheme } from '@/hooks/use-theme';
import type { Offer } from '@/lib/api';
import { useMarket } from '@/lib/market-context';
import { openRoute } from '@/lib/open-maps';

/** Göttingen – die erste Stadt. Gilt, bis der eigene Standort da ist. */
const START: Region = { latitude: 51.5413, longitude: 9.9158, latitudeDelta: 0.12, longitudeDelta: 0.12 };

/**
 * Die Karte: alle Partner als runde Logos. Antippen zeigt unten eine Karte mit
 * Angeboten, Preis ab und Route.
 */
export default function PartnerMap() {
  const colors = useTheme();
  const router = useRouter();
  const market = useMarket();
  const mapRef = useRef<MapView>(null);
  const [selected, setSelected] = useState<PartnerPlace<Offer> | null>(null);
  // Für welche Pin-Liste die Logos schon gezeichnet sind (dann einfrieren).
  const [frozen, setFrozen] = useState('');

  const places = useMemo(() => partnerPlaces(market.offers), [market.offers]);

  // Logos zeichnen sich asynchron – kurz mitverfolgen, dann einfrieren (spart Akku).
  const signature = places.map((p) => `${p.partnerId}:${p.logoUrl ?? ''}`).join('|');
  const tracks = frozen !== signature;
  useEffect(() => {
    const timer = setTimeout(() => setFrozen(signature), 1500);
    return () => clearTimeout(timer);
  }, [signature]);

  useEffect(() => {
    if (market.coords) {
      mapRef.current?.animateToRegion({ latitude: market.coords.lat, longitude: market.coords.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }, 500);
    }
  }, [market.coords]);

  const distance = selected && market.coords
    ? formatDistance(distanceKm({ latitude: market.coords.lat, longitude: market.coords.lng }, { latitude: selected.lat, longitude: selected.lng }))
    : null;

  return (
    <View style={styles.flex}>
      <TopBar />
      <View style={styles.flex}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={START}
          showsUserLocation={!!market.coords}
          showsMyLocationButton={false}
          onPress={() => setSelected(null)}>
          {places.map((place) => (
            <Marker
              key={place.partnerId}
              coordinate={{ latitude: place.lat, longitude: place.lng }}
              tracksViewChanges={tracks}
              onPress={(e) => {
                e.stopPropagation();
                setSelected(place);
              }}>
              <View style={[styles.pin, { borderColor: selected?.partnerId === place.partnerId ? colors.tint : '#ffffff' }]}>
                <PartnerLogo name={place.name} uri={place.logoUrl} size={40} />
              </View>
            </Marker>
          ))}
        </MapView>

        <View style={styles.header} pointerEvents="none">
          <View style={[styles.pill, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Mascot mood="thinking" gesture="look" size={28} />
            <Text style={[styles.pillText, { color: colors.text }]}>
              {places.length === 0 ? 'Bald hier: unsere Partner' : `${places.length} Partner in deiner Stadt`}
            </Text>
          </View>
        </View>

        {market.coords ? (
          <PressableScale
            onPress={() =>
              market.coords &&
              mapRef.current?.animateToRegion({ latitude: market.coords.lat, longitude: market.coords.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 400)
            }
            accessibilityRole="button"
            accessibilityLabel="Auf meinen Standort zentrieren"
            style={[styles.locate, { backgroundColor: colors.background, borderColor: colors.border, bottom: selected ? 220 : Spacing.three }]}>
            <Icon name="map-pin" size={22} color={colors.tint} />
          </PressableScale>
        ) : null}

        {selected ? (
          <View style={styles.sheetWrap}>
            <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.sheetHead}>
                <PartnerLogo name={selected.name} uri={selected.logoUrl} size={48} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {selected.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {[distance, selected.address ?? selected.city].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={[styles.meta, { color: colors.text }]}>
                    {selected.offers.length} {selected.offers.length === 1 ? 'Angebot' : 'Angebote'}
                    {selected.fromCents !== null ? ` · ab ${formatEuro(selected.fromCents)}` : ''}
                  </Text>
                </View>
                <PressableScale onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={10}>
                  <Icon name="close" size={20} color={colors.textSecondary} />
                </PressableScale>
              </View>
              <View style={styles.actions}>
                <Button
                  title="Angebote"
                  icon="ticket"
                  onPress={() => router.push({ pathname: '/partner/[id]', params: { id: String(selected.partnerId) } })}
                  style={styles.action}
                />
                <Button title="Route" icon="map" variant="secondary" onPress={() => openRoute({ lat: selected.lat, lng: selected.lng }, selected.name)} style={styles.action} />
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pin: { borderWidth: 3, borderRadius: 26, padding: 1, backgroundColor: '#ffffff' },
  header: { position: 'absolute', top: Spacing.three, left: 0, right: 0, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: Stroke, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  pillText: { fontFamily: FontFamily.bold, fontSize: 14 },
  locate: { position: 'absolute', right: Spacing.three, width: 48, height: 48, borderRadius: 24, borderWidth: Stroke, alignItems: 'center', justifyContent: 'center' },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.three, alignItems: 'center' },
  sheet: { width: '100%', maxWidth: MaxContentWidth, borderWidth: Stroke, borderRadius: Radius.panel, padding: Spacing.three, gap: Spacing.three },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  name: { fontFamily: FontFamily.bold, fontSize: 17 },
  meta: { fontFamily: FontFamily.medium, fontSize: 13 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
