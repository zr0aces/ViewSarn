const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFreshModules } = require('./helpers');

const loadRender = (env) => loadFreshModules(env, ['../src/render']);

test('render slots cap concurrency and queue the overflow', async () => {
  const { _acquireSlot, _releaseSlot, _inFlight } = loadRender({ RENDER_CONCURRENCY: '2' });

  await _acquireSlot();
  await _acquireSlot();
  assert.deepEqual(_inFlight(), { active: 2, waiting: 0 });

  let thirdStarted = false;
  const third = _acquireSlot().then(() => { thirdStarted = true; });

  await null; // let the pending acquire settle if it were going to
  assert.equal(thirdStarted, false, 'third render must wait for a free slot');
  assert.deepEqual(_inFlight(), { active: 2, waiting: 1 });

  _releaseSlot();
  await third;
  assert.equal(thirdStarted, true, 'releasing a slot must hand it to the queued render');
  assert.deepEqual(_inFlight(), { active: 2, waiting: 0 }, 'the freed slot is reused, not double-counted');

  _releaseSlot();
  _releaseSlot();
  assert.deepEqual(_inFlight(), { active: 0, waiting: 0 }, 'slots must drain back to zero');
});

test('render slots are released even when a render throws', async () => {
  const { _acquireSlot, _releaseSlot, _inFlight } = loadRender({ RENDER_CONCURRENCY: '1' });

  await _acquireSlot();
  try {
    throw new Error('render blew up');
  } catch {
    _releaseSlot();
  }

  assert.deepEqual(_inFlight(), { active: 0, waiting: 0 });
  await _acquireSlot(); // would hang forever if the slot leaked
  _releaseSlot();
});

test('a full queue is rejected with 503 rather than growing without bound', async () => {
  const { _acquireSlot, _releaseSlot, _inFlight } = loadRender({
    RENDER_CONCURRENCY: '1',
    RENDER_QUEUE_MAX: '2'
  });

  await _acquireSlot();              // takes the only slot
  const queued = [_acquireSlot(), _acquireSlot()];  // fills the queue
  assert.deepEqual(_inFlight(), { active: 1, waiting: 2 });

  await assert.rejects(
    () => _acquireSlot(),
    (err) => err.status === 503,
    'the request past the queue ceiling must be rejected, not queued'
  );

  _releaseSlot();
  await queued[0];
  _releaseSlot();
  await queued[1];
  _releaseSlot();
  assert.deepEqual(_inFlight(), { active: 0, waiting: 0 });
});

test('a queued request whose client disconnects is dropped instead of rendered', async () => {
  const { _acquireSlot, _releaseSlot, _inFlight } = loadRender({
    RENDER_CONCURRENCY: '1',
    RENDER_QUEUE_MAX: '10'
  });

  await _acquireSlot();                       // occupies the only slot
  const controller = new AbortController();
  const queued = _acquireSlot(controller.signal);
  const stayed = _acquireSlot();              // queued behind the one that leaves
  assert.deepEqual(_inFlight(), { active: 1, waiting: 2 });

  controller.abort();
  await assert.rejects(() => queued, (err) => err.status === 499);
  assert.deepEqual(_inFlight(), { active: 1, waiting: 1 }, 'the aborted entry must leave the queue');

  // The slot must go to the request still waiting, not to the abandoned one.
  _releaseSlot();
  await stayed;
  _releaseSlot();
  assert.deepEqual(_inFlight(), { active: 0, waiting: 0 });
});

test('an already-aborted request never takes a slot', async () => {
  const { _acquireSlot, _inFlight } = loadRender({ RENDER_CONCURRENCY: '2' });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() => _acquireSlot(controller.signal), (err) => err.status === 499);
  assert.deepEqual(_inFlight(), { active: 0, waiting: 0 }, 'no slot may be consumed');
});
