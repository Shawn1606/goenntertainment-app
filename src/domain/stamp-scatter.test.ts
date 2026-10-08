import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SHIFT,
  MAX_STAR_SWING,
  MAX_TILT,
  MIN_STAR_SWING,
  STAMP_SCALE,
  seeded,
  stampForBeat,
  stampPose,
  stampReach,
  stampSize,
  starSwing,
} from './stamp-scatter.ts';

/** Polsterung der Stempelkarte (Spacing.three in constants/theme.ts). */
const CARD_PADDING = 16;
/** Feldgrößen der Karte: groß (Stempel-Seite) und kompakt (Startseite). */
const SLOTS = [54, 27];

test('ein Stempel ist größer als sein Feld – aufgedrückt, nicht eingepasst', () => {
  assert.ok(STAMP_SCALE > 1);
  for (const slot of SLOTS) assert.ok(stampSize(slot) > slot, `Feld ${slot}`);
  assert.equal(stampSize(54), 65);
});

test('auch ganz verschoben ragt kein Stempel über die Polsterung der Karte', () => {
  for (const slot of SLOTS) {
    assert.ok(stampReach(slot) > 0);
    assert.ok(stampReach(slot) < CARD_PADDING, `Feld ${slot}: ${stampReach(slot)} pt`);
  }
});

test('jeder Stempel bleibt innerhalb von 15 % Verschiebung', () => {
  for (let id = 1; id <= 500; id++) {
    const pose = stampPose(id);
    assert.ok(Math.abs(pose.dx) <= MAX_SHIFT, `dx ${pose.dx} bei ${id}`);
    assert.ok(Math.abs(pose.dy) <= MAX_SHIFT, `dy ${pose.dy} bei ${id}`);
    assert.ok(Math.abs(pose.tilt) <= MAX_TILT);
    assert.ok(pose.phase >= 0 && pose.phase < 1);
  }
});

test('die Verschiebung nutzt den Spielraum auch aus (über 10 %)', () => {
  const poses = Array.from({ length: 200 }, (_, i) => stampPose(i + 1));
  assert.equal(MAX_SHIFT, 0.15);
  assert.ok(poses.some((p) => Math.abs(p.dx) > 0.1) && poses.some((p) => Math.abs(p.dy) > 0.1));
});

test('die Lage ist fest: gleicher Stempel, gleiche Lage', () => {
  assert.deepEqual(stampPose(42), stampPose(42));
});

test('verschiedene Stempel liegen verschieden – und nutzen beide Richtungen', () => {
  const poses = Array.from({ length: 40 }, (_, i) => stampPose(i + 1));
  assert.ok(new Set(poses.map((p) => p.dx.toFixed(4))).size > 30);
  assert.ok(poses.some((p) => p.dx < 0) && poses.some((p) => p.dx > 0));
  assert.ok(poses.some((p) => p.dy < 0) && poses.some((p) => p.dy > 0));
});

test('seeded liefert Zahlen in [0, 1)', () => {
  const next = seeded(7);
  for (let i = 0; i < 1000; i++) {
    const v = next();
    assert.ok(v >= 0 && v < 1);
  }
});

test('der Stern schlägt in beide Richtungen aus, höchstens 65°', () => {
  assert.equal(starSwing(1, 0.9), MAX_STAR_SWING);
  assert.equal(starSwing(1, 0.1), -MAX_STAR_SWING);
  assert.equal(starSwing(0, 0.9), MIN_STAR_SWING);
  for (let i = 0; i < 200; i++) {
    const a = starSwing(Math.random(), Math.random());
    assert.ok(Math.abs(a) <= MAX_STAR_SWING && Math.abs(a) >= MIN_STAR_SWING);
  }
  assert.ok(Math.abs(starSwing(Number.NaN, Number.NaN)) <= MAX_STAR_SWING);
});

test('Takt der Karte: immer ein gültiger Stempel, fest je Schlag, alle kommen dran', () => {
  const seen = new Set<number>();
  for (let beat = 1; beat <= 200; beat++) {
    const i = stampForBeat(beat, 7);
    assert.ok(i >= 0 && i < 7, `Schlag ${beat}: ${i}`);
    seen.add(i);
  }
  assert.equal(seen.size, 7, 'über viele Schläge ist jeder Stempel einmal dran');
  assert.equal(stampForBeat(42, 7), stampForBeat(42, 7));
  assert.equal(stampForBeat(5, 0), -1);
  assert.equal(stampForBeat(Number.NaN, 5), -1);
});
