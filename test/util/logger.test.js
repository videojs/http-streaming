import QUnit from 'qunit';
import videojs from 'video.js';
import logger from '../../src/util/logger';

QUnit.test('Logger includes source', function(assert) {
  const source = 'testsource';
  const originalLogDebug = videojs.log.debug;
  let msg;
  let logger_;

  videojs.log.debug = (...args) => {
    msg = args.join(' ');
  };

  logger_ = logger(source);
  logger_('test');

  assert.strictEqual(
    msg,
    `VHS: ${source} > test`,
    'log message includes the source');

  // Reset
  videojs.log.debug = originalLogDebug;
});
