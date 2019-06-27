import QUnit from 'qunit';
import {
  gopsSafeToAlignWith,
  updateGopBuffer,
  removeGopBuffer
} from '../../src/util/gops';

QUnit.module('GOPs');

QUnit.test('gopsSafeToAlignWith returns correct list', function(assert) {
  // gopsSafeToAlignWith uses a 3 second safetyNet so that gops very close to the playhead
  // are not considered safe to append to
  const safetyNet = 3;
  const pts = (time) => Math.ceil(time * 90000);
  let mapping = 0;
  let currentTime;
  let buffer = [];
  let actual;
  let expected;

  expected = [];
  actual = gopsSafeToAlignWith(buffer, currentTime, mapping);
  assert.deepEqual(actual, expected, 'empty array when currentTime is undefined');

  currentTime = 0;
  actual = gopsSafeToAlignWith(buffer, currentTime, mapping);
  assert.deepEqual(actual, expected, 'empty array when buffer is empty');

  buffer = expected = [
    { pts: pts(currentTime + safetyNet + 1) },
    { pts: pts(currentTime + safetyNet + 2) },
    { pts: pts(currentTime + safetyNet + 3) }
  ];
  actual = gopsSafeToAlignWith(buffer, currentTime, mapping);
  assert.deepEqual(
    actual, expected,
    'entire buffer considered safe when all gops come after currentTime + safetyNet'
  );

  buffer = [
    { pts: pts(currentTime + safetyNet) },
    { pts: pts(currentTime + safetyNet + 1) },
    { pts: pts(currentTime + safetyNet + 2) }
  ];
  expected = [
    { pts: pts(currentTime + safetyNet + 1) },
    { pts: pts(currentTime + safetyNet + 2) }
  ];
  actual = gopsSafeToAlignWith(buffer, currentTime, mapping);
  assert.deepEqual(actual, expected, 'safetyNet comparison is not inclusive');

  currentTime = 10;
  mapping = -5;
  buffer = [
    { pts: pts(currentTime - mapping + safetyNet - 2) },
    { pts: pts(currentTime - mapping + safetyNet - 1) },
    { pts: pts(currentTime - mapping + safetyNet) },
    { pts: pts(currentTime - mapping + safetyNet + 1) },
    { pts: pts(currentTime - mapping + safetyNet + 2) }
  ];
  expected = [
    { pts: pts(currentTime - mapping + safetyNet + 1) },
    { pts: pts(currentTime - mapping + safetyNet + 2) }
  ];
  actual = gopsSafeToAlignWith(buffer, currentTime, mapping);
  assert.deepEqual(actual, expected, 'uses mapping to shift currentTime');

  currentTime = 20;
  expected = [];
  actual = gopsSafeToAlignWith(buffer, currentTime, mapping);
  assert.deepEqual(
    actual, expected,
    'empty array when no gops in buffer come after currentTime'
  );
});

QUnit.test('updateGopBuffer correctly processes new gop information', function(assert) {
  let buffer = [];
  let gops = [];
  let replace = true;
  let actual;
  let expected;

  buffer = expected = [{ pts: 100 }, { pts: 200 }];
  actual = updateGopBuffer(buffer, gops, replace);
  assert.deepEqual(actual, expected, 'returns buffer when no new gops');

  gops = expected = [{ pts: 300 }, { pts: 400 }];
  actual = updateGopBuffer(buffer, gops, replace);
  assert.deepEqual(actual, expected, 'returns only new gops when replace is true');

  replace = false;
  buffer = [];
  gops = [{ pts: 100 }];
  expected = [{ pts: 100 }];
  actual = updateGopBuffer(buffer, gops, replace);
  assert.deepEqual(actual, expected, 'appends new gops to empty buffer');

  buffer = [{ pts: 100 }, { pts: 200 }];
  gops = [{ pts: 300 }, { pts: 400 }];
  expected = [{ pts: 100 }, { pts: 200 }, { pts: 300 }, { pts: 400 }];
  actual = updateGopBuffer(buffer, gops, replace);
  assert.deepEqual(actual, expected, 'appends new gops at end of buffer when no overlap');

  buffer = [{ pts: 100 }, { pts: 200 }, { pts: 300 }, { pts: 400 }];
  gops = [{ pts: 250 }, { pts: 300 }, { pts: 350 }];
  expected = [{ pts: 100 }, { pts: 200 }, { pts: 250 }, { pts: 300 }, { pts: 350 }];
  actual = updateGopBuffer(buffer, gops, replace);
  assert.deepEqual(
    actual, expected,
    'slices buffer at point of overlap and appends new gops'
  );

  buffer = [{ pts: 100 }, { pts: 200 }, { pts: 300 }, { pts: 400 }];
  gops = [{ pts: 200 }, { pts: 300 }, { pts: 350 }];
  expected = [{ pts: 100 }, { pts: 200 }, { pts: 300 }, { pts: 350 }];
  actual = updateGopBuffer(buffer, gops, replace);
  assert.deepEqual(actual, expected, 'overlap slice is inclusive');

  buffer = [{ pts: 300 }, { pts: 400 }, { pts: 500 }, { pts: 600 }];
  gops = [{ pts: 100 }, { pts: 200 }, { pts: 250 }];
  expected = [{ pts: 100 }, { pts: 200 }, { pts: 250 }];
  actual = updateGopBuffer(buffer, gops, replace);
  assert.deepEqual(
    actual, expected,
    'completely replaces buffer with new gops when all gops come before buffer'
  );
});

QUnit.test('removeGopBuffer correctly removes range from buffer', function(assert) {
  const pts = (time) => Math.ceil(time * 90000);
  let buffer = [];
  let start = 0;
  let end = 0;
  const mapping = -5;
  let actual;
  let expected;

  expected = [];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'returns empty array when buffer empty');

  start = 0;
  end = 8;
  buffer = expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(
    actual, expected,
    'no removal when remove range comes before start of buffer'
  );

  start = 22;
  end = 30;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(
    actual, expected,
    'removes last gop when remove range is after end of buffer'
  );

  start = 0;
  end = 10;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'clamps start range to begining of buffer');

  start = 0;
  end = 12;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'clamps start range to begining of buffer');

  start = 0;
  end = 14;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'clamps start range to begining of buffer');

  start = 15;
  end = 30;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'clamps end range to end of buffer');

  start = 17;
  end = 30;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'clamps end range to end of buffer');

  start = 20;
  end = 30;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'clamps end range to end of buffer');

  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  start = 12;
  end = 15;
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'removes gops that remove range intersects with');

  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  start = 12;
  end = 14;
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'removes gops that remove range intersects with');

  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  start = 13;
  end = 14;
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'removes gops that remove range intersects with');

  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  start = 13;
  end = 15;
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'removes gops that remove range intersects with');

  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  start = 12;
  end = 17;
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'removes gops that remove range intersects with');

  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  start = 13;
  end = 16;
  expected = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(actual, expected, 'removes gops that remove range intersects with');

  start = 10;
  end = 20;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(
    actual, expected,
    'removes entire buffer when buffer inside remove range'
  );

  start = 0;
  end = 30;
  buffer = [
    { pts: pts(10 - mapping) },
    { pts: pts(11 - mapping) },
    { pts: pts(12 - mapping) },
    { pts: pts(15 - mapping) },
    { pts: pts(18 - mapping) },
    { pts: pts(20 - mapping) }
  ];
  expected = [];
  actual = removeGopBuffer(buffer, start, end, mapping);
  assert.deepEqual(
    actual, expected,
    'removes entire buffer when buffer inside remove range'
  );
});
