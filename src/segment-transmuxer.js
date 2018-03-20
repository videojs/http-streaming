import videojs from 'video.js';

// TODO better handling
let alreadyListening = false;

export const transmux = ({
  transmuxer,
  segmentInfo,
  audioAppendStart,
  gopsToAlignWith,
  ignoreAudio,
  isPartial,
  callback
}) => {
  let audioDone = ignoreAudio;
  let audioSuperDone = ignoreAudio;
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

    if (event.data.action === 'done') {
      if (event.data.type === 'audio') {
        audioDone = true;
      }
      if (audioDone) {
        handleDone_(event, transmuxedData, callback);
      }
    }

    if (event.data.action === 'superDone') {
      if (event.data.type === 'audio') {
        audioSuperDone = true;
      }
      if (audioSuperDone) {
        transmuxer.removeEventListener('message', handleMessage);
        alreadyListening = false;
        handleDone_(event, transmuxedData, callback);
      }
    }
  };

  if (!alreadyListening) {
    transmuxer.addEventListener('message', handleMessage);
    alreadyListening = true;
  }

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

export const handleDone_ = (event, transmuxedData, callback) => {
  // all buffers should have been flushed from the muxer, so start processing anything we
  // have received
  let sortedSegments = {
    type: transmuxedData.isPartial ? 'content' : 'info',
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

  // Sort segments into separate video/audio arrays and
  // keep track of their total byte lengths
  sortedSegments = transmuxedData.buffer.reduce((segmentObj, segment) => {
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
  console.log(event.data.videoTimingInfo);
  transmuxedData.videoTimingInfo = event.data.videoTimingInfo;
};
