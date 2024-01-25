import QUnit from 'qunit';
import {
  default as SegmentLoader,
  illegalMediaSwitch,
  safeBackBufferTrimTime,
  timestampOffsetForSegment,
  shouldWaitForTimelineChange,
  segmentTooLong,
  mediaDuration,
  getTroublesomeSegmentDurationMessage,
  getSyncSegmentCandidate,
  segmentInfoString
} from '../src/segment-loader';
import mp4probe from 'mux.js/lib/mp4/probe';
import {
  playlistWithDuration,
  standardXHRResponse,
  MockTextTrack
} from './test-helpers.js';
import {
  LoaderCommonHooks,
  LoaderCommonSettings,
  LoaderCommonFactory
} from './loader-common.js';
import {
  muxed as muxedSegment,
  oneSecond as oneSecondSegment,
  audio as audioSegment,
  video as videoSegment,
  videoDiffPtsDts as videoDiffPtsDtsSegment,
  videoOneSecond as videoOneSecondSegment,
  videoOneSecond1 as videoOneSecond1Segment,
  videoOneSecond2 as videoOneSecond2Segment,
  videoOneSecond3 as videoOneSecond3Segment,
  videoLargeOffset as videoLargeOffsetSegment,
  videoLargeOffset2 as videoLargeOffset2Segment,
  videoMaxOffset as videoMaxOffsetSegment,
  videoMinOffset as videoMinOffsetSegment,
  audioLargeOffset as audioLargeOffsetSegment,
  audioLargeOffset2 as audioLargeOffset2Segment,
  audioMaxOffset as audioMaxOffsetSegment,
  audioMinOffset as audioMinOffsetSegment,
  mp4Video as mp4VideoSegment,
  mp4VideoInit as mp4VideoInitSegment,
  mp4Audio as mp4AudioSegment,
  mp4AudioInit as mp4AudioInitSegment,
  zeroLength as zeroLengthSegment,
  encrypted as encryptedSegment,
  encryptionKey
} from 'create-test-data!segments';
import sinon from 'sinon';
import { timeRangesEqual } from './custom-assertions.js';
import { QUOTA_EXCEEDED_ERR } from '../src/error-codes';
import window from 'global/window';
import document from 'global/document';
import {merge, createTimeRanges} from '../src/util/vjs-compat';

const newEvent = function(name) {
  let event;

  if (typeof window.Event === 'function') {
    event = new window.Event(name);
  } else {
    event = document.createEvent('Event');
    event.initEvent(name, true, true);
  }

  return event;
};

/* TODO
// noop addSegmentMetadataCue_ since most test segments dont have real timing information
// save the original function to a variable to patch it back in for the metadata cue
// specific tests
const ogAddSegmentMetadataCue_ = SegmentLoader.prototype.addSegmentMetadataCue_;

SegmentLoader.prototype.addSegmentMetadataCue_ = function() {};
*/

QUnit.module('SegmentLoader Isolated Functions');

QUnit.test('getSyncSegmentCandidate works as expected', function(assert) {
  let segments = [];

  assert.equal(getSyncSegmentCandidate(-1, segments, 0), 0, '-1 timeline, no segments, 0 target');
  assert.equal(getSyncSegmentCandidate(0, segments, 0), 0, '0 timeline, no segments, 0 target');

  segments = [
    {timeline: 0, duration: 4},
    {timeline: 0, duration: 4},
    {timeline: 0, duration: 4},
    {timeline: 0, duration: 4}
  ];

  assert.equal(getSyncSegmentCandidate(-1, segments, 0), 0, '-1 timeline, 4x 0 segments, 0 target');
  assert.equal(getSyncSegmentCandidate(0, segments, 1), 0, '0 timeline, 4x 0 segments, 1 target');
  assert.equal(getSyncSegmentCandidate(0, segments, 4), 1, '0 timeline, 4x 0 segments, 4 target');
  assert.equal(getSyncSegmentCandidate(-1, segments, 8), 0, '-1 timeline, 4x 0 segments, 8 target');
  assert.equal(getSyncSegmentCandidate(0, segments, 8), 2, '0 timeline, 4x 0 segments, 8 target');
  assert.equal(getSyncSegmentCandidate(0, segments, 20), 3, '0 timeline, 4x 0 segments, 20 target');

  segments = [
    {timeline: 1, duration: 4},
    {timeline: 0, duration: 4},
    {timeline: 1, duration: 4},
    {timeline: 0, duration: 4},
    {timeline: 2, duration: 4},
    {timeline: 1, duration: 4},
    {timeline: 0, duration: 4}
  ];

  assert.equal(getSyncSegmentCandidate(1, segments, 8), 5, '1 timeline, mixed timeline segments, 8 target');
  assert.equal(getSyncSegmentCandidate(0, segments, 8), 6, '0 timeline, mixed timeline segments, 8 target');
  assert.equal(getSyncSegmentCandidate(2, segments, 8), 4, '2 timeline, mixed timeline segments, 8 target');
});

QUnit.test('illegalMediaSwitch detects illegal media switches', function(assert) {
  let startingMedia = { hasAudio: true, hasVideo: true };
  let newSegmentMedia = { hasAudio: true, hasVideo: true };

  assert.notOk(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'no error when muxed to muxed'
  );

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.notOk(
    illegalMediaSwitch('audio', startingMedia, newSegmentMedia),
    'no error when not main loader type'
  );

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.notOk(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'no error when audio only to audio only'
  );

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: true };
  assert.notOk(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'no error when video only to video only'
  );

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: true };
  assert.notOk(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'no error when video only to muxed'
  );

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Neither audio nor video found in segment.',
    'error when neither audio nor video'
  );

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Neither audio nor video found in segment.',
    'error when audio only to neither audio nor video'
  );

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: false, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Neither audio nor video found in segment.',
    'error when video only to neither audio nor video'
  );

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: true, hasVideo: true };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Video found in segment when we expected only audio.' +
               ' We can\'t switch to a stream with video from an audio only stream.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
    'error when audio only to muxed'
  );

  startingMedia = { hasAudio: true, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Only audio found in segment when we expected video.' +
               ' We can\'t switch to audio only from a stream that had video.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
    'error when muxed to audio only'
  );

  startingMedia = { hasAudio: true, hasVideo: false };
  newSegmentMedia = { hasAudio: false, hasVideo: true };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Video found in segment when we expected only audio.' +
               ' We can\'t switch to a stream with video from an audio only stream.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
    'error when audio only to video only'
  );

  startingMedia = { hasAudio: false, hasVideo: true };
  newSegmentMedia = { hasAudio: true, hasVideo: false };
  assert.equal(
    illegalMediaSwitch('main', startingMedia, newSegmentMedia),
    'Only audio found in segment when we expected video.' +
               ' We can\'t switch to audio only from a stream that had video.' +
               ' To get rid of this message, please add codec information to the' +
               ' manifest.',
    'error when video only to audio only'
  );
});

QUnit.module('timestampOffsetForSegment');

QUnit.test('returns startOfSegment when timeline changes and the buffer is empty', function(assert) {
  assert.equal(
    timestampOffsetForSegment({
      segmentTimeline: 1,
      currentTimeline: 0,
      startOfSegment: 3,
      buffered: createTimeRanges()
    }),
    3,
    'returned startOfSegment'
  );
});

QUnit.test('returns buffered end when timeline changes and there exists buffered content', function(assert) {
  assert.equal(
    timestampOffsetForSegment({
      segmentTimeline: 1,
      currentTimeline: 0,
      startOfSegment: 3,
      buffered: createTimeRanges([[1, 5], [7, 8]])
    }),
    8,
    'returned buffered end'
  );
});

QUnit.test('returns null when timeline does not change', function(assert) {
  assert.ok(
    timestampOffsetForSegment({
      segmentTimeline: 0,
      currentTimeline: 0,
      startOfSegment: 3,
      buffered: createTimeRanges([[1, 5], [7, 8]])
    }) === null,
    'returned null'
  );

  assert.ok(
    timestampOffsetForSegment({
      segmentTimeline: 1,
      currentTimeline: 1,
      startOfSegment: 3,
      buffered: createTimeRanges([[1, 5], [7, 8]])
    }) === null,
    'returned null'
  );
});

QUnit.test('returns value when overrideCheck is true', function(assert) {
  assert.equal(
    timestampOffsetForSegment({
      segmentTimeline: 0,
      currentTimeline: 0,
      startOfSegment: 3,
      buffered: createTimeRanges([[1, 5], [7, 8]]),
      overrideCheck: true
    }),
    8,
    'returned buffered end'
  );
});

QUnit.test('uses startOfSegment when timeline is before current', function(assert) {
  assert.equal(
    timestampOffsetForSegment({
      segmentTimeline: 0,
      currentTimeline: 1,
      startOfSegment: 3,
      buffered: createTimeRanges([[1, 5], [7, 8]]),
      overrideCheck: true
    }),
    3,
    'returned startOfSegment'
  );
});

QUnit.module('shouldWaitForTimelineChange');

QUnit.test('should not wait if timelines are the same', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({ currentTimeline: 1, segmentTimeline: 1 }),
    'should not wait'
  );
});

QUnit.test('audio loader waits if no main timeline change', function(assert) {
  assert.ok(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'audio',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should wait'
  );
});

QUnit.test('audio loader waits if last main timeline change not on audio segment\'s timeline', function(assert) {
  assert.ok(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'audio',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          if (type === 'main') {
            return { from: 0, to: 1 };
          }
        }
      }
    }),
    'should wait'
  );
});

QUnit.test('audio loader does not wait if last main timeline matches audio segment\'s timeline', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'audio',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          if (type === 'main') {
            return { from: 1, to: 2 };
          }
        }
      }
    }),
    'should not wait'
  );
});

QUnit.test('audio loader does not wait if last main timeline matches audio segment\'s timeline', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'audio',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          if (type === 'main') {
            return { from: 1, to: 2 };
          }
        }
      }
    }),
    'should not wait'
  );
});

QUnit.test('main loader does not wait if audio enabled', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main'
    }),
    'should not wait'
  );
});

QUnit.test('main loader does not wait if no audio timeline change', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main',
      timelineChangeController: {
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should not wait'
  );
});

QUnit.test('main loader waits if no pending audio timeline change', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main',
      timelineChangeController: {
        pendingTimelineChange({ type }) {
          return void 0;
        },
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should wait'
  );
});

QUnit.test('main loader waits if pending audio timeline change doesn\'t match segment timeline', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main',
      timelineChangeController: {
        pendingTimelineChange({ type }) {
          if (type === 'audio') {
            return { from: 0, to: 1 };
          }
        },
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should wait'
  );
});

QUnit.test('main loader does not wait if pending audio timeline change matches segment timeline', function(assert) {
  assert.notOk(
    shouldWaitForTimelineChange({
      currentTimeline: 1,
      segmentTimeline: 2,
      loaderType: 'main',
      timelineChangeController: {
        pendingTimelineChange({ type }) {
          if (type === 'audio') {
            return { from: 1, to: 2 };
          }
        },
        lastTimelineChange({ type }) {
          return void 0;
        }
      }
    }),
    'should not wait'
  );
});

QUnit.module('safeBackBufferTrimTime');

QUnit.test('uses 30s before playhead when seekable start is 0', function(assert) {
  const seekable = createTimeRanges([[0, 120]]);
  const targetDuration = 10;
  const currentTime = 70;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    40,
    'returned 30 seconds before playhead'
  );
});

QUnit.test('uses 30s before playhead when seekable start is earlier', function(assert) {
  const seekable = createTimeRanges([[30, 120]]);
  const targetDuration = 10;
  const currentTime = 70;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    40,
    'returned 30 seconds before playhead'
  );
});

QUnit.test('uses seekable start when within 30s of playhead', function(assert) {
  const seekable = createTimeRanges([[41, 120]]);
  const targetDuration = 10;
  const currentTime = 70;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    41,
    'returned 29 seconds before playhead'
  );
});

QUnit.test('uses target duration when seekable range is within target duration', function(assert) {
  let seekable = createTimeRanges([[0, 120]]);
  const targetDuration = 10;
  let currentTime = 9;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    -1,
    'returned 10 seconds before playhead'
  );

  seekable = createTimeRanges([[40, 120]]);
  currentTime = 41;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    31,
    'returned 10 seconds before playhead'
  );
});

QUnit.test('uses target duration when seekable range is after current time', function(assert) {
  const seekable = createTimeRanges([[110, 120]]);
  const targetDuration = 10;
  const currentTime = 80;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    70,
    'returned 10 seconds before playhead'
  );
});

QUnit.test('uses current time when seekable range is well before current time', function(assert) {
  const seekable = createTimeRanges([[10, 20]]);
  const targetDuration = 10;
  const currentTime = 140;

  assert.equal(
    safeBackBufferTrimTime(seekable, currentTime, targetDuration),
    110,
    'returned 30 seconds before playhead'
  );
});

QUnit.module('mediaDuration');

QUnit.test('0 when no timing info', function(assert) {
  assert.equal(mediaDuration({}), 0, '0 when no timing info');
  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1}, videoTimingInfo: {start: 1}}),
    0,
    '0 when no end times'
  );
  assert.equal(
    mediaDuration({audioTimingInfo: {end: 1}, videoTimingInfo: {end: 1}}),
    0,
    '0 when no start times'
  );
});

QUnit.test('reports audio duration', function(assert) {
  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1, end: 2}}),
    1,
    'audio duration when no video info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1, end: 2}, videoTimingInfo: {start: 1}}),
    1,
    'audio duration when not enough video info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1, end: 2}, videoTimingInfo: {end: 3}}),
    1,
    'audio duration when not enough video info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1, end: 3}, videoTimingInfo: {start: 1, end: 2}}),
    2,
    'audio duration when audio duration > video duration'
  );
});

QUnit.test('reports video duration', function(assert) {
  assert.equal(
    mediaDuration({videoTimingInfo: {start: 1, end: 2}}),
    1,
    'video duration when no audio info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1}, videoTimingInfo: {start: 1, end: 2}}),
    1,
    'video duration when not enough audio info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {end: 3}, videoTimingInfo: {start: 1, end: 2}}),
    1,
    'video duration when not enough audio info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1, end: 2}, videoTimingInfo: {start: 1, end: 3}}),
    2,
    'video duration when video duration > audio duration'
  );
});

if (window.BigInt) {
  QUnit.test('handles bigint', function(assert) {
    assert.equal(
      mediaDuration({audioTimingInfo: {start: window.BigInt(1), end: window.BigInt(2)}}),
      1,
      'audio duration when no video info'
    );

    assert.equal(
      mediaDuration({videoTimingInfo: {start: window.BigInt(1), end: window.BigInt(2)}}),
      1,
      'video duration when no audio info'
    );
  });
}

QUnit.test('reports video duration', function(assert) {
  assert.equal(
    mediaDuration({videoTimingInfo: {start: 1, end: 2}}),
    1,
    'video duration when no audio info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1}, videoTimingInfo: {start: 1, end: 2}}),
    1,
    'video duration when not enough audio info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {end: 3}, videoTimingInfo: {start: 1, end: 2}}),
    1,
    'video duration when not enough audio info'
  );

  assert.equal(
    mediaDuration({audioTimingInfo: {start: 1, end: 2}, videoTimingInfo: {start: 1, end: 3}}),
    2,
    'video duration when video duration > audio duration'
  );
});

QUnit.module('segmentTooLong');

QUnit.test('false when no segment duration', function(assert) {
  assert.notOk(segmentTooLong({ maxDuration: 9 }), 'false when no segment duration');
  assert.notOk(
    segmentTooLong({ segmentDuration: 0, maxDuration: 9 }),
    'false when segment duration is 0'
  );
});

QUnit.test('false when duration is within range', function(assert) {
  assert.notOk(
    segmentTooLong({
      segmentDuration: 9,
      maxDuration: 9
    }),
    'false when duration is same'
  );
  assert.notOk(
    segmentTooLong({
      segmentDuration: 9.49,
      maxDuration: 9
    }),
    'false when duration rounds down to same'
  );
});

QUnit.test('true when duration is too long', function(assert) {
  assert.ok(
    segmentTooLong({
      segmentDuration: 9,
      maxDuration: 8.9
    }),
    'true when duration is too long'
  );
  assert.ok(
    segmentTooLong({
      segmentDuration: 9.5,
      maxDuration: 9
    }),
    'true when duration rounds up to be too long'
  );
});

QUnit.module('getTroublesomeSegmentDurationMessage');

QUnit.test('falsey when dash', function(assert) {
  assert.notOk(
    getTroublesomeSegmentDurationMessage(
      {
        audioTimingInfo: { start: 0, end: 10 },
        videoTimingInfo: { start: 0, end: 10 },
        mediaIndex: 0,
        playlist: {
          id: 'id',
          targetDuration: 4
        }
      },
      'dash'
    ),
    'falsey when dash'
  );
});

QUnit.test('falsey when segment is within range', function(assert) {
  assert.notOk(
    getTroublesomeSegmentDurationMessage(
      {
        audioTimingInfo: { start: 0, end: 10 },
        videoTimingInfo: { start: 0, end: 10 },
        duration: 10,
        mediaIndex: 0,
        playlist: {
          id: 'id',
          targetDuration: 10
        }
      },
      'hls'
    ),
    'falsey when segment equal to target duration'
  );

  assert.notOk(
    getTroublesomeSegmentDurationMessage(
      {
        audioTimingInfo: { start: 0, end: 10 },
        videoTimingInfo: { start: 0, end: 5 },
        duration: 10,
        mediaIndex: 0,
        playlist: {
          id: 'id',
          targetDuration: 10
        }
      },
      'hls'
    ),
    'falsey when segment less than target duration'
  );

  assert.notOk(
    getTroublesomeSegmentDurationMessage(
      {
        audioTimingInfo: { start: 0, end: 5 },
        videoTimingInfo: { start: 0, end: 5 },
        mediaIndex: 0,
        duration: 5,
        playlist: {
          id: 'id',
          targetDuration: 10
        }
      },
      'hls'
    ),
    'falsey when segment less than target duration'
  );
});

QUnit.test('warn when segment is way too long', function(assert) {
  assert.deepEqual(
    getTroublesomeSegmentDurationMessage(
      {
        audioTimingInfo: { start: 0, end: 10 },
        videoTimingInfo: { start: 0, end: 10 },
        mediaIndex: 0,
        duration: 10,
        playlist: {
          targetDuration: 4,
          id: 'id'
        }
      },
      'hls'
    ),
    {
      severity: 'warn',
      message:
        'Segment with index 0 from playlist id has a duration of 10 when the reported ' +
        'duration is 10 and the target duration is 4. For HLS content, a duration in ' +
        'excess of the target duration may result in playback issues. See the HLS ' +
        'specification section on EXT-X-TARGETDURATION for more details: ' +
        'https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-4.3.3.1'
    },
    'warn when segment way too long'
  );
});

QUnit.test('info segment is bit too long', function(assert) {
  assert.deepEqual(
    getTroublesomeSegmentDurationMessage(
      {
        audioTimingInfo: { start: 0, end: 4.5 },
        videoTimingInfo: { start: 0, end: 4.5 },
        mediaIndex: 0,
        duration: 4.5,
        playlist: {
          id: 'id',
          targetDuration: 4
        }
      },
      'hls'
    ),
    {
      severity: 'info',
      message:
        'Segment with index 0 from playlist id has a duration of 4.5 when the reported ' +
        'duration is 4.5 and the target duration is 4. For HLS content, a duration in ' +
        'excess of the target duration may result in playback issues. See the HLS ' +
        'specification section on EXT-X-TARGETDURATION for more details: ' +
        'https://tools.ietf.org/html/draft-pantos-http-live-streaming-23#section-4.3.3.1'
    },
    'info when segment is a bit too long'
  );
});

QUnit.module('segmentInfoString');

QUnit.test('all possible information', function(assert) {
  const segment = {
    uri: 'foo',
    parts: [
      {start: 0, end: 1, duration: 1},
      {start: 1, end: 2, duration: 1},
      {start: 2, end: 3, duration: 1},
      {start: 4, end: 5, duration: 1},
      {start: 5, end: 6, duration: 1}
    ],
    start: 0,
    end: 6
  };
  const segmentInfo = {
    startOfSegment: 1,
    duration: 5,
    segment,
    part: segment.parts[0],
    playlist: {
      mediaSequence: 0,
      id: 'playlist-id',
      segments: [segment]
    },
    mediaIndex: 0,
    partIndex: 0,
    timeline: 0,
    independent: 'previous part',
    getMediaInfoForTime: 'bufferedEnd 0'
  };

  const expected =
    'segment [0/0] ' +
    'part [0/4] ' +
    'segment start/end [0 => 6] ' +
    'part start/end [0 => 1] ' +
    'startOfSegment [1] ' +
    'duration [5] ' +
    'timeline [0] ' +
    'selected by [getMediaInfoForTime (bufferedEnd 0) with independent previous part] ' +
    'playlist [playlist-id]';

  assert.equal(segmentInfoString(segmentInfo), expected, 'expected return value');
});

QUnit.test('mediaIndex selection', function(assert) {
  const segment = {
    uri: 'foo',
    parts: [
      {start: 0, end: 1, duration: 1},
      {start: 1, end: 2, duration: 1},
      {start: 2, end: 3, duration: 1},
      {start: 4, end: 5, duration: 1},
      {start: 5, end: 6, duration: 1}
    ],
    start: 0,
    end: 6
  };
  const segmentInfo = {
    startOfSegment: 1,
    duration: 5,
    segment,
    part: segment.parts[0],
    playlist: {
      mediaSequence: 0,
      id: 'playlist-id',
      segments: [segment]
    },
    mediaIndex: 0,
    partIndex: 0,
    timeline: 0
  };

  const expected =
    'segment [0/0] ' +
    'part [0/4] ' +
    'segment start/end [0 => 6] ' +
    'part start/end [0 => 1] ' +
    'startOfSegment [1] ' +
    'duration [5] ' +
    'timeline [0] ' +
    'selected by [mediaIndex/partIndex increment] ' +
    'playlist [playlist-id]';

  assert.equal(segmentInfoString(segmentInfo), expected, 'expected return value');
});

QUnit.test('sync request selection', function(assert) {
  const segment = {
    uri: 'foo',
    parts: [
      {start: 0, end: 1, duration: 1},
      {start: 1, end: 2, duration: 1},
      {start: 2, end: 3, duration: 1},
      {start: 4, end: 5, duration: 1},
      {start: 5, end: 6, duration: 1}
    ],
    start: 0,
    end: 6
  };
  const segmentInfo = {
    startOfSegment: 1,
    duration: 5,
    segment,
    part: segment.parts[0],
    playlist: {
      mediaSequence: 0,
      id: 'playlist-id',
      segments: [segment]
    },
    mediaIndex: 0,
    partIndex: 0,
    timeline: 0,
    isSyncRequest: true

  };

  const expected =
    'segment [0/0] ' +
    'part [0/4] ' +
    'segment start/end [0 => 6] ' +
    'part start/end [0 => 1] ' +
    'startOfSegment [1] ' +
    'duration [5] ' +
    'timeline [0] ' +
    'selected by [getSyncSegmentCandidate (isSyncRequest)] ' +
    'playlist [playlist-id]';

  assert.equal(segmentInfoString(segmentInfo), expected, 'expected return value');
});

QUnit.test('preload segment', function(assert) {
  const segment = {
    parts: [
      {start: 0, end: 1, duration: 1},
      {start: 1, end: 2, duration: 1},
      {start: 2, end: 3, duration: 1},
      {start: 4, end: 5, duration: 1},
      {start: 5, end: 6, duration: 1}
    ],
    start: 0,
    end: 6
  };
  const segmentInfo = {
    startOfSegment: 1,
    duration: 5,
    segment,
    part: segment.parts[0],
    playlist: {
      mediaSequence: 0,
      id: 'playlist-id',
      segments: [segment]
    },
    mediaIndex: 0,
    partIndex: 0,
    timeline: 0
  };

  const expected =
    'pre-segment [0/0] ' +
    'part [0/4] ' +
    'segment start/end [0 => 6] ' +
    'part start/end [0 => 1] ' +
    'startOfSegment [1] ' +
    'duration [5] ' +
    'timeline [0] ' +
    'selected by [mediaIndex/partIndex increment] ' +
    'playlist [playlist-id]';

  assert.equal(segmentInfoString(segmentInfo), expected, 'expected return value');
});

QUnit.test('without parts', function(assert) {
  const segment = {
    start: 0,
    end: 6
  };
  const segmentInfo = {
    startOfSegment: 1,
    duration: 5,
    segment,
    playlist: {
      mediaSequence: 0,
      id: 'playlist-id',
      segments: [segment]
    },
    mediaIndex: 0,
    timeline: 0
  };

  const expected =
    'pre-segment [0/0] ' +
    'segment start/end [0 => 6] ' +
    'startOfSegment [1] ' +
    'duration [5] ' +
    'timeline [0] ' +
    'selected by [mediaIndex/partIndex increment] ' +
    'playlist [playlist-id]';

  assert.equal(segmentInfoString(segmentInfo), expected, 'expected return value');
});

QUnit.test('unknown start/end', function(assert) {
  const segment = {
    uri: 'foo',
    parts: [
      {start: null, end: null, duration: 1},
      {start: null, end: null, duration: 1},
      {start: null, end: null, duration: 1},
      {start: null, end: null, duration: 1},
      {start: null, end: null, duration: 1}
    ],
    start: null,
    end: null
  };
  const segmentInfo = {
    startOfSegment: 1,
    duration: 5,
    segment,
    part: segment.parts[0],
    playlist: {
      mediaSequence: 0,
      id: 'playlist-id',
      segments: [segment]
    },
    mediaIndex: 0,
    partIndex: 0,
    timeline: 0
  };

  const expected =
    'segment [0/0] ' +
    'part [0/4] ' +
    'segment start/end [null => null] ' +
    'part start/end [null => null] ' +
    'startOfSegment [1] ' +
    'duration [5] ' +
    'timeline [0] ' +
    'selected by [mediaIndex/partIndex increment] ' +
    'playlist [playlist-id]';

  assert.equal(segmentInfoString(segmentInfo), expected, 'expected return value');
});

QUnit.module('SegmentLoader', function(hooks) {
  hooks.beforeEach(LoaderCommonHooks.beforeEach);
  hooks.afterEach(LoaderCommonHooks.afterEach);

  LoaderCommonFactory({
    LoaderConstructor: SegmentLoader,
    loaderSettings: {loaderType: 'main'},
    encryptedSegmentFn: encryptedSegment,
    encryptedSegmentKeyFn: encryptionKey
  });

  // Tests specific to the main segment loader go in this module
  QUnit.module('Main', function(nestedHooks) {
    let loader;

    nestedHooks.beforeEach(function(assert) {
      this.startTime = sinon.stub(mp4probe, 'startTime');
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack
      }), {});

      this.fakeMainTimelineChange = () => {
        // Fake the last timeline change for main so audio loader has enough info to
        // append the first segment.
        this.timelineChangeController.lastTimelineChange({
          type: 'main',
          from: -1,
          to: 0
        });
      };
    });

    nestedHooks.afterEach(function(assert) {
      this.startTime.restore();
      loader.dispose();
    });

    QUnit.test('load waits until a playlist is specified to proceed', function(assert) {
      loader.load();

      assert.equal(loader.state, 'INIT', 'waiting in init');
      assert.equal(loader.paused(), false, 'not paused');
      assert.equal(this.requests.length, 0, 'have not made a request yet');

      loader.playlist(playlistWithDuration(10));
      this.clock.tick(1);

      assert.equal(this.requests.length, 1, 'made a request');
      assert.equal(loader.state, 'WAITING', 'transitioned states');
    });

    QUnit.test('only appends one segment at a time', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(10));
        loader.load();
        this.clock.tick(1);

        // some time passes and a segment is received
        this.clock.tick(100);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(this.requests.length, 0, 'only made one request');
      });
    });

    QUnit.test('should use video PTS value for timestamp offset calculation when useDtsForTimestampOffset set as false', function(assert) {
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        useDtsForTimestampOffset: false
      }), {});

      const playlist = playlistWithDuration(20, { uri: 'playlist.m3u8' });

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          loader.playlist(playlist);
          loader.load();

          this.clock.tick(100);

          standardXHRResponse(this.requests.shift(), videoDiffPtsDtsSegment());
        });
      }).then(() => {
        assert.equal(
          loader.sourceUpdater_.videoTimestampOffset(),
          -playlist.segments[0].videoTimingInfo.transmuxedPresentationStart,
          'set video timestampOffset'
        );

        assert.equal(
          loader.sourceUpdater_.audioTimestampOffset(),
          -playlist.segments[0].videoTimingInfo.transmuxedPresentationStart,
          'set audio timestampOffset'
        );
      });
    });

    QUnit.test('should use video DTS value for timestamp offset calculation when useDtsForTimestampOffset set as true', function(assert) {
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        useDtsForTimestampOffset: true
      }), {});

      const playlist = playlistWithDuration(20, { uri: 'playlist.m3u8' });

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          loader.playlist(playlist);
          loader.load();

          this.clock.tick(100);
          // segment
          standardXHRResponse(this.requests.shift(), videoDiffPtsDtsSegment());
        });
      }).then(() => {
        assert.equal(
          loader.sourceUpdater_.videoTimestampOffset(),
          -playlist.segments[0].videoTimingInfo.transmuxedDecodeStart,
          'set video timestampOffset'
        );

        assert.equal(
          loader.sourceUpdater_.audioTimestampOffset(),
          -playlist.segments[0].videoTimingInfo.transmuxedDecodeStart,
          'set audio timestampOffset'
        );
      });
    });

    QUnit.test('should use video DTS value as primary for muxed segments (eg: audio and video together) for timestamp offset calculation when useDtsForTimestampOffset set as true', function(assert) {
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        useDtsForTimestampOffset: true
      }), {});

      const playlist = playlistWithDuration(20, { uri: 'playlist.m3u8' });

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          loader.playlist(playlist);
          loader.load();

          this.clock.tick(100);

          standardXHRResponse(this.requests.shift(), muxedSegment());
        });
      }).then(() => {
        assert.equal(
          loader.sourceUpdater_.videoTimestampOffset(),
          -playlist.segments[0].videoTimingInfo.transmuxedDecodeStart,
          'set video timestampOffset'
        );

        assert.equal(
          loader.sourceUpdater_.audioTimestampOffset(),
          -playlist.segments[0].videoTimingInfo.transmuxedDecodeStart,
          'set audio timestampOffset'
        );
      });
    });

    QUnit.test('should use audio DTS value for timestamp offset calculation when useDtsForTimestampOffset set as true and only audio', function(assert) {
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        useDtsForTimestampOffset: true
      }), {});

      const playlist = playlistWithDuration(20, { uri: 'playlist.m3u8' });

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, { isAudioOnly: true }).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          loader.playlist(playlist);
          loader.load();

          this.clock.tick(100);
          // segment
          standardXHRResponse(this.requests.shift(), audioSegment());
        });
      }).then(() => {
        assert.equal(
          loader.sourceUpdater_.audioTimestampOffset(),
          -playlist.segments[0].audioTimingInfo.transmuxedDecodeStart,
          'set audio timestampOffset'
        );
      });
    });

    QUnit.test('should fallback to segment\'s start time when there is no transmuxed content (eg: mp4) and useDtsForTimestampOffset is set as true', function(assert) {
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        useDtsForTimestampOffset: true
      }), {});

      const playlist = playlistWithDuration(10);
      const ogPost = loader.transmuxer_.postMessage;

      loader.transmuxer_.postMessage = (message) => {
        if (message.action === 'probeMp4StartTime') {
          const evt = newEvent('message');

          evt.data = {action: 'probeMp4StartTime', startTime: 11, data: message.data};

          loader.transmuxer_.dispatchEvent(evt);
          return;
        }
        return ogPost.call(loader.transmuxer_, message);
      };

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          playlist.segments.forEach((segment) => {
            segment.map = {
              resolvedUri: 'init.mp4',
              byterange: { length: Infinity, offset: 0 }
            };
          });
          loader.playlist(playlist);
          loader.load();

          this.clock.tick(100);
          // init
          standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
          // segment
          standardXHRResponse(this.requests.shift(), mp4VideoSegment());
        });
      }).then(() => {
        assert.equal(loader.sourceUpdater_.videoTimestampOffset(), -11, 'set video timestampOffset');
        assert.equal(loader.sourceUpdater_.audioTimestampOffset(), -11, 'set audio timestampOffset');
      });
    });

    QUnit.test('updates timestamps when segments do not start at zero', function(assert) {
      const playlist = playlistWithDuration(10);
      const ogPost = loader.transmuxer_.postMessage;

      loader.transmuxer_.postMessage = (message) => {
        if (message.action === 'probeMp4StartTime') {
          const evt = newEvent('message');

          evt.data = {action: 'probeMp4StartTime', startTime: 11, data: message.data};

          loader.transmuxer_.dispatchEvent(evt);
          return;
        }
        return ogPost.call(loader.transmuxer_, message);
      };

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          playlist.segments.forEach((segment) => {
            segment.map = {
              resolvedUri: 'init.mp4',
              byterange: { length: Infinity, offset: 0 }
            };
          });
          loader.playlist(playlist);
          loader.load();

          this.clock.tick(100);
          // init
          standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
          // segment
          standardXHRResponse(this.requests.shift(), mp4VideoSegment());
        });
      }).then(() => {

        assert.equal(loader.sourceUpdater_.videoTimestampOffset(), -11, 'set timestampOffset');
        assert.equal(
          playlist.segments[0].start,
          0,
          'segment start time not shifted by mp4 start time'
        );
        assert.equal(
          playlist.segments[0].end,
          10,
          'segment end time not shifted by mp4 start time'
        );
      });
    });

    QUnit.test('uses the log event from the transmuxer', function(assert) {
      const playlist = playlistWithDuration(10);
      const ogPost = loader.transmuxer_.postMessage;
      const messages = [];

      loader.logger_ = (message) => {
        messages.push(message);
      };

      loader.transmuxer_.postMessage = (message) => {
        const retval = ogPost.call(loader.transmuxer_, message);

        if (message.action === 'push') {
          const log = newEvent('message');

          log.data = {action: 'log', log: {message: 'debug foo', stream: 'something', level: 'warn'}};

          loader.transmuxer_.dispatchEvent(log);
          return;
        }

        return retval;
      };

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          loader.playlist(playlist);
          loader.load();

          this.clock.tick(100);
          // segment
          standardXHRResponse(this.requests.shift(), videoOneSecondSegment());
        });
      }).then(() => {
        let messageFound = false;

        messages.forEach(function(message) {
          if ((/debug foo/).test(message) && (/warn/).test(message) && (/something/).test(message)) {
            messageFound = true;
          }
        });

        assert.ok(messageFound, 'message was logged');
      });
    });

    QUnit.test('triggers syncinfoupdate before attempting a resync', function(assert) {
      let syncInfoUpdates = 0;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        this.seekable = createTimeRanges([[0, 10]]);
        loader.on('syncinfoupdate', () => {
          syncInfoUpdates++;
          // Simulate the seekable window updating
          this.seekable = createTimeRanges([[200, 210]]);
          // Simulate the seek to live that should happen in playback-watcher
          this.currentTime = 210;
        });

        standardXHRResponse(this.requests.shift(), oneSecondSegment());
        // the appended event will not fire, as segment-loader will realize that its guess
        // was off and will reset everything to load at the new point, therefore, wait for
        // the syncinfoupdate event rather than the appended event
        return new Promise((resolve, reject) => {
          loader.one('syncinfoupdate', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(loader.mediaIndex, null, 'mediaIndex reset by seek to seekable');
        assert.equal(loader.partIndex, null, 'partIndex reset by seek to seekable');
        assert.equal(syncInfoUpdates, 1, 'syncinfoupdate was triggered');
      });
    });

    // This test case used to test that we didn't stop all segment processing (including
    // transmuxing), however, that case has changed, such that segment processing will
    // not stop during appends, but will stop if in the middle of processing.
    QUnit.test('abort does not cancel segment appends in progress', function(assert) {
      const done = assert.async();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.one('appending', () => {
          loader.abort();
          this.clock.tick(1);
          assert.equal(loader.state, 'APPENDING', 'still appending');
          done();
        });

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());

      });
    });

    QUnit.test('appendsdone happens after appends complete', function(assert) {
      const done = assert.async();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        loader.one('appendsdone', () => {
          assert.ok(true, 'appendsdone triggered');
          done();
        });
      });
    });

    QUnit.test('appendsdone does not happen after abort during append', function(assert) {
      const done = assert.async();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        let appendsdone = false;

        loader.one('appendsdone', () => {
          appendsdone = true;
        });

        let appends = 0;

        const finish = function() {
          appends++;

          if (appends < 2) {
            return;
          }

          assert.notOk(appendsdone, 'appendsdone not triggered');
          done();
        };

        loader.one('appending', () => {
          loader.abort();
          loader.sourceUpdater_.videoQueueCallback(finish);
          loader.sourceUpdater_.audioQueueCallback(finish);
        });

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());

      });
    });

    QUnit.test('audio loader waits to request segment until it has enough info', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      // Second segment will involve the test, as that will have a timeline change for
      // audio before the main loader has reached the change itself.
      this.fakeMainTimelineChange();

      const playlist = playlistWithDuration(20);

      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // segment 0
          standardXHRResponse(this.requests.shift(), audioSegment());
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 0, 'no requests because not enough info to load');
        assert.equal(loader.loadQueue_.length, 1, 'one entry in load queue');
      });
    });

    QUnit.test('audio loader does not wait to request segment even if timestamp offset is nonzero', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      const playlist = playlistWithDuration(100);

      // The normal case this test represents is live, but seeking before start also
      // represents the same (and a valid) case.
      loader.currentTime_ = () => 70;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.equal(
          loader.pendingSegment_.timestampOffset,
          70,
          'timestamp offset is nonzero'
        );
        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 1, 'one request');
        assert.equal(loader.loadQueue_.length, 0, 'no entries in load queue');
      });
    });

    // In the event that the loader doesn't have enough info to load, the segment request
    // will be part of the load queue until there's enough info. This test ensures that
    // these calls can be successfully aborted.
    QUnit.test('abort works when waiting to load', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      // Second segment will involve the test, as that will have a timeline change for
      // audio before the main loader has reached the change itself.
      this.fakeMainTimelineChange();

      const playlist = playlistWithDuration(20);

      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // segment 0
          standardXHRResponse(this.requests.shift(), audioSegment());
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 0, 'no requests because not enough info to load');
        assert.equal(loader.loadQueue_.length, 1, 'one entry in load queue');

        loader.abort();
        assert.equal(loader.state, 'READY', 'aborted load');
        assert.equal(loader.loadQueue_.length, 0, 'cleared load queue');
      });
    });

    QUnit.test('processLoadQueue processes the load queue', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      // Second segment will involve the test, as that will have a timeline change for
      // audio before the main loader has reached the change itself.
      this.fakeMainTimelineChange();

      const playlist = playlistWithDuration(20);

      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // segment 0
          standardXHRResponse(this.requests.shift(), audioSegment());
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 0, 'no requests because not enough info to load');
        assert.equal(loader.loadQueue_.length, 1, 'one entry in load queue');

        loader.processLoadQueue_();

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 1, 'made a request');
        assert.equal(loader.loadQueue_.length, 0, 'load queue is empty');
      });
    });

    QUnit.test('audio loader checks to process load queue on timeline change', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      // Second segment will involve the test, as that will have a timeline change for
      // audio before the main loader has reached the change itself.
      this.fakeMainTimelineChange();

      const playlist = playlistWithDuration(20);

      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // segment 0
          standardXHRResponse(this.requests.shift(), audioSegment());
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(
          this.requests.length,
          0,
          'no requests because not enough info to load'
        );
        assert.equal(loader.loadQueue_.length, 1, 'one entry in load queue');

        this.timelineChangeController.lastTimelineChange({
          type: 'main',
          from: 0,
          to: 1
        });

        assert.equal(loader.state, 'WAITING', 'state is waiting on segment');
        assert.equal(this.requests.length, 1, 'made a request');
        assert.equal(
          loader.loadQueue_.length,
          0,
          'load queue is empty after main timeline caught up'
        );
      });
    });

    QUnit.test('audio loader checks to process append queue on timeline change', function(assert) {
      const done = assert.async();

      assert.expect(3);
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      let ranFinish = false;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origFinish = loader.segmentRequestFinished_.bind(loader);

        // Although overriding the internal function isn't the cleanest way to test, it's
        // difficult to try to catch the moment where the segment is finished and in the
        // queue, but not yet processed and appending.
        loader.segmentRequestFinished_ = (error, simpleSegment, result) => {
          origFinish(error, simpleSegment, result);

          // call queue should have an entry for this function, but only want to run
          // through this logic once
          if (ranFinish) {
            return;
          }

          ranFinish = true;

          // segment request finished, but the loader is waiting on main to have a
          // timeline change
          assert.equal(loader.state, 'WAITING', 'state is waiting');

          // the timeline change should trigger an append
          loader.on('appending', () => {
            done();
          });

          this.timelineChangeController.lastTimelineChange({
            type: 'main',
            from: -1,
            to: 0
          });
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        // segment 0
        standardXHRResponse(this.requests.shift(), audioSegment());
      });
    });

    QUnit.test('main loader checks to process append queue on timeline change', function(assert) {
      const done = assert.async();

      assert.expect(3);

      let ranFinish = false;

      const playlist = playlistWithDuration(20);

      // add a discontinuity so that the main loader will wait for audio to append before
      // changing timelines
      playlist.discontinuityStarts = [1];
      playlist.segments[1].timeline = 1;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        // demuxed
        loader.setAudio(false);
        loader.load();
        this.clock.tick(1);

        // Main loader won't load the first segment until the audio loader is ready to
        // load the first segment.
        this.timelineChangeController.pendingTimelineChange({
          type: 'audio',
          from: -1,
          to: 0
        });

        // segment 0
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        const origFinish = loader.segmentRequestFinished_.bind(loader);

        // Although overriding the internal function isn't the cleanest way to test, it's
        // difficult to try to catch the moment where the segment is finished and in the
        // queue, but not yet processed and appending.
        loader.segmentRequestFinished_ = (error, simpleSegment, result) => {
          origFinish(error, simpleSegment, result);

          // call queue should have an entry for this function, but only want to run
          // through this logic once
          if (ranFinish) {
            return;
          }

          ranFinish = true;

          assert.equal(loader.state, 'WAITING', 'state is waiting on segment');

          // the timeline change should trigger an append
          loader.on('appending', () => {
            done();
          });

          this.timelineChangeController.pendingTimelineChange({
            type: 'audio',
            from: 0,
            to: 1
          });
        };

        this.clock.tick(1);
        // segment 1
        standardXHRResponse(this.requests.shift(), videoSegment());
      });
    });

    QUnit.test('main loader updates main and audio timeline changes on appends when muxed', function(assert) {
      const playlist = playlistWithDuration(20);

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.deepEqual(
          this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
          {
            type: 'main',
            from: -1,
            to: 0
          },
          'added pending timeline change for main'
        );
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          'no timeline change for audio yet'
        );
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'main' }),
          'no timeline change for main yet'
        );

        // segment 0
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.deepEqual(
          this.timelineChangeController.lastTimelineChange({ type: 'main' }),
          {
            type: 'main',
            from: -1,
            to: 0
          },
          'added last timeline change for main'
        );
        // main loader, when content is muxed, will update both the main and audio
        // timeline changes
        assert.deepEqual(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          {
            type: 'audio',
            from: -1,
            to: 0
          },
          'added last timeline change for audio'
        );
      });
    });

    QUnit.test('main loader updates only main timeline changes on appends when demuxed', function(assert) {
      const playlist = playlistWithDuration(20);

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        // demuxed
        loader.setAudio(false);
        loader.load();
        this.clock.tick(1);

        assert.deepEqual(
          this.timelineChangeController.pendingTimelineChange({ type: 'main' }),
          {
            type: 'main',
            from: -1,
            to: 0
          },
          'added pending timeline change for main'
        );

        // Main loader won't load the first segment until the audio loader is ready to
        // load the first segment.
        this.timelineChangeController.pendingTimelineChange({
          type: 'audio',
          from: -1,
          to: 0
        });
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          'no timeline change for audio yet'
        );
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'main' }),
          'no timeline change for main yet'
        );

        // segment 0
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.deepEqual(
          this.timelineChangeController.lastTimelineChange({ type: 'main' }),
          {
            type: 'main',
            from: -1,
            to: 0
          },
          'added last timeline change for main'
        );
        // main loader, when content is demuxed, will not update audio timeline changes
        assert.notOk(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          'did not add last timeline change for audio'
        );
      });
    });

    QUnit.test('audio loader updates timeline changes on appends', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      this.fakeMainTimelineChange();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          loader.playlist(playlistWithDuration(20));
          loader.load();
          this.clock.tick(1);

          assert.deepEqual(
            this.timelineChangeController.pendingTimelineChange({ type: 'audio' }),
            {
              type: 'audio',
              from: -1,
              to: 0
            },
            'added pending timeline change for audio'
          );
          assert.notOk(
            this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
            'no timeline change for audio yet'
          );

          // segment 0
          standardXHRResponse(this.requests.shift(), audioSegment());
        });
      }).then(() => {
        assert.deepEqual(
          this.timelineChangeController.lastTimelineChange({ type: 'audio' }),
          {
            type: 'audio',
            from: -1,
            to: 0
          },
          'added last timeline change for audio'
        );
      });
    });

    QUnit.test('sets the timestampOffset on timeline change', function(assert) {
      const setTimestampOffsetMessages = [];
      let timestampOffsetEvents = 0;
      let buffered = createTimeRanges();
      const playlist = playlistWithDuration(40);
      let videoSegmentStartTime = 3;
      let videoSegmentEndTime = 13;

      // timestampoffset events are triggered when the source buffer's timestamp offset is
      // set
      loader.on('timestampoffset', () => {
        timestampOffsetEvents++;
      });

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, { isVideoOnly: true }).then(() => {

        // The transmuxer's timestamp offset is set at different times than the source
        // buffers' timestamp offsets. Since keepOriginalTimestamps is set to true, the
        // timestampOffset value in the transmuxer is used for content alignment
        // modifications, rather than changing time values to match a timeline.
        const origPostMessage = loader.transmuxer_.postMessage.bind(loader.transmuxer_);

        loader.transmuxer_.postMessage = (config) => {
          if (config.action === 'setTimestampOffset') {
            setTimestampOffsetMessages.push(config);
          }

          origPostMessage(config);
        };

        const origHandleTimingInfo = loader.handleTimingInfo_.bind(loader);

        // The source buffer timestamp offset is offset by the start of the segment. In
        // order to account for this, use a fixed value.
        loader.handleTimingInfo_ = (simpleSegment, mediaType, timeType, time) => {
          if (mediaType === 'video') {
            time = timeType === 'start' ? videoSegmentStartTime : videoSegmentEndTime;
          }
          origHandleTimingInfo(simpleSegment, mediaType, timeType, time);
        };

        loader.buffered_ = () => buffered;

        playlist.discontinuityStarts = [2];
        playlist.segments[2].timeline = 1;
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // segment 0
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was fired');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          0 - 3,
          'timestampoffset set on source buffer'
        );
        assert.equal(
          setTimestampOffsetMessages.length,
          0,
          'timestampoffset was not set in transmuxer'
        );

        buffered = createTimeRanges([[0, 10]]);
        playlist.segments[0].end = 10;
        // start request for segment 1
        this.clock.tick(1);

        assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          0 - 3,
          'timestampoffset not changed on source buffer'
        );
        // still at 0
        assert.equal(
          setTimestampOffsetMessages.length,
          0,
          'timestampoffset was not set in transmuxer'
        );

        // video start time changed for the next segment (1), but the timestamp offset on
        // the source buffer shouldn't change
        videoSegmentStartTime = 13;
        videoSegmentEndTime = 23;
        // segment 1
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          0 - 3,
          'timestampoffset not changed on source buffer'
        );
        assert.equal(
          setTimestampOffsetMessages.length,
          0,
          'timestampoffset was not set in transmuxer'
        );

        buffered = createTimeRanges([[10, 20]]);
        playlist.segments[1].end = 20;
        // start request for segment 2, which has a discontinuity (new timeline)
        this.clock.tick(1);

        assert.equal(timestampOffsetEvents, 1, 'timestampoffset event was not fired again');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          0 - 3,
          'timestampoffset not changed on source buffer'
        );
        assert.equal(
          setTimestampOffsetMessages.length,
          1,
          'timestampoffset was set in transmuxer'
        );
        assert.equal(
          setTimestampOffsetMessages[0].timestampOffset,
          20,
          'transmuxer timestampoffset set to 20'
        );

        videoSegmentStartTime = 101;
        videoSegmentEndTime = 111;
        // segment 2
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.equal(timestampOffsetEvents, 2, 'timestampoffset event was fired');
        assert.equal(
          loader.sourceUpdater_.videoBuffer.timestampOffset,
          20 - 101,
          'timestampoffset changed on source buffer'
        );
        assert.equal(
          setTimestampOffsetMessages.length,
          1,
          'timestampoffset unchanged in transmuxer'
        );
      });
    });

    QUnit.test('saves segment timing info', function(assert) {
      const playlist = playlistWithDuration(20);
      const syncController = loader.syncController_;
      let saveSegmentTimingInfoCalls = 0;
      const origSaveSegmentTimingInfo =
        syncController.saveSegmentTimingInfo.bind(syncController);

      syncController.saveSegmentTimingInfo = ({
        segmentInfo,
        shouldSaveTimelineMapping
      }) => {
        saveSegmentTimingInfoCalls++;
        origSaveSegmentTimingInfo({ segmentInfo, shouldSaveTimelineMapping });
      };

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        assert.equal(saveSegmentTimingInfoCalls, 0, 'no calls to save timing info');

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(saveSegmentTimingInfoCalls, 1, 'called to save timing info');
      });
    });

    QUnit.test('main loader saves timeline mapping', function(assert) {
      const syncController = loader.syncController_;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        assert.notOk(syncController.mappingForTimeline(0), 'no mapping for timeline 0');

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.ok(syncController.mappingForTimeline(0), 'saved mapping for timeline 0');
      });
    });

    QUnit.test('audio loader doesn\'t save timeline mapping', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      this.fakeMainTimelineChange();

      const syncController = loader.syncController_;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {

          loader.one('appended', resolve);
          loader.one('error', reject);
          loader.playlist(playlistWithDuration(20));
          loader.load();
          this.clock.tick(1);
          standardXHRResponse(this.requests.shift(), audioSegment());

          assert.notOk(syncController.mappingForTimeline(0), 'no mapping for timeline 0');
        });
      }).then(() => {
        assert.notOk(syncController.mappingForTimeline(0), 'no mapping for timeline 0');
      });
    });

    QUnit.test('tracks segment end times as they are buffered', function(assert) {
      const playlist = playlistWithDuration(20);

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.notOk(playlist.segments[0].end, 'does not start with duration');

        standardXHRResponse(this.requests.shift(), oneSecondSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.ok(playlist.segments[0].end, 'updated duration');
      });
    });

    QUnit.test('adds cues with segment information to the segment-metadata' +
               ' track as they are buffered', function(assert) {
      const addCueSpy = sinon.spy();

      loader.segmentMetadataTrack_ = {
        addCue: addCueSpy
      };

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        loader.playlist(playlistWithDuration(50));
        loader.load();

        this.clock.tick(1);

        // Respond with a segment, and wait until it is appended
        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.strictEqual(
          addCueSpy.callCount,
          1,
          'appending segment should have added a new cue to the segmentMetadataTrack'
        );
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        assert.strictEqual(
          addCueSpy.callCount,
          2,
          'another append adds to segmentMetadataTrack'
        );
      });
    });

    QUnit.test('does not add cue for invalid segment timing info', function(assert) {
      const addCueSpy = sinon.spy();

      loader.segmentMetadataTrack_ = {
        addCue: addCueSpy
      };

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(50));
        loader.load();

        this.clock.tick(1);

        // Respond with a segment, and wait until it is appended
        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(addCueSpy.callCount, 1, 'cue added for appended segment');

        loader.addSegmentMetadataCue_({
          segment: {},
          start: 0,
          end: undefined
        });

        assert.equal(addCueSpy.callCount, 1, 'no cue added for invalid segment');
      });
    });

    QUnit.test('translates metadata events into WebVTT cues', function(assert) {
      const done = assert.async();
      const dispatchType = 0x10;
      const metadataCues = [{
        cueTime: 14,
        frames: [{
          data: 'This is a priv tag'
        }]
      }];
      const addCueSpy = sinon.spy();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.on('appending', () => {
          // Simulate an id3Frame event happening that will call handleId3_
          loader.handleId3_(loader.pendingSegment_, metadataCues, dispatchType);
        });

        loader.on('appended', () => {
          this.clock.tick(1);

          assert.strictEqual(
            loader.inbandTextTracks_.metadataTrack_.inBandMetadataTrackDispatchType,
            dispatchType,
            'in-band metadata track dispatch type correctly set'
          );
          assert.strictEqual(
            addCueSpy.callCount,
            1,
            'created 1 metadataTrack.cue from the frames'
          );
          done();
        });

        loader.inbandTextTracks_ = {};
        loader.playlist(playlistWithDuration(20));
        loader.load();
        // set the mediaSource duration as it is usually set by
        // main playlist controller, which is not present here
        loader.mediaSource_.duration = 20;

        this.clock.tick(1);

        // Mock text tracks and addRemoteTextTrack on the mock tech
        sinon.stub(loader.vhs_.tech_, 'addRemoteTextTrack')
          .returns({
            track: {
              addCue: addCueSpy
            }
          });

        this.sourceUpdater_ = loader.sourceUpdater_;
        this.inbandTextTracks_ = loader.inbandTextTracks_;
        this.tech_ = loader.vhs_.tech_;
        standardXHRResponse(this.requests.shift(), muxedSegment());

      });
    });

    QUnit.test('translates caption events into WebVTT cues', function(assert) {
      const done = assert.async();
      const textTrackStub = sinon.stub(loader.vhs_.tech_, 'textTracks');
      const captions = [{
        startTime: 0,
        endTime: 1,
        text: 'text',
        stream: 'CC1'
      }];
      const addCueSpy = sinon.spy();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.on('appending', () => {
          // Simulate a caption event happening that will call handleCaptions_
          loader.handleCaptions_(loader.pendingSegment_, captions);
        });

        loader.on('appended', () => {
          assert.ok(
            Object.keys(loader.inbandTextTracks_.CC1),
            'created one text track with the caption stream as the id'
          );
          assert.strictEqual(addCueSpy.callCount, 1, 'created one cue');
          done();
        });

        loader.playlist(playlistWithDuration(20));
        loader.load();

        this.clock.tick(1);

        // Mock text tracks on the mock tech and setup the inbandTextTracks
        loader.inbandTextTracks_ = {};
        textTrackStub.returns({
          getTrackById: () => null
        });
        sinon.stub(loader.vhs_.tech_, 'addRemoteTextTrack')
          .returns({
            track: {
              addCue: addCueSpy
            }
          });

        standardXHRResponse(this.requests.shift(), muxedSegment());

      });
    });

    QUnit.test('translates metadata events from audio-only stream into WebVTT cues', function(assert) {
      const done = assert.async();
      const textTrackStub = sinon.stub(loader.vhs_.tech_, 'textTracks');
      const metadata = [{
        cueTime: 12,
        frames: [{
          data: 'This is a priv tag'
        }]
      }];

      const addCueSpy = sinon.spy();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.on('appending', () => {
          // Simulate a caption event happening that will call handleCaptions_
          const dispatchType = 0x10;

          // Ensure no video buffer is present in the test case
          loader.sourceUpdater_.videoBuffer = undefined;

          loader.handleId3_(loader.pendingSegment_, metadata, dispatchType);
        });

        loader.on('appended', () => {

          assert.ok(Object.keys(loader.inbandTextTracks_.metadataTrack_), 'created a metadata track');
          assert.strictEqual(addCueSpy.callCount, 1, 'created one cue');

          assert.strictEqual(
            loader.inbandTextTracks_.metadataTrack_.inBandMetadataTrackDispatchType,
            16,
            'in-band metadata track dispatch type correctly set'
          );

          const cue = addCueSpy.getCall(0).args[0];

          assert.strictEqual(cue.value.data, 'This is a priv tag', 'included the text');

          assert.strictEqual(cue.startTime, metadata[0].cueTime + loader.sourceUpdater_.audioTimestampOffset(), 'cue.startTime offset from audioTimestampOffset');
          done();
        });

        loader.playlist(playlistWithDuration(20));
        loader.load();

        this.clock.tick(1);

        // Mock text tracks on the mock tech and setup the inbandTextTracks
        loader.inbandTextTracks_ = {};
        textTrackStub.returns({
          getTrackById: () => null
        });
        sinon.stub(loader.vhs_.tech_, 'addRemoteTextTrack')
          .returns({
            track: {
              addCue: addCueSpy
            }
          });

        this.sourceUpdater_ = loader.sourceUpdater_;
        this.inbandTextTracks_ = loader.inbandTextTracks_;
        this.tech_ = loader.vhs_.tech_;
        standardXHRResponse(this.requests.shift(), audioSegment());
      });
    });

    QUnit.test('fires ended at the end of a playlist', function(assert) {
      let endOfStreams = 0;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.on('ended', () => endOfStreams++);
        loader.playlist(playlistWithDuration(10));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(endOfStreams, 1, 'triggered ended');
      });
    });

    QUnit.test('endOfStream happens even after a rendition switch', function(assert) {
      let endOfStreams = 0;
      let bandwidthupdates = 0;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.on('ended', () => endOfStreams++);

        loader.on('bandwidthupdate', () => {
          bandwidthupdates++;
          // Simulate a rendition switch
          loader.resetEverything();
        });

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(10);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(bandwidthupdates, 1, 'triggered bandwidthupdate');
        assert.equal(endOfStreams, 1, 'triggered ended');
      });
    });

    QUnit.test('live playlists do not trigger ended', function(assert) {
      let endOfStreams = 0;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(10);

        loader.on('ended', () => endOfStreams++);

        playlist.endList = false;
        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(endOfStreams, 0, 'did not trigger ended');
      });
    });

    QUnit.test('saves segment info to new segment after playlist refresh', function(assert) {
      // playlist updated during waiting
      const playlistUpdated = playlistWithDuration(40);
      const playlist = playlistWithDuration(40);

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        playlist.endList = false;

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '0.ts',
          'correct segment reference'
        );

        // wrap up the first request to set mediaIndex and start normal live streaming
        standardXHRResponse(this.requests.shift(), oneSecondSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        playlistUpdated.segments.shift();
        playlistUpdated.mediaSequence++;
        loader.playlist(playlistUpdated);

        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(playlistUpdated.segments[0].start, 0.11072222222222239, 'set start on segment of new playlist');
        assert.ok(playlistUpdated.segments[0].end, 'set end on segment of new playlist');
        assert.notOk(playlist.segments[1].start, 'did not set start on segment of old playlist');
        assert.notOk(playlist.segments[1].end, 'did not set end on segment of old playlist');
      });
    });

    QUnit.test('saves segment info to old segment after playlist refresh if segment fell off', function(assert) {
      const playlist = playlistWithDuration(40);
      // playlist updated during waiting
      const playlistUpdated = playlistWithDuration(40);

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        playlist.endList = false;

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '0.ts', 'first segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '0.ts',
          'correct segment reference'
        );

        // wrap up the first request to set mediaIndex and start normal live streaming
        standardXHRResponse(this.requests.shift(), oneSecondSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(loader.state, 'WAITING', 'in waiting state');
        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        playlistUpdated.segments.shift();
        playlistUpdated.segments.shift();
        playlistUpdated.mediaSequence += 2;
        loader.playlist(playlistUpdated);

        assert.equal(loader.pendingSegment_.uri, '1.ts', 'second segment still pending');
        assert.equal(
          loader.pendingSegment_.segment.uri,
          '1.ts',
          'correct segment reference'
        );

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(playlist.segments[1].start, 0.11072222222222239, 'set start on segment of old playlist');
        assert.ok(playlist.segments[1].end, 'set end on segment of old playlist');
        assert.notOk(
          playlistUpdated.segments[0].start,
          'no start info for first segment of new playlist'
        );
        assert.notOk(
          playlistUpdated.segments[0].end,
          'no end info for first segment of new playlist'
        );
      });
    });

    QUnit.test('errors when trying to switch from audio and video to audio only', function(assert) {

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          const playlist = playlistWithDuration(40);

          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          standardXHRResponse(this.requests.shift(), muxedSegment());
          this.clock.tick(1);
        });
      }).then(() => new Promise((resolve, reject) => {
        this.clock.tick(1);
        loader.one('error', () => {
          const error = loader.error();

          assert.equal(
            error.message,
            'Only audio found in segment when we expected video.' +
            ' We can\'t switch to audio only from a stream that had video.' +
            ' To get rid of this message, please add codec information to the' +
            ' manifest.',
            'correct error message'
          );
          resolve();
        });

        standardXHRResponse(this.requests.shift(), audioSegment());
      }));
    });

    QUnit.test('errors when trying to switch from audio only to audio and video', function(assert) {

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {

          loader.one('appended', resolve);
          loader.one('error', reject);

          const playlist = playlistWithDuration(40);

          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          standardXHRResponse(this.requests.shift(), audioSegment());

        });
      }).then(() => new Promise((resolve, reject) => {
        this.clock.tick(1);

        loader.one('error', function() {
          const error = loader.error();

          assert.equal(
            error.message,
            'Video found in segment when we expected only audio.' +
            ' We can\'t switch to a stream with video from an audio only stream.' +
            ' To get rid of this message, please add codec information to the' +
            ' manifest.',
            'correct error message'
          );
          resolve();
        });

        standardXHRResponse(this.requests.shift(), muxedSegment());
      }));
    });

    QUnit.test('no error when not switching from audio and video', function(assert) {
      const errors = [];

      loader.on('error', () => errors.push(loader.error()));

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(errors.length, 0, 'no errors');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(errors.length, 0, 'no errors');
      });
    });

    QUnit.test('dispose cleans up transmuxer', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        loader.playlist(playlistWithDuration(20));
        const transmuxer = loader.transmuxer_;

        const origTransmuxerTerminate = transmuxer.terminate.bind(transmuxer);
        let transmuxerTerminateCount = 0;

        transmuxer.terminate = () => {
          transmuxerTerminateCount++;
          origTransmuxerTerminate();
        };

        loader.load();
        this.clock.tick(1);
        loader.dispose();

        assert.equal(transmuxerTerminateCount, 1, 'terminated transmuxer');
        assert.ok(!transmuxer.currentTransmux, 'no current transmux');
        assert.equal(transmuxer.transmuxQueue.length, 0, 'no queue');
      });
    });

    QUnit.test('calling remove removes cues', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // load a segment as we can't remove if nothing's been appended
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        const removedCues = [];

        loader.inbandTextTracks_ = {
          CC1: {
            removeCue(cue) {
              removedCues.push(cue);
              this.cues.splice(this.cues.indexOf(cue), 1);
            },
            cues: [
              {startTime: 10, endTime: 20, text: 'delete me'},
              {startTime: 0, endTime: 2, text: 'save me'}
            ]
          }
        };

        loader.remove(10, 20);

        assert.strictEqual(
          loader.inbandTextTracks_.CC1.cues.length,
          1,
          'one cue remains after remove'
        );
        assert.strictEqual(
          removedCues[0].text,
          'delete me',
          'the cue that overlapped the remove region was removed'
        );
      });
    });

    QUnit.test('calling remove handles absence of cues (null)', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // load a segment as we can't remove if nothing's been appended
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        loader.inbandTextTracks_ = {
          CC1: {
            cues: null
          }
        };

        // this call should not raise an exception
        loader.remove(3, 10);

        assert.strictEqual(loader.inbandTextTracks_.CC1.cues, null, 'cues are still null');
      });
    });

    QUnit.test('only removes video when audio disabled', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // load a segment as we can't remove if nothing's been appended
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        loader.setAudio(false);

        const audioRemoves = [];
        const videoRemoves = [];

        loader.sourceUpdater_.removeAudio = (start, end) => {
          audioRemoves.push({start, end});
        };
        loader.sourceUpdater_.removeVideo = (start, end) => {
          videoRemoves.push({start, end});
        };

        loader.remove(3, 10);

        assert.equal(audioRemoves, 0, 'did not remove from audio buffer');
        assert.equal(videoRemoves.length, 1, 'removed from video buffer');
        assert.deepEqual(videoRemoves[0], {start: 3, end: 10}, 'removed the right range');
      });
    });

    QUnit.test('removes audio when audio disabled', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {

        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // load a segment as we can't remove if nothing's been appended
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        const audioRemoves = [];
        const videoRemoves = [];

        loader.sourceUpdater_.removeAudio = (start, end) => {
          audioRemoves.push({start, end});
        };
        loader.sourceUpdater_.removeVideo = (start, end) => {
          videoRemoves.push({start, end});
        };

        loader.setAudio(false);
        assert.equal(videoRemoves.length, 0, 'no video removes');
        assert.equal(audioRemoves.length, 1, 'removed audio from the buffer');
        assert.deepEqual(audioRemoves[0], {start: 0, end: loader.duration_()}, 'removed the right range');

      });
    });

    QUnit.test('does not remove until starting media info', function(assert) {
      let audioRemoves = 0;
      let videoRemoves = 0;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        loader.sourceUpdater_.removeAudio = (start, end) => {
          audioRemoves++;
        };
        loader.sourceUpdater_.removeVideo = (start, end) => {
          videoRemoves++;
        };

        // segment is requested but not yet downloaded, therefore there's no starting
        // media info
        //
        // callback won't be called
        loader.remove(0, 100, () => {});
        assert.equal(audioRemoves, 0, 'no audio removes');
        assert.equal(videoRemoves, 0, 'no video removes');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        loader.remove(0, 100, () => {});
        assert.equal(audioRemoves, 1, 'one audio remove');
        assert.equal(videoRemoves, 1, 'one video remove');
      });
    });

    QUnit.test('does not remove when end <= start', function(assert) {
      let audioRemoves = 0;
      let videoRemoves = 0;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        loader.sourceUpdater_.removeAudio = (start, end) => {
          audioRemoves++;
        };
        loader.sourceUpdater_.removeVideo = (start, end) => {
          videoRemoves++;
        };

        assert.equal(audioRemoves, 0, 'no audio removes');
        assert.equal(videoRemoves, 0, 'no video removes');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        loader.remove(0, 0, () => {});
        assert.equal(audioRemoves, 0, 'no audio remove');
        assert.equal(videoRemoves, 0, 'no video remove');

        loader.remove(5, 4, () => {});
        assert.equal(audioRemoves, 0, 'no audio remove');
        assert.equal(videoRemoves, 0, 'no video remove');

        loader.remove(0, 4, () => {});
        assert.equal(audioRemoves, 1, 'valid remove works');
        assert.equal(videoRemoves, 1, 'valid remove works');
      });
    });

    QUnit.test('triggers appenderror when append errors', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appenderror', resolve);
          loader.one('error', reject);

          const playlist = playlistWithDuration(40);

          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // mocking in this case because it's hard to find a good append error that will
          // 1) work across browsers
          // 2) won't cause an error in the transmuxer first
          loader.sourceUpdater_.appendBuffer = ({type, bytes}, callback) => {
            callback({type: 'error'});
          };

          standardXHRResponse(this.requests.shift(), muxedSegment());

        });
      }).then(() => {
        assert.deepEqual(
          loader.error_,
          {
            message: 'video append of 2960b failed for segment #0 in playlist playlist.m3u8',
            metadata: {
              errorType: 'segment-append-error'
            }
          },
          'loader triggered and saved the appenderror'
        );
      });
    });

    QUnit.test('appends init segments initially', function(assert) {
      const appends = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');
      });
    });

    QUnit.test('does not append init segments after first', function(assert) {
      const appends = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 4, 'two more appends');
        assert.equal(appends[2].type, 'video', 'appended to video buffer');
        assert.notOk(appends[2].initSegment, 'did not append video init segment');
        assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
        assert.notOk(appends[3].initSegment, 'did not append audio init segment');
      });
    });

    QUnit.test('does not re-append audio init segment when audio only', function(assert) {
      const appends = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, { isAudioOnly: true }).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 1, 'one append');
        assert.equal(appends[0].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[0].initSegment, 'appended audio init segment');

        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more append');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.notOk(appends[1].initSegment, 'did not append audio init segment');
      });
    });

    QUnit.test('re-appends audio init segment on playlist changes', function(assert) {
      const appends = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isAudioOnly: true}).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), audioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(appends.length, 1, 'one append');
        assert.equal(appends[0].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[0].initSegment, 'appended audio init segment');

        // new playlist for an audio only loader would mean an audio track change
        loader.playlist(playlistWithDuration(20, { uri: 'new-playlist.m3u8' }));
        // remove old aborted request
        this.requests.shift();
        // get the new request
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), audioSegment());
        // since it's a sync request, wait for the syncinfoupdate event (we won't get the
        // appended event)
        return new Promise((resolve, reject) => {
          loader.one('syncinfoupdate', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more appends');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');
      });
    });

    QUnit.test('re-appends video init segment on playlist changes', function(assert) {
      const appends = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), videoSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 1, 'one append');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');

        loader.playlist(playlistWithDuration(20, { uri: 'new-playlist.m3u8' }));
        // remove old aborted request
        this.requests.shift();
        // get the new request
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), videoSegment());
        // since it's a sync request, wait for the syncinfoupdate event (we won't get the
        // appended event)
        return new Promise((resolve, reject) => {
          loader.one('syncinfoupdate', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more append');
        assert.equal(appends[1].type, 'video', 'appended to video buffer');
        assert.ok(appends[1].initSegment, 'appended video init segment');
      });
    });

    QUnit.skip('sync request can be thrown away', function(assert) {
      const appends = [];
      const logs = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {

        // set the mediaSource duration as it is usually set by
        // main playlist controller, which is not present here
        loader.mediaSource_.duration = Infinity;

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

          loader.appendToSourceBuffer_ = (config) => {
            appends.push(config);
            origAppendToSourceBuffer(config);
          };

          loader.playlist(playlistWithDuration(20));
          loader.load();
          this.clock.tick(1);
          standardXHRResponse(this.requests.shift(), videoSegment());

        });
      }).then(() => {
        return new Promise((resolve, reject) => {
          // since it's a sync request, wait for the syncinfoupdate event (we won't get the
          // appended event)
          this.clock.tick(1);

          assert.equal(appends.length, 1, 'one append');
          assert.equal(appends[0].type, 'video', 'appended to video buffer');
          assert.ok(appends[0].initSegment, 'appended video init segment');

          loader.playlist(playlistWithDuration(20, { uri: 'new-playlist.m3u8' }));
          // remove old aborted request
          this.requests.shift();
          // get the new request
          this.clock.tick(1);
          loader.chooseNextRequest_ = () => ({partIndex: null, mediaIndex: 1});
          loader.logger_ = (line) => {
            logs.push(line);
          };
          loader.one('syncinfoupdate', function() {
            resolve();
          });
          loader.one('error', reject);
          standardXHRResponse(this.requests.shift(), videoSegment());

        });
      }).then(() => {
        this.clock.tick(1);
        assert.equal(appends.length, 1, 'still only one append');
        assert.true(
          logs.some((l) => (/^sync segment was incorrect, not appending/).test(l)),
          'has log line'
        );
        assert.true(
          logs.some((l) => (/^Throwing away un-appended sync request segment/).test(l)),
          'has log line'
        );
      });
    });

    QUnit.test('re-appends init segments on discontinuity', function(assert) {
      const appends = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20, { discontinuityStarts: [1] }));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {

        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 4, 'two more appends');
        assert.equal(appends[2].type, 'video', 'appended to video buffer');
        assert.ok(appends[2].initSegment, 'appended video init segment');
        assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[3].initSegment, 'appended audio init segment');
      });
    });

    QUnit.test('re-appends init segments after different trackinfo', function(assert) {
      const appends = [];
      const oldTrackInfo = loader.handleTrackInfo_;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());

        loader.handleTrackInfo_ = (simpleSegment, trackInfo) => {
          trackInfo.foo = true;
          return oldTrackInfo.call(loader, simpleSegment, trackInfo);
        };

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');

        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 4, 'two more appends');
        assert.equal(appends[2].type, 'video', 'appended to video buffer');
        assert.ok(appends[2].initSegment, 'appended video init segment');
        assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[3].initSegment, 'appended audio init segment');
      });
    });

    QUnit.test('stores and reuses audio init segments from map tag', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio',
        segmentMetadataTrack: this.segmentMetadataTrack
      }), {});
      const appends = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isAudioOnly: true}).then(() => {
        const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

        loader.appendToSourceBuffer_ = (config) => {
          appends.push(config);
          origAppendToSourceBuffer(config);
        };

        const playlist = playlistWithDuration(40);

        playlist.segments[0].map = {
          resolvedUri: 'init.mp4',
          byterange: { length: Infinity, offset: 0 }
        };
        // change the map tag as we won't re-append the init segment if it hasn't changed
        playlist.segments[1].map = {
          resolvedUri: 'init2.mp4',
          byterange: { length: 100, offset: 10 }
        };
        // reuse the initial map to see if it was cached
        playlist.segments[2].map = {
          resolvedUri: 'init.mp4',
          byterange: { length: Infinity, offset: 0 }
        };

        playlist.segments[3].map = {
          resolvedUri: 'init.mp4',
          byterange: { length: Infinity, offset: 0 }
        };

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // The main loader has to be the first to load a segment, so fake a main timeline
        // change.
        this.timelineChangeController.lastTimelineChange({
          type: 'main',
          from: -1,
          to: 0
        });

        // init
        standardXHRResponse(this.requests.shift(), mp4AudioInitSegment());
        // segment
        standardXHRResponse(this.requests.shift(), mp4AudioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 1, 'one append');
        assert.equal(appends[0].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[0].initSegment, 'appended audio init segment');

        // init
        standardXHRResponse(this.requests.shift(), mp4AudioInitSegment());
        // segment
        standardXHRResponse(this.requests.shift(), mp4AudioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more append');
        assert.equal(appends[1].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended audio init segment');
        assert.notEqual(
          appends[0].initSegment,
          appends[1].initSegment,
          'appended a different init segment'
        );
        // force init segment append to prove that init segments are not
        // re-requested, but will be re-appended when needed.
        loader.appendInitSegment_.audio = true;

        // no init segment request, as it should be the same (and cached) segment
        standardXHRResponse(this.requests.shift(), mp4AudioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 3, 'one more append');
        assert.equal(appends[2].type, 'audio', 'appended to audio buffer');
        assert.ok(appends[2].initSegment, 'appended audio init segment');
        assert.equal(
          appends[0].initSegment,
          appends[2].initSegment,
          'reused the init segment'
        );

        // no init segment request, as it should be the same (and cached) segment
        standardXHRResponse(this.requests.shift(), mp4AudioSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(appends.length, 4, 'one more append');
        assert.equal(appends[3].type, 'audio', 'appended to audio buffer');
        assert.notOk(appends[3].initSegment, 'did not append audio init segment');
      });
    });

    QUnit.test('stores and reuses video init segments from map tag', function(assert) {
      const appends = [];

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_, {isVideoOnly: true}).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
          const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);

          loader.appendToSourceBuffer_ = (config) => {
            appends.push(config);
            origAppendToSourceBuffer(config);
          };

          const playlist = playlistWithDuration(40);

          playlist.segments[0].map = {
            resolvedUri: 'init.mp4',
            byterange: { length: Infinity, offset: 0 }
          };
          // change the map tag as we won't re-append the init segment if it hasn't changed
          playlist.segments[1].map = {
            resolvedUri: 'init2.mp4',
            byterange: { length: 100, offset: 10 }
          };
          // reuse the initial map to see if it was cached
          playlist.segments[2].map = {
            resolvedUri: 'init.mp4',
            byterange: { length: Infinity, offset: 0 }
          };

          playlist.segments[3].map = {
            resolvedUri: 'init.mp4',
            byterange: { length: Infinity, offset: 0 }
          };

          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // init
          standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
          // segment
          standardXHRResponse(this.requests.shift(), mp4VideoSegment());
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 1, 'one append');
        assert.equal(appends[0].type, 'video', 'appended to video buffer');
        assert.ok(appends[0].initSegment, 'appended video init segment');

        // init
        standardXHRResponse(this.requests.shift(), mp4VideoInitSegment());
        // segment
        standardXHRResponse(this.requests.shift(), mp4VideoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'one more append');
        assert.equal(appends[1].type, 'video', 'appended to audio buffer');
        assert.ok(appends[1].initSegment, 'appended video init segment');
        assert.notEqual(
          appends[0].initSegment,
          appends[1].initSegment,
          'appended a different init segment'
        );

        // force init segment append to prove that init segments are not
        // re-requested, but will be re-appended when needed.
        loader.appendInitSegment_.video = true;

        // no init segment request, as it should be the same (and cached) segment
        standardXHRResponse(this.requests.shift(), mp4VideoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 3, 'one more append');
        assert.equal(appends[2].type, 'video', 'appended to video buffer');
        assert.ok(appends[2].initSegment, 'appended video init segment');
        assert.equal(
          appends[0].initSegment,
          appends[2].initSegment,
          'reused the init segment'
        );

        // no init segment request, as it should be the same (and cached) segment
        standardXHRResponse(this.requests.shift(), mp4VideoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(appends.length, 4, 'one more append');
        assert.equal(appends[3].type, 'video', 'appended to video buffer');
        assert.notOk(appends[3].initSegment, 'did not append video init segment');
      });
    });

    QUnit.test('waits to set source buffer timestamp offsets if zero data segment', function(assert) {
      const appends = [];
      const audioTimestampOffsets = [];
      const videoTimestampOffsets = [];
      const transmuxerTimestampOffsets = [];
      const sourceUpdater = loader.sourceUpdater_;

      // Mock text tracks on the mock tech because the segment contains text track data
      loader.inbandTextTracks_ = {};
      loader.vhs_.tech_.addRemoteTextTrack = () => {
        return { track: { addCue: () => {} } };
      };

      return this.setupMediaSource(loader.mediaSource_, sourceUpdater).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          const origAppendToSourceBuffer = loader.appendToSourceBuffer_.bind(loader);
          const origAudioTimestampOffset =
            sourceUpdater.audioTimestampOffset.bind(sourceUpdater);
          const origVideoTimestampOffset =
            sourceUpdater.videoTimestampOffset.bind(sourceUpdater);
          const origTransmuxerPostMessage =
            loader.transmuxer_.postMessage.bind(loader.transmuxer_);

          // Keep track of appends and changes in timestamp offset to verify the right
          // number of each were set.
          loader.appendToSourceBuffer_ = (config) => {
            appends.push(config);
            origAppendToSourceBuffer(config);
          };
          sourceUpdater.audioTimestampOffset = (offset) => {
            if (!offset) {
              return audioTimestampOffsets.length ?
                audioTimestampOffsets[audioTimestampOffsets.length - 1] : -1;
            }
            audioTimestampOffsets.push(offset);
            origAudioTimestampOffset(offset);
          };
          sourceUpdater.videoTimestampOffset = (offset) => {
            if (!offset) {
              return videoTimestampOffsets.length ?
                videoTimestampOffsets[videoTimestampOffsets.length - 1] : -1;
            }
            videoTimestampOffsets.push(offset);
            origVideoTimestampOffset(offset);
          };
          loader.transmuxer_.postMessage = (message) => {
            if (message.action === 'setTimestampOffset') {
              transmuxerTimestampOffsets.push(message.timestampOffset);
            }
            origTransmuxerPostMessage(message);
          };

          // Load the playlist and the zero length segment. Note that the zero length
          // segment is the first loaded segment, as it's an easy case for when a timestamp
          // offset should be set, except in this case, when the first segment has no audio
          // or video data.
          loader.playlist(playlistWithDuration(20));
          loader.load();
          this.clock.tick(1);
          standardXHRResponse(this.requests.shift(), zeroLengthSegment());
        });
      }).then(() => {
        assert.equal(appends.length, 0, 'zero appends');
        assert.equal(
          audioTimestampOffsets.length,
          0,
          'zero audio source buffer timestamp offsets'
        );
        assert.equal(
          videoTimestampOffsets.length,
          0,
          'zero video source buffer timestamp offsets'
        );
        // unlike the source buffer, which won't have data appended yet, the transmuxer
        // timestamp offset should be updated since there may be ID3 data or metadata
        assert.equal(
          transmuxerTimestampOffsets.length,
          1,
          'one transmuxer timestamp offset'
        );

        // Load the second segment, this time with audio and video data, and ensure that
        // after its append the timestamp offset values are set.
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        assert.equal(appends.length, 2, 'two appends');
        assert.equal(
          audioTimestampOffsets.length,
          1,
          'one audio source buffer timestamp offset'
        );
        assert.equal(
          videoTimestampOffsets.length,
          1,
          'one video source buffer timestamp offset'
        );
        assert.equal(
          transmuxerTimestampOffsets.length,
          2,
          'another transmuxer timestamp offset'
        );
      });
    });

    QUnit.test('sets timestamp offset on timeline changes but not if segment start is early', function(assert) {
      const audioTimestampOffsets = [];
      const videoTimestampOffsets = [];
      const transmuxerTimestampOffsets = [];
      const sourceUpdater = loader.sourceUpdater_;
      let buffered = createTimeRanges();
      let timestampOffsetOverride;

      loader.buffered_ = () => buffered;

      return this.setupMediaSource(loader.mediaSource_, sourceUpdater).then(() => {
        const origAudioTimestampOffset =
          sourceUpdater.audioTimestampOffset.bind(sourceUpdater);
        const origVideoTimestampOffset =
          sourceUpdater.videoTimestampOffset.bind(sourceUpdater);
        const origTransmuxerPostMessage =
          loader.transmuxer_.postMessage.bind(loader.transmuxer_);

        // Keep track of timestamp offsets change to verify the right number were set.
        sourceUpdater.audioTimestampOffset = (offset) => {
          if (!offset) {
            if (timestampOffsetOverride) {
              return timestampOffsetOverride;
            }
            return audioTimestampOffsets.length ?
              audioTimestampOffsets[audioTimestampOffsets.length - 1] : -1;
          }
          audioTimestampOffsets.push(offset);
          origAudioTimestampOffset(offset);
        };
        sourceUpdater.videoTimestampOffset = (offset) => {
          if (!offset) {
            if (timestampOffsetOverride) {
              return timestampOffsetOverride;
            }
            return videoTimestampOffsets.length ?
              videoTimestampOffsets[videoTimestampOffsets.length - 1] : -1;
          }
          videoTimestampOffsets.push(offset);
          origVideoTimestampOffset(offset);
        };
        loader.transmuxer_.postMessage = (message) => {
          if (message.action === 'setTimestampOffset') {
            transmuxerTimestampOffsets.push(message.timestampOffset);
          }
          origTransmuxerPostMessage(message);
        };

        // Load the playlist and the first segment, as normal.
        loader.playlist(playlistWithDuration(20));
        loader.load();
        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(
          audioTimestampOffsets.length,
          1,
          'one audio source buffer timestamp offset'
        );
        assert.equal(
          videoTimestampOffsets.length,
          1,
          'one video source buffer timestamp offset'
        );
        assert.equal(
          transmuxerTimestampOffsets.length,
          1,
          'one transmuxer timestamp offset'
        );

        // Mock the buffer and timestamp offset to pretend the first segment had data from
        // 11 to 21 seconds, normalized to 0 to 10 seconds in player time via a timestamp
        // offset of 11.
        //
        // The next segment will use the buffered end of 10 seconds as its starting value,
        // which starts before the timestamp offset of 11. However, even though the segment
        // start is before the timestamp offset, it should be appended without changing the
        // timestamp offset, as issues were seen when the timestamp offset was changed
        // without an actual timeline change.
        buffered = createTimeRanges([[0, 10]]);
        timestampOffsetOverride = 11;

        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.equal(
          audioTimestampOffsets.length,
          1,
          'no extra audio source buffer timestamp offset'
        );
        assert.equal(
          videoTimestampOffsets.length,
          1,
          'no extra video source buffer timestamp offset'
        );
        assert.equal(
          transmuxerTimestampOffsets.length,
          1,
          'no extra transmuxer timestamp offset'
        );
      });
    });

    QUnit.test('main buffered uses video buffer when audio disabled', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 3], [5, 6]]),
          'buffered reports intersection of audio and video buffers'
        );
        loader.setAudio(false);
        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 6]]),
          'buffered reports video buffered'
        );
      });
    });

    QUnit.test('main buffered uses video buffer when video only', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), videoSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 6]]),
          'buffered reports video buffered'
        );
        loader.setAudio(false);
        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 6]]),
          'buffered reports video buffered'
        );
      });
    });

    QUnit.test('main buffered uses audio buffer when audio only', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          const playlist = playlistWithDuration(40);

          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // need to load content to have starting media
          standardXHRResponse(this.requests.shift(), audioSegment());
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 3], [5, 7]]),
          'buffered reports audio buffered'
        );
        // note that there currently is no proper support for audio only with alt audio,
        // so the setAudio(false) test can be skipped
      });
    });

    QUnit.test('audio buffered uses audio buffer', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      this.fakeMainTimelineChange();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);

          const playlist = playlistWithDuration(40);

          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // need to load content to have starting media
          standardXHRResponse(this.requests.shift(), audioSegment());
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 3], [5, 7]]),
          'buffered reports audio buffered'
        );
      });
    });

    QUnit.test('audio buffered uses audio buffer even when muxed', function(assert) {
      loader.dispose();
      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'audio'
      }), {});

      this.fakeMainTimelineChange();

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 3], [5, 7]]),
          'buffered reports audio buffered'
        );
      });
    });

    QUnit.test('can get buffered between playlists', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // need to load content to have starting media
        standardXHRResponse(this.requests.shift(), muxedSegment());
        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // mock the buffered values (easiest solution to test that segment-loader is
        // calling the correct functions)
        loader.sourceUpdater_.audioBuffered =
          () => createTimeRanges([[2, 3], [5, 7]]);
        loader.sourceUpdater_.videoBuffered =
          () => createTimeRanges([[2, 6]]);
        loader.sourceUpdater_.buffered =
          () => createTimeRanges([[2, 3], [5, 6]]);

        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 3], [5, 6]]),
          'buffered reports intersection of audio and video buffers'
        );
        const playlist2 = playlistWithDuration(40, {uri: 'playlist2.m3u8'});

        loader.playlist(playlist2);

        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 3], [5, 6]]),
          'buffered reports intersection of audio and video buffers'
        );

        loader.load();

        timeRangesEqual(
          loader.buffered_(),
          createTimeRanges([[2, 3], [5, 6]]),
          'buffered reports intersection of audio and video buffers'
        );
      });
    });

    QUnit.test('saves bandwidth when segment duration is >= min to record', function(assert) {
      const stats = {
        bytesReceived: 100,
        bandwidth: 101,
        roundTrip: 102
      };

      loader.bandwidth = 999;
      // used for updating byte length
      loader.pendingSegment_ = {};
      loader.saveBandwidthRelatedStats_(0.04, stats);

      assert.equal(loader.bandwidth, 101, 'saved bandwidth');
    });

    QUnit.test('does not save bandwidth when segment duration is < min to record', function(assert) {
      const stats = {
        bytesReceived: 100,
        bandwidth: 101,
        roundTrip: 102
      };

      loader.bandwidth = 999;
      // used for updating byte length
      loader.pendingSegment_ = {};
      loader.saveBandwidthRelatedStats_(0.01, stats);

      assert.equal(loader.bandwidth, 999, 'did not save bandwidth');
    });

    QUnit.test('saves throughput when segment duration is >= min to record', function(assert) {
      const segmentInfo = {
        duration: 0.04,
        rate: 101,
        endOfAllRequests: Date.now(),
        byteLength: 100
      };

      loader.throughput = {
        rate: 1000,
        count: 1
      };
      loader.recordThroughput_(segmentInfo);

      // easier to assert not equal than deal with mocking dates
      assert.notEqual(loader.throughput.rate, 1000, 'saved throughput');
      assert.equal(loader.throughput.count, 2, 'saved throughput');
    });

    QUnit.test('does not save throughput when segment duration is < min to record', function(assert) {
      const segmentInfo = {
        duration: 0.01,
        rate: 101,
        endOfAllRequests: Date.now(),
        byteLength: 100
      };

      loader.throughput = {
        rate: 1000,
        count: 1
      };
      loader.recordThroughput_(segmentInfo);

      assert.equal(loader.throughput.rate, 1000, 'did not save throughput');
      assert.equal(loader.throughput.count, 1, 'did not save throughput');
    });

    QUnit.test('sets correct video start time for large DTS value', function(assert) {
      const playlist = playlistWithDuration(40);
      const {
        mediaSource_: mediaSource,
        sourceUpdater_: sourceUpdater
      } = loader;
      const mediaSettings = { isVideoOnly: true };

      return this.setupMediaSource(mediaSource, sourceUpdater, mediaSettings).then(() => {
        loader.playlist(playlist);
        loader.load();

        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), videoLargeOffsetSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        const segment = playlist.segments[0];

        assert.equal(segment.start, 0, 'set start to 0');
        assert.equal(
          segment.videoTimingInfo.transmuxedDecodeEnd,
          // the segment's DTS (2^32 + 1) + segment's duration (6006 clock cycles),
          // divided by 90khz clock to get seconds
          (Math.pow(2, 32) + 1 + 6006) / 90000,
          'set proper transmuxed decode end'
        );

        standardXHRResponse(this.requests.shift(), videoLargeOffset2Segment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        const segment = playlist.segments[1];

        assert.equal(
          segment.start.toFixed(6),
          // since this is the second segment, it should start at the first segment's
          // duration (6006 clock cycles divided by 90khz clock to get seconds)
          (6006 / 90000).toFixed(6),
          'set correct start'
        );
        assert.equal(
          segment.videoTimingInfo.transmuxedDecodeEnd,
          // the segment's DTS (2^32 + 1 + 6006) + this segment's duration of 6006,
          // divided by 90khz clock to get seconds
          (Math.pow(2, 32) + 1 + (6006 * 2)) / 90000,
          'set proper transmuxed decode end'
        );
      });
    });

    QUnit.test('sets correct video start time with rollover', function(assert) {
      const playlist = playlistWithDuration(40);
      const {
        mediaSource_: mediaSource,
        sourceUpdater_: sourceUpdater
      } = loader;
      const mediaSettings = { isVideoOnly: true };

      return this.setupMediaSource(mediaSource, sourceUpdater, mediaSettings).then(() => {
        loader.playlist(playlist);
        loader.load();

        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), videoMaxOffsetSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        const segment = playlist.segments[0];

        assert.equal(segment.start, 0, 'set start to 0');
        assert.equal(
          segment.videoTimingInfo.transmuxedDecodeEnd,
          // Segment's ending DTS (max DTS) divided by 90khz clock to get seconds.
          //
          // Note that this segment is meant to end exactly at the max DTS of 2^33. The
          // starting DTS should be 2^33 - 6006 (the segment's duration).
          Math.pow(2, 33) / 90000,
          'set proper transmuxed decode end'
        );

        standardXHRResponse(this.requests.shift(), videoMinOffsetSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        const segment = playlist.segments[1];

        assert.equal(
          segment.start.toFixed(6),
          // since this is the second segment, it should start at the first segment's
          // duration (6006 clock cycles divided by 90khz clock to get seconds)
          (6006 / 90000).toFixed(6),
          'set correct start'
        );
        assert.equal(
          segment.videoTimingInfo.transmuxedDecodeEnd,
          // previous segment's ending DTS (max DTS) + duration of this segment (6006),
          // divided by 90khz clock to get seconds
          //
          // This is verifying that we handled rollover. If we didn't handle rollover, then
          // the DTS of this segment would be 0 + 6006, the segment's DTS + duration. These
          // are the values you'd see when probing the segment alone, without a reference
          // to a prior segment. But our rollover handling adds the max value of 2^33 to
          // the timestamp values, since it detected from the prior segment that we reached
          // the max value for a timestamp of 2^33, and since JavaScript can handle values
          // larger than 2^33 in value, it does the addition from the player side.
          (Math.pow(2, 33) + (6006)) / 90000,
          'set proper transmuxed decode end greater than rollover value'
        );
      });
    });

    QUnit.test('sets correct audio start time for large DTS value', function(assert) {
      const playlist = playlistWithDuration(40);
      const {
        mediaSource_: mediaSource,
        sourceUpdater_: sourceUpdater
      } = loader;
      const mediaSettings = { isAudioOnly: true };

      return this.setupMediaSource(mediaSource, sourceUpdater, mediaSettings).then(() => {
        loader.playlist(playlist);
        loader.load();

        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), audioLargeOffsetSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        const segment = playlist.segments[0];

        assert.equal(segment.start, 0, 'set start to 0');
        assert.equal(
          segment.audioTimingInfo.transmuxedDecodeEnd.toFixed(4),
          // the segment's DTS (2^32 + 1) + segment's duration (11520 clock cycles),
          // divided by 90khz clock to get seconds
          ((Math.pow(2, 32) + 1 + 11520) / 90000).toFixed(4),
          'set proper transmuxed decode end'
        );

        standardXHRResponse(this.requests.shift(), audioLargeOffset2Segment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        const segment = playlist.segments[1];

        assert.equal(
          segment.start.toFixed(6),
          // since this is the second segment, it should start at the first segment's
          // duration (11520 clock cycles divided by 90khz clock to get seconds)
          (11520 / 90000).toFixed(6),
          'set correct start'
        );
        assert.equal(
          segment.audioTimingInfo.transmuxedDecodeEnd.toFixed(4),
          // the segment's DTS (2^32 + 1 + 11520) + this segment's duration of 11520,
          // divided by 90khz clock to get seconds
          ((Math.pow(2, 32) + 1 + (11520 * 2)) / 90000).toFixed(4),
          'set proper transmuxed decode end'
        );
      });
    });

    QUnit.test('sets correct audio start time with rollover', function(assert) {
      const playlist = playlistWithDuration(40);
      const {
        mediaSource_: mediaSource,
        sourceUpdater_: sourceUpdater
      } = loader;
      const mediaSettings = { isAudioOnly: true };

      return this.setupMediaSource(mediaSource, sourceUpdater, mediaSettings).then(() => {
        loader.playlist(playlist);
        loader.load();

        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), audioMaxOffsetSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        const segment = playlist.segments[0];

        assert.equal(segment.start, 0, 'set start to 0');
        assert.equal(
          segment.audioTimingInfo.transmuxedDecodeEnd.toFixed(5),
          // Segment's ending DTS (max DTS) divided by 90khz clock to get seconds.
          //
          // Note that this segment is meant to end exactly at the max DTS of 2^33. The
          // starting DTS should be 2^33 - 11520 (the segment's duration).
          (Math.pow(2, 33) / 90000).toFixed(5),
          'set proper transmuxed decode end'
        );

        standardXHRResponse(this.requests.shift(), audioMinOffsetSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        const segment = playlist.segments[1];

        assert.equal(
          segment.start.toFixed(6),
          // since this is the second segment, it should start at the first segment's
          // duration (11520 clock cycles divided by 90khz clock to get seconds)
          (11520 / 90000).toFixed(6),
          'set correct start'
        );
        assert.equal(
          segment.audioTimingInfo.transmuxedDecodeEnd.toFixed(5),
          // previous segment's ending DTS (max DTS) + duration of this segment (11520),
          // divided by 90khz clock to get seconds
          //
          // This is verifying that we handled rollover. If we didn't handle rollover, then
          // the DTS of this segment would be 0 + 6006, the segment's DTS + duration. These
          // are the values you'd see when probing the segment alone, without a reference
          // to a prior segment. But our rollover handling adds the max value of 2^33 to
          // the timestamp values, since it detected from the prior segment that we reached
          // the max value for a timestamp of 2^33, and since JavaScript can handle values
          // larger than 2^33 in value, it does the addition from the player side.
          ((Math.pow(2, 33) + (11520)) / 90000).toFixed(5),
          'set proper transmuxed decode end greater than rollover value'
        );
      });
    });

    QUnit.test('PDT mapping updated before loader starts loading', function(assert) {
      const targetDuration = 1;
      const playlistOptions = {
        targetDuration,
        discontinuityStarts: [2],
        // make it a live playlist so that removing segments from beginning is allowed
        endList: false
      };
      const playlistDuration = 4;
      const playlist1 = playlistWithDuration(
        playlistDuration,
        // need different URIs to ensure the playlists are considered different
        merge(playlistOptions, { uri: 'playlist1.m3u8' })
      );
      const playlist2 = playlistWithDuration(
        playlistDuration,
        merge(playlistOptions, { uri: 'playlist2.m3u8' })
      );

      const segmentDurationMs = targetDuration * 1000;

      const playlist1Start = new Date('2021-01-01T00:00:00.000-05:00');

      playlist1.segments[0].dateTimeObject = playlist1Start;
      playlist1.segments[1].dateTimeObject = new Date(playlist1Start.getTime() + segmentDurationMs);
      // jump of 0.5 seconds after disco (0.5 seconds of missing real world time, e.g.,
      // an encoder went down briefly), should have a PDT mapping difference of -3.5
      // seconds from first mapping
      playlist1.segments[2].dateTimeObject = new Date(playlist1.segments[1].dateTimeObject.getTime() + segmentDurationMs + 500);
      playlist1.segments[3].dateTimeObject = new Date(playlist1.segments[2].dateTimeObject.getTime() + segmentDurationMs);

      // offset by 0.25 seconds from playlist1
      const playlist2Start = new Date('2021-01-01T00:00:00.250-05:00');

      playlist2.segments[0].dateTimeObject = playlist2Start;
      playlist2.segments[1].dateTimeObject = new Date(playlist2Start.getTime() + segmentDurationMs);
      // jump of 0.5 seconds after disco (0.5 seconds of missing real world time, e.g.,
      // an encoder went down briefly), should have a PDT mapping difference of -3.5
      // seconds from first mapping
      playlist2.segments[2].dateTimeObject = new Date(playlist2.segments[1].dateTimeObject.getTime() + segmentDurationMs + 500);
      playlist2.segments[3].dateTimeObject = new Date(playlist2.segments[2].dateTimeObject.getTime() + segmentDurationMs);

      const {
        mediaSource_: mediaSource,
        sourceUpdater_: sourceUpdater
      } = loader;
      const mediaSettings = { isVideoOnly: true };

      return this.setupMediaSource(mediaSource, sourceUpdater, mediaSettings).then(() => {
        loader.playlist(playlist1);

        // uses private property of sync controller because there isn't a great way
        // to really check without a whole bunch of other code
        assert.deepEqual(
          loader.syncController_.timelineToDatetimeMappings,
          { 0: -1609477200 },
          'set date time mapping to start of playlist1'
        );

        // change of playlist before load should set new 0 point
        loader.playlist(playlist2);

        assert.deepEqual(
          loader.syncController_.timelineToDatetimeMappings,
          // offset of 0.25 seconds
          { 0: -1609477200.25 },
          'set date time mapping to start of playlist2'
        );

        // changes back, because why not
        loader.playlist(playlist1);

        assert.deepEqual(
          loader.syncController_.timelineToDatetimeMappings,
          { 0: -1609477200 },
          'set date time mapping to start of playlist1'
        );

        playlist1.segments.shift();
        playlist1.mediaSequence++;
        // playlist update, first segment removed
        loader.playlist(playlist1);

        assert.deepEqual(
          loader.syncController_.timelineToDatetimeMappings,
          // 1 second later
          { 0: -1609477201 },
          'set date time mapping to new start of playlist1'
        );

        playlist1.segments.shift();
        playlist1.mediaSequence++;
        // playlist update, first two segments now removed
        loader.playlist(playlist1);

        assert.deepEqual(
          loader.syncController_.timelineToDatetimeMappings,
          // 2.5 seconds later, as this is a disco and the PDT jumped
          // note also the timeline jumped in the mapping key
          { 1: -1609477202.5 },
          'set date time mapping to post disco of playlist1'
        );

        loader.load();
      });
    });

    QUnit.test('handles PDT mappings for different timelines', function(assert) {
      const playlistDuration = 5;
      const targetDuration = 1;
      const playlistOptions = {
        targetDuration,
        discontinuityStarts: [3]
      };
      let currentTime = 0;
      // In a normal mediaIndex++ situation, the timing values will be OK even though the
      // PDT mapping changes, but when changing renditions over a timeline change, the new
      // mapping will lead to an incorrect value if the different timeline mappings are
      // not accounted for.
      const playlist1 = playlistWithDuration(
        playlistDuration,
        // need different URIs to ensure the playlists are considered different
        merge(playlistOptions, { uri: 'playlist1.m3u8' })
      );
      const playlist2 = playlistWithDuration(
        playlistDuration,
        merge(playlistOptions, { uri: 'playlist2.m3u8' })
      );

      loader.currentTime_ = () => currentTime;

      const segmentDurationMs = targetDuration * 1000;
      const segment0Start = new Date('2021-01-01T00:00:00.000-05:00');
      const segment1Start = new Date(segment0Start.getTime() + segmentDurationMs);
      const segment2Start = new Date(segment1Start.getTime() + segmentDurationMs);
      // jump of 0.5 seconds after disco (0.5 seconds of missing real world time, e.g.,
      // an encoder went down briefly), should have a PDT mapping difference of -3.5
      // seconds from first mapping
      const segment3Start = new Date(segment2Start.getTime() + segmentDurationMs + 500);

      [playlist1, playlist2].forEach((playlist) => {
        playlist.dateTimeObject = segment0Start;
        playlist.segments[0].dateTimeObject = segment0Start;
        playlist.segments[1].dateTimeObject = segment1Start;
        playlist.segments[2].dateTimeObject = segment2Start;
        playlist.segments[3].dateTimeObject = segment3Start;
      });

      const {
        mediaSource_: mediaSource,
        sourceUpdater_: sourceUpdater
      } = loader;
      const mediaSettings = { isVideoOnly: true };

      return this.setupMediaSource(mediaSource, sourceUpdater, mediaSettings).then(() => {
        loader.playlist(playlist1);
        loader.load();

        this.clock.tick(1);
        standardXHRResponse(this.requests.shift(), videoOneSecondSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), videoOneSecond1Segment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), videoOneSecond2Segment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        this.clock.tick(1);

        // responding with the first segment post discontinuity
        standardXHRResponse(this.requests.shift(), videoOneSecond3Segment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // The time needs to be at a point in time where the ProgramDateTime strategy
        // is chosen. In this case, the segments go:
        //
        // 0.ts: 0 => 1
        // 1.ts: 1 => 2
        // 2.ts: 2 => 3
        // DISCO
        // 3.ts: 3 => 4
        //
        // By setting the current time to 2.8, 2.ts should be chosen, since the closest
        // sync point will be ProgramDateTime, at a time of 3.5, though this time value is
        // wrong, since the gap in ProgramDateTime was not accounted for.
        currentTime = 2.8;
        loader.playlist(playlist2);
        loader.resetLoader();
        this.clock.tick(1);

        standardXHRResponse(this.requests.shift(), videoOneSecond2Segment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        assert.deepEqual(
          playlist1.segments[2],
          playlist2.segments[2],
          'segments are equal'
        );
      });
    });

    QUnit.test('QUOTA_EXCEEDED_ERR no loader error triggered', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // mock some buffer to prevent an error from not being able to clear any buffer
        loader.sourceUpdater_.audioBuffered = () => createTimeRanges([0, 5]);
        loader.sourceUpdater_.videoBuffered = () => createTimeRanges([0, 5]);

        loader.sourceUpdater_.appendBuffer = ({type, bytes}, callback) => {
          callback({type: 'QUOTA_EXCEEDED_ERR', code: QUOTA_EXCEEDED_ERR});
          assert.notOk(loader.error_, 'no error triggered on loader');
        };

        standardXHRResponse(this.requests.shift(), muxedSegment());
      });
    });

    QUnit.test('QUOTA_EXCEEDED_ERR triggers error if no room for single segment', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        return new Promise((resolve, reject) => {
          const playlist = playlistWithDuration(40);

          loader.playlist(playlist);
          loader.load();
          this.clock.tick(1);

          // appenderrors are fatal, we don't want them in this case
          loader.one('appenderror', reject);
          loader.one('error', resolve);

          loader.sourceUpdater_.appendBuffer = ({type, bytes}, callback) => {
            callback({type: 'QUOTA_EXCEEDED_ERR', code: QUOTA_EXCEEDED_ERR});
          };

          standardXHRResponse(this.requests.shift(), muxedSegment());

        });
      }).then(() => {
        // buffer was empty, meaning there wasn't room for a single segment from that
        // rendition
        assert.deepEqual(
          loader.error_,
          {
            message: 'Quota exceeded error with append of a single segment of content',
            excludeUntil: Infinity,
            metadata: {
              errorType: 'segment-exceeds-source-buffer-quota-error'
            }
          },
          'loader triggered and saved the error'
        );
      });
    });

    QUnit.test('QUOTA_EXCEEDED_ERR leads to clearing back buffer and retrying', function(assert) {
      const removeVideoCalls = [];
      const removeAudioCalls = [];
      let origAppendBuffer;

      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const playlist = playlistWithDuration(40);

        loader.playlist(playlist);
        loader.load();
        this.clock.tick(1);

        // mock some buffer and the playhead position
        loader.currentTime_ = () => 7;
        loader.sourceUpdater_.audioBuffered = () => createTimeRanges([2, 10]);
        loader.sourceUpdater_.videoBuffered = () => createTimeRanges([0, 10]);

        loader.sourceUpdater_.removeVideo = (start, end, done) => {
          assert.ok(loader.waitingOnRemove_, 'waiting on buffer removal to complete');
          removeVideoCalls.push({ start, end });
          done();
        };
        loader.sourceUpdater_.removeAudio = (start, end, done) => {
          assert.ok(loader.waitingOnRemove_, 'waiting on buffer removal to complete');
          removeAudioCalls.push({ start, end });
          done();
        };

        origAppendBuffer = loader.sourceUpdater_.appendBuffer;
        loader.sourceUpdater_.appendBuffer = ({type, bytes}, callback) => {
          assert.equal(removeVideoCalls.length, 0, 'no calls to remove video');
          assert.equal(removeAudioCalls.length, 0, 'no calls to remove audio');
          assert.notOk(
            loader.waitingOnRemove_,
            'loader is not waiting on buffer removal'
          );
          assert.notOk(
            loader.quotaExceededErrorRetryTimeout_,
            'loader is not waiting to retry'
          );
          assert.equal(loader.callQueue_.length, 0, 'loader has empty call queue');

          callback({type: 'QUOTA_EXCEEDED_ERR', code: QUOTA_EXCEEDED_ERR});

          assert.deepEqual(
            removeVideoCalls,
            [{ start: 0, end: 6 }],
            'removed video to one second behind playhead'
          );
          assert.deepEqual(
            removeAudioCalls,
            [{ start: 0, end: 6 }],
            'removed audio to one second behind playhead'
          );
          assert.notOk(
            loader.waitingOnRemove_,
            'loader is not waiting on buffer removal'
          );
          assert.ok(
            loader.quotaExceededErrorRetryTimeout_,
            'loader is waiting to retry'
          );
          assert.equal(loader.callQueue_.length, 1, 'loader has call waiting in queue');

          loader.sourceUpdater_.appendBuffer = origAppendBuffer;

          // wait one second for retry timeout
          this.clock.tick(1000);

          // ensure we cleared out the waiting state and call queue
          assert.notOk(
            loader.quotaExceededErrorRetryTimeout_,
            'loader is not waiting to retry'
          );
          assert.equal(loader.callQueue_.length, 0, 'loader has empty call queue');
        };

        standardXHRResponse(this.requests.shift(), muxedSegment());

        return new Promise((resolve, reject) => {
          loader.one('appended', resolve);
          loader.one('error', reject);
        });
      }).then(() => {
        // at this point the append should've successfully completed, but it's good to
        // once again check that the old state that was used was cleared out
        assert.notOk(
          loader.waitingOnRemove_,
          'loader is not waiting on buffer removal'
        );
        assert.notOk(
          loader.quotaExceededErrorRetryTimeout_,
          'loader is not waiting to retry'
        );
        assert.equal(loader.callQueue_.length, 0, 'loader has empty call queue');
      });
    });
  });
});

QUnit.module('SegmentLoader: FMP4', function(hooks) {
  hooks.beforeEach(LoaderCommonHooks.beforeEach);
  hooks.afterEach(LoaderCommonHooks.afterEach);

  LoaderCommonFactory({
    LoaderConstructor: SegmentLoader,
    loaderSettings: {loaderType: 'main'},
    // TODO change to encrypted FMP4s when supported
    //
    // This segment should be an encrypted FMP4, however, right now in the code there's no
    // support for an encrypted map tag, as the IV is not passed along. When that support
    // is added, change this segment to an encrypted FMP4.
    encryptedSegmentFn: encryptedSegment,
    encryptedSegmentKeyFn: encryptionKey
  });

  // Tests specific to the main segment loader go in this module
  QUnit.module('Loader Main', function(nestedHooks) {
    let loader;

    nestedHooks.beforeEach(function(assert) {
      this.segmentMetadataTrack = new MockTextTrack();
      this.inbandTextTracks = {
        CC1: new MockTextTrack()
      };
      this.startTime = sinon.stub(mp4probe, 'startTime');

      loader = new SegmentLoader(LoaderCommonSettings.call(this, {
        loaderType: 'main',
        segmentMetadataTrack: this.segmentMetadataTrack,
        inbandTextTracks: this.inbandTextTracks
      }), {});
    });

    nestedHooks.afterEach(function(assert) {
      this.startTime.restore();
      loader.dispose();
    });

    QUnit.test('CaptionParser messages sent as expected', function(assert) {
      return this.setupMediaSource(loader.mediaSource_, loader.sourceUpdater_).then(() => {
        const actions = {};

        loader.transmuxer_.postMessage = ({action}) => {
          if (/Mp4Captions/.test(action)) {
            actions[action] = actions[action] || 0;
            actions[action]++;
          }
        };

        loader.load();
        loader.playlist(playlistWithDuration(10, 'm4s'));
        assert.equal(this.requests.length, 0, 'have not made a request yet');

        this.clock.tick(1);
        assert.equal(this.requests.length, 1, 'made a request');
        assert.deepEqual(actions, {
          clearParsedMp4Captions: 1,
          clearAllMp4Captions: 2
        }, 'caption parser cleared as expected on load');

        // Simulate a rendition switch
        loader.resetEverything();
        assert.deepEqual(actions, {
          clearParsedMp4Captions: 2,
          clearAllMp4Captions: 3
        }, 'caption parser cleared as expected on resetEverything');

        // Simulate a discontinuity
        const originalCurrentTimeline = loader.currentTimeline_;

        loader.currentTimeline_ = originalCurrentTimeline + 1;
        assert.deepEqual(actions, {
          clearParsedMp4Captions: 2,
          clearAllMp4Captions: 3
        }, 'caption parser cleared as expected after timeline change');
        loader.currentTimeline_ = originalCurrentTimeline;

        // Add to the inband text track, then call remove
        this.inbandTextTracks.CC1.addCue({
          startTime: 1,
          endTime: 2,
          text: 'test'
        });
        loader.startingMediaInfo_ = {hasVideo: true, hasAudio: true};
        loader.remove(0, 2);
        assert.equal(this.inbandTextTracks.CC1.cues.length, 0, 'all cues have been removed');

        // Check that captions are added to track when found in the segment
        // and then captionParser is cleared
        const segment = {
          resolvedUri: '0.m4s',
          bytes: new Uint8Array([0, 0, 1]),
          map: {
            bytes: new Uint8Array([0, 0, 1])
          },
          endOfAllRequests: 0,
          captionStreams: {
            CC1: true
          }
        };
        const originalPendingSegment = loader.pendingSegment_;

        loader.pendingSegment_ = {
          segment,
          playlist: {
            syncInfo: null
          }
        };
        // prevent request from being made
        loader.loadSegment_ = (simpleSegment) => {
          // mock request finish
          loader.pendingSegment_.requestId = simpleSegment.requestId;
          loader.pendingSegment_.hasAppendedData_ = true;
          // captions were found in the request
          loader.handleCaptions_(simpleSegment, [{
            startTime: 1,
            endTime: 2,
            text: 'test',
            stream: 'CC1'
          }]);
        };
        loader.fillBuffer_();
        assert.ok(this.inbandTextTracks.CC1, 'text track created');
        assert.equal(this.inbandTextTracks.CC1.cues.length, 1, 'cue added');
        assert.deepEqual(actions, {
          clearParsedMp4Captions: 3,
          clearAllMp4Captions: 3
        }, 'caption parser cleared as expected after load');
        loader.pendingSegment_ = originalPendingSegment;

        // Dispose the loader
        loader.dispose();
      });
    });
  });
});
