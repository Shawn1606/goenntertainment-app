/**
 * Aus der Angebotsliste die Orte für die Karte: ein Eintrag je Partner mit
 * Koordinaten, dazu seine Angebote und der günstigste Einstieg.
 *
 * Die Karte zeigt Partner und nicht Angebote: Ein Jump-Park mit fünf Angeboten
 * ist EIN Ort, und fünf Pins exakt übereinander wären vier unsichtbare.
 */

type OfferLike = {
  id: number;
  price_cents: number | null;
  price_credits: number | null;
  interest_id: number | null;
  partner: {
    id: number;
    name: string;
    lat: number | null;
    lng: number | null;
    logo_url: string | null;
    address: string | null;
    city: string | null;
    interest_id: number | null;
  } | null;
};

export type PartnerPlace<T extends OfferLike> = {
  partnerId: number;
  name: string;
  lat: number;
  lng: number;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  interestId: number | null;
  offers: T[];
  /** Günstigster Euro-Preis unter den Angeboten, falls es einen gibt. */
  fromCents: number | null;
};

export function partnerPlaces<T extends OfferLike>(offers: T[]): PartnerPlace<T>[] {
  const byPartner = new Map<number, PartnerPlace<T>>();
  for (const offer of offers) {
    const p = offer.partner;
    if (!p || p.lat === null || p.lng === null) continue;
    let place = byPartner.get(p.id);
    if (!place) {
      place = {
        partnerId: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        logoUrl: p.logo_url,
        address: p.address,
        city: p.city,
        interestId: p.interest_id ?? offer.interest_id,
        offers: [],
        fromCents: null,
      };
      byPartner.set(p.id, place);
    }
    place.offers.push(offer);
    if (offer.price_cents !== null && (place.fromCents === null || offer.price_cents < place.fromCents)) {
      place.fromCents = offer.price_cents;
    }
  }
  return [...byPartner.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Ein Punkt auf der Karte: ein einzelner Partner oder mehrere, die zu nah beieinander liegen. */
export type MapCluster<P extends { partnerId: number; lat: number; lng: number }> = {
  key: string;
  lat: number;
  lng: number;
  places: P[];
};

/**
 * Partner, die auf dem Bildschirm näher als `minPx` beieinander lägen, zu einem
 * Punkt mit Zahl zusammenfassen – sonst stapeln sich die Logos zu einem Knäuel.
 *
 * `region` ist der sichtbare Ausschnitt (Breiten-/Längengrad-Spanne),
 * `widthPx` die Breite der Karte. Daraus folgt, wie viele Pixel ein Grad hat.
 * Gruppiert wird gierig: Der erste freie Partner wird Mittelpunkt, alle nahen
 * kommen dazu; der Punkt liegt danach im Schwerpunkt der Gruppe.
 */
export function clusterPlaces<P extends { partnerId: number; lat: number; lng: number }>(
  places: readonly P[],
  region: { latitudeDelta: number; longitudeDelta: number },
  widthPx: number,
  minPx = 44,
): MapCluster<P>[] {
  if (places.length === 0) return [];
  const pxPerLng = widthPx / Math.max(region.longitudeDelta, 1e-6);
  // Breitengrade sind auf der Karte (Mercator, kleine Ausschnitte) ähnlich groß wie Längengrade mal 1/cos(Breite).
  const midLat = places.reduce((s, p) => s + p.lat, 0) / places.length;
  const pxPerLat = pxPerLng / Math.max(Math.cos((midLat * Math.PI) / 180), 0.1);

  const used = new Set<number>();
  const clusters: MapCluster<P>[] = [];
  for (const seed of places) {
    if (used.has(seed.partnerId)) continue;
    used.add(seed.partnerId);
    const group = [seed];
    for (const other of places) {
      if (used.has(other.partnerId)) continue;
      const dx = (other.lng - seed.lng) * pxPerLng;
      const dy = (other.lat - seed.lat) * pxPerLat;
      if (Math.hypot(dx, dy) < minPx) {
        group.push(other);
        used.add(other.partnerId);
      }
    }
    const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
    const lng = group.reduce((s, p) => s + p.lng, 0) / group.length;
    clusters.push({ key: group.map((p) => p.partnerId).sort((a, b) => a - b).join('-'), lat, lng, places: group });
  }
  return clusters;
}
