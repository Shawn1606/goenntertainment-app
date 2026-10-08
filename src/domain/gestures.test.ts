import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISMISS_MIN,
  DISMISS_VELOCITY,
  EDGE_RESISTANCE,
  FAST_SCROLL,
  PULL_FLICK_MIN,
  PULL_FLICK_VELOCITY,
  PULL_MAX,
  PULL_RATIO,
  PULL_TO_CLOSE,
  TAB_SWIPE_MIN,
  TAB_SWIPE_VELOCITY,
  dismissDistance,
  flightHeight,
  isFastScrollDown,
  pullOffset,
  scrollSpeed,
  shouldClosePull,
  shouldDismiss,
  tabDragOffset,
  tabSwipeTarget,
} from './gestures.ts';

const W = 390;
/** Home · Gruppen · Entdecken · Tickets · Karte */
const TABS = 5;

test('Tab-Wischen: nach links zum nächsten, nach rechts zum vorigen Tab', () => {
  assert.equal(tabSwipeTarget(0, TABS, -W * 0.5, 0, W), 1);
  assert.equal(tabSwipeTarget(2, TABS, -W * 0.5, 0, W), 3);
  assert.equal(tabSwipeTarget(2, TABS, W * 0.5, 0, W), 1);
  assert.equal(tabSwipeTarget(3, TABS, -W * 0.4, 0, W), 4, 'Tickets → Karte');
});

test('Tab-Wischen: zu kurz und zu langsam federt zurück', () => {
  assert.equal(tabSwipeTarget(1, TABS, -W * 0.2, -100, W), null);
  assert.equal(tabSwipeTarget(1, TABS, 0, 0, W), null);
});

test('Tab-Wischen: ein kurzer Schubs reicht – aber nur in Wischrichtung', () => {
  assert.equal(tabSwipeTarget(1, TABS, -TAB_SWIPE_MIN, -TAB_SWIPE_VELOCITY, W), 2);
  assert.equal(tabSwipeTarget(1, TABS, -(TAB_SWIPE_MIN - 1), -2000, W), null, 'Zittern ist kein Wischen');
  assert.equal(tabSwipeTarget(1, TABS, -80, +1500, W), null, 'zurückgeschnippt = bleiben');
});

test('Tab-Wischen: am ersten und letzten Tab geht es nicht weiter', () => {
  assert.equal(tabSwipeTarget(0, TABS, W * 0.8, 2000, W), null);
  assert.equal(tabSwipeTarget(TABS - 1, TABS, -W * 0.8, -2000, W), null);
});

test('Tab-Wischen: gesperrte Ziele werden nicht angesteuert', () => {
  assert.equal(tabSwipeTarget(3, TABS, -W * 0.8, 0, W, [4]), null);
  assert.equal(tabSwipeTarget(3, TABS, W * 0.8, 0, W, [4]), 2);
});

test('Tab-Wischen: unsinnige Werte führen nirgendwohin', () => {
  assert.equal(tabSwipeTarget(1, TABS, Number.NaN, 0, W), null);
  assert.equal(tabSwipeTarget(1, TABS, -200, 0, 0), null);
  assert.equal(tabSwipeTarget(0, 0, -200, 0, W), null);
});

test('Ziehen: die Seite folgt dem Finger, höchstens eine Breite', () => {
  assert.equal(tabDragOffset(1, TABS, -120, W), -120);
  assert.equal(tabDragOffset(1, TABS, -900, W), -W);
  assert.equal(tabDragOffset(1, TABS, 900, W), W);
});

test('Ziehen: ohne Nachbarn nur gedämpft (Gummiband)', () => {
  assert.equal(tabDragOffset(0, TABS, 100, W), 100 * EDGE_RESISTANCE);
  assert.equal(tabDragOffset(TABS - 1, TABS, -100, W), -100 * EDGE_RESISTANCE);
  assert.equal(tabDragOffset(3, TABS, -100, W, [4]), -100 * EDGE_RESISTANCE);
  assert.equal(tabDragOffset(1, TABS, Number.NaN, W), 0);
});

test('Schließen: ein Viertel der Höhe, zwischen 80 und 140 Punkten', () => {
  assert.equal(dismissDistance(400), 100);
  assert.equal(dismissDistance(200), 80);
  assert.equal(dismissDistance(2000), 140);
  assert.equal(dismissDistance(0), 140);
  assert.equal(dismissDistance(Number.NaN), 140);
});

test('Schließen: weit genug oder schnell genug nach unten', () => {
  assert.equal(shouldDismiss(120, 0, 400), true);
  assert.equal(shouldDismiss(60, 0, 400), false);
  assert.equal(shouldDismiss(DISMISS_MIN, DISMISS_VELOCITY, 400), true);
  assert.equal(shouldDismiss(DISMISS_MIN - 1, 5000, 400), false, 'Antippen schließt nichts');
  assert.equal(shouldDismiss(-200, 3000, 400), false, 'nach oben schließt nie');
  assert.equal(shouldDismiss(Number.NaN, 3000, 400), false);
});

test('Scrolltempo: Punkte je Millisekunde, nach unten positiv', () => {
  assert.equal(scrollSpeed(null, { y: 100, t: 10 }), 0);
  assert.equal(scrollSpeed({ y: 0, t: 0 }, { y: 160, t: 16 }), 10);
  assert.equal(scrollSpeed({ y: 160, t: 0 }, { y: 0, t: 16 }), -10);
  assert.equal(scrollSpeed({ y: 0, t: 0 }, { y: 50, t: 4 }), 0, 'zu dicht: Rauschen');
  assert.equal(scrollSpeed({ y: 0, t: 0 }, { y: 5000, t: 600 }), 0, 'Pause dazwischen');
});

test('Ganz schnell nach unten – nur dann fliegt Goenni', () => {
  assert.equal(isFastScrollDown({ y: 0, t: 0 }, { y: FAST_SCROLL * 16, t: 16 }), true);
  assert.equal(isFastScrollDown({ y: 0, t: 0 }, { y: FAST_SCROLL * 16 - 2, t: 16 }), false);
  assert.equal(isFastScrollDown({ y: 900, t: 0 }, { y: 0, t: 16 }), false, 'nach oben fliegt er nicht');
});

test('Flughöhe: je schneller, desto höher – in festen Grenzen', () => {
  const slow = flightHeight(FAST_SCROLL, 800);
  const fast = flightHeight(FAST_SCROLL * 2, 800);
  const wild = flightHeight(FAST_SCROLL * 10, 800);
  assert.ok(fast > slow);
  assert.equal(wild, fast, 'ab doppeltem Tempo nicht mehr höher');
  assert.ok(flightHeight(FAST_SCROLL * 10, 4000) <= 360);
  assert.ok(flightHeight(FAST_SCROLL, 300) >= 160);
  assert.ok(flightHeight(Number.NaN, Number.NaN) >= 160);
});

test('Seite wegziehen: der Inhalt folgt gedämpft und nur nach unten', () => {
  assert.equal(pullOffset(100), 100 * PULL_RATIO);
  assert.equal(pullOffset(-80), 0);
  assert.equal(pullOffset(10_000), PULL_MAX);
  assert.equal(pullOffset(Number.NaN), 0);
});

test('Seite wegziehen: weit genug oder mit Schwung – sonst federt sie zurück', () => {
  assert.equal(shouldClosePull(PULL_TO_CLOSE, 0), true);
  assert.equal(shouldClosePull(PULL_TO_CLOSE - 1, 0), false);
  assert.equal(shouldClosePull(PULL_FLICK_MIN, PULL_FLICK_VELOCITY), true);
  assert.equal(shouldClosePull(PULL_FLICK_MIN - 1, 5000), false, 'ein Zucken schließt nichts');
  assert.equal(shouldClosePull(0, 5000), false);
  assert.equal(shouldClosePull(Number.NaN, 5000), false);
  // Der Fingerweg bis „scharf" bleibt bequem erreichbar (unter 160 Punkten).
  assert.ok(PULL_TO_CLOSE / PULL_RATIO < 160);
});
