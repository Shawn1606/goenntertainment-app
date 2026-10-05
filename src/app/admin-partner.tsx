import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreen, SectionTitle, ToggleRow, numberOrNull } from '@/components/admin-ui';
import { PartnerLogo } from '@/components/partner-logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { QrCode } from '@/components/ui/qr-code';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits, formatEuro } from '@/domain/club';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type AdminOffer, type AdminPartner, type PartnerInput } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { useMarket } from '@/lib/market-context';
import { pickImage } from '@/lib/pick-image';
import { shareText } from '@/lib/share';

type Draft = Record<
  'name' | 'tagline' | 'description' | 'address' | 'city' | 'lat' | 'lng' | 'phone' | 'website' | 'instagram' | 'opening_hours' | 'max_discount_percent',
  string
>;

const EMPTY: Draft = {
  name: '',
  tagline: '',
  description: '',
  address: '',
  city: 'Göttingen',
  lat: '',
  lng: '',
  phone: '',
  website: '',
  instagram: '',
  opening_hours: '',
  max_discount_percent: '',
};

function draftOf(p: AdminPartner): Draft {
  return {
    name: p.name,
    tagline: p.tagline ?? '',
    description: p.description ?? '',
    address: p.address ?? '',
    city: p.city ?? '',
    lat: p.lat === null ? '' : String(p.lat),
    lng: p.lng === null ? '' : String(p.lng),
    phone: p.phone ?? '',
    website: p.website ?? '',
    instagram: p.instagram ?? '',
    opening_hours: p.opening_hours ?? '',
    max_discount_percent: p.max_discount_percent === null ? '' : String(p.max_discount_percent),
  };
}

/**
 * Einen Partner anlegen oder bearbeiten – mit allem, was dazugehört: Bilder,
 * Kategorie, Standort (für Karte und Check-in), Aufkleber-Code, Team und Angebote.
 */
export default function AdminPartnerScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const colors = useTheme();
  const { token } = useAuth();
  const market = useMarket();

  const [partner, setPartner] = useState<AdminPartner | null>(null);
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [interestId, setInterestId] = useState<number | null>(null);
  const [active, setActive] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [staffEmail, setStaffEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const apply = (p: AdminPartner) => {
    setPartner(p);
    setDraft(draftOf(p));
    setInterestId(p.interest_id);
    setActive(p.is_active);
    setFeatured(p.is_featured);
  };

  useFocusEffect(
    useCallback(() => {
      if (!token || !id) return;
      api.admin.partner(token, Number(id)).then(({ data }) => apply(data));
      api.admin.offers(token, Number(id)).then(({ data }) => setOffers(data));
    }, [token, id]),
  );

  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setErrors({});
    const input: PartnerInput = {
      name: draft.name.trim(),
      tagline: draft.tagline.trim() || null,
      description: draft.description.trim() || null,
      address: draft.address.trim() || null,
      city: draft.city.trim() || null,
      lat: numberOrNull(draft.lat),
      lng: numberOrNull(draft.lng),
      phone: draft.phone.trim() || null,
      website: draft.website.trim() || null,
      instagram: draft.instagram.trim() || null,
      opening_hours: draft.opening_hours.trim() || null,
      max_discount_percent: numberOrNull(draft.max_discount_percent),
      interest_id: interestId,
      is_active: active,
      is_featured: featured,
    };
    try {
      const { data } = partner ? await api.admin.updatePartner(token, partner.id, input) : await api.admin.createPartner(token, input);
      apply(data);
      void market.refresh();
      if (!partner) router.setParams({ id: String(data.id) });
      await notifyUser('Gespeichert', partner ? 'Der Partner ist aktualisiert.' : 'Der Partner ist angelegt. Jetzt Bilder, Aufkleber und Angebote ergänzen.');
    } catch (e) {
      const err = e as { errors?: Record<string, string[]> };
      setErrors(err.errors ?? {});
      await notifyUser('Nicht gespeichert', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: 'logo' | 'cover') => {
    if (!token || !partner) return;
    const image = await pickImage(kind === 'logo' ? 'Logo wählen' : 'Titelbild wählen', kind, kind === 'logo' ? { aspect: [1, 1] } : { aspect: [16, 9] });
    if (!image) return;
    try {
      apply((await api.admin.partnerImage(token, partner.id, kind, image)).data);
      void market.refresh();
    } catch (e) {
      await notifyUser('Upload fehlgeschlagen', errorMessage(e));
    }
  };

  const rotate = async () => {
    if (!token || !partner) return;
    if (!(await confirmAction('Neuen Aufkleber-Code erzeugen?', 'ALLE alten Aufkleber dieses Partners funktionieren danach nicht mehr. Nur bei Missbrauch nötig.', 'Neu erzeugen', true))) return;
    apply((await api.admin.rotatePartnerToken(token, partner.id)).data);
  };

  const addStaff = async () => {
    if (!token || !partner || !staffEmail.trim()) return;
    try {
      apply((await api.admin.addStaff(token, partner.id, staffEmail.trim())).data);
      setStaffEmail('');
    } catch (e) {
      await notifyUser('Nicht hinzugefügt', errorMessage(e));
    }
  };

  const removeStaff = async (userId: number, name: string) => {
    if (!token || !partner) return;
    if (!(await confirmAction(`${name} entfernen?`, 'Die Person kann danach nicht mehr für diesen Partner scannen.', 'Entfernen', true))) return;
    apply((await api.admin.removeStaff(token, partner.id, userId)).data);
  };

  const remove = async () => {
    if (!token || !partner) return;
    if (!(await confirmAction('Partner löschen?', 'Löscht den Partner mit allen Angeboten. Buchungen bleiben als Beleg erhalten. Zum Pausieren lieber „Aktiv" ausschalten.', 'Löschen', true))) return;
    await api.admin.deletePartner(token, partner.id);
    void market.refresh();
    router.back();
  };

  const field = (key: keyof Draft, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField label={label} value={draft[key]} onChangeText={set(key)} error={errors[key]?.[0]} autoCorrect={false} {...extra} />
  );

  return (
    <AdminScreen title={partner ? partner.name : 'Neuer Partner'}>
      {partner ? (
        <Card style={styles.images}>
          <PressableScale onPress={() => upload('logo')} accessibilityRole="button" accessibilityLabel="Logo ändern" style={styles.imageButton}>
            <PartnerLogo name={partner.name} uri={partner.logo_url} size={72} />
            <Text style={[styles.small, { color: colors.tint }]}>Logo ändern</Text>
          </PressableScale>
          <View style={{ flex: 1, gap: Spacing.two }}>
            <Text style={[styles.small, { color: colors.textSecondary }]}>
              Titelbild: {partner.cover_url ? 'vorhanden' : 'fehlt – ohne Bild zeigen Angebote einen Farbverlauf'}
            </Text>
            <Button title="Titelbild hochladen" icon="camera" variant="secondary" size="small" onPress={() => upload('cover')} />
          </View>
        </Card>
      ) : null}

      <Card style={styles.form}>
        {field('name', 'Name *')}
        {field('tagline', 'Kurzbeschreibung (eine Zeile)')}
        {field('description', 'Beschreibung', { multiline: true, numberOfLines: 4 })}
        <Text style={[styles.label, { color: colors.textSecondary }]}>Kategorie</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {market.interests.map((i) => {
            const on = interestId === i.id;
            return (
              <PressableScale
                key={i.id}
                onPress={() => setInterestId(on ? null : i.id)}
                haptic="select"
                style={[styles.chip, { borderColor: on ? colors.tint : colors.border, backgroundColor: on ? colors.tint : colors.background }]}>
                <CategoryIcon interest={i} size={14} color={on ? '#ffffff' : colors.text} />
                <Text style={[styles.chipText, { color: on ? '#ffffff' : colors.text }]}>{i.name}</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
        {field('address', 'Straße und Hausnummer')}
        {field('city', 'Stadt')}
        <View style={styles.pair}>
          <View style={styles.flex}>{field('lat', 'Breitengrad (z. B. 51.5413)', { keyboardType: 'decimal-pad' })}</View>
          <View style={styles.flex}>{field('lng', 'Längengrad (z. B. 9.9158)', { keyboardType: 'decimal-pad' })}</View>
        </View>
        <Text style={[styles.small, { color: colors.textSecondary }]}>
          Koordinaten braucht die Karte und der Check-in am Aufkleber (Standortprüfung). Tipp: In Google Maps lange auf den Ort drücken und die Zahlen kopieren.
        </Text>
        {field('opening_hours', 'Öffnungszeiten', { multiline: true, numberOfLines: 3 })}
        {field('phone', 'Telefon', { keyboardType: 'phone-pad' })}
        {field('website', 'Webseite (https://…)', { autoCapitalize: 'none', keyboardType: 'url' })}
        {field('instagram', 'Instagram (ohne @)', { autoCapitalize: 'none' })}
        {field('max_discount_percent', 'Höchstrabatt in % (leer = 35 %)', { keyboardType: 'number-pad' })}
        <ToggleRow label="Aktiv" hint="Pausierte Partner sind in der App unsichtbar." value={active} onChange={setActive} />
        <ToggleRow label="Hervorheben" hint="Steht auf der Startseite weiter vorn." value={featured} onChange={setFeatured} />
        <Button title={partner ? 'Speichern' : 'Partner anlegen'} onPress={save} loading={saving} disabled={!draft.name.trim()} />
      </Card>

      {partner ? (
        <>
          <SectionTitle>Aufkleber an der Kasse</SectionTitle>
          <Card style={styles.sticker}>
            <Text style={[styles.small, { color: colors.textSecondary }]}>
              Diese Adresse auf einen NFC-Aufkleber (NTAG213/215, Datensatz „URL“) schreiben und den QR-Code daneben drucken. Beides führt zum Check-in.
            </Text>
            <View style={styles.qr}>
              <QrCode value={partner.checkin_url} size={180} label={`Aufkleber-Code für ${partner.name}`} />
            </View>
            <Text style={[styles.url, { color: colors.text }]} selectable>
              {partner.checkin_url}
            </Text>
            <View style={styles.pair}>
              <Button title="Adresse teilen" icon="share" variant="secondary" size="small" onPress={() => shareText(partner.checkin_url, `Aufkleber ${partner.name}`)} style={styles.flex} />
              <Button title="Neu erzeugen" icon="refresh" variant="danger" size="small" onPress={rotate} style={styles.flex} />
            </View>
          </Card>

          <SectionTitle>Team (Partner-Modus)</SectionTitle>
          <Card style={styles.form}>
            {(partner.staff ?? []).map((s) => (
              <View key={s.id} style={styles.staff}>
                <Icon name="user" size={18} color={colors.tint} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]}>{s.name}</Text>
                  <Text style={[styles.small, { color: colors.textSecondary }]}>{s.email}</Text>
                </View>
                <PressableScale onPress={() => removeStaff(s.id, s.name)} accessibilityRole="button" accessibilityLabel={`${s.name} entfernen`} hitSlop={8}>
                  <Icon name="close" size={18} color={colors.textSecondary} />
                </PressableScale>
              </View>
            ))}
            <TextField label="E-Mail eines App-Kontos" value={staffEmail} onChangeText={setStaffEmail} autoCapitalize="none" keyboardType="email-address" />
            <Button title="Ins Team holen" icon="user-plus" variant="secondary" onPress={addStaff} disabled={!staffEmail.trim()} />
          </Card>

          <SectionTitle action={<Button title="Neues Angebot" icon="plus" size="small" onPress={() => router.push({ pathname: '/admin-offer', params: { partner: String(partner.id) } })} />}>
            Angebote
          </SectionTitle>
          {offers.length === 0 ? <Text style={[styles.small, { color: colors.textSecondary }]}>Noch keine Angebote.</Text> : null}
          {offers.map((o) => (
            <Card key={o.id} onPress={() => router.push({ pathname: '/admin-offer', params: { id: String(o.id), partner: String(partner.id) } })} accessibilityLabel={o.title}>
              <View style={[styles.staff, !o.is_active && { opacity: 0.55 }]}>
                <Icon name={o.kind === 'perk' ? 'gift' : 'ticket'} size={20} color={colors.tint} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: colors.text }]}>{o.title}</Text>
                  <Text style={[styles.small, { color: colors.textSecondary }]}>
                    {[o.price_cents !== null ? formatEuro(o.price_cents) : null, o.price_credits !== null ? `${formatCredits(o.price_credits)} Credits` : null].filter(Boolean).join(' · ')}
                    {` · ${o.bookings_count} Buchungen`}
                    {o.is_active ? '' : ' · aus'}
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.textSecondary} />
              </View>
            </Card>
          ))}

          <Button title="Partner löschen" variant="danger" onPress={remove} />
        </>
      ) : null}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  images: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  imageButton: { alignItems: 'center', gap: 4 },
  form: { gap: Spacing.three },
  label: { fontFamily: FontFamily.semibold, fontSize: 13 },
  small: { fontFamily: FontFamily.medium, fontSize: 12.5, lineHeight: 17 },
  chips: { gap: Spacing.two },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  pair: { flexDirection: 'row', gap: Spacing.two },
  sticker: { gap: Spacing.three, alignItems: 'stretch' },
  qr: { alignSelf: 'center', padding: Spacing.two, backgroundColor: '#ffffff', borderRadius: Radius.card },
  url: { fontFamily: FontFamily.semibold, fontSize: 13, textAlign: 'center' },
  staff: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  name: { fontFamily: FontFamily.bold, fontSize: 15 },
});
