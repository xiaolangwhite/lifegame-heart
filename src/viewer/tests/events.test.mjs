/**
 * The push transport, without a socket.
 *
 * `EventHub` is where the three sources of change — the core's tick, a REST
 * mutation and a subscription update — meet one fan-out. The properties worth
 * pinning are the ones a browser cannot check for itself: that a slow client
 * coalesces instead of queueing, that two subscribers are independent, that a
 * refused or failed frame becomes an `error` event rather than silence, and that
 * closing the hub lets go of the core.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CoreUnavailableError } from '../bridge.mjs';
import { EventHub } from '../events.mjs';
import { frameAdmission } from '../public/shared.mjs';

/** A bridge that answers from a script, so a test controls the timing. */
function createStubBridge(options = {}) {
  const listeners = new Set();
  const requests = [];
  const gate = options.gate ?? null;
  return {
    requests,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    close() {
      listeners.clear();
    },
    get subscriberCount() {
      return listeners.size;
    },
    async request(cmd, fields = {}) {
      requests.push({ cmd, fields });
      if (gate) await gate(cmd);
      if (options.fail) throw options.fail;
      if (cmd === 'hello') {
        return {
          ok: true,
          protocol: 1,
          world: options.world ?? { width: 64, height: 64 },
          rule: 'B3/S23',
          running: false,
          tps: 10,
        };
      }
      if (cmd === 'frame') {
        return {
          ok: true,
          frame: {
            x0: fields.x0,
            y0: fields.y0,
            w: fields.w,
            h: fields.h,
            generation: options.generation ?? 0,
            population: options.population ?? 0,
            format: 'cells',
            data: '',
          },
        };
      }
      return { ok: true };
    },
  };
}

/** A sink that records everything a client was sent. */
function createRecorder() {
  const events = [];
  return {
    events,
    send(event, payload) {
      events.push({ event, payload });
    },
    ofType(type) {
      return events.filter((entry) => entry.event === type);
    },
  };
}

const VIEWPORT = { x0: 0, y0: 0, w: 64, h: 48 };

test('a new client is told what it is talking to, then shown the world', async () => {
  const bridge = createStubBridge({ population: 5 });
  const hub = new EventHub({ bridge });
  const recorder = createRecorder();

  await hub.addClient({ viewport: VIEWPORT, send: recorder.send });

  assert.equal(recorder.events[0].event, 'hello');
  assert.equal(recorder.events[0].payload.protocolVersion, 1);
  assert.equal(recorder.events[0].payload.representation, 'sparse');
  assert.equal(recorder.events[0].payload.world.width, 64);
  assert.equal(typeof recorder.events[0].payload.clientId, 'number');

  const frames = recorder.ofType('frame');
  assert.equal(frames.length, 1, 'the first frame arrives without being asked for');
  assert.equal(frames[0].payload.w, 64);
  assert.ok(
    bridge.requests.some((entry) => entry.cmd === 'frame'),
    'the frame came from the core',
  );

  hub.close();
});

test('a client that has not named a rectangle is shown nothing', async () => {
  // There is no default view on this side. The default view is the watching
  // page's canvas over a fixed number of pixels per cell, and a rectangle
  // invented here would be a second declaration of it — and a frame for a view
  // nobody is looking at, which for a design-target world is a whole world.
  const bridge = createStubBridge({ population: 5 });
  const hub = new EventHub({ bridge });
  const recorder = createRecorder();

  const client = await hub.addClient({ send: recorder.send });

  assert.equal(recorder.events.length, 1, 'the greeting, and nothing else');
  assert.equal(recorder.events[0].event, 'hello');
  assert.deepEqual(
    bridge.requests.filter((entry) => entry.cmd === 'frame'),
    [],
    'no frame was asked of the core',
  );
  assert.equal(client.viewport, null);
  assert.equal(recorder.ofType('error').length, 0, 'and no error either');

  // A rectangle named later is served, on the same client.
  await hub.setViewport(client, { x0: 4, y0: 4, w: 16, h: 16 });
  assert.equal(recorder.ofType('frame').length, 1);
  assert.equal(recorder.ofType('frame')[0].payload.w, 16);

  hub.close();
});

test('a tick reaches every subscriber and refreshes what they are watching', async () => {
  const bridge = createStubBridge({ population: 2 });
  const hub = new EventHub({ bridge });
  const first = createRecorder();
  const second = createRecorder();

  await hub.addClient({ viewport: VIEWPORT, send: first.send });
  await hub.addClient({ viewport: { x0: 10, y0: 10, w: 32, h: 32 }, send: second.send });

  const framesBefore = [first.ofType('frame').length, second.ofType('frame').length];

  bridge.emit({ event: 'tick', generation: 3, population: 7, changed: 1 });
  await new Promise((resolve) => setImmediate(resolve));

  for (const recorder of [first, second]) {
    assert.equal(recorder.ofType('tick').length, 1, 'every subscriber hears the tick');
  }
  assert.equal(first.ofType('frame').length, framesBefore[0] + 1, 'and is shown the new frame');
  assert.equal(second.ofType('frame').length, framesBefore[1] + 1);

  // Each subscriber gets its own rectangle, not the first one's.
  const secondFrame = second.ofType('frame').at(-1).payload;
  assert.equal(secondFrame.x0, 10);
  assert.equal(secondFrame.w, 32);

  hub.close();
});

test('a slow subscriber coalesces rather than queueing frames', async () => {
  // A core running at sixty ticks per second against a transport that issues one
  // request at a time would otherwise queue sixty frames per second per client.
  const bridge = createStubBridge({});
  const hub = new EventHub({ bridge });
  const recorder = createRecorder();
  await hub.addClient({ viewport: VIEWPORT, send: recorder.send });

  let started = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const original = bridge.request.bind(bridge);
  bridge.request = async (cmd, fields) => {
    if (cmd !== 'frame') return original(cmd, fields);
    started += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 30));
    inFlight -= 1;
    return original(cmd, fields);
  };

  // Six changes arriving together, then six more while the first frame is being
  // built. Neither burst may become six frames.
  for (let index = 0; index < 6; index += 1) hub.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 5));
  for (let index = 0; index < 6; index += 1) hub.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(maxInFlight, 1, 'only one frame is ever in flight for one client');
  assert.ok(started <= 2, `twelve changes while a frame was in flight produced ${started} frames`);
  assert.ok(started >= 1, 'and the change was served at least once');

  hub.close();
});

test('a removed subscriber stops receiving, and the hub lets go of the core', async () => {
  const bridge = createStubBridge({ population: 1 });
  const hub = new EventHub({ bridge });
  const recorder = createRecorder();
  const client = await hub.addClient({ viewport: VIEWPORT, send: recorder.send });

  assert.equal(hub.size, 1);
  hub.removeClient(client);
  assert.equal(hub.size, 0);

  const count = recorder.events.length;
  hub.invalidate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recorder.events.length, count, 'a removed subscriber is not written to');

  assert.equal(bridge.subscriberCount, 1, 'the hub is subscribed while it is open');
  hub.close();
  assert.equal(bridge.subscriberCount, 0, 'closing the hub unsubscribes from the core');
});

test('a client can be found by id, and an unknown id is not a client', async () => {
  const bridge = createStubBridge({});
  const hub = new EventHub({ bridge });
  const recorder = createRecorder();
  const client = await hub.addClient({ viewport: VIEWPORT, send: recorder.send });

  assert.equal(hub.clientById(client.id), client);
  assert.equal(hub.clientById(client.id + 100), null);
  assert.equal(hub.clientById('not a number'), null);

  hub.close();
});

test('a new subscription is answered with a frame for that rectangle', async () => {
  const bridge = createStubBridge({ world: { width: 65536, height: 65536 }, population: 1 });
  const hub = new EventHub({ bridge });
  const recorder = createRecorder();
  const client = await hub.addClient({ viewport: VIEWPORT, send: recorder.send });

  await hub.setViewport(client, { x0: '120', y0: '80', w: '256', h: '128' });
  const frame = recorder.ofType('frame').at(-1).payload;
  assert.deepEqual(
    { x0: frame.x0, y0: frame.y0, w: frame.w, h: frame.h },
    { x0: 120, y0: 80, w: 256, h: 128 },
  );

  // Values that are not numbers fall back rather than producing NaN.
  await hub.setViewport(client, { x0: 'x', y0: null, w: undefined, h: Number.NaN });
  const fallback = recorder.ofType('frame').at(-1).payload;
  assert.ok(Number.isInteger(fallback.x0) && Number.isInteger(fallback.w));

  hub.close();
});

test('a frame the encoder would refuse becomes an error, not a request', async () => {
  // The population is supplied the way the service supplies it, because the
  // core's `hello` does not report one and the hub must not ask for a rectangle
  // it cannot know is affordable. The world is the design target, so the
  // rectangle is inside it and the *encoder* is the reason it is refused.
  const bridge = createStubBridge({ world: { width: 65536, height: 65536 } });
  const hub = new EventHub({ bridge, population: () => 40_000_000 });
  const recorder = createRecorder();
  await hub.addClient({ viewport: { x0: 0, y0: 0, w: 8192, h: 8192 }, send: recorder.send });

  const refusal = frameAdmission({ area: 8192 * 8192, population: 40_000_000 });
  assert.ok(refusal, 'the case must actually be one the encoder would refuse');

  const errors = recorder.ofType('error');
  assert.equal(errors.length, 1, 'the client is told why it has no frame');
  assert.match(errors[0].payload.message, /exceeds/);
  assert.equal(
    bridge.requests.filter((entry) => entry.cmd === 'frame').length,
    0,
    'nothing was asked of the core',
  );

  hub.close();
});

test('the admitted rectangle is the one the encoder can serve cheaply', async () => {
  const bridge = createStubBridge({
    world: { width: 65536, height: 65536 },
    population: 5_000,
  });
  const hub = new EventHub({ bridge, population: () => 5_000 });
  const recorder = createRecorder();
  await hub.addClient({ viewport: { x0: 0, y0: 0, w: 65536, h: 65536 }, send: recorder.send });

  assert.equal(recorder.ofType('error').length, 0, 'a sparse world may be viewed whole');
  assert.equal(recorder.ofType('frame').length, 1);
  assert.equal(recorder.ofType('frame')[0].payload.w, 65536, 'and not clipped');

  hub.close();
});

test('a rectangle larger than the world is clipped, not refused', async () => {
  // A subscription outside the world is a view that is too wide, not a fault:
  // the core would answer it with an error, so it is fitted here instead.
  const bridge = createStubBridge({ world: { width: 64, height: 64 } });
  const hub = new EventHub({ bridge });
  const recorder = createRecorder();
  await hub.addClient({ viewport: { x0: 0, y0: 0, w: 1024, h: 768 }, send: recorder.send });

  assert.equal(recorder.ofType('error').length, 0);
  const frame = recorder.ofType('frame')[0].payload;
  assert.equal(frame.w, 64);
  assert.equal(frame.h, 64);

  hub.close();
});

test('a core that cannot be reached produces an error event', async () => {
  const bridge = createStubBridge({ fail: new CoreUnavailableError('the core is gone') });
  const hub = new EventHub({ bridge });
  const recorder = createRecorder();

  await hub.addClient({ viewport: VIEWPORT, send: recorder.send });

  const errors = recorder.ofType('error');
  assert.ok(errors.length >= 1, 'the client hears about it rather than waiting');
  assert.equal(errors[0].payload.error, 'core_unavailable');
  assert.equal(recorder.ofType('hello').length, 0, 'there is nothing to describe');

  hub.close();
});

test('the representation a client is told follows the core', async () => {
  const bridge = createStubBridge({});
  const hub = new EventHub({ bridge, representation: 'sparse' });
  const first = createRecorder();
  await hub.addClient({ viewport: VIEWPORT, send: first.send });
  assert.equal(first.ofType('hello')[0].payload.representation, 'sparse');

  hub.representation = 'tiled';
  const second = createRecorder();
  await hub.addClient({ viewport: VIEWPORT, send: second.send });
  assert.equal(second.ofType('hello')[0].payload.representation, 'tiled');

  hub.close();
});
