import {detectContainerForBytes, getId3Offset} from '@videojs/vhs-utils/dist/containers';
import {stringToBytes, toUint8} from '@videojs/vhs-utils/dist/byte-helpers';
import {callbackWrapper} from '../xhr';

const containerRequest = (uri, xhr, cb) => {
  let bytes;
  let id3Offset;

  const progressListener = function(error, request) {
    if (error) {
      return cb(error, request, '', bytes);
    }
    const currentLength = bytes && bytes.length || 0;
    const contentPart = request.responseText.substring(currentLength, request.responseText.length);
    const newBytes = toUint8(stringToBytes(contentPart, true));

    // we use a "temp" Uint8array here because we want to set bytes
    // to the old bytes plus the new bytes, but we don't want to go through
    // converting the old bytes that we have from a string to bytes again.
    // Instead we create a Uint8array and share the new/old bytes
    // to this object. Then set bytes equal to temp.
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
      // this forces the browser to pass the bytes to us unprocessed
      request.overrideMimeType('text/plain; charset=x-user-defined');
      request.addEventListener('progress', function(event) {
        return callbackWrapper(request, null, {statusCode: request.status}, progressListener);
      });
    }
  };

  return xhr(options, () => {});
};

export default containerRequest;
