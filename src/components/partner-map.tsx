import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import { useDockSuppression } from '@/components/mascot-dock';
import { PartnerLogo } from '@/components/partner-logo';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { FontFamily, MaxContentWidth, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatEuro } from '@/domain/club';
import { distanceKm, formatDistance } from '@/domain/distance';
import { clusterPlaces, partnerPlaces, type MapCluster, type PartnerPlace } from '@/domain/partner-places';
import { useTheme } from '@/hooks/use-theme';
import type { Offer } from '@/lib/api';
import { useMarket } from '@/lib/market-context';
import { openRoute } from '@/lib/open-maps';

/** Göttingen – die erste Stadt. Gilt, bis der eigene Standort da ist. */
const START: Region = { latitude: 51.5413, longitude: 9.9158, latitudeDelta: 0.12, longitudeDelta: 0.12 };

/**
 * Die Karte: alle Partner als kleine Logo-Pins, sonst so wenig wie möglich.
 *
 * Aufgeräumt (Nutzerwunsch: „viel zu voll"): kein Goenni hier – weder im Kopf
 * noch im Dock –, der Standort-Knopf sitzt oben rechts, wo er nie mit dem
 * Partner-Blatt kollidiert. Partner, die auf dem Bildschirm übereinander lägen,
 * werden zu einem Punkt mit Zahl zusammengefasst (`clusterPlaces`); Antippen
 * zoomt hinein. Ein Partner-Pin öffnet unten ein kurzes Blatt mit Angeboten,
 * Preis ab und Route.
 */
export default function PartnerMap() {
  const colors = useTheme();
  const router = useRouter();
  const market = useMarket();
  const { width } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const [selected, setSelected] = useState<PartnerPlace<Offer> | null>(null);
  const [region, setRegion] = useState<Region>(START);
  // Die Karte braucht Platz: Goenni bleibt hier ganz weg.
  const focused = useIsFocused();
  useDockSuppression('map', focused);
  // Für welche Pin-Liste die Logos schon gezeichnet sind (dann einfrieren).
  const [frozen, setFrozen] = useState('');

  const places = useMemo(() => partnerPlaces(market.offers), [market.offers]);
  const clusters = clusterPlaces(places, region, width);

  // Logos zeichnen sich asynchron – kurz mitverfolgen, dann einfrieren (spart Akku).
  const signature = clusters.map((c) => `${c.key}:${c.places[0]?.logoUrl ?? ''}`).join('|') + `#${selected?.partnerId ?? ''}`;
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

  /** Eine Gruppe antippen: so weit hineinzoomen, dass sie sich auflöst. */
  const openCluster = (cluster: MapCluster<PartnerPlace<Offer>>) => {
    const lats = cluster.places.map((p) => p.lat);
    const lngs = cluster.places.map((p) => p.lng);
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs), 0.002);
    mapRef.current?.animateToRegion({ latitude: cluster.lat, longitude: cluster.lng, latitudeDelta: span * 3, longitudeDelta: span * 3 }, 400);
  };

  return (
    <View style={styles.flex}>
      <TopBar decor={false} />
      <View style={styles.flex}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={START}
          showsUserLocation={!!market.coords}
          showsMyLocationButton={false}
          showsPointsOfInterests={false}
          toolbarEnabled={false}
          onRegionChangeComplete={setRegion}
          onPress={() => setSelected(null)}>
          {clusters.map((cluster) => {
            if (cluster.places.length > 1) {
              return (
                <Marker
                  key={cluster.key}
                  coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
                  tracksViewChanges={tracks}
                  onPress={(e) => {
                    e.stopPropagation();
                    openCluster(cluster);
                  }}>
                  <View style={[styles.cluster, { backgroundColor: colors.tint }]}>
                    <Text style={styles.clusterText}>{cluster.places.length}</Text>
                  </View>
                </Marker>
              );
            }
            const place = cluster.places[0];
            const active = selected?.partnerId === place.partnerId;
            return (
              <Marker
                key={cluster.key}
                coordinate={{ latitude: place.lat, longitude: place.lng }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={tracks}
                onPress={(e) => {
                  e.stopPropagation();
                  setSelected(place);
                }}>
                {/* Pin mit Spitze: liest sich als Ort, nicht als schwebender Knopf. */}
                <View style={styles.pinWrap}>
                  <View style={[styles.pin, { borderColor: active ? colors.tint : '#ffffff' }, active && styles.pinActive]}>
                    <PartnerLogo name={place.name} uri={place.logoUrl} size={active ? 38 : 30} />
                  </View>
                  <View style={[styles.pinTip, { borderTopColor: active ? colors.tint : '#ffffff' }]} />
                </View>
              </Marker>
            );
          })}
        </MapView>

        <View style={[styles.count, { backgroundColor: colors.background, borderColor: colors.border }]} pointerEvents="none">
          <Icon name="map-pin" size={14} color={colors.tint} />
          <Text style={[styles.countText, { color: colors.text }]}>{places.length === 0 ? 'Bald hier: unsere Partner' : `${places.length} Partner`}</Text>
        </View>

        {market.coords ? (
          <View style={styles.locateSlot}>
            <PressableScale
              onPress={() =>
                market.coords &&
                mapRef.current?.animateToRegion({ latitude: market.coords.lat, longitude: market.coords.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 400)
              }
              accessibilityRole="button"
              accessibilityLabel="Auf meinen Standort zentrieren"
              style={[styles.locate, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Icon name="compass" size={20} color={colors.tint} />
            </PressableScale>
          </View>
        ) : null}

        {selected ? (
          <View style={styles.sheetWrap}>
            <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.sheetHead}>
                <PartnerLogo name={selected.name} uri={selected.logoUrl} size={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                    {selected.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {[distance, selected.address ?? selected.city].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={styles.chips}>
                    <View style={[styles.chip, { backgroundColor: colors.backgroundSelected }]}>
                      <Text style={[styles.chipText, { color: colors.text }]}>
                        {selected.offers.length} {selected.offers.length === 1 ? 'Angebot' : 'Angebote'}
                      </Text>
                    </View>
                    {selected.fromCents !== null ? (
                      <View style={[styles.chip, { backgroundColor: colors.backgroundSelected }]}>
                        <Text style={[styles.chipText, { color: colors.text }]}>ab {formatEuro(selected.fromCents)}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={styles.closeSlot}>
                  <PressableScale onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={10} style={[styles.close, { backgroundColor: colors.backgroundSelected }]}>
                    <Icon name="close" size={16} color={colors.text} />
                  </PressableScale>
                </View>
              </View>
              <View style={styles.actions}>
                <Button
                  title="Angebote ansehen"
                  icon="ticket"
                  size="small"
                  onPress={() => router.push({ pathname: '/partner/[id]', params: { id: String(selected.partnerId) } })}
                  style={styles.action}
                />
                <Button title="Route" icon="map" size="small" variant="secondary" onPress={() => openRoute({ lat: selected.lat, lng: selected.lng }, selected.name)} style={styles.action} />
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
  pinWrap: { alignItems: 'center' },
  pin: {
    borderWidth: 2.5,
    borderRadius: 999,
    padding: 1,
    backgroundColor: '#ffffff',
    shadowColor: '#1c0833',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pinActive: { borderWidth: 3 },
  pinTip: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  cluster: { minWidth: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, elevation: 3 },
  clusterText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 15 },
  count: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: Stroke,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  countText: { fontFamily: FontFamily.bold, fontSize: 13 },
  /** Position an einer Hülle: PressableScale legt `style` auf die innere Fläche. */
  locateSlot: { position: 'absolute', top: Spacing.three, right: Spacing.three },
  locate: { width: 44, height: 44, borderRadius: 22, borderWidth: Stroke, alignItems: 'center', justifyContent: 'center' },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.three, alignItems: 'center' },
  sheet: { width: '100%', maxWidth: MaxContentWidth, borderWidth: Stroke, borderRadius: Radius.panel, padding: Spacing.three, gap: Spacing.three },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  name: { fontFamily: FontFamily.bold, fontSize: 17 },
  meta: { fontFamily: FontFamily.medium, fontSize: 13 },
  chips: { flexDirection: 'row', gap: 6, marginTop: 2 },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 12 },
  closeSlot: { alignSelf: 'flex-start' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
