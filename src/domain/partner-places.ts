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
