import test from 'node:test';
import assert from 'node:assert/strict';

import { coachTips, openClaims, progressRatio, progressText, unit, type TestphaseChallenge, type TestphaseClaim, type TestphaseState } from './testphase.ts';

const claim = (over: Partial<TestphaseClaim> = {}): TestphaseClaim => ({
  key: 'x',
  period: '2026-10',
  reward: 50,
  claimed: false,
  claimable: false,
  label: 'x',
  ...over,
});

const challenge = (over: Partial<TestphaseChallenge> = {}): TestphaseChallenge => ({
  id: 1,
  type: 'monthly',
  title: 'Bowling-Profi',
  description: null,
  metric: 'visits',
  target: 10,
  progress: 0,
  reward_credits: 150,
  period: 'month',
  period_label: 'Oktober 2026',
  starts_at: null,
  ends_at: null,
  status: 'running',
  partner: null,
  interest: null,
  match_text: 'Bowling',
  offer_kind: null,
  plans: null,
  allowed: true,
  claim: claim({ key: 'challenge:1' }),
  ...over,
});

const state = (over: Partial<TestphaseState> = {}): TestphaseState => ({
  plan: 'free',
  challenges: [],
  bingo: {
    period: '2026-10',
    period_label: 'Oktober 2026',
    cells: Array.from({ length: 9 }, (_, i) => ({ index: i, kind: i === 4 ? 'joker' : 'task', label: `Feld ${i}`, hint: '', icon: 'star', done: i === 4 })),
    lines: [{ index: 0, cells: [0, 1, 2], done: false, claim: claim({ key: 'bingo:line:0' }) }],
    line_reward: 50,
    full_reward: 300,
    full: { done: false, claim: claim({ key: 'bingo:full', reward: 300 }) },
  },
  streak: { weeks: 0, active_this_week: false, at_risk: false, joker: false, joker_used: false, start_week: null, milestones: [{ weeks: 4, reward: 50, claim: claim({ key: 'streak:4' }) }] },
  first_visit_bonus: { active: true },
  options: { partners: [], interests: [], types: [], metrics: [] },
  ...over,
});

test('Fortschritt als Text und Anteil', () => {
  assert.equal(progressText(challenge({ progress: 7 })), '7 / 10 Besuche');
  assert.equal(progressText(challenge({ progress: 12 })), '10 / 10 Besuche');
  assert.equal(progressRatio(challenge({ progress: 5 })), 0.5);
  assert.equal(unit('visits', 1), 'Besuch');
  assert.equal(unit('redeemed', 5), 'eingelöste Angebote');
});

test('Coach: abholbare Credits zuerst', () => {
  const s = state({
    challenges: [challenge({ progress: 10, claim: claim({ key: 'challenge:1', reward: 150, claimable: true }) })],
    streak: { ...state().streak, weeks: 2, at_risk: true },
  });
  const tips = coachTips(s);
  assert.equal(tips[0].line, 'Da liegen 150 Credits für dich bereit – hol sie dir unten ab!');
  assert.equal(tips[0].mood, 'cheer');
  assert.ok(tips[1].line.includes('Serie von 2 Wochen'));
  assert.equal(openClaims(s).length, 1);
});

test('Coach: die Challenge am nächsten am Ziel', () => {
  const tips = coachTips(
    state({
      challenges: [
        challenge({ id: 1, title: 'Weit weg', progress: 1, target: 10 }),
        challenge({ id: 2, title: 'Softdrink-Sammler', metric: 'redeemed', progress: 4, target: 5, reward_credits: 100 }),
        challenge({ id: 3, title: 'Gesperrt', progress: 9, target: 10, allowed: false }),
      ],
    }),
  );
  assert.equal(tips[0].line, 'Nur noch 1 eingelöstes Angebot bei „Softdrink-Sammler“ – dann gibt\'s 100 Credits!');
});

test('Coach: keine Hinweise auf geheime oder nicht gewählte Challenges', () => {
  const tips = coachTips(
    state({
      challenges: [
        challenge({ id: 1, title: 'Geheime Challenge', progress: 4, target: 5, is_secret: true, revealed: false }),
        challenge({ id: 2, title: 'Wahl: Einlösen', progress: 4, target: 5, is_choice: true, chosen: false }),
        challenge({ id: 3, title: 'Gewählt', progress: 1, target: 5, is_choice: true, chosen: true }),
      ],
    }),
  );
  assert.ok(tips[0].line.includes('„Gewählt“'));
  assert.ok(!tips.some((t) => t.line.includes('Geheime') || t.line.includes('Wahl: Einlösen')));
});

test('Abholbar zählt auch Treuestufen', () => {
  const s = state({
    loyalty: { visits: 12, level: 'bronze', level_name: 'Bronze', next: null, levels: [{ key: 'bronze', name: 'Bronze', visits: 10, reward: 50, claim: claim({ key: 'loyalty:bronze', claimable: true }) }] },
  });
  assert.equal(openClaims(s).length, 1);
});

test('Coach: fast volle Bingo-Reihe', () => {
  const s = state();
  s.bingo.cells[0].done = true;
  s.bingo.cells[1].done = true;
  const tips = coachTips(s);
  assert.ok(tips.some((t) => t.line === 'Ein Feld fehlt zur Bingo-Reihe: Feld 2. Das schaffst du!'));
});

test('Coach: ohne Challenges der Hinweis auf Beispiele', () => {
  assert.equal(coachTips(state())[0].line, 'Noch keine Challenges da – leg unten ein paar Beispiele an!');
});
