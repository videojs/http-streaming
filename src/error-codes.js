import videojs from 'video.js';

// https://www.w3.org/TR/WebIDL-1/#quotaexceedederror
export const QUOTA_EXCEEDED_ERR = 22;

export const getStreamingNetworkErrorMetadata = ({ requestType, request, error, parseFailure }) => {
  const isBadStatus = request.status < 200 || request.status > 299;
  const errorMetadata = {
    uri: request.uri,
    requestType
  };

  if (error) {
    errorMetadata.error = error;
    errorMetadata.errorType = videojs.Error.NetworkRequestFailed;
  } else if (request.timedout) {
    errorMetadata.errorType = videojs.Error.NetworkRequestTimeout;
  } else if (request.aborted) {
    errorMetadata.erroType = videojs.Error.NetworkRequestAborted;
  } else if (parseFailure || isBadStatus) {
    const errorType = parseFailure ? videojs.Error.NetworkBodyParserFailed : videojs.Error.NetworkBadStatus;

    errorMetadata.errorType = errorType;
    errorMetadata.status = request.status;
    errorMetadata.headers = request.headers;
  }

  return errorMetadata;
};
