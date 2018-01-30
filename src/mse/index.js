/**
 * @file videojs-contrib-media-sources.js
 */
import window from 'global/window';
import HtmlMediaSource from './html-media-source';
import videojs from 'video.js';
let urlCount = 0;

// ------------
// Media Source
// ------------

// store references to the media sources so they can be connected
// to a video element (a swf object)
// TODO: can we store this somewhere local to this module?
videojs.mediaSources = {};

/**
 * Provide a method for a swf object to notify JS that a
 * media source is now open.
 *
 * @param {String} msObjectURL string referencing the MSE Object URL
 * @param {String} swfId the swf id
 */
const open = function(msObjectURL, swfId) {
  let mediaSource = videojs.mediaSources[msObjectURL];

  if (mediaSource) {
    mediaSource.trigger({type: 'sourceopen', swfId});
  } else {
    throw new Error('Media Source not found (Video.js)');
  }
};

/**
 * Check to see if the native MediaSource object exists and supports
 * an MP4 container with both H.264 video and AAC-LC audio.
 *
 * @return {Boolean} if  native media sources are supported
 */
const supportsNativeMediaSources = function() {
  return (!!window.MediaSource && !!window.MediaSource.isTypeSupported &&
    window.MediaSource.isTypeSupported('video/mp4;codecs="avc1.4d400d,mp4a.40.2"'));
};

/**
 * An emulation of the MediaSource API so that we can support
 * native and non-native functionality. returns an instance of
 * HtmlMediaSource.
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/MediaSource
 */
export const MediaSource = function() {
  this.MediaSource = {
    open,
    supportsNativeMediaSources
  };

  if (supportsNativeMediaSources()) {
    return new HtmlMediaSource();
  }

  throw new Error('Cannot use create a virtual MediaSource for this video');
};

MediaSource.open = open;
MediaSource.supportsNativeMediaSources = supportsNativeMediaSources;

/**
 * A wrapper around the native URL for our MSE object
 * implementation, this object is exposed under videojs.URL
 *
 * @link https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
 */
export const URL = {
  /**
   * A wrapper around the native createObjectURL for our objects.
   * This function maps a native or emulated mediaSource to a blob
   * url so that it can be loaded into video.js
   *
   * @link https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL
   * @param {MediaSource} object the object to create a blob url to
   */
  createObjectURL(object) {
    let objectUrlPrefix = 'blob:vjs-media-source/';
    let url;

    // use the native MediaSource to generate an object URL
    if (object instanceof HtmlMediaSource) {
      url = window.URL.createObjectURL(object.nativeMediaSource_);
      object.url_ = url;
      return url;
    }
    // if the object isn't an emulated MediaSource, delegate to the
    // native implementation
    if (!(object instanceof HtmlMediaSource)) {
      url = window.URL.createObjectURL(object);
      object.url_ = url;
      return url;
    }

    // build a URL that can be used to map back to the emulated
    // MediaSource
    url = objectUrlPrefix + urlCount;

    urlCount++;

    // setup the mapping back to object
    videojs.mediaSources[url] = object;

    return url;
  }
};

videojs.MediaSource = MediaSource;
videojs.URL = URL;
