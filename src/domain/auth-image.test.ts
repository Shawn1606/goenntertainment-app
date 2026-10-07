import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authImageSource, isApiAddress } from './auth-image.ts';

const API = 'https://app.example.invalid/api';
const TOKEN = '12|test-only-token-not-a-secret';

test('private images under the API get the bearer token', () => {
  for (const uri of [
    'https://app.example.invalid/api/admin/evidence-files/0123456789abcdef0123456789abcdef01234567.png',
    'https://app.example.invalid/api/media/stories/0123456789abcdef0123456789abcdef01234567.jpg',
    'HTTPS://APP.example.invalid:443/api/media/stories/a.webp',
  ]) {
    assert.deepEqual(authImageSource(uri, TOKEN, API), { uri, headers: { Authorization: `Bearer ${TOKEN}` } }, uri);
  }
});

test('the token never goes to another host, scheme or port', () => {
  for (const uri of [
    'https://other.example.invalid/api/media/stories/a.jpg',
    'http://app.example.invalid/api/media/stories/a.jpg',
    'https://app.example.invalid:8443/api/media/stories/a.jpg',
    'https://app.example.invalid.other.example.invalid/api/media/stories/a.jpg',
    'https://user@app.example.invalid/api/media/stories/a.jpg',
    '//app.example.invalid/api/media/stories/a.jpg',
    'file:///api/media/stories/a.jpg',
    'data:image/png;base64,AAAA',
  ]) {
    assert.deepEqual(authImageSource(uri, TOKEN, API), { uri }, uri);
  }
});

test('public files and paths outside the API get no token', () => {
  for (const uri of [
    'https://app.example.invalid/storage/avatars/a.jpg',
    'https://app.example.invalid/apix/media/a.jpg',
    'https://app.example.invalid/api',
    'https://app.example.invalid/api/../storage/a.jpg',
    'https://app.example.invalid/api/%2e%2e/storage/a.jpg',
  ]) {
    assert.deepEqual(authImageSource(uri, TOKEN, API), { uri }, uri);
  }
});

test('without a token the address stays plain', () => {
  const uri = 'https://app.example.invalid/api/media/stories/a.jpg';
  assert.deepEqual(authImageSource(uri, null, API), { uri });
  assert.deepEqual(authImageSource(uri, undefined, API), { uri });
  assert.deepEqual(authImageSource(uri, '', API), { uri });
});

test('the development API on a LAN address with a port works the same way', () => {
  const api = 'http://192.0.2.10:8000/api';
  assert.equal(isApiAddress('http://192.0.2.10:8000/api/media/stories/a.jpg', api), true);
  assert.equal(isApiAddress('http://192.0.2.10:8001/api/media/stories/a.jpg', api), false);
  assert.equal(isApiAddress('http://192.0.2.10/api/media/stories/a.jpg', api), false);
  // A trailing slash on the base changes nothing.
  assert.equal(isApiAddress('http://192.0.2.10:8000/api/x', `${api}/`), true);
});
