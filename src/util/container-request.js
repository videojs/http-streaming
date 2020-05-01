import {detectContainerForBytes, getId3Offset} from '@videojs/vhs-utils/dist/containers';
import {stringToBytes, toUint8} from '@videojs/vhs-utils/dist/byte-helpers';
import {callbackWrapper} from '../xhr';

const containerRequest = (uri, xhr, cb) => {
  let bytes;
  let id3Offset;
  let finished = false;

  const progressListener = function(error, request) {
    if (finished) {
      return;
    }
    if (error) {
      finished = true;
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

    // we need at least 10 bytes to determine a type
    if (bytes.length < 10) {
      return;
    }

    id3Offset = id3Offset || getId3Offset(bytes);

    // if we have an id3 offset we are dealing with aac/mp3 and we
    // need 2 bytes after the id3 offset to determine which on it is.
    if ((id3Offset && bytes.length < id3Offset + 2)) {
      return;
    }
    const type = detectContainerForBytes(bytes);

    // if this looks like a ts segment but we don't have enough data
    // to see the second sync byte, wait until we have enough data
    // before declaring it ts
    if (type === 'ts' && bytes.length < 188) {
      return;
    }

    // this may be an unsynced ts segment
    // wait for 376 bytes before detecting no container
    if (!type && bytes.length < 376) {
      return;
    }

    request.abort();

    finished = true;
    return cb(null, request, type, bytes);
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

  const request = xhr(options, function(error, response) {
    // if progress listeners are not supported, or
    // for some reason we get here and are not finished,
    // complete container checking with all of the data.
    if (finished) {
      return;
    }

    return callbackWrapper(request, error, response, progressListener);
  });

  return request;
};

export default containerRequest;
