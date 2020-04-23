import {detectContainerForBytes, getId3Offset} from '@videojs/vhs-utils/dist/containers';
import {stringToBytes, toUint8} from '@videojs/vhs-utils/dist/byte-helpers';
import {callbackWrapper} from '../xhr';

export const requestAndDetectSegmentContainer = (uri, xhr, cb) => {
  let bytes;
  let id3Offset;

  const progressListener = function(error, request) {
    if (error) {
      return cb(error, request, '', bytes);
    }
    const currentLength = bytes && bytes.length || 0;
    const contentPart = request.responseText.substring(currentLength, request.responseText.length);
    const newBytes = toUint8(stringToBytes(contentPart, true));
    const temp = new Uint8Array(currentLength + newBytes.length);

    if (bytes) {
      temp.set(bytes);
    }
    temp.set(newBytes, currentLength);
    bytes = temp;

    if (!id3Offset) {
      id3Offset = getId3Offset(bytes);
    }

    // not enough data to determine type yet
    if (bytes.length < id3Offset + 2) {
      return;
    }
    request.abort();
    const type = detectContainerForBytes(bytes);

    cb(null, request, type, bytes);
  };

  const options = {
    uri,
    beforeSend(request) {
      request.overrideMimeType('text/plain; charset=x-user-defined');
      request.addEventListener('progress', function(event) {
        return callbackWrapper(request, null, {statusCode: request.status}, progressListener);
      });
    }
  };

  return xhr(options, () => {});
};
