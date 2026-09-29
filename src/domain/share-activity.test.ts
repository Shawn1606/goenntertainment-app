import test from 'node:test';
import assert from 'node:assert/strict';

import { shareSubjectFor, shareTextFor, telegramUrl, whatsappUrl } from './share-activity.ts';

/** Ein Event mit den Feldern, die das Teilen braucht. */
const event = (over: Record<string, unknown> = {}) => ({
  id: 42,
  title: 'Grillen im Volksgarten',
  location: 'Volksgarten, Köln',
  starts_at: new Date(2026, 7 - 1, 30, 18, 30).toISOString(),
  description: 'Wir bringen Kohle mit, bring was zu trinken.',
  ...over,
});

test('der Text nennt Titel, Zeitpunkt und Ort', () => {
  const text = shareTextFor(event());
  assert.ok(text.includes('Grillen im Volksgarten'), 'Titel');
  assert.ok(text.includes('30.07.2026, 18:30'), 'Zeitpunkt');
  assert.ok(text.includes('Volksgarten, Köln'), 'Ort');
});

test('der Text sagt, woher das Event kommt', () => {
  // Ohne diesen Satz ist eine geteilte Nachricht eine Verabredung ohne Absender –
  // und niemand weiss, wo man zusagt.
  assert.ok(/GÖ4Fun/i.test(shareTextFor(event())));
});

test('ohne Zeitpunkt fehlt die Zeile, statt „null" zu zeigen', () => {
  const text = shareTextFor(event({ starts_at: null }));
  assert.ok(!text.includes('null'));
  assert.ok(!text.includes('undefined'));
  assert.ok(text.includes('Grillen im Volksgarten'));
});

test('ohne Ort fehlt die Ortszeile', () => {
  const text = shareTextFor(event({ location: '' }));
  assert.ok(!text.includes('undefined'));
  assert.ok(text.includes('Grillen im Volksgarten'));
});

test('eine lange Beschreibung wird gekuerzt', () => {
  // WhatsApp packt den Text in eine URL; ein Roman darin ist unlesbar und
  // sprengt auf manchen Systemen die Laengengrenze.
  const text = shareTextFor(event({ description: 'a'.repeat(1000) }));
  assert.ok(text.length < 500, `zu lang: ${text.length}`);
  assert.ok(text.includes('…'), 'die Kuerzung soll sichtbar sein');
});

test('eine kurze Beschreibung bleibt vollstaendig und ohne Auslassung', () => {
  const text = shareTextFor(event({ description: 'Kurz und gut.' }));
  assert.ok(text.includes('Kurz und gut.'));
  assert.ok(!text.includes('…'));
});

test('der Betreff ist der Titel – fuer E-Mail-Ziele des System-Teilens', () => {
  assert.equal(shareSubjectFor(event()), 'Grillen im Volksgarten');
});

/* ------------------------------------------------------------- Adressen */

test('die WhatsApp-Adresse steckt den Text sauber kodiert in den Parameter', () => {
  const url = whatsappUrl('Hallo & Tschüss?');
  assert.ok(url.startsWith('https://wa.me/?text='));
  // Genau darum geht es: & und ? duerfen die Adresse nicht zerlegen.
  assert.ok(url.includes('%26'));
  assert.ok(url.includes('%3F'));
  assert.ok(!url.includes('Hallo & '));
});

test('wa.me und nicht die App-Adresse: das funktioniert auch ohne WhatsApp', () => {
  // `whatsapp://send?text=` schlaegt fehl, wenn die App fehlt. `wa.me` landet
  // dann im Browser und bietet die Installation an – das ist die freundlichere
  // Sackgasse.
  assert.ok(whatsappUrl('x').startsWith('https://'));
});

test('die Telegram-Adresse kodiert ebenfalls', () => {
  const url = telegramUrl('Hallo & Tschüss?');
  assert.ok(url.startsWith('https://t.me/share/url?'));
  assert.ok(url.includes('%26'));
});

test('ein leerer Text ergibt eine gueltige Adresse ohne Inhalt', () => {
  assert.equal(whatsappUrl(''), 'https://wa.me/?text=');
});
