const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { APP_URL, MIDI_PERMISSIONS, isBundleURL, resolveBundlePath, isTrustedRequest } = require('./policy.cjs');

test('bundled origin rejects remote, credentialed and other local URLs', () => {
  assert.equal(isBundleURL(APP_URL), true);
  for (const value of ['https://app/index.html', 'file:///index.html', 'soundlab://evil/index.html',
    'soundlab://user@app/index.html', 'soundlab://app:80/index.html', 'invalid']) assert.equal(isBundleURL(value), false);
});
test('only bundled files resolve, including encoded traversal and malformed URLs', () => {
  const root = path.resolve('test-dist');
  assert.equal(resolveBundlePath(root, APP_URL), path.join(root, 'index.html'));
  assert.equal(resolveBundlePath(root, 'soundlab://app/assets/app.js'), path.join(root, 'assets/app.js'));
  for (const value of ['soundlab://app/%2e%2e%2fsecret', 'soundlab://app/%5csecret',
    'soundlab://app/%00secret', 'soundlab://app/%ZZ', 'https://app/index.html']) assert.equal(resolveBundlePath(root, value), null);
});
test('MIDI permissions are restricted to the bundled main renderer', () => {
  const renderer = { isDestroyed: () => false, getURL: () => APP_URL };
  assert.equal(isTrustedRequest(renderer, renderer, APP_URL, true), true);
  assert.equal(isTrustedRequest(renderer, renderer, 'https://evil.example', true), false);
  assert.equal(isTrustedRequest(renderer, renderer, APP_URL, false), false);
  assert.equal(isTrustedRequest(renderer, {}, APP_URL, true), false);
  assert.equal(isTrustedRequest(null, renderer, APP_URL, true), false);
  assert.deepEqual([...MIDI_PERMISSIONS], ['midi', 'midiSysex']);
});
