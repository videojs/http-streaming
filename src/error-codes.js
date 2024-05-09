import videojs from 'video.js';

// https://www.w3.org/TR/WebIDL-1/#quotaexceedederror
export const QUOTA_EXCEEDED_ERR = 22;

export const getStreamingNetworkErrorMetadata = ({ requestType, request, error, parseFailure }) => {
  const isBadStatus = request.status < 200 || request.status > 299;
  const isFailure = request.status >= 400 && request.status <= 499;
  const errorMetadata = {
    uri: request.uri,
    requestType
  };
  const isBadStatusOrParseFailure = (isBadStatus && !isFailure) || parseFailure;

  if (error && isFailure) {
    // copy original error and add to the metadata.
    errorMetadata.error = {...error};
    errorMetadata.errorType = videojs.Error.NetworkRequestFailed;
  } else if (request.aborted) {
    errorMetadata.errorType = videojs.Error.NetworkRequestAborted;
  } else if (request.timedout) {
    errorMetadata.erroType = videojs.Error.NetworkRequestTimeout;
  } else if (isBadStatusOrParseFailure) {
    const errorType = parseFailure ? videojs.Error.NetworkBodyParserFailed : videojs.Error.NetworkBadStatus;

    errorMetadata.errorType = errorType;
    errorMetadata.status = request.status;
    errorMetadata.headers = request.headers;
  }

  return errorMetadata;
};
