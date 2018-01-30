/**
 * @file codec-utils.js
 */

/**
 * Check if a codec string refers to an audio codec.
 *
 * @param {String} codec codec string to check
 * @return {Boolean} if this is an audio codec
 * @private
 */
const isAudioCodec = function(codec) {
  return (/mp4a\.\d+.\d+/i).test(codec);
};

/**
 * Check if a codec string refers to a video codec.
 *
 * @param {String} codec codec string to check
 * @return {Boolean} if this is a video codec
 * @private
 */
const isVideoCodec = function(codec) {
  return (/avc1\.[\da-f]+/i).test(codec);
};

/**
 * Parse a content type header into a type and parameters
 * object
 *
 * @param {String} type the content type header
 * @return {Object} the parsed content-type
 * @private
 */
const parseContentType = function(type) {
  let object = {type: '', parameters: {}};
  let parameters = type.trim().split(';');

  // first parameter should always be content-type
  object.type = parameters.shift().trim();
  parameters.forEach((parameter) => {
    let pair = parameter.trim().split('=');

    if (pair.length > 1) {
      let name = pair[0].replace(/"/g, '').trim();
      let value = pair[1].replace(/"/g, '').trim();

      object.parameters[name] = value;
    }
  });

  return object;
};

/**
 * Replace the old apple-style `avc1.<dd>.<dd>` codec string with the standard
 * `avc1.<hhhhhh>`
 *
 * @param {Array} codecs an array of codec strings to fix
 * @return {Array} the translated codec array
 * @private
 */
const translateLegacyCodecs = function(codecs) {
  return codecs.map((codec) => {
    return codec.replace(/avc1\.(\d+)\.(\d+)/i, function(orig, profile, avcLevel) {
      let profileHex = ('00' + Number(profile).toString(16)).slice(-2);
      let avcLevelHex = ('00' + Number(avcLevel).toString(16)).slice(-2);

      return 'avc1.' + profileHex + '00' + avcLevelHex;
    });
  });
};

export default {
  isAudioCodec,
  parseContentType,
  isVideoCodec,
  translateLegacyCodecs
};
