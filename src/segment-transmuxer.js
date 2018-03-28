import videojs from 'video.js';

const transmuxQueue = [];
let currentTransmux;

export const handleData_ = (event, transmuxedData, callback) => {
  const {
    type,
    boxes,
    initSegment,
    // TODO is segment.info used ever???
    captions,
    captionStreams,
    metadata
  } = event.data.segment;

  transmuxedData.buffer.push({
    captions,
    captionStreams,
    metadata
  });

  callback({
    type,
    trackInfo: transmuxedData.trackInfo,
    timingInfo: transmuxedData.videoTimingInfo || transmuxedData.audioTimingInfo,
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
  });
};

export const handleDone_ = (event, transmuxedData, complete, callback) => {
  // all buffers should have been flushed from the muxer, so start processing anything we
  // have received
  let sortedSegments = {
    captions: [],
    metadata: [],
    gopInfo: transmuxedData.gopInfo,
    timingInfo: transmuxedData.videoTimingInfo || transmuxedData.audioTimingInfo,
    captionStreams: {},
    complete
  };
  const buffer = transmuxedData.buffer;

  // TODO best place?
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

export const handleTrackInfo_ = (event, transmuxedData) => {
  transmuxedData.trackInfo = event.data.trackInfo;
};

export const handleGopInfo_ = (event, transmuxedData) => {
  transmuxedData.gopInfo = event.data.gopInfo;
};

export const handleAudioTimingInfo_ = (event, transmuxedData) => {
  transmuxedData.audioTimingInfo = event.data.audioTimingInfo;
};

export const handleVideoTimingInfo_ = (event, transmuxedData) => {
  transmuxedData.videoTimingInfo = event.data.videoTimingInfo;
};

export const processTransmux = ({
  transmuxer,
  bytes,
  audioAppendStart,
  gopsToAlignWith,
  isPartial,
  onData,
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
      handleTrackInfo_(event, transmuxedData);
    }
    if (event.data.action === 'gopInfo') {
      handleGopInfo_(event, transmuxedData);
    }
    if (event.data.action === 'audioTimingInfo') {
      handleAudioTimingInfo_(event, transmuxedData);
    }
    if (event.data.action === 'videoTimingInfo') {
      handleVideoTimingInfo_(event, transmuxedData);
    }

    if (event.data.type !== 'transmuxed') {
      return;
    }

    transmuxer.removeEventListener('message', handleMessage);
    handleDone_(event, transmuxedData, event.data.action === 'superDone', onDone);

    currentTransmux = null;
    if (transmuxQueue.length) {
      currentTransmux = transmuxQueue.shift();
      processTransmux(currentTransmux);
    }
  };

  transmuxer.addEventListener('message', handleMessage);

  if (!isPartial) {
    // all data should be handled via partials
    transmuxer.postMessage({ action: 'superFlush' });
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

  transmuxer.postMessage({
    action: 'push',
    // Send the typed-array of data as an ArrayBuffer so that
    // it can be sent as a "Transferable" and avoid the costly
    // memory copy
    data: bytes.buffer,
    // To recreate the original typed-array, we need information
    // about what portion of the ArrayBuffer it was a view into
    byteOffset: bytes.byteOffset,
    byteLength: bytes.byteLength
  },
  [ bytes.buffer ]);
  transmuxer.postMessage({ action: 'flush' });
};

export const transmux = (options) => {
  if (!currentTransmux) {
    currentTransmux = options;
    processTransmux(options);
    return;
  }
  transmuxQueue.push(options);
};
