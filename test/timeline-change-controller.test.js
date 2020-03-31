import QUnit from 'qunit';
import TimelineChangeController from '../src/timeline-change-controller';

QUnit.module('Timeline Change Controller', {
  beforeEach(assert) {
    this.timelineChangeController = new TimelineChangeController();
  }
});

QUnit.test('saves last timeline changes from different types', function(assert) {
  assert.notOk(
    this.timelineChangeController.lastTimelineChange({ type: 'main' }),
    'starts without any main timeline change'
  );
  assert.notOk(
    this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
    'starts without any audio timeline change'
  );

  this.timelineChangeController.lastTimelineChange({
    type: 'main',
    from: 1,
    to: 2
  });

  assert.deepEqual(
    this.timelineChangeController.lastTimelineChange({ type: 'main' }),
    {
      type: 'main',
      from: 1,
      to: 2
    },
    'records main timeline change'
  );
  assert.notOk(
    this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
    'no audio timeline change'
  );

  this.timelineChangeController.lastTimelineChange({
    type: 'audio',
    from: 2,
    to: 3
  });

  assert.deepEqual(
    this.timelineChangeController.lastTimelineChange({ type: 'main' }),
    {
      type: 'main',
      from: 1,
      to: 2
    },
    'still has main timeline change'
  );
  assert.deepEqual(
    this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
    {
      type: 'audio',
      from: 2,
      to: 3
    },
    'records audio timeline change'
  );
});

QUnit.test('saves pending timeline changes from different types', function(assert) {
  assert.notOk(
    this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
    'starts without any main pending timeline change'
  );
  assert.notOk(
    this.timelineChangeController.pendingTimelineChange({ type: 'audio' }),
    'starts without any audio pending timeline change'
  );

  this.timelineChangeController.pendingTimelineChange({
    type: 'main',
    from: 1,
    to: 2
  });

  assert.deepEqual(
    this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
    {
      type: 'main',
      from: 1,
      to: 2
    },
    'records main pending timeline change'
  );
  assert.notOk(
    this.timelineChangeController.pendingTimelineChange({ type: 'audio' }),
    'no audio pending timeline change'
  );

  this.timelineChangeController.pendingTimelineChange({
    type: 'audio',
    from: 2,
    to: 3
  });

  assert.deepEqual(
    this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
    {
      type: 'main',
      from: 1,
      to: 2
    },
    'still has main pending timeline change'
  );
  assert.deepEqual(
    this.timelineChangeController.pendingTimelineChange({ type: 'audio' }),
    {
      type: 'audio',
      from: 2,
      to: 3
    },
    'records audio pending timeline change'
  );
});

QUnit.test('triggers timelinechange event on timeline changes', function(assert) {
  let timelineChanges = 0;

  this.timelineChangeController.on('timelinechange', () => timelineChanges++);
  this.timelineChangeController.lastTimelineChange({
    type: 'main',
    from: 1,
    to: 2
  });

  assert.equal(timelineChanges, 1, 'triggered timelinechange event');

  this.timelineChangeController.lastTimelineChange({
    type: 'audio',
    from: 2,
    to: 3
  });

  assert.equal(timelineChanges, 2, 'triggered timelinechange event');

  this.timelineChangeController.lastTimelineChange({
    type: 'audio',
    from: 3,
    to: 4
  });

  assert.equal(timelineChanges, 3, 'triggered timelinechange event');
});

QUnit.test('triggers pendingtimelinechange event on pending timeline changes', function(assert) {
  let pendingTimelineChanges = 0;

  this.timelineChangeController.on(
    'pendingtimelinechange',
    () => pendingTimelineChanges++
  );
  this.timelineChangeController.pendingTimelineChange({
    type: 'main',
    from: 1,
    to: 2
  });

  assert.equal(pendingTimelineChanges, 1, 'triggered pendingtimelinechange event');

  this.timelineChangeController.pendingTimelineChange({
    type: 'audio',
    from: 2,
    to: 3
  });

  assert.equal(pendingTimelineChanges, 2, 'triggered pendingtimelinechange event');

  this.timelineChangeController.pendingTimelineChange({
    type: 'audio',
    from: 3,
    to: 4
  });

  assert.equal(pendingTimelineChanges, 3, 'triggered pendingtimelinechange event');
});

QUnit.test('timeline change deletes pending timeline change', function(assert) {
  this.timelineChangeController.pendingTimelineChange({
    type: 'main',
    from: 1,
    to: 2
  });

  assert.deepEqual(
    this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
    {
      type: 'main',
      from: 1,
      to: 2
    },
    'saved pending timeline change'
  );

  this.timelineChangeController.lastTimelineChange({
    type: 'main',
    from: 2,
    to: 3
  });

  assert.notOk(
    this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
    'deleted pending timeline change'
  );
});

QUnit.test('clear pending deletes and triggers pendingtimelinechange', function(assert) {
  let pendingTimelineChanges = 0;

  this.timelineChangeController.on(
    'pendingtimelinechange',
    () => pendingTimelineChanges++
  );

  this.timelineChangeController.pendingTimelineChange({
    type: 'main',
    from: 1,
    to: 2
  });

  assert.equal(pendingTimelineChanges, 1, 'triggered pendingtimelinechange event');
  assert.deepEqual(
    this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
    {
      type: 'main',
      from: 1,
      to: 2
    },
    'saved pending timeline change'
  );

  this.timelineChangeController.clearPendingTimelineChange('main');

  assert.equal(pendingTimelineChanges, 2, 'triggered pendingtimelinechange event');
  assert.notOk(
    this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
    'deleted pending timeline change'
  );
});
