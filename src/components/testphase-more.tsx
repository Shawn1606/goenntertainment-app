/**
 * Weitere Ideen in der Testphase – die Abschnitte unter den Challenges auf dem
 * Admin-Bildschirm „Test" (src/app/admin-test.tsx):
 *
 *   Challenges mit Wahl (13) · Happy Hour & Kontingente (21, 36) ·
 *   Treuestufen (52) · Sammelalbum (55) · Partner-Wunschliste (45) ·
 *   Kosten teilen (62) · Abstimmungen (64) · Rückmeldungen (30)
 *
 * Gerechnet wird alles auf dem Server (api/app/Support/TestPhase); jede Aktion
 * schickt den neuen Stand zurück, den der Bildschirm über `onState` übernimmt.
 * Kosten teilen und Abstimmungen betreffen zwei Konten – zum Ausprobieren zwei
 * Admin-Konten in dieselbe Gruppe stecken.
 */
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { SectionTitle } from '@/components/admin-ui';
import { useCelebrate } from '@/components/celebration';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from '@/components/ui/pressable-scale';
import { TextField } from '@/components/ui/text-field';
import { FontFamily, Radius, Spacing, Stroke } from '@/constants/theme';
import { formatCredits, formatPercent } from '@/domain/club';
import { formatDay } from '@/domain/date-format';
import { initialsOf } from '@/domain/initials';
import { progressText, type TestphaseClaim, type TestphaseState } from '@/domain/testphase';
import { useTheme } from '@/hooks/use-theme';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { confirmAction, notifyUser } from '@/lib/confirm';
import { useMarket } from '@/lib/market-context';

const WEEKDAYS = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

type Props = { state: TestphaseState; onState: (state: TestphaseState) => void };

/** Führt eine Aktion aus, übernimmt den neuen Stand und zeigt Fehler an. */
function useRunner(onState: (state: TestphaseState) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<{ data: TestphaseState }>) => {
    if (busy) return;
    setBusy(key);
    try {
      onState((await action()).data);
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
    setBusy(null);
  };
  return { busy, run };
}

export function TestphaseMore({ state, onState }: Props) {
  return (
    <>
      <ChoiceSection state={state} onState={onState} />
      <PerksSection state={state} />
      <LoyaltySection state={state} onState={onState} />
      <AlbumSection state={state} />
      <WishSection state={state} onState={onState} />
      <ShareSection state={state} onState={onState} />
      <PollSection state={state} onState={onState} />
      <FeedbackSection state={state} />
    </>
  );
}

/* ----------------------------------------------------- Challenges mit Wahl */

function ChoiceSection({ state, onState }: Props) {
  const colors = useTheme();
  const { token } = useAuth();
  const { busy, run } = useRunner(onState);
  const choices = state.challenges.filter((c) => c.is_choice);
  if (choices.length === 0) return null;
  const limit = state.choice_limit ?? 3;
  const chosen = choices.filter((c) => c.chosen).length;

  return (
    <>
      <SectionTitle>{`Challenges mit Wahl · ${chosen} von ${limit}`}</SectionTitle>
      <Card style={styles.stack}>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          Such dir {limit} aus – nur die gewählten zählen und lassen sich abholen. Abwählen geht, solange du sie nicht abgeholt hast.
        </Text>
        {choices.map((c) => (
          <View key={c.id} style={[styles.row, styles.divided, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.strong, { color: colors.text }]}>{c.title.replace(/^Wahl: /, '')}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {progressText(c)} · {formatCredits(c.reward_credits)} Credits
              </Text>
            </View>
            <Button
              title={c.chosen ? 'Gewählt' : 'Auswählen'}
              icon={c.chosen ? 'check' : 'plus'}
              size="small"
              variant={c.chosen ? 'primary' : 'secondary'}
              disabled={!c.chosen && chosen >= limit}
              loading={busy === `c${c.id}`}
              onPress={() => token && run(`c${c.id}`, () => api.admin.testphase.choose(token, c.id))}
            />
          </View>
        ))}
      </Card>
    </>
  );
}

/* --------------------------------------------- Happy Hour und Kontingente */

function PerksSection({ state }: { state: TestphaseState }) {
  const colors = useTheme();
  const happy = state.happy_hour;
  const reserved = state.reserved_offers ?? [];
  if (!happy && reserved.length === 0) return null;
  const days = happy?.weekdays.map((d) => WEEKDAYS[d] ?? '').filter(Boolean).join(', ');

  return (
    <>
      <SectionTitle>Happy Hour & Kontingente</SectionTitle>
      <Card style={styles.stack}>
        {happy ? (
          <View style={styles.row}>
            <Icon name="sunset" size={22} color={colors.tint} />
            <Text style={[styles.text, { color: colors.text, flex: 1 }]}>
              {happy.percent > 0
                ? `Happy Hour: Credit-Buchungen mit Wunschtermin ${days} kosten dich ${formatPercent(happy.percent)} weniger – zusätzlich zum Rabatt.`
                : `Happy Hour (${days}) gibt es für Gold und Platinum.`}
            </Text>
          </View>
        ) : null}
        <View style={[styles.row, styles.divided, { borderTopColor: colors.border }]}>
          <Icon name="crown" size={22} color={colors.tint} />
          <Text style={[styles.text, { color: colors.text, flex: 1 }]}>
            {reserved.length === 0
              ? 'Noch kein Angebot mit Tageskontingent. Im Angebot unter „Plätze pro Tag“ eintragen – ein Teil davon lässt sich für Platinum reservieren.'
              : 'Angebote mit Tageskontingent:'}
          </Text>
        </View>
        {reserved.map((o) => (
          <Text key={o.id} style={[styles.meta, { color: colors.textSecondary }]}>
            {o.title}
            {o.partner ? ` · ${o.partner}` : ''} – {o.daily_capacity} Plätze/Tag, davon {o.platinum_reserved} nur Platinum
          </Text>
        ))}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ Treuestufen */

function LoyaltySection({ state, onState }: Props) {
  const colors = useTheme();
  const loyalty = state.loyalty;
  const claim = useClaim(onState);
  if (!loyalty) return null;
  const next = loyalty.next;
  const ratio = next ? Math.min(1, loyalty.visits / next.visits) : 1;

  return (
    <>
      <SectionTitle>Treuestufe</SectionTitle>
      <Card style={styles.stack}>
        <View style={styles.row}>
          <View style={[styles.levelBadge, { backgroundColor: loyalty.level ? colors.tint : colors.backgroundSelected }]}>
            <Icon name="medal" size={24} color={loyalty.level ? '#ffffff' : colors.textSecondary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.big, { color: colors.text }]}>{loyalty.level_name ?? 'Noch keine Stufe'}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {loyalty.visits} {loyalty.visits === 1 ? 'Besuch' : 'Besuche'} in den letzten 12 Monaten – unabhängig vom Abo
            </Text>
          </View>
        </View>
        {next ? (
          <View style={{ gap: 4 }}>
            <View style={[styles.bar, { backgroundColor: colors.backgroundSelected }]}>
              <View style={[styles.barFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: colors.tint }]} />
            </View>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              Noch {next.visits - loyalty.visits} bis {next.name}
            </Text>
          </View>
        ) : null}
        {loyalty.levels.map((l) => (
          <View key={l.key} style={[styles.row, styles.divided, { borderTopColor: colors.border }]}>
            <Text style={[styles.text, { color: colors.text, flex: 1 }]}>
              {l.name} · ab {l.visits} Besuchen
            </Text>
            <ClaimBadge claim={l.claim} busy={claim.busy} onClaim={claim.run} />
          </View>
        ))}
      </Card>
    </>
  );
}

/* ----------------------------------------------------------- Sammelalbum */

function AlbumSection({ state }: { state: TestphaseState }) {
  const colors = useTheme();
  const album = state.album;
  if (!album || album.total === 0) return null;

  return (
    <>
      <SectionTitle>{`Sammelalbum · ${album.visited} von ${album.total}`}</SectionTitle>
      <Card>
        <View style={styles.albumGrid}>
          {album.stamps.map((s) => {
            const got = s.visits > 0;
            return (
              <View
                key={s.partner_id}
                style={styles.albumItem}
                accessible
                accessibilityLabel={got ? `${s.name}: ${s.visits} Besuche, zuerst am ${formatDay(s.first_visit)}` : `${s.name}: noch nicht besucht`}>
                <View style={[styles.albumStamp, { borderColor: got ? s.ink : colors.border, opacity: got ? 1 : 0.45 }]}>
                  {s.logo_url ? (
                    <Image source={{ uri: s.logo_url }} style={styles.albumLogo} />
                  ) : (
                    <Text style={[styles.albumInitials, { color: got ? s.ink : colors.textSecondary }]}>{initialsOf(s.name)}</Text>
                  )}
                  {got ? (
                    <View style={[styles.albumCount, { backgroundColor: s.ink }]}>
                      <Text style={styles.albumCountText}>{s.visits}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.albumName, { color: got ? colors.text : colors.textSecondary }]} numberOfLines={2}>
                  {s.name}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>
    </>
  );
}

/* ---------------------------------------------------- Partner-Wunschliste */

function WishSection({ state, onState }: Props) {
  const colors = useTheme();
  const { token } = useAuth();
  const { busy, run } = useRunner(onState);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const wishes = state.wishes ?? [];

  const add = () =>
    token &&
    run('add', async () => {
      const res = await api.admin.testphase.addWish(token, name.trim(), note.trim() || null);
      setName('');
      setNote('');
      return res;
    });

  return (
    <>
      <SectionTitle>Partner-Wunschliste</SectionTitle>
      <Card style={styles.stack}>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          Welche Firma soll GÖ4Fun ansprechen? Stimmen von Platinum-Mitgliedern zählen doppelt.
        </Text>
        <TextField label="Firma" value={name} onChangeText={setName} placeholder="z. B. Kino Lumière" />
        <TextField label="Warum? (optional)" value={note} onChangeText={setNote} maxLength={300} />
        <Button title="Vorschlagen" icon="plus" onPress={add} loading={busy === 'add'} disabled={!name.trim()} />
        {wishes.map((w) => (
          <View key={w.id} style={[styles.row, styles.divided, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.strong, { color: colors.text }]}>{w.name}</Text>
              {w.note ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{w.note}</Text> : null}
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {w.score} {w.score === 1 ? 'Punkt' : 'Punkte'} · {w.voters} {w.voters === 1 ? 'Stimme' : 'Stimmen'}
              </Text>
            </View>
            <Button
              title={w.voted ? 'Gestimmt' : 'Dafür'}
              icon={w.voted ? 'heart-filled' : 'heart'}
              size="small"
              variant={w.voted ? 'primary' : 'secondary'}
              loading={busy === `v${w.id}`}
              onPress={() => token && run(`v${w.id}`, () => api.admin.testphase.voteWish(token, w.id))}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${w.name} von der Liste nehmen`}
              onPress={async () => {
                if (!token) return;
                if (!(await confirmAction('Von der Liste nehmen?', `„${w.name}“ und alle Stimmen dafür werden gelöscht.`, 'Löschen', true))) return;
                await run(`d${w.id}`, () => api.admin.testphase.deleteWish(token, w.id));
              }}
              style={styles.iconBtn}>
              <Icon name="trash" size={18} color={colors.textSecondary} />
            </PressableScale>
          </View>
        ))}
      </Card>
    </>
  );
}

/* --------------------------------------------------------- Kosten teilen */

function ShareSection({ state, onState }: Props) {
  const colors = useTheme();
  const { token } = useAuth();
  const market = useMarket();
  const { busy, run } = useRunner(onState);
  const [picked, setPicked] = useState<Record<number, number[]>>({});
  const shares = state.shares;
  if (!shares) return null;
  const empty = shares.shareable.length === 0 && shares.owed_to_me.length === 0 && shares.i_owe.length === 0;

  const toggle = (bookingId: number, userId: number) =>
    setPicked((p) => {
      const list = p[bookingId] ?? [];
      return { ...p, [bookingId]: list.includes(userId) ? list.filter((x) => x !== userId) : [...list, userId] };
    });

  return (
    <>
      <SectionTitle>Kosten teilen</SectionTitle>
      <Card style={styles.stack}>
        {empty ? (
          <Text style={[styles.text, { color: colors.textSecondary }]}>
            Buch etwas mit Credits für eine Gruppe – dann kannst du hier die anderen um ihren Anteil bitten. Sie zahlen ihn in Credits zurück.
          </Text>
        ) : null}

        {shares.shareable.map((b) => {
          const sel = picked[b.booking_id] ?? [];
          return (
            <View key={b.booking_id} style={[styles.stack, styles.divided, { borderTopColor: colors.border }]}>
              <Text style={[styles.strong, { color: colors.text }]}>{b.offer_title}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {b.people} Personen · {formatCredits(b.total_credits)} Credits · Anteil {formatCredits(b.share_credits)} pro Person
              </Text>
              <View style={styles.chips}>
                {b.members.map((m) => (
                  <ChoiceChip key={m.id} size="small" multi label={m.name} active={sel.includes(m.id)} onPress={() => toggle(b.booking_id, m.id)} />
                ))}
              </View>
              <Button
                title={sel.length > 0 ? `${sel.length} um ${formatCredits(b.share_credits * sel.length)} Credits bitten` : 'Wen bittest du?'}
                icon="users"
                size="small"
                disabled={sel.length === 0}
                loading={busy === `s${b.booking_id}`}
                onPress={() => token && run(`s${b.booking_id}`, () => api.admin.testphase.requestShares(token, b.booking_id, sel))}
              />
            </View>
          );
        })}

        {shares.i_owe.map((s) => (
          <View key={`o${s.id}`} style={[styles.row, styles.divided, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.strong, { color: colors.text }]}>
                {s.other} bittet um {formatCredits(s.credits)} Credits
              </Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {s.offer_title} · {s.status === 'pending' ? 'offen' : s.status === 'paid' ? 'bezahlt' : 'abgelehnt'}
              </Text>
            </View>
            {s.status === 'pending' ? (
              <View style={{ gap: 4 }}>
                <Button
                  title="Zahlen"
                  icon="coin"
                  size="small"
                  loading={busy === `p${s.id}`}
                  onPress={() =>
                    token &&
                    run(`p${s.id}`, async () => {
                      const res = await api.admin.testphase.payShare(token, s.id);
                      market.setCredits(res.balance);
                      return res;
                    })
                  }
                />
                <Button
                  title="Ablehnen"
                  size="small"
                  variant="ghost"
                  loading={busy === `x${s.id}`}
                  onPress={() => token && run(`x${s.id}`, () => api.admin.testphase.declineShare(token, s.id))}
                />
              </View>
            ) : null}
          </View>
        ))}

        {shares.owed_to_me.map((s) => (
          <View key={`m${s.id}`} style={[styles.row, styles.divided, { borderTopColor: colors.border }]}>
            <Icon name={s.status === 'paid' ? 'check' : s.status === 'declined' ? 'close' : 'clock'} size={18} color={colors.textSecondary} />
            <Text style={[styles.text, { color: colors.text, flex: 1 }]}>
              {s.other}: {formatCredits(s.credits)} Credits für {s.offer_title} –{' '}
              {s.status === 'pending' ? 'wartet' : s.status === 'paid' ? 'bezahlt' : 'abgelehnt'}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ Abstimmung */

function PollSection({ state, onState }: Props) {
  const colors = useTheme();
  const router = useRouter();
  const { token } = useAuth();
  const { busy, run } = useRunner(onState);
  const groups = state.options.groups ?? [];
  const offers = state.options.offers ?? [];
  const [groupId, setGroupId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<number[]>([]);
  const polls = state.polls ?? [];
  const activeGroup = groupId ?? groups[0]?.id ?? null;

  const create = () =>
    token &&
    activeGroup !== null &&
    run('create', async () => {
      const res = await api.admin.testphase.createPoll(token, {
        group_id: activeGroup,
        title: title.trim() || 'Was machen wir?',
        options: chosen.map((id) => ({ offer_id: id })),
      });
      setTitle('');
      setChosen([]);
      return res;
    });

  return (
    <>
      <SectionTitle>Abstimmung in der Gruppe</SectionTitle>
      <Card style={styles.stack}>
        {groups.length === 0 ? (
          <Text style={[styles.text, { color: colors.textSecondary }]}>Du bist noch in keiner Gruppe – leg unter „Gruppen“ eine an.</Text>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Gruppe</Text>
            <ChipRow>
              {groups.map((g) => (
                <ChoiceChip key={g.id} size="small" label={g.name} active={activeGroup === g.id} onPress={() => setGroupId(g.id)} />
              ))}
            </ChipRow>
            <TextField label="Frage" value={title} onChangeText={setTitle} placeholder="Was machen wir am Freitag?" />
            <Text style={[styles.label, { color: colors.textSecondary }]}>2 oder 3 Angebote zur Wahl</Text>
            <ChipRow>
              {offers.map((o) => {
                const on = chosen.includes(o.id);
                return (
                  <ChoiceChip
                    key={o.id}
                    size="small"
                    multi
                    label={o.partner ? `${o.title} · ${o.partner}` : o.title}
                    active={on}
                    onPress={() => setChosen((c) => (on ? c.filter((x) => x !== o.id) : c.length >= 3 ? c : [...c, o.id]))}
                  />
                );
              })}
            </ChipRow>
            <Button title="Abstimmung starten" icon="send" onPress={create} loading={busy === 'create'} disabled={chosen.length < 2} />
          </>
        )}

        {polls.map((p) => (
          <View key={p.id} style={[styles.stack, styles.divided, { borderTopColor: colors.border }]}>
            <Text style={[styles.strong, { color: colors.text }]}>{p.title}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {p.group_name} · {p.voted} von {p.members} abgestimmt{p.closed ? ' · beendet' : ''}
            </Text>
            {p.options.map((o) => {
              const mine = p.my_option_id === o.id;
              const winner = p.closed && p.winner_option_id === o.id;
              const share = p.voted > 0 ? o.votes / p.voted : 0;
              return (
                <PressableScale
                  key={o.id}
                  disabled={p.closed}
                  onPress={() => token && run(`v${o.id}`, () => api.admin.testphase.votePoll(token, p.id, o.id))}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: mine, disabled: p.closed }}
                  accessibilityLabel={`${o.offer_title}, ${o.votes} Stimmen`}
                  style={[styles.option, { borderColor: winner || mine ? colors.tint : colors.border }]}>
                  <View style={[styles.optionFill, { width: `${Math.round(share * 100)}%`, backgroundColor: colors.backgroundSelected }]} />
                  <Icon name={winner ? 'trophy' : mine ? 'check' : 'ticket'} size={16} color={winner || mine ? colors.tint : colors.textSecondary} />
                  <Text style={[styles.text, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                    {o.offer_title}
                    {o.day ? ` · ${formatDay(o.day)}` : ''}
                  </Text>
                  <Text style={[styles.strong, { color: colors.text }]}>{o.votes}</Text>
                </PressableScale>
              );
            })}
            {p.closed && p.winner_option_id ? (
              <Button
                title="Gewinner jetzt buchen"
                icon="ticket"
                size="small"
                onPress={() => {
                  const win = p.options.find((o) => o.id === p.winner_option_id);
                  if (win?.offer_id) router.push({ pathname: '/offer/[id]', params: { id: String(win.offer_id), group: String(p.group_id) } });
                }}
              />
            ) : null}
            {!p.closed && p.can_close ? (
              <Button
                title="Abstimmung beenden"
                size="small"
                variant="ghost"
                loading={busy === `c${p.id}`}
                onPress={() => token && run(`c${p.id}`, () => api.admin.testphase.closePoll(token, p.id))}
              />
            ) : null}
          </View>
        ))}
      </Card>
    </>
  );
}

/* --------------------------------------------------------- Rückmeldungen */

function FeedbackSection({ state }: { state: TestphaseState }) {
  const colors = useTheme();
  const list = state.feedback ?? [];

  return (
    <>
      <SectionTitle>Rückmeldungen an Partner</SectionTitle>
      <Card style={styles.stack}>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          Nach dem Einlösen einer Buchung gibt es auf dem Ticket eine private Rückmeldung an den Partner – sie bringt 10 Credits.
        </Text>
        {list.map((f) => (
          <View key={f.id} style={[styles.stack, styles.divided, { borderTopColor: colors.border }]}>
            <View style={styles.row}>
              <Text style={[styles.strong, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                {f.partner ?? 'Partner'}
                {f.offer_title ? ` · ${f.offer_title}` : ''}
              </Text>
              <View style={styles.stars} accessible accessibilityLabel={`${f.rating} von 5 Sternen`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Icon key={n} name={n <= f.rating ? 'star-filled' : 'star'} size={14} color={n <= f.rating ? '#f59e0b' : colors.border} />
                ))}
              </View>
            </View>
            {f.comment ? <Text style={[styles.text, { color: colors.text }]}>{f.comment}</Text> : null}
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{formatDay(f.created_at)}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------- Bausteine */

function useClaim(onState: (state: TestphaseState) => void) {
  const { token } = useAuth();
  const market = useMarket();
  const celebrate = useCelebrate();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (claim: TestphaseClaim) => {
    if (!token || busy) return;
    setBusy(claim.key);
    try {
      const res = await api.admin.testphase.claim(token, claim.key);
      onState(res.data);
      market.setCredits(res.balance);
      celebrate({ title: 'Abgeholt!', subtitle: claim.label, credits: res.credits, kind: 'coins' });
    } catch (e) {
      await notifyUser('Hat nicht geklappt', errorMessage(e));
    }
    setBusy(null);
  };
  return { busy, run };
}

function ClaimBadge({ claim, busy, onClaim }: { claim: TestphaseClaim; busy: string | null; onClaim: (c: TestphaseClaim) => void }) {
  const colors = useTheme();
  if (claim.claimed) {
    return (
      <View style={styles.row}>
        <Icon name="check" size={14} color="#059669" />
        <Text style={[styles.meta, { color: '#059669' }]}>{formatCredits(claim.reward)} abgeholt</Text>
      </View>
    );
  }
  if (!claim.claimable) return <Text style={[styles.meta, { color: colors.textSecondary }]}>{formatCredits(claim.reward)} Credits</Text>;
  return <Button title={`+${formatCredits(claim.reward)} abholen`} icon="coin" size="small" loading={busy === claim.key} onPress={() => onClaim(claim)} />;
}

function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}


const styles = StyleSheet.create({
  stack: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  divided: { borderTopWidth: 1, paddingTop: Spacing.two },
  text: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  strong: { fontFamily: FontFamily.bold, fontSize: 14.5 },
  big: { fontFamily: FontFamily.bold, fontSize: 19 },
  meta: { fontFamily: FontFamily.medium, fontSize: 12.5 },
  label: { fontFamily: FontFamily.semibold, fontSize: 13 },
  levelBadge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, justifyContent: 'flex-start' },
  albumItem: { width: 76, alignItems: 'center', gap: 4 },
  albumStamp: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumLogo: { width: 46, height: 46, borderRadius: 23 },
  albumInitials: { fontFamily: FontFamily.bold, fontSize: 18 },
  albumCount: { position: 'absolute', right: -4, bottom: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  albumCountText: { color: '#ffffff', fontFamily: FontFamily.bold, fontSize: 11.5 },
  albumName: { fontFamily: FontFamily.semibold, fontSize: 11.5, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  iconBtn: { padding: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: Stroke,
    borderRadius: Radius.card,
    paddingVertical: 10,
    paddingHorizontal: Spacing.three,
    overflow: 'hidden',
  },
  optionFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  stars: { flexDirection: 'row', gap: 2 },
});
