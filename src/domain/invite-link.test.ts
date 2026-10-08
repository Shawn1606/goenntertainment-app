import test from 'node:test';
import assert from 'node:assert/strict';

import { inviteLink, inviteText } from './invite-link.ts';

test('Link ohne /api und ohne Bindestrich im Code', () => {
  assert.equal(inviteLink('https://goe4fun.de/api', 'ABCD-2345'), 'https://goe4fun.de/g/ABCD2345');
  assert.equal(inviteLink('http://192.168.178.44:8000/api/', 'XY12'), 'http://192.168.178.44:8000/g/XY12');
});

test('Text nennt Gruppe, Link und Code', () => {
  const text = inviteText('Crew', 'ABCD-2345', 'https://x/g/ABCD2345');
  assert.match(text, /„Crew“/);
  assert.match(text, /https:\/\/x\/g\/ABCD2345/);
  assert.match(text, /ABCD-2345/);
});
