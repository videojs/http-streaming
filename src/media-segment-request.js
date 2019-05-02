import videojs from 'video.js';
import { createTransferableMessage } from './bin-utils';
import { stringToArrayBuffer } from './util/string-to-array-buffer';
import { transmux } from './segment-transmuxer';
import { probeMp4StartTime, probeTsSegment } from './util/segment';
import { isLikelyFmp4Data } from './util/codecs';
import mp4probe from 'mux.js/lib/mp4/probe';
import { segmentXhrHeaders } from './xhr';

export const REQUEST_ERRORS = {
  FAILURE: 2,
  TIMEOUT: -101,
  ABORTED: -102
};

/**
 * Abort all requests
 *
 * @param {Object} activeXhrs - an object that tracks all XHR requests
 */
const abortAll = (activeXhrs) => {
  activeXhrs.forEach((xhr) => {
    xhr.abort();
  });
};

/**
 * Gather important bandwidth stats once a request has completed
 *
 * @param {Object} request - the XHR request from which to gather stats
 */
const getRequestStats = (request) => {
  return {
    bandwidth: request.bandwidth,
    bytesReceived: request.bytesReceived || 0,
    roundTripTime: request.roundTripTime || 0
  };
};

/**
 * If possible gather bandwidth stats as a request is in
 * progress
 *
 * @param {Event} progressEvent - an event object from an XHR's progress event
 */
const getProgressStats = (progressEvent) => {
  const request = progressEvent.target;
  const roundTripTime = Date.now() - request.requestTime;
  const stats = {
    bandwidth: Infinity,
    bytesReceived: 0,
    roundTripTime: roundTripTime || 0
  };

  stats.bytesReceived = progressEvent.loaded;
  // This can result in Infinity if stats.roundTripTime is 0 but that is ok
  // because we should only use bandwidth stats on progress to determine when
  // abort a request early due to insufficient bandwidth
  stats.bandwidth = Math.floor((stats.bytesReceived / stats.roundTripTime) * 8 * 1000);

  return stats;
};

/**
 * Handle all error conditions in one place and return an object
 * with all the information
 *
 * @param {Error|null} error - if non-null signals an error occured with the XHR
 * @param {Object} request -  the XHR request that possibly generated the error
 */
const handleErrors = (error, request) => {
  if (request.timedout) {
    return {
      status: request.status,
      message: 'HLS request timed-out at URL: ' + request.uri,
      code: REQUEST_ERRORS.TIMEOUT,
      xhr: request
    };
  }

  if (request.aborted) {
    return {
      status: request.status,
      message: 'HLS request aborted at URL: ' + request.uri,
      code: REQUEST_ERRORS.ABORTED,
      xhr: request
    };
  }

  if (error) {
    return {
      status: request.status,
      message: 'HLS request errored at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    };
  }

  return null;
};

/**
 * Handle responses for key data and convert the key data to the correct format
 * for the decryption step later
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */
const handleKeyResponse = (segment, finishProcessingFn) => (error, request) => {
  const response = request.response;
  const errorObj = handleErrors(error, request);

  if (errorObj) {
    return finishProcessingFn(errorObj, segment);
  }

  if (response.byteLength !== 16) {
    return finishProcessingFn({
      status: request.status,
      message: 'Invalid HLS key at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    }, segment);
  }

  const view = new DataView(response);

  segment.key.bytes = new Uint32Array([
    view.getUint32(0),
    view.getUint32(4),
    view.getUint32(8),
    view.getUint32(12)
  ]);
  return finishProcessingFn(null, segment);
};

/**
 * Handle init-segment responses
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */
const handleInitSegmentResponse =
({segment, captionParser, finishProcessingFn}) => (error, request) => {
  const response = request.response;
  const errorObj = handleErrors(error, request);

  if (errorObj) {
    return finishProcessingFn(errorObj, segment);
  }

  // stop processing if received empty content
  if (response.byteLength === 0) {
    return finishProcessingFn({
      status: request.status,
      message: 'Empty HLS segment content at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    }, segment);
  }

  segment.map.bytes = new Uint8Array(request.response);

  // Initialize CaptionParser if it hasn't been yet
  if (captionParser && !captionParser.isInitialized()) {
    captionParser.init();
  }

  segment.map.timescales = mp4probe.timescale(segment.map.bytes);
  segment.map.videoTrackIds = mp4probe.videoTrackIds(segment.map.bytes);

  return finishProcessingFn(null, segment);
};

/**
 * Response handler for segment-requests being sure to set the correct
 * property depending on whether the segment is encryped or not
 * Also records and keeps track of stats that are used for ABR purposes
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} finishProcessingFn - a callback to execute to continue processing
 *                                        this request
 */
const handleSegmentResponse = ({
  segment,
  captionParser,
  captionsFn,
  finishProcessingFn,
  responseType
}) => (error, request) => {
  const response = request.response;
  const errorObj = handleErrors(error, request);

  if (errorObj) {
    return finishProcessingFn(errorObj, segment);
  }

  const newBytes = responseType === 'arraybuffer' ? request.response :
    stringToArrayBuffer(request.responseText.substring(segment.lastReachedChar || 0));

  // stop processing if received empty content
  if (response.byteLength === 0) {
    return finishProcessingFn({
      status: request.status,
      message: 'Empty HLS segment content at URL: ' + request.uri,
      code: REQUEST_ERRORS.FAILURE,
      xhr: request
    }, segment);
  }

  segment.stats = getRequestStats(request);

  if (segment.key) {
    segment.encryptedBytes = new Uint8Array(newBytes);
  } else {
    segment.bytes = new Uint8Array(newBytes);
  }

  return finishProcessingFn(null, segment);
};

const transmuxAndNotify = ({
  segment,
  bytes,
  isPartial,
  trackInfoFn,
  timingInfoFn,
  id3Fn,
  captionsFn,
  dataFn,
  doneFn
}) => {
  // Keep references to each function so we can null them out after we're done with them.
  // One reason for this is that in the case of full segments, we want to trust start
  // times from the probe, rather than the transmuxer.
  let audioStartFn = timingInfoFn.bind(null, segment, 'audio', 'start');
  let audioEndFn = timingInfoFn.bind(null, segment, 'audio', 'end');
  let videoStartFn = timingInfoFn.bind(null, segment, 'video', 'start');
  let videoEndFn = timingInfoFn.bind(null, segment, 'video', 'end');

  // Check to see if we are appending a full segment.
  if (!isPartial && !segment.lastReachedChar) {
    // In the full segment transmuxer, we don't yet have the ability to extract a "proper"
    // start time. Meaning cached frame data may corrupt our notion of where this segment
    // really starts. To get around this, full segment appends should probe for the info
    // needed.
    const probeResult = probeTsSegment(bytes, segment.baseStartTime);

    if (probeResult) {
      trackInfoFn(segment, {
        hasAudio: probeResult.hasAudio,
        hasVideo: probeResult.hasVideo
      });
      trackInfoFn = null;

      audioStartFn(probeResult.audioStart);
      audioStartFn = null;
      videoStartFn(probeResult.videoStart);
      videoStartFn = null;
    }
  }

  transmux({
    bytes,
    transmuxer: segment.transmuxer,
    audioAppendStart: segment.audioAppendStart,
    gopsToAlignWith: segment.gopsToAlignWith,
    isPartial,
    onData: (result) => {
      dataFn(segment, result);
    },
    onTrackInfo: (trackInfo) => {
      if (trackInfoFn) {
        trackInfoFn(segment, trackInfo);
      }
    },
    onAudioTimingInfo: (audioTimingInfo) => {
      // we only want the first start value we encounter
      if (audioStartFn && typeof audioTimingInfo.start !== 'undefined') {
        audioStartFn(audioTimingInfo.start);
        audioStartFn = null;
      }
      // we want to continually update the end time
      if (audioEndFn && typeof audioTimingInfo.end !== 'undefined') {
        audioEndFn(audioTimingInfo.end);
      }
    },
    onVideoTimingInfo: (videoTimingInfo) => {
      // we only want the first start value we encounter
      if (videoStartFn && typeof videoTimingInfo.start !== 'undefined') {
        videoStartFn(videoTimingInfo.start);
        videoStartFn = null;
      }
      // we want to continually update the end time
      if (videoEndFn && typeof videoTimingInfo.end !== 'undefined') {
        videoEndFn(videoTimingInfo.end);
      }
    },
    onId3: (id3Frames, dispatchType) => {
      id3Fn(segment, id3Frames, dispatchType);
    },
    onCaptions: (captions) => {
      captionsFn(segment, [captions]);
    },
    onDone: (result) => {
      // To handle partial appends, there won't be a done function passed in (since
      // there's still, potentially, more segment to process), so there's nothing to do.
      if (!doneFn || isPartial) {
        return;
      }
      doneFn(null, segment, result);
    }
  });
};

const handleSegmentBytes = ({
  segment,
  bytes,
  isPartial,
  captionParser,
  trackInfoFn,
  timingInfoFn,
  id3Fn,
  captionsFn,
  dataFn,
  doneFn
}) => {
  const bytesAsUint8Array = new Uint8Array(bytes);

  segment.isFmp4 =
    // only set the property the first time we see some bytes so that partial appends
    // don't try to check every section of bytes (since the check should only consider the
    // first bytes in the segment)
    typeof segment.isFmp4 === 'boolean' ? segment.isFmp4 :
      isLikelyFmp4Data(bytesAsUint8Array);

  if (segment.isFmp4) {
    // since we don't support appending fmp4 data on progress, we know we have the full
    // segment here
    const startTime = probeMp4StartTime(bytesAsUint8Array, segment.map.bytes);

    // we don't parse fmp4 (yet), so we can't provide any track info, however, the
    // track info callback should still be called before the dataFn is called
    trackInfoFn(segment, null);
    // use null for the media type since we don't technically know whether it's audio or
    // video
    // the probe doesn't provide the segment end time, so only callback with the start
    // (the end time can be roughly calculated by the receiver using the duration)
    timingInfoFn(segment, null, 'start', startTime);
    dataFn(segment, { data: bytes });

    // Run through the CaptionParser in case there are captions.
    // Initialize CaptionParser if it hasn't been yet
    if (captionParser && !captionParser.isInitialized()) {
      captionParser.init();
    }

    const parsed = captionParser.parse(
      segment.bytes,
      segment.map.videoTrackIds,
      segment.map.timescales);

    if (parsed && parsed.captions && parsed.captions.length > 0) {
      captionsFn(segment, parsed.captions);
    }

    doneFn(null, segment, {});
    return;
  }

  // VTT or other segments that don't need processing
  if (!segment.transmuxer) {
    doneFn(null, segment, {});
    return;
  }

  // ts or aac
  transmuxAndNotify({
    segment,
    bytes,
    isPartial,
    trackInfoFn,
    timingInfoFn,
    id3Fn,
    captionsFn,
    dataFn,
    doneFn
  });
};

/**
 * Decrypt the segment via the decryption web worker
 *
 * @param {WebWorker} decryptionWorker - a WebWorker interface to AES-128 decryption
 *                                       routines
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} trackInfoFn - a callback that receives track info
 * @param {Function} dataFn - a callback that is executed when segment bytes are available
 *                            and ready to use
 * @param {Function} doneFn - a callback that is executed after decryption has completed
 */
const decryptSegment = ({
  decryptionWorker,
  segment,
  captionParser,
  trackInfoFn,
  timingInfoFn,
  id3Fn,
  captionsFn,
  dataFn,
  doneFn
}) => {
  const decryptionHandler = (event) => {
    if (event.data.source === segment.requestId) {
      decryptionWorker.removeEventListener('message', decryptionHandler);
      const decrypted = event.data.decrypted;

      segment.bytes = new Uint8Array(decrypted.bytes,
                                     decrypted.byteOffset,
                                     decrypted.byteLength);

      handleSegmentBytes({
        segment,
        bytes: segment.bytes,
        isPartial: false,
        captionParser,
        trackInfoFn,
        timingInfoFn,
        id3Fn,
        captionsFn,
        dataFn,
        doneFn
      });
    }
  };

  decryptionWorker.addEventListener('message', decryptionHandler);

  const keyBytes = segment.key.bytes.slice();

  // this is an encrypted segment
  // incrementally decrypt the segment
  decryptionWorker.postMessage(createTransferableMessage({
    source: segment.requestId,
    encrypted: segment.encryptedBytes,
    key: keyBytes,
    iv: segment.key.iv
  }), [
    segment.encryptedBytes.buffer,
    keyBytes.buffer
  ]);
};

/**
 * This function waits for all XHRs to finish (with either success or failure)
 * before continueing processing via it's callback. The function gathers errors
 * from each request into a single errors array so that the error status for
 * each request can be examined later.
 *
 * @param {Object} activeXhrs - an object that tracks all XHR requests
 * @param {WebWorker} decryptionWorker - a WebWorker interface to AES-128 decryption
 *                                       routines
 * @param {Function} trackInfoFn - a callback that receives track info
 * @param {Function} timingInfoFn - a callback that receives timing info
 * @param {Function} id3Fn - a callback that receives ID3 metadata
 * @param {Function} captionsFn - a callback that receives captions
 * @param {Function} dataFn - a callback that is executed when segment bytes are available
 *                            and ready to use
 * @param {Function} doneFn - a callback that is executed after all resources have been
 *                            downloaded and any decryption completed
 */
const waitForCompletion = ({
  activeXhrs,
  decryptionWorker,
  captionParser,
  trackInfoFn,
  timingInfoFn,
  id3Fn,
  captionsFn,
  dataFn,
  doneFn
}) => {
  let count = 0;
  let didError = false;

  return (error, segment) => {
    if (didError) {
      return;
    }

    if (error) {
      didError = true;
      // If there are errors, we have to abort any outstanding requests
      abortAll(activeXhrs);

      // Even though the requests above are aborted, and in theory we could wait until we
      // handle the aborted events from those requests, there are some cases where we may
      // never get an aborted event. For instance, if the network connection is lost and
      // there were two requests, the first may have triggered an error immediately, while
      // the second request remains unsent. In that case, the aborted algorithm will not
      // trigger an abort: see https://xhr.spec.whatwg.org/#the-abort()-method
      //
      // We also can't rely on the ready state of the XHR, since the request that
      // triggered the connection error may also show as a ready state of 0 (unsent).
      // Therefore, we have to finish this group of requests immediately after the first
      // seen error.
      return doneFn(error, segment);
    }

    count += 1;

    if (count === activeXhrs.length) {
      // Keep track of when *all* of the requests have completed
      segment.endOfAllRequests = Date.now();

      if (segment.encryptedBytes) {
        return decryptSegment({
          decryptionWorker,
          segment,
          captionParser,
          trackInfoFn,
          timingInfoFn,
          id3Fn,
          captionsFn,
          dataFn,
          doneFn
        });
      }
      // Otherwise, everything is ready just continue
      handleSegmentBytes({
        segment,
        bytes: segment.bytes,
        isPartial: false,
        captionParser,
        trackInfoFn,
        timingInfoFn,
        id3Fn,
        captionsFn,
        dataFn,
        doneFn
      });
    }
  };
};

/**
 * Simple progress event callback handler that gathers some stats before
 * executing a provided callback with the `segment` object
 *
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} progressFn - a callback that is executed each time a progress event
 *                                is received
 * @param {Function} trackInfoFn - a callback that receives track info
 * @param {Function} dataFn - a callback that is executed when segment bytes are available
 *                            and ready to use
 * @param {Event} event - the progress event object from XMLHttpRequest
 */
const handleProgress = ({
  segment,
  progressFn,
  trackInfoFn,
  timingInfoFn,
  id3Fn,
  captionsFn,
  dataFn,
  handlePartialData
}) => (event) => {
  const request = event.target;

  if (request.aborted) {
    return;
  }

  // don't support encrypted segments or fmp4 for now
  // in order to determine if it's an fmp4 we need at least 8 bytes
  if (handlePartialData && !segment.key && request.responseText.length >= 8) {
    const newBytes = stringToArrayBuffer(
      request.responseText.substring(segment.lastReachedChar || 0));

    if (segment.lastReachedChar || !isLikelyFmp4Data(new Uint8Array(newBytes))) {
      segment.lastReachedChar = request.responseText.length;

      handleSegmentBytes({
        segment,
        bytes: newBytes,
        isPartial: true,
        trackInfoFn,
        timingInfoFn,
        id3Fn,
        captionsFn,
        dataFn
      });
    }
  }

  segment.stats = videojs.mergeOptions(segment.stats, getProgressStats(event));

  // record the time that we receive the first byte of data
  if (!segment.stats.firstBytesReceivedAt && segment.stats.bytesReceived) {
    segment.stats.firstBytesReceivedAt = Date.now();
  }

  return progressFn(event, segment);
};

/**
 * Load all resources and does any processing necessary for a media-segment
 *
 * Features:
 *   decrypts the media-segment if it has a key uri and an iv
 *   aborts *all* requests if *any* one request fails
 *
 * The segment object, at minimum, has the following format:
 * {
 *   resolvedUri: String,
 *   [transmuxer]: Object,
 *   [byterange]: {
 *     offset: Number,
 *     length: Number
 *   },
 *   [key]: {
 *     resolvedUri: String
 *     [byterange]: {
 *       offset: Number,
 *       length: Number
 *     },
 *     iv: {
 *       bytes: Uint32Array
 *     }
 *   },
 *   [map]: {
 *     resolvedUri: String,
 *     [byterange]: {
 *       offset: Number,
 *       length: Number
 *     },
 *     [bytes]: Uint8Array
 *   }
 * }
 * ...where [name] denotes optional properties
 *
 * @param {Function} xhr - an instance of the xhr wrapper in xhr.js
 * @param {Object} xhrOptions - the base options to provide to all xhr requests
 * @param {WebWorker} decryptionWorker - a WebWorker interface to AES-128
 *                                       decryption routines
 * @param {Object} segment - a simplified copy of the segmentInfo object
 *                           from SegmentLoader
 * @param {Function} progressFn - a callback that receives progress events from the main
 *                                segment's xhr request
 * @param {Function} trackInfoFn - a callback that receives track info
 * @param {Function} id3Fn - a callback that receives ID3 metadata
 * @param {Function} captionsFn - a callback that receives captions
 * @param {Function} dataFn - a callback that receives data from the main segment's xhr
 *                            request, transmuxed if needed
 * @param {Function} doneFn - a callback that is executed only once all requests have
 *                            succeeded or failed
 * @returns {Function} a function that, when invoked, immediately aborts all
 *                     outstanding requests
 */
export const mediaSegmentRequest = ({
  xhr,
  xhrOptions,
  decryptionWorker,
  captionParser,
  segment,
  progressFn,
  trackInfoFn,
  timingInfoFn,
  id3Fn,
  captionsFn,
  dataFn,
  doneFn,
  handlePartialData
}) => {
  const activeXhrs = [];
  const finishProcessingFn = waitForCompletion({
    activeXhrs,
    decryptionWorker,
    captionParser,
    trackInfoFn,
    timingInfoFn,
    id3Fn,
    captionsFn,
    dataFn,
    doneFn
  });

  // optionally, request the decryption key
  if (segment.key && !segment.key.bytes) {
    const keyRequestOptions = videojs.mergeOptions(xhrOptions, {
      uri: segment.key.resolvedUri,
      responseType: 'arraybuffer'
    });
    const keyRequestCallback = handleKeyResponse(segment, finishProcessingFn);
    const keyXhr = xhr(keyRequestOptions, keyRequestCallback);

    activeXhrs.push(keyXhr);
  }

  // optionally, request the associated media init segment
  if (segment.map &&
    !segment.map.bytes) {
    const initSegmentOptions = videojs.mergeOptions(xhrOptions, {
      uri: segment.map.resolvedUri,
      responseType: 'arraybuffer',
      headers: segmentXhrHeaders(segment.map)
    });
    const initSegmentRequestCallback = handleInitSegmentResponse({
      segment,
      captionParser,
      finishProcessingFn
    });
    const initSegmentXhr = xhr(initSegmentOptions, initSegmentRequestCallback);

    activeXhrs.push(initSegmentXhr);
  }

  const segmentRequestOptions = videojs.mergeOptions(xhrOptions, {
    uri: segment.resolvedUri,
    responseType: 'arraybuffer',
    headers: segmentXhrHeaders(segment)
  });

  if (handlePartialData) {
    // setting to text is required for partial responses
    // conversion to ArrayBuffer happens later
    segmentRequestOptions.responseType = 'text';
    segmentRequestOptions.beforeSend = (xhrObject) => {
      // XHR binary charset opt by Marcus Granado 2006 [http://mgran.blogspot.com]
      // makes the browser pass through the "text" unparsed
      xhrObject.overrideMimeType('text/plain; charset=x-user-defined');
    };
  }

  const segmentRequestCallback = handleSegmentResponse({
    segment,
    captionParser,
    captionsFn,
    finishProcessingFn,
    responseType: segmentRequestOptions.responseType
  });
  const segmentXhr = xhr(segmentRequestOptions, segmentRequestCallback);

  segmentXhr.addEventListener(
    'progress',
    handleProgress({
      segment,
      progressFn,
      trackInfoFn,
      timingInfoFn,
      id3Fn,
      captionsFn,
      dataFn,
      handlePartialData
    }));
  activeXhrs.push(segmentXhr);

  return () => abortAll(activeXhrs);
};
