export const transmux = ({ transmuxer, segmentInfo, callback }) => {
  const buffer = [];
  const handleMessage = (event) => {
    if (event.data.action === 'data') {
      handleData_(event, buffer);
    }
    if (event.data.action === 'done') {
      handleDone_(event, buffer, callback);
      transmuxer.removeEventListener('message', handleMessage);
    }
  };

  transmuxer.addEventListener('message', handleMessage);

  // TODO
  // - 'setAudioAppendStart',
  // - 'alignGopsWith',

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

export const handleData_ = (event, buffer) => {
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

  buffer.push(segment);
};

export const handleDone_ = (event, buffer, callback) => {
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
    metadata: []
  };

  // Sort segments into separate video/audio arrays and
  // keep track of their total byte lengths
  sortedSegments = buffer.reduce((segmentObj, segment) => {
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

    return segmentObj;
  }, sortedSegments);

  callback(null, sortedSegments);
};
