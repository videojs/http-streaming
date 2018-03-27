import videojs from 'video.js';

const transmuxQueue = [];
let currentTransmux;

export const transmux = (options) => {
  if (!currentTransmux) {
    currentTransmux = options;
    processTransmux(options);
    return;
  }
  transmuxQueue.push(options);
};

const processTransmux = ({
  transmuxer,
  bytes,
  audioAppendStart,
  gopsToAlignWith,
  // TODO
  ignoreAudio,
  isPartial,
  callback
}) => {
  const transmuxedData = {
    isPartial,
    buffer: []
  };

  const handleMessage = (event) => {
    if (event.data.action === 'data') {
      handleData_(event, transmuxedData);
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

    if (event.data.action === 'done') {
      transmuxer.removeEventListener('message', handleMessage);
      handleDone_(event, transmuxedData, false, callback);
    }

    if (event.data.action === 'superDone') {
      transmuxer.removeEventListener('message', handleMessage);
      handleDone_(event, transmuxedData, true, callback);
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
      gopsToAlignWith: gopsToAlignWith
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

export const handleData_ = (event, transmuxedData) => {
  const segment = event.data.segment;

  // cast ArrayBuffer to TypedArray
  segment.data = new Uint8Array(
    segment.boxes.data,
    segment.boxes.data.byteOffset,
    segment.boxes.data.byteLength
  );

  segment.initSegment = new Uint8Array(
    segment.initSegment.data,
    segment.initSegment.byteOffset,
    segment.initSegment.byteLength
  );

  transmuxedData.buffer.push(segment);
};

export const handleDone_ = (event, transmuxedData, isInfo, callback) => {
  // all buffers should have been flushed from the muxer, so start processing anything we
  // have received
  let sortedSegments = {
    type: isInfo ? 'info' : 'content',
    video: {
      segments: [],
      bytes: 0
    },
    audio: {
      segments: [],
      bytes: 0
    },
    captions: [],
    metadata: [],
    trackInfo: transmuxedData.trackInfo,
    gopInfo: transmuxedData.gopInfo,
    timingInfo: transmuxedData.videoTimingInfo || transmuxedData.audioTimingInfo,
    captionStreams: {}
  };
  const buffer = transmuxedData.buffer;

  // TODO best place?
  transmuxedData.buffer = [];

  // Sort segments into separate video/audio arrays and
  // keep track of their total byte lengths
  sortedSegments = buffer.reduce((segmentObj, segment) => {
    const type = segment.type;
    const data = segment.data;
    const initSegment = segment.initSegment;

    segmentObj[type].segments.push(data);
    segmentObj[type].bytes += data.byteLength;

    if (!segmentObj[type].initSegment) {
      segmentObj[type].initSegment = initSegment;
    }

    // Gather any captions into a single array
    if (segment.captions) {
      segmentObj.captions = segmentObj.captions.concat(segment.captions);
    }

    if (segment.info) {
      segmentObj[type].info = segment.info;
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

  currentTransmux = null;
  if (transmuxQueue.length) {
    currentTransmux = transmuxQueue.shift();
    processTransmux(currentTransmux);
  }
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
