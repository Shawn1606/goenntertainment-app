import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreen, ToggleRow, centsOrNull, euroInput, numberOrNull } from '@/components/admin-ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatEuro, quoteMoney } from '@/domain/club';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage, type AdminOffer, type OfferInput, type OfferKind } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CLUB_RULES } from '@/lib/club-rules';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { useMarket } from '@/lib/market-context';
import { pickImage } from '@/lib/pick-image';

type Draft = Record<
  | 'title'
  | 'subtitle'
  | 'description'
  | 'price'
  | 'credits'
  | 'max_discount'
  | 'min_people'
  | 'max_people'
  | 'min_age'
  | 'max_age'
  | 'duration'
  | 'valid_days'
  | 'sort'
  | 'daily_capacity'
  | 'platinum_reserved',
  string
>;

const EMPTY: Draft = {
  title: '',
  subtitle: '',
  description: '',
  price: '',
  credits: '',
  max_discount: '',
  min_people: '1',
  max_people: '',
  min_age: '',
  max_age: '',
  duration: '',
  valid_days: '90',
  sort: '0',
  daily_capacity: '',
  platinum_reserved: '0',
};

const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/**
 * Ein Angebot anlegen oder bearbeiten.
 *
 * Unten steht eine Rabatt-Vorschau: was ein Free-, Gold- und Platinum-Mitglied
 * allein und zu sechst zahlen würde – damit man beim Höchstrabatt sieht, was er
 * für den Partner bedeutet.
 */
export default function AdminOfferScreen() {
  const { id, partner } = useLocalSearchParams<{ id?: string; partner?: string }>();
  const router = useRouter();
  const colors = useTheme();
  const { token } = useAuth();
  const market = useMarket();
  const [offer, setOffer] = useState<AdminOffer | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [kind, setKind] = useState<OfferKind>('activity');
  const [indoor, setIndoor] = useState<boolean | null>(null);
  const [interestId, setInterestId] = useState<number | null>(null);
  const [active, setActive] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const apply = (o: AdminOffer) => {
    setOffer(o);
    setKind(o.kind);
    setIndoor(o.indoor);
    setInterestId(o.interest_id);
    setActive(o.is_active);
    setFeatured(o.is_featured);
    setDraft({
      title: o.title,
      subtitle: o.subtitle ?? '',
      description: o.description ?? '',
      price: euroInput(o.price_cents),
      credits: str(o.price_credits),
      max_discount: str(o.own_max_discount_percent),
      min_people: String(o.min_people),
      max_people: str(o.max_people),
      min_age: str(o.min_age),
      max_age: str(o.max_age),
      duration: str(o.duration_minutes),
      valid_days: String(o.valid_days),
      sort: String(o.sort),
      daily_capacity: str(o.daily_capacity),
      platinum_reserved: String(o.platinum_reserved ?? 0),
    });
  };

  useEffect(() => {
    if (!token || !id) return;
    api.admin
      .offers(token, partner ? Number(partner) : undefined)
      .then(({ data }) => {
        const found = data.find((o) => o.id === Number(id));
        if (found) apply(found);
      })
      .catch((e) => void notifyUser('Angebot nicht geladen', errorMessage(e)));
  }, [token, id, partner]);

  // Der Rabattdeckel des Partners: Gilt, wenn das Feld hier leer bleibt ("wie Partner").
  // Ohne ihn rechnete die Vorschau mit 20 % und versprach mehr Rabatt, als es gibt.
  const partnerId = Number(partner ?? offer?.partner_id) || null;
  const [partnerCap, setPartnerCap] = useState<number | null>(null);
  useEffect(() => {
    if (!token || !partnerId) return;
    let active = true;
    api.admin
      .partner(token, partnerId)
      .then(({ data }) => {
        if (active) setPartnerCap(data.max_discount_percent);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [token, partnerId]);

  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setErrors({});
    const input: OfferInput = {
      partner_id: Number(partner ?? offer?.partner_id),
      kind,
      title: draft.title.trim(),
      subtitle: draft.subtitle.trim() || null,
      description: draft.description.trim() || null,
      interest_id: interestId,
      price_cents: centsOrNull(draft.price),
      price_credits: numberOrNull(draft.credits),
      max_discount_percent: numberOrNull(draft.max_discount),
      min_people: numberOrNull(draft.min_people) ?? 1,
      max_people: numberOrNull(draft.max_people),
      min_age: numberOrNull(draft.min_age),
      max_age: numberOrNull(draft.max_age),
      duration_minutes: numberOrNull(draft.duration),
      indoor,
      valid_days: numberOrNull(draft.valid_days) ?? 90,
      sort: numberOrNull(draft.sort) ?? 0,
      is_active: active,
      is_featured: featured,
      daily_capacity: numberOrNull(draft.daily_capacity),
      platinum_reserved: numberOrNull(draft.platinum_reserved) ?? 0,
    };
    // Entscheidungen vor dem `try`: Bedingungen darin kann der React Compiler nicht übersetzen.
    const save = () => (offer ? api.admin.updateOffer(token, offer.id, input) : api.admin.createOffer(token, input));
    try {
      const { data } = await save();
      apply(data);
      void market.refresh();
      if (!offer) router.setParams({ id: String(data.id) });
      await notifyUser('Gespeichert', 'Das Angebot ist aktualisiert.');
    } catch (e) {
      await showSaveError(e);
    }
    setSaving(false);
  };

  const showSaveError = async (e: unknown) => {
    const err = e as { errors?: Record<string, string[]> };
    setErrors(err.errors ?? {});
    await notifyUser('Nicht gespeichert', errorMessage(e));
  };

  const upload = async () => {
    if (!token || !offer) return;
    const image = await pickImage('Bild wählen', 'angebot', { aspect: [16, 10] });
    if (!image) return;
    try {
      apply((await api.admin.offerImage(token, offer.id, image)).data);
      void market.refresh();
    } catch (e) {
      await notifyUser('Upload fehlgeschlagen', errorMessage(e));
    }
  };

  const remove = async () => {
    if (!token || !offer) return;
    if (!(await confirmAction('Angebot löschen?', 'Buchungen bleiben als Beleg erhalten. Zum Pausieren lieber „Aktiv" ausschalten.', 'Löschen', true))) return;
    try {
      await api.admin.deleteOffer(token, offer.id);
      void market.refresh();
      router.back();
    } catch (e) {
      await notifyUser('Nicht gelöscht', errorMessage(e));
    }
  };

  const field = (key: keyof Draft, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField label={label} value={draft[key]} onChangeText={set(key)} autoCorrect={false} {...extra} />
  );

  const price = centsOrNull(draft.price);
  const cap = numberOrNull(draft.max_discount) ?? partnerCap;

  return (
    <AdminScreen title={offer ? offer.title : 'Neues Angebot'}>
      {offer ? (
        <Card style={styles.imageRow}>
          {offer.image_url ? <Image source={{ uri: offer.image_url }} style={styles.image} contentFit="cover" /> : null}
          <Button title={offer.image_url ? 'Bild ändern' : 'Bild hochladen'} icon="camera" variant="secondary" size="small" onPress={upload} />
        </Card>
      ) : null}

      <Card style={styles.form}>
        <View style={styles.segment}>
          {(['activity', 'perk'] as const).map((k) => (
            <PressableScale
              key={k}
              onPress={() => setKind(k)}
              haptic="select"
              style={[styles.segItem, { borderColor: kind === k ? colors.tint : colors.border, backgroundColor: kind === k ? colors.tint : colors.background }]}>
              <Text style={[styles.segText, { color: kind === k ? '#ffffff' : colors.text }]}>{k === 'activity' ? 'Aktivität' : 'Vorteil (z. B. Freigetränk)'}</Text>
            </PressableScale>
          ))}
        </View>
        <TextField label="Titel *" value={draft.title} onChangeText={set('title')} error={errors.title?.[0]} />
        {field('subtitle', 'Untertitel')}
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

        <View style={styles.pair}>
          <View style={styles.flex}>
            <TextField label="Preis in € (pro Person)" value={draft.price} onChangeText={set('price')} keyboardType="decimal-pad" error={errors.price_cents?.[0]} />
          </View>
          <View style={styles.flex}>{field('credits', 'oder Credits (pro Person)', { keyboardType: 'number-pad' })}</View>
        </View>
        {field('max_discount', 'Höchstrabatt in % (leer = wie Partner)', { keyboardType: 'number-pad' })}
        <View style={styles.pair}>
          <View style={styles.flex}>{field('min_people', 'Personen ab', { keyboardType: 'number-pad' })}</View>
          <View style={styles.flex}>
            <TextField label="Personen bis" value={draft.max_people} onChangeText={set('max_people')} keyboardType="number-pad" error={errors.max_people?.[0]} />
          </View>
        </View>
        <View style={styles.pair}>
          <View style={styles.flex}>{field('min_age', 'Alter ab', { keyboardType: 'number-pad' })}</View>
          <View style={styles.flex}>
            <TextField label="Alter bis" value={draft.max_age} onChangeText={set('max_age')} keyboardType="number-pad" error={errors.max_age?.[0]} />
          </View>
        </View>
        <View style={styles.pair}>
          <View style={styles.flex}>{field('duration', 'Dauer in Minuten', { keyboardType: 'number-pad' })}</View>
          <View style={styles.flex}>{field('valid_days', 'Einlösbar (Tage)', { keyboardType: 'number-pad' })}</View>
        </View>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Testphase: Plätze pro Tag (leer = unbegrenzt). Mit Kontingent müssen Kund:innen einen Tag wählen; die reservierten Plätze bekommen nur Platinum-Mitglieder.
        </Text>
        <View style={styles.pair}>
          <View style={styles.flex}>{field('daily_capacity', 'Plätze pro Tag', { keyboardType: 'number-pad' })}</View>
          <View style={styles.flex}>{field('platinum_reserved', 'davon nur Platinum', { keyboardType: 'number-pad' })}</View>
        </View>

        <Text style={[styles.label, { color: colors.textSecondary }]}>Drinnen oder draußen?</Text>
        <View style={styles.segment}>
          {([
            [null, 'Beides/egal'],
            [true, 'Drinnen'],
            [false, 'Draußen'],
          ] as const).map(([value, label]) => (
            <PressableScale
              key={label}
              onPress={() => setIndoor(value)}
              haptic="select"
              style={[styles.segItem, { borderColor: indoor === value ? colors.tint : colors.border, backgroundColor: indoor === value ? colors.tint : colors.background }]}>
              <Text style={[styles.segText, { color: indoor === value ? '#ffffff' : colors.text }]}>{label}</Text>
            </PressableScale>
          ))}
        </View>
        {field('sort', 'Reihenfolge (kleiner = weiter vorn)', { keyboardType: 'number-pad' })}
        <ToggleRow label="Aktiv" hint="Ausgeschaltet ist das Angebot unsichtbar." value={active} onChange={setActive} />
        <ToggleRow label="Hervorheben" hint="Erscheint unter „Top-Angebote“." value={featured} onChange={setFeatured} />
        <Button title={offer ? 'Speichern' : 'Angebot anlegen'} onPress={save} loading={saving} disabled={!draft.title.trim()} />
      </Card>

      {price !== null ? (
        <Card style={styles.form}>
          <Text style={[styles.label, { color: colors.text }]}>Rabatt-Vorschau (pro Person)</Text>
          {CLUB_RULES.plans.map((plan) => {
            const one = quoteMoney(CLUB_RULES, { plan: plan.key, people: 1, unitPriceCents: price, maxDiscountPercent: cap });
            const six = quoteMoney(CLUB_RULES, { plan: plan.key, people: 6, unitPriceCents: price, maxDiscountPercent: cap });
            return (
              <View key={plan.key} style={styles.previewRow}>
                <Text style={[styles.previewPlan, { color: colors.text }]}>{plan.name}</Text>
                <Text style={[styles.previewValue, { color: colors.textSecondary }]}>
                  allein {formatEuro(one.totalCents)} · zu sechst {formatEuro(Math.round(six.totalCents / 6))}
                </Text>
              </View>
            );
          })}
        </Card>
      ) : null}

      {offer ? <Button title="Angebot löschen" variant="danger" onPress={remove} /> : null}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  imageRow: { gap: Spacing.three },
  image: { width: '100%', aspectRatio: 16 / 10, borderRadius: Radius.field },
  form: { gap: Spacing.three },
  label: { fontFamily: FontFamily.semibold, fontSize: 13 },
  chips: { gap: Spacing.two },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 13 },
  pair: { flexDirection: 'row', gap: Spacing.two },
  segment: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  segItem: { borderWidth: Stroke, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  segText: { fontFamily: FontFamily.semibold, fontSize: 13.5 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two, flexWrap: 'wrap' },
  previewPlan: { fontFamily: FontFamily.bold, fontSize: 14 },
  previewValue: { fontFamily: FontFamily.medium, fontSize: 13 },
});
