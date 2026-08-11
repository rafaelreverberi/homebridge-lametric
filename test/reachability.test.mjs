import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeviceCommunicationError,
  ReachabilityLogGate,
  throwUnlessDeviceCommunicationError,
} from '../dist/reachability.js';

function createLogger() {
  const messages = { debug: [], info: [], warn: [] };
  return {
    messages,
    logger: {
      debug: message => messages.debug.push(message),
      info: message => messages.info.push(message),
      warn: message => messages.warn.push(message),
    },
  };
}

test('an unreachable device warns once until it recovers', () => {
  const { logger, messages } = createLogger();
  const gate = new ReachabilityLogGate(logger, '192.0.2.1:4343');
  const failure = Object.assign(new Error('connect failed'), { code: 'EHOSTUNREACH' });

  gate.reportFailure(failure);
  gate.reportFailure(failure);
  gate.reportFailure(failure);

  assert.equal(messages.warn.length, 1);
  assert.equal(messages.debug.length, 2);
  assert.match(messages.warn[0], /Further connection errors will be hidden/);
  assert.match(messages.warn[0], /EHOSTUNREACH/);
});

test('recovery and a later outage are each logged once', () => {
  const { logger, messages } = createLogger();
  const gate = new ReachabilityLogGate(logger, '192.0.2.1:4343');

  gate.reportFailure(new Error('offline'));
  gate.reportSuccess();
  gate.reportSuccess();
  gate.reportFailure(new Error('offline again'));

  assert.equal(messages.warn.length, 2);
  assert.equal(messages.info.length, 1);
  assert.equal(messages.info[0], 'LaMetric device 192.0.2.1:4343 is reachable again.');
});

test('only one retry probe is allowed per offline interval', () => {
  const { logger } = createLogger();
  let currentTime = 1_000;
  const gate = new ReachabilityLogGate(logger, '192.0.2.1:4343', 60_000, () => currentTime);

  assert.equal(gate.beginAttempt(), true);
  gate.reportFailure(new Error('offline'));
  assert.equal(gate.beginAttempt(), false);

  currentTime += 60_000;
  assert.equal(gate.beginAttempt(), true);
  assert.equal(gate.beginAttempt(), false);

  gate.reportSuccess();
  assert.equal(gate.beginAttempt(), true);
});

test('expected offline writes do not escape into Homebridge handlers', () => {
  assert.doesNotThrow(() => {
    throwUnlessDeviceCommunicationError(new DeviceCommunicationError('retry paused'));
  });
  assert.throws(
    () => throwUnlessDeviceCommunicationError(new Error('unexpected bug')),
    /unexpected bug/,
  );
});
