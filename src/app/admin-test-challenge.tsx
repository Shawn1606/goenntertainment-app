import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdminScreen, ToggleRow, numberOrNull } from '@/components/admin-ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Spacing } from '@/constants/theme';
import {
  CHALLENGE_TYPES,
  METRIC_LABEL,
  PERIOD_LABEL,
  TYPE_DEFAULTS,
  TYPE_LABEL,
  type ChallengeMetric,
  type ChallengePeriod,
  type ChallengeType,
  type TestphaseState,
} from '@/domain/testphase';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { notifyUser } from '@/lib/confirm';

const PLANS = [
  { key: 'free', label: 'Free' },
  { key: 'gold', label: 'Gold' },
  { key: 'platinum', label: 'Platinum' },
];

const KINDS: { key: string | null; label: string }[] = [
  { key: null, label: 'Alle Angebote' },
  { key: 'activity', label: 'Aktivitäten' },
  { key: 'perk', label: 'Gratis-Angebote' },
];

/** „31.12.2026" oder „2026-12-31" → „2026-12-31"; sonst null. */
function isoDay(text: string): string | null {
  const t = text.trim();
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (de) return `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/**
 * Neue Challenge für die Testphase: Art, was gezählt wird, wie oft, in welchem
 * Zeitraum, was sie bringt – und optional eingegrenzt auf einen Partner, eine
 * Kategorie, ein Suchwort („Bowling") oder bestimmte Stufen.
 */
export default function AdminTestChallengeScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { token } = useAuth();
  const [options, setOptions] = useState<TestphaseState['options'] | null>(null);
  const [type, setType] = useState<ChallengeType>('monthly');
  const [metric, setMetric] = useState<ChallengeMetric>('visits');
  const [period, setPeriod] = useState<ChallengePeriod>('month');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState('5');
  const [reward, setReward] = useState('100');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [interestId, setInterestId] = useState<number | null>(null);
  const [matchText, setMatchText] = useState('');
  const [offerKind, setOfferKind] = useState<string | null>(null);
  const [plans, setPlans] = useState<string[]>([]);
  const [secret, setSecret] = useState(false);
  const [choice, setChoice] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.admin.testphase
      .state(token)
      .then(({ data }) => setOptions(data.options))
      .catch(() => setOptions(null));
  }, [token]);

  const pickType = (t: ChallengeType) => {
    setType(t);
    setPeriod(TYPE_DEFAULTS[t].period);
    setMetric(TYPE_DEFAULTS[t].metric);
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setErrors({});
    // Vor dem `try`: Bedingungen darin kann der React Compiler nicht übersetzen.
    const input: Parameters<typeof api.admin.testphase.createChallenge>[1] = {
      type,
      title: title.trim(),
      description: description.trim() || null,
      metric,
      target: numberOrNull(target) ?? 0,
      reward_credits: numberOrNull(reward) ?? 0,
      period,
      starts_at: period === 'range' ? isoDay(startsAt) : null,
      ends_at: period === 'range' ? isoDay(endsAt) : null,
      partner_id: partnerId,
      interest_id: interestId,
      match_text: matchText.trim() || null,
      offer_kind: offerKind,
      plans: plans.length ? plans : null,
      is_secret: secret,
      is_choice: choice,
    };
    try {
      await api.admin.testphase.createChallenge(token, input);
      router.back();
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

  const label = (text: string) => <Text style={[styles.label, { color: colors.textSecondary }]}>{text}</Text>;

  return (
    <AdminScreen title="Neue Challenge">
      <Card style={styles.form}>
        {label('Art')}
        <Chips items={CHALLENGE_TYPES.map((t) => ({ key: t, label: TYPE_LABEL[t] }))} value={type} onChange={(t) => pickType(t as ChallengeType)} />

        <TextField label="Titel *" value={title} onChangeText={setTitle} placeholder="z. B. Bowling-Profi" error={errors.title?.[0]} />
        <TextField label="Beschreibung" value={description} onChangeText={setDescription} placeholder="z. B. Geh diesen Monat zehnmal zum Bowling." multiline />

        {label('Was zählt')}
        <Chips
          items={(options?.metrics ?? (Object.keys(METRIC_LABEL) as ChallengeMetric[])).map((m) => ({ key: m, label: METRIC_LABEL[m] }))}
          value={metric}
          onChange={(m) => setMetric(m as ChallengeMetric)}
        />

        <View style={styles.pair}>
          <View style={styles.flex}>
            <TextField label="Wie oft *" value={target} onChangeText={setTarget} keyboardType="number-pad" error={errors.target?.[0]} />
          </View>
          <View style={styles.flex}>
            <TextField label="Belohnung (Credits) *" value={reward} onChangeText={setReward} keyboardType="number-pad" error={errors.reward_credits?.[0]} />
          </View>
        </View>

        {label('Zeitraum')}
        <Chips items={(['month', 'week', 'range'] as const).map((p) => ({ key: p, label: PERIOD_LABEL[p] }))} value={period} onChange={(p) => setPeriod(p as ChallengePeriod)} />
        {period === 'range' ? (
          <View style={styles.pair}>
            <View style={styles.flex}>
              <TextField label="Von" value={startsAt} onChangeText={setStartsAt} placeholder="01.12.2026" error={errors.starts_at?.[0]} />
            </View>
            <View style={styles.flex}>
              <TextField label="Bis" value={endsAt} onChangeText={setEndsAt} placeholder="28.02.2027" error={errors.ends_at?.[0]} />
            </View>
          </View>
        ) : null}
      </Card>

      <Card style={styles.form}>
        <Text style={[styles.title, { color: colors.text }]}>Eingrenzen (optional)</Text>
        {label('Partner')}
        <Chips
          items={[{ key: null, label: 'Alle' }, ...(options?.partners ?? []).map((p) => ({ key: p.id, label: p.name }))]}
          value={partnerId}
          onChange={(id) => setPartnerId(id as number | null)}
        />
        {label('Kategorie')}
        <Chips
          items={[{ key: null, label: 'Alle' }, ...(options?.interests ?? []).map((i) => ({ key: i.id, label: i.name }))]}
          value={interestId}
          onChange={(id) => setInterestId(id as number | null)}
        />
        <TextField
          label="Suchwort im Namen"
          value={matchText}
          onChangeText={setMatchText}
          placeholder="z. B. Bowling oder Softdrink"
          autoCorrect={false}
          error={errors.match_text?.[0]}
        />
        {label('Angebote')}
        <Chips items={KINDS} value={offerKind} onChange={(k) => setOfferKind(k as string | null)} />
        {label('Nur für Stufen (leer = alle)')}
        <View style={styles.chipsWrap}>
          {PLANS.map((p) => {
            const on = plans.includes(p.key);
            return (
              <PressableScale
                key={p.key}
                onPress={() => setPlans(on ? plans.filter((x) => x !== p.key) : [...plans, p.key])}
                haptic="select"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={[styles.chip, { borderColor: on ? colors.tint : colors.border, backgroundColor: on ? colors.tint : colors.background }]}>
                <Text style={[styles.chipText, { color: on ? '#ffffff' : colors.text }]}>{p.label}</Text>
              </PressableScale>
            );
          })}
        </View>
      </Card>

      <Card style={styles.form}>
        <ToggleRow label="Geheim" hint="Titel und Aufgabe bleiben verborgen, bis man sie geschafft hat." value={secret} onChange={setSecret} />
        <ToggleRow label="Mit Wahl" hint="Zählt nur, wenn man sie auswählt – höchstens 3 je Zeitraum." value={choice} onChange={setChoice} />
      </Card>

      <Button title="Challenge anlegen" icon="check" onPress={save} loading={saving} disabled={!title.trim()} />
    </AdminScreen>
  );
}

function Chips<K extends string | number | null>({ items, value, onChange }: { items: { key: K; label: string }[]; value: K; onChange: (key: K) => void }) {
  const colors = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {items.map((item) => {
        const on = item.key === value;
        return (
          <PressableScale
            key={String(item.key)}
            onPress={() => onChange(item.key)}
            haptic="select"
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.chip, { borderColor: on ? colors.tint : colors.border, backgroundColor: on ? colors.tint : colors.background }]}>
            <Text style={[styles.chipText, { color: on ? '#ffffff' : colors.text }]}>{item.label}</Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three },
  title: { fontFamily: FontFamily.bold, fontSize: 16 },
  label: { fontFamily: FontFamily.semibold, fontSize: 13, marginBottom: -Spacing.two },
  pair: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1, minWidth: 0 },
  chips: { gap: Spacing.two, paddingVertical: 2 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontFamily: FontFamily.semibold, fontSize: 13 },
});
