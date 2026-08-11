import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const accessorySource = await readFile(new URL('../src/platformAccessory.ts', import.meta.url), 'utf8');
const platformSource = await readFile(new URL('../src/platform.ts', import.meta.url), 'utf8');

test('routine accessory activity is only emitted in debug logs', () => {
  assert.doesNotMatch(accessorySource, /platform\.log\.info\s*\(/);
  assert.match(accessorySource, /platform\.log\.debug\(`\[HTTP \$\{method\}\]/);
  assert.match(accessorySource, /platform\.log\.debug\(`getActive/);
});

test('normal platform logs are limited to important lifecycle events', () => {
  const infoCalls = platformSource.match(/this\.log\.info\s*\([^;]+;/g) ?? [];

  assert.equal(infoCalls.length, 4);
  assert.ok(infoCalls.some(call => call.includes('Discovered')));
  assert.ok(infoCalls.some(call => call.includes('Removing ${staleDeviceAccessories.length} stale')));
  assert.ok(infoCalls.some(call => call.includes('Removing ${legacyAccessories.length} legacy')));
  assert.ok(infoCalls.some(call => call.includes('Adding accessory')));
  assert.ok(infoCalls.every(call => !call.includes('ip=')));
});

test('warnings and errors remain visible in normal logs', () => {
  assert.match(accessorySource, /platform\.log\.warn\s*\(/);
  assert.match(accessorySource, /platform\.log\.error\s*\(/);
  assert.match(platformSource, /this\.log\.warn\s*\(/);
  assert.match(platformSource, /this\.log\.error\s*\(/);
});
