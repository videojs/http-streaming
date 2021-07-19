import window from 'global/window';
import { timeRangesToArray } from './ranges';

// two space indent
const INDENT = '  ';

const timeRangesString = (timeRanges) => {
  if (!timeRanges) {
    return null;
  }

  const timeRangesArray = timeRangesToArray(timeRanges);

  const string = timeRangesArray.reduce((acc, timeRange) => {
    acc += `${timeRange.start} => ${timeRange.end}, `;
    return acc;
  }, '');

  return string.substring(0, string.length - 2);
};

const timeRangesGapsString = (timeRanges) => {
  let lastEnd = timeRanges.end(0);
  let string = '';

  for (let i = 1; i < timeRanges.length; i++) {
    if (i > 1) {
      string += ', ';
    }

    string += `${lastEnd} => ${timeRanges.start(i)}`;

    lastEnd = timeRanges.end(i);
  }

  return string;
};

const toStringOfDepth = (array, depth) => {
  if (!array) {
    return `${INDENT.repeat(depth)}null`;
  }

  return array
    // First line's indent should only be 1 since the string will already have been
    // indented to the parent level (unless it is at depth 0 already).
    .map((string, index) =>
      INDENT.repeat(index === 0 ? Math.min(depth, 1) : depth) + string)
    .join('\n');
};

const segmentInfoArr = (segmentInfo) => {
  if (!segmentInfo) {
    return null;
  }

  const {
    uri,
    mediaIndex,
    partIndex,
    isSyncRequest,
    startOfSegment,
    timestampOffset,
    timeline,
    duration,
    audioAppendStart,
    discontinuity
  } = segmentInfo;

  return [
    `uri: ${uri}`,
    `discontinuity: ${Boolean(discontinuity)}`,
    `mediaIndex: ${mediaIndex}`,
    `partIndex: ${partIndex}`,
    `isSyncRequest: ${isSyncRequest}`,
    `startOfSegment: ${startOfSegment}`,
    `timestampOffset: ${timestampOffset}`,
    `timeline: ${timeline}`,
    `duration: ${duration}`,
    `audioAppendStart: ${audioAppendStart}`
  ];
};

const playlistInfoArr = (playlist) => {
  if (!playlist) {
    return null;
  }

  const {
    endList,
    excludeUntil,
    id,
    segments,
    targetDuration,
    timeline,
    mediaSequence
  } = playlist;

  return [
    `id: ${id}`,
    `endList: ${endList}`,
    `excludeUntil: ${excludeUntil}`,
    `numSegments: ${segments ? segments.length : 'n/a'}`,
    `mediaSequence: ${mediaSequence}`,
    `targetDuration: ${targetDuration}`,
    `timeline: ${timeline}`
  ];
};

const segmentLoaderInfoArr = (loader, depth) => {
  const playlist = loader.playlist_;

  return [
    `state: ${loader.state_}`,
    `syncPoint: ${JSON.stringify(loader.syncPoint_)}`,
    'pendingSegment:',
    toStringOfDepth(segmentInfoArr(loader.pendingSegment_), depth + 1),
    'playlist:',
    toStringOfDepth(playlistInfoArr(playlist), depth + 1),
    `audioDisabled: ${loader.audioDisabled_}`,
    `callQueue length: ${loader.callQueue_.length}`,
    `loadQueue length: ${loader.loadQueue_.length}`,
    `currentTimeline: ${loader.currentTimeline_}`,
    `ended: ${loader.ended_}`,
    `error: ${loader.error_}`,
    `fetchAtBuffer: ${loader.fetchAtBuffer_}`,
    `isPendingTimestampOffset: ${loader.isPendingTimestampOffset_}`,
    `mediaIndex: ${loader.mediaIndex}`,
    `partIndex: ${loader.partIndex}`
  ];
};

export const log = (player) => {
  const mpc = player.tech(true).vhs.masterPlaylistController_;
  const mainSegmentLoader = mpc.mainSegmentLoader_;
  const audioSegmentLoader = mpc.audioSegmentLoader_;
  const sourceUpdater = mainSegmentLoader.sourceUpdater_;
  const videoBuffered = sourceUpdater.videoBuffer ?
    sourceUpdater.videoBuffer.buffered : null;
  const videoTimestampOffset = sourceUpdater.videoBuffer ?
    sourceUpdater.videoBuffer.timestampOffset : null;
  const audioBuffered = sourceUpdater.audioBuffer ?
    sourceUpdater.audioBuffer.buffered : null;
  const audioTimestampOffset = sourceUpdater.audioBuffer ?
    sourceUpdater.audioBuffer.timestampOffset : null;
  const logger = window.console;

  logger.log(toStringOfDepth([
    `currentTime: ${player.currentTime()}`,
    `seekable: ${timeRangesString(player.seekable())}`,
    `video buffered: ${timeRangesString(videoBuffered)}`,
    `audio buffered: ${timeRangesString(audioBuffered)}`,
    `seeking: ${player.seeking()}`,
    `video timestamp offset: ${videoTimestampOffset}`,
    `audio timestamp offset: ${audioTimestampOffset}`,
    '\n',
    'main segment loader:',
    toStringOfDepth(segmentLoaderInfoArr(mainSegmentLoader, 1), 1),
    '\n',
    'audio segment loader:',
    toStringOfDepth(segmentLoaderInfoArr(audioSegmentLoader, 1), 1)
  ], 0));

  const mainSyncPoint = mainSegmentLoader.syncPoint_;
  const audioSyncPoint = audioSegmentLoader.syncPoint_;

  if (mainSyncPoint && mainSyncPoint.segmentIndex < -1) {
    logger.warn(`main loader's sync point is a negative: ${JSON.stringify(mainSyncPoint)}`);
  }
  if (audioSyncPoint && audioSyncPoint.segmentIndex < -1) {
    logger.warn(`audio loader's sync point is a negative: ${JSON.stringify(audioSyncPoint)}`);
  }

  if (audioBuffered && audioBuffered.length > 1) {
    const numGaps = audioBuffered.length - 1;
    const bufferedString = timeRangesGapsString(audioBuffered);

    logger.warn(`${numGaps} gap(s) in the audio buffer: ${bufferedString}`);
  }
  if (videoBuffered && videoBuffered.length > 1) {
    const numGaps = videoBuffered.length - 1;
    const bufferedString = timeRangesGapsString(videoBuffered);

    logger.warn(`${numGaps} gap(s) in the video buffer: ${bufferedString}`);
  }

  const mainPlaylistLoader = mpc.masterPlaylistLoader_;
  const mediaTypes = mpc.mediaTypes_;
  const audioPlaylistLoader = mediaTypes.AUDIO.activePlaylistLoader;

  const mainPlaylist = mainPlaylistLoader.master;
  const mediaPlaylist = mainPlaylistLoader.media_;
  const audioPlaylist = audioPlaylistLoader && audioPlaylistLoader.media_;

  logger.log('main playlist', mainPlaylist);
  logger.log('media playlist', mediaPlaylist);

  if (audioPlaylist) {
    logger.log('audio playlist', audioPlaylist);
  }

  if (mediaPlaylist.excludeUntil) {
    logger.warn('media playlist was excluded');
  }
  if (audioPlaylist && audioPlaylist.excludeUntil) {
    logger.warn('audio playlist was excluded');
  }

  // Future Enhancements
  //
  // Go through all playlists and look for potential issues:
  // * mismatched discontinuity sequences
  // * no discontinuity sequence
  // * segment durations greater than target duration
};

export default {
  log
};
