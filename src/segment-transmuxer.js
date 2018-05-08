/* eslint-disable no-use-before-define */
// TODO: fix above!

import videojs from 'video.js';

const transmuxQueue = [];
let currentTransmux;

export const handleData_ = (event, transmuxedData, callback) => {
  const {
    type,
    initSegment,
    captions,
    captionStreams,
    metadata,
    videoDtsTime
  } = event.data.segment;

  transmuxedData.buffer.push({
    captions,
    captionStreams,
    metadata
  });

  // right now, boxes will come back from partial transmuxer, data from full
  const boxes = event.data.segment.boxes || {
    data: event.data.segment.data
  };

  const result = {
    type,
    // cast ArrayBuffer to TypedArray
    data: new Uint8Array(
      boxes.data,
      boxes.data.byteOffset,
      boxes.data.byteLength
    ),
    initSegment: new Uint8Array(
      initSegment.data,
      initSegment.byteOffset,
      initSegment.byteLength
    )
  };

  if (videoDtsTime) {
    result.videoDtsTime = videoDtsTime;
  }

  callback(result);
};

export const handleDone_ = (event, transmuxedData, complete, callback) => {
  // all buffers should have been flushed from the muxer, so start processing anything we
  // have received
  let sortedSegments = {
    captions: [],
    metadata: [],
    gopInfo: transmuxedData.gopInfo,
    captionStreams: {},
    complete
  };
  const buffer = transmuxedData.buffer;

  transmuxedData.buffer = [];

  // Sort segments into separate video/audio arrays and
  // keep track of their total byte lengths
  sortedSegments = buffer.reduce((segmentObj, segment) => {
    // Gather any captions into a single array
    if (segment.captions) {
      segmentObj.captions = segmentObj.captions.concat(segment.captions);
    }

    // Gather any metadata into a single array
    if (segment.metadata) {
      segmentObj.metadata = segmentObj.metadata.concat(segment.metadata);
    }

    if (segment.captionStreams) {
      segmentObj.captionStreams = videojs.mergeOptions(
        segmentObj.captionStreams, segment.captionStreams);
    }

    return segmentObj;
  }, sortedSegments);

  callback(sortedSegments);
};

export const handleGopInfo_ = (event, transmuxedData) => {
  transmuxedData.gopInfo = event.data.gopInfo;
};

export const processTransmux = ({
  transmuxer,
  bytes,
  audioAppendStart,
  gopsToAlignWith,
  isPartial,
  onData,
  onTrackInfo,
  onAudioTimingInfo,
  onVideoTimingInfo,
  onDone
}) => {
  const transmuxedData = {
    isPartial,
    buffer: []
  };

  const handleMessage = (event) => {
    if (event.data.action === 'data') {
      handleData_(event, transmuxedData, onData);
    }
    if (event.data.action === 'trackinfo') {
      onTrackInfo(event.data.trackInfo);
    }
    if (event.data.action === 'gopInfo') {
      handleGopInfo_(event, transmuxedData);
    }
    if (event.data.action === 'audioTimingInfo') {
      onAudioTimingInfo(event.data.audioTimingInfo);
    }
    if (event.data.action === 'videoTimingInfo') {
      onVideoTimingInfo(event.data.videoTimingInfo);
    }

    if (event.data.type !== 'transmuxed') {
      return;
    }

    transmuxer.removeEventListener('message', handleMessage);
    handleDone_(event, transmuxedData, event.data.action === 'endedSegment', onDone);

    dequeue();
  };

  transmuxer.addEventListener('message', handleMessage);

  if (!isPartial && bytes.byteLength === 0) {
    // all data handled via partials
    transmuxer.postMessage({ action: 'endSegment' });
    return;
  }

  if (audioAppendStart) {
    transmuxer.postMessage({
      action: 'setAudioAppendStart',
      appendStart: audioAppendStart
    });
  }

  if (gopsToAlignWith) {
    transmuxer.postMessage({
      action: 'alignGopsWith',
      gopsToAlignWith
    });
  }

  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
  const byteOffset = bytes instanceof ArrayBuffer ? 0 : bytes.byteOffset;

  transmuxer.postMessage({
    action: 'push',
    // Send the typed-array of data as an ArrayBuffer so that
    // it can be sent as a "Transferable" and avoid the costly
    // memory copy
    data: buffer,
    // To recreate the original typed-array, we need information
    // about what portion of the ArrayBuffer it was a view into
    byteOffset,
    byteLength: bytes.byteLength
  },
  [ buffer ]);
  transmuxer.postMessage({ action: 'flush' });
};

export const dequeue = () => {
  currentTransmux = null;
  if (transmuxQueue.length) {
    currentTransmux = transmuxQueue.shift();
    if (typeof currentTransmux === 'function') {
      currentTransmux();
    } else {
      processTransmux(currentTransmux);
    }
  }
};

export const processAction = (transmuxer, action) => {
  transmuxer.postMessage({ action });
  dequeue();
};

// TODO might be better to pass in an action into transmux
export const reset = (transmuxer) => {
  if (!currentTransmux) {
    currentTransmux = 'reset';
    processAction(transmuxer, 'reset');
    return;
  }
  transmuxQueue.push(processAction.bind(null, transmuxer, 'reset'));
};

export const endTimeline = (transmuxer) => {
  if (!currentTransmux) {
    currentTransmux = 'endTimeline';
    processAction(transmuxer, 'endTimeline');
    return;
  }
  transmuxQueue.push(processAction.bind(null, transmuxer, 'endTimeline'));
};

export const transmux = (options) => {
  if (!currentTransmux) {
    currentTransmux = options;
    processTransmux(options);
    return;
  }
  transmuxQueue.push(options);
};

export default {
  reset,
  endTimeline,
  transmux
};
