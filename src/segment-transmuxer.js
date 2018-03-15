import videojs from 'video.js';

export const transmux = ({
  transmuxer,
  segmentInfo,
  audioAppendStart,
  gopsToAlignWith,
  callback }) => {
  const transmuxedData = {
    buffer: []
  };
  const handleMessage = (event) => {
    if (event.data.action === 'data') {
      handleData_(event, transmuxedData);
    }
    if (event.data.action === 'done') {
      handleDone_(event, transmuxedData, callback);
      transmuxer.removeEventListener('message', handleMessage);
    }
    if (event.data.action === 'trackinfo') {
      handleTrackInfo_(event, transmuxedData);
    }
    if (event.data.action === 'gopInfo') {
      handleGopInfo_(event, transmuxedData);
    }
  };

  transmuxer.addEventListener('message', handleMessage);

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
    data: segmentInfo.bytes.buffer,
    // To recreate the original typed-array, we need information
    // about what portion of the ArrayBuffer it was a view into
    byteOffset: segmentInfo.bytes.byteOffset,
    byteLength: segmentInfo.bytes.byteLength
  },
  [ segmentInfo.bytes.buffer ]);
  transmuxer.postMessage({ action: 'flush' });
};

export const handleData_ = (event, transmuxedData) => {
  const segment = event.data.segment;

  // cast ArrayBuffer to TypedArray
  segment.data = new Uint8Array(
    segment.data,
    event.data.byteOffset,
    event.data.byteLength
  );

  segment.initSegment = new Uint8Array(
    segment.initSegment.data,
    segment.initSegment.byteOffset,
    segment.initSegment.byteLength
  );

  transmuxedData.buffer.push(segment);
};

export const handleDone_ = (event, transmuxedData, callback) => {
  // all buffers should have been flushed from the muxer, so start processing anything we
  // have received
  let sortedSegments = {
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
    captionStreams: {}
  };

  // Sort segments into separate video/audio arrays and
  // keep track of their total byte lengths
  sortedSegments = transmuxedData.buffer.reduce((segmentObj, segment) => {
    const type = segment.type;
    const data = segment.data;
    const initSegment = segment.initSegment;

    segmentObj[type].segments.push(data);
    segmentObj[type].bytes += data.byteLength;

    segmentObj[type].initSegment = initSegment;

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

  callback(null, sortedSegments);
};

export const handleTrackInfo_ = (event, transmuxedData) => {
  transmuxedData.trackInfo = event.data.trackInfo;
};

export const handleGopInfo_ = (event, transmuxedData) => {
  transmuxedData.gopInfo = event.data.gopInfo;
};
