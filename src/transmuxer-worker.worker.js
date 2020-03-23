/*! @name @videojs/http-streaming @version 1.11.0-alpha.1 @license Apache-2.0 */
var transmuxerWorker = (function () {
  'use strict';

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   *
   * A lightweight readable stream implemention that handles event dispatching.
   * Objects that inherit from streams should call init in their constructors.
   */

  var Stream = function() {
    this.init = function() {
      var listeners = {};
      /**
       * Add a listener for a specified event type.
       * @param type {string} the event name
       * @param listener {function} the callback to be invoked when an event of
       * the specified type occurs
       */
      this.on = function(type, listener) {
        if (!listeners[type]) {
          listeners[type] = [];
        }
        listeners[type] = listeners[type].concat(listener);
      };
      /**
       * Remove a listener for a specified event type.
       * @param type {string} the event name
       * @param listener {function} a function previously registered for this
       * type of event through `on`
       */
      this.off = function(type, listener) {
        var index;
        if (!listeners[type]) {
          return false;
        }
        index = listeners[type].indexOf(listener);
        listeners[type] = listeners[type].slice();
        listeners[type].splice(index, 1);
        return index > -1;
      };
      /**
       * Trigger an event of the specified type on this stream. Any additional
       * arguments to this function are passed as parameters to event listeners.
       * @param type {string} the event name
       */
      this.trigger = function(type) {
        var callbacks, i, length, args;
        callbacks = listeners[type];
        if (!callbacks) {
          return;
        }
        // Slicing the arguments on every invocation of this method
        // can add a significant amount of overhead. Avoid the
        // intermediate object creation for the common case of a
        // single callback argument
        if (arguments.length === 2) {
          length = callbacks.length;
          for (i = 0; i < length; ++i) {
            callbacks[i].call(this, arguments[1]);
          }
        } else {
          args = [];
          i = arguments.length;
          for (i = 1; i < arguments.length; ++i) {
            args.push(arguments[i]);
          }
          length = callbacks.length;
          for (i = 0; i < length; ++i) {
            callbacks[i].apply(this, args);
          }
        }
      };
      /**
       * Destroys the stream and cleans up.
       */
      this.dispose = function() {
        listeners = {};
      };
    };
  };

  /**
   * Forwards all `data` events on this stream to the destination stream. The
   * destination stream should provide a method `push` to receive the data
   * events as they arrive.
   * @param destination {stream} the stream that will receive all `data` events
   * @param autoFlush {boolean} if false, we will not call `flush` on the destination
   *                            when the current stream emits a 'done' event
   * @see http://nodejs.org/api/stream.html#stream_readable_pipe_destination_options
   */
  Stream.prototype.pipe = function(destination) {
    this.on('data', function(data) {
      destination.push(data);
    });

    this.on('done', function(flushSource) {
      destination.flush(flushSource);
    });

    this.on('partialdone', function(flushSource) {
      destination.partialFlush(flushSource);
    });

    this.on('endedtimeline', function(flushSource) {
      destination.endTimeline(flushSource);
    });

    this.on('reset', function(flushSource) {
      destination.reset(flushSource);
    });

    return destination;
  };

  // Default stream functions that are expected to be overridden to perform
  // actual work. These are provided by the prototype as a sort of no-op
  // implementation so that we don't have to check for their existence in the
  // `pipe` function above.
  Stream.prototype.push = function(data) {
    this.trigger('data', data);
  };

  Stream.prototype.flush = function(flushSource) {
    this.trigger('done', flushSource);
  };

  Stream.prototype.partialFlush = function(flushSource) {
    this.trigger('partialdone', flushSource);
  };

  Stream.prototype.endTimeline = function(flushSource) {
    this.trigger('endedtimeline', flushSource);
  };

  Stream.prototype.reset = function(flushSource) {
    this.trigger('reset', flushSource);
  };

  var stream = Stream;

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   *
   * Functions that generate fragmented MP4s suitable for use with Media
   * Source Extensions.
   */

  var UINT32_MAX = Math.pow(2, 32) - 1;

  var box, dinf, esds, ftyp, mdat, mfhd, minf, moof, moov, mvex, mvhd,
      trak, tkhd, mdia, mdhd, hdlr, sdtp, stbl, stsd, traf, trex,
      trun, types, MAJOR_BRAND, MINOR_VERSION, AVC1_BRAND, VIDEO_HDLR,
      AUDIO_HDLR, HDLR_TYPES, VMHD, SMHD, DREF, STCO, STSC, STSZ, STTS;

  // pre-calculate constants
  (function() {
    var i;
    types = {
      avc1: [], // codingname
      avcC: [],
      btrt: [],
      dinf: [],
      dref: [],
      esds: [],
      ftyp: [],
      hdlr: [],
      mdat: [],
      mdhd: [],
      mdia: [],
      mfhd: [],
      minf: [],
      moof: [],
      moov: [],
      mp4a: [], // codingname
      mvex: [],
      mvhd: [],
      pasp: [],
      sdtp: [],
      smhd: [],
      stbl: [],
      stco: [],
      stsc: [],
      stsd: [],
      stsz: [],
      stts: [],
      styp: [],
      tfdt: [],
      tfhd: [],
      traf: [],
      trak: [],
      trun: [],
      trex: [],
      tkhd: [],
      vmhd: []
    };

    // In environments where Uint8Array is undefined (e.g., IE8), skip set up so that we
    // don't throw an error
    if (typeof Uint8Array === 'undefined') {
      return;
    }

    for (i in types) {
      if (types.hasOwnProperty(i)) {
        types[i] = [
          i.charCodeAt(0),
          i.charCodeAt(1),
          i.charCodeAt(2),
          i.charCodeAt(3)
        ];
      }
    }

    MAJOR_BRAND = new Uint8Array([
      'i'.charCodeAt(0),
      's'.charCodeAt(0),
      'o'.charCodeAt(0),
      'm'.charCodeAt(0)
    ]);
    AVC1_BRAND = new Uint8Array([
      'a'.charCodeAt(0),
      'v'.charCodeAt(0),
      'c'.charCodeAt(0),
      '1'.charCodeAt(0)
    ]);
    MINOR_VERSION = new Uint8Array([0, 0, 0, 1]);
    VIDEO_HDLR = new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x00, // pre_defined
      0x76, 0x69, 0x64, 0x65, // handler_type: 'vide'
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x56, 0x69, 0x64, 0x65,
      0x6f, 0x48, 0x61, 0x6e,
      0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'VideoHandler'
    ]);
    AUDIO_HDLR = new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x00, // pre_defined
      0x73, 0x6f, 0x75, 0x6e, // handler_type: 'soun'
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, 0x00, 0x00, // reserved
      0x53, 0x6f, 0x75, 0x6e,
      0x64, 0x48, 0x61, 0x6e,
      0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'SoundHandler'
    ]);
    HDLR_TYPES = {
      video: VIDEO_HDLR,
      audio: AUDIO_HDLR
    };
    DREF = new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x01, // entry_count
      0x00, 0x00, 0x00, 0x0c, // entry_size
      0x75, 0x72, 0x6c, 0x20, // 'url' type
      0x00, // version 0
      0x00, 0x00, 0x01 // entry_flags
    ]);
    SMHD = new Uint8Array([
      0x00,             // version
      0x00, 0x00, 0x00, // flags
      0x00, 0x00,       // balance, 0 means centered
      0x00, 0x00        // reserved
    ]);
    STCO = new Uint8Array([
      0x00, // version
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x00 // entry_count
    ]);
    STSC = STCO;
    STSZ = new Uint8Array([
      0x00, // version
      0x00, 0x00, 0x00, // flags
      0x00, 0x00, 0x00, 0x00, // sample_size
      0x00, 0x00, 0x00, 0x00 // sample_count
    ]);
    STTS = STCO;
    VMHD = new Uint8Array([
      0x00, // version
      0x00, 0x00, 0x01, // flags
      0x00, 0x00, // graphicsmode
      0x00, 0x00,
      0x00, 0x00,
      0x00, 0x00 // opcolor
    ]);
  }());

  box = function(type) {
    var
      payload = [],
      size = 0,
      i,
      result,
      view;

    for (i = 1; i < arguments.length; i++) {
      payload.push(arguments[i]);
    }

    i = payload.length;

    // calculate the total size we need to allocate
    while (i--) {
      size += payload[i].byteLength;
    }
    result = new Uint8Array(size + 8);
    view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    view.setUint32(0, result.byteLength);
    result.set(type, 4);

    // copy the payload into the result
    for (i = 0, size = 8; i < payload.length; i++) {
      result.set(payload[i], size);
      size += payload[i].byteLength;
    }
    return result;
  };

  dinf = function() {
    return box(types.dinf, box(types.dref, DREF));
  };

  esds = function(track) {
    return box(types.esds, new Uint8Array([
      0x00, // version
      0x00, 0x00, 0x00, // flags

      // ES_Descriptor
      0x03, // tag, ES_DescrTag
      0x19, // length
      0x00, 0x00, // ES_ID
      0x00, // streamDependenceFlag, URL_flag, reserved, streamPriority

      // DecoderConfigDescriptor
      0x04, // tag, DecoderConfigDescrTag
      0x11, // length
      0x40, // object type
      0x15,  // streamType
      0x00, 0x06, 0x00, // bufferSizeDB
      0x00, 0x00, 0xda, 0xc0, // maxBitrate
      0x00, 0x00, 0xda, 0xc0, // avgBitrate

      // DecoderSpecificInfo
      0x05, // tag, DecoderSpecificInfoTag
      0x02, // length
      // ISO/IEC 14496-3, AudioSpecificConfig
      // for samplingFrequencyIndex see ISO/IEC 13818-7:2006, 8.1.3.2.2, Table 35
      (track.audioobjecttype << 3) | (track.samplingfrequencyindex >>> 1),
      (track.samplingfrequencyindex << 7) | (track.channelcount << 3),
      0x06, 0x01, 0x02 // GASpecificConfig
    ]));
  };

  ftyp = function() {
    return box(types.ftyp, MAJOR_BRAND, MINOR_VERSION, MAJOR_BRAND, AVC1_BRAND);
  };

  hdlr = function(type) {
    return box(types.hdlr, HDLR_TYPES[type]);
  };
  mdat = function(data) {
    return box(types.mdat, data);
  };
  mdhd = function(track) {
    var result = new Uint8Array([
      0x00,                   // version 0
      0x00, 0x00, 0x00,       // flags
      0x00, 0x00, 0x00, 0x02, // creation_time
      0x00, 0x00, 0x00, 0x03, // modification_time
      0x00, 0x01, 0x5f, 0x90, // timescale, 90,000 "ticks" per second

      (track.duration >>> 24) & 0xFF,
      (track.duration >>> 16) & 0xFF,
      (track.duration >>>  8) & 0xFF,
      track.duration & 0xFF,  // duration
      0x55, 0xc4,             // 'und' language (undetermined)
      0x00, 0x00
    ]);

    // Use the sample rate from the track metadata, when it is
    // defined. The sample rate can be parsed out of an ADTS header, for
    // instance.
    if (track.samplerate) {
      result[12] = (track.samplerate >>> 24) & 0xFF;
      result[13] = (track.samplerate >>> 16) & 0xFF;
      result[14] = (track.samplerate >>>  8) & 0xFF;
      result[15] = (track.samplerate)        & 0xFF;
    }

    return box(types.mdhd, result);
  };
  mdia = function(track) {
    return box(types.mdia, mdhd(track), hdlr(track.type), minf(track));
  };
  mfhd = function(sequenceNumber) {
    return box(types.mfhd, new Uint8Array([
      0x00,
      0x00, 0x00, 0x00, // flags
      (sequenceNumber & 0xFF000000) >> 24,
      (sequenceNumber & 0xFF0000) >> 16,
      (sequenceNumber & 0xFF00) >> 8,
      sequenceNumber & 0xFF // sequence_number
    ]));
  };
  minf = function(track) {
    return box(types.minf,
               track.type === 'video' ? box(types.vmhd, VMHD) : box(types.smhd, SMHD),
               dinf(),
               stbl(track));
  };
  moof = function(sequenceNumber, tracks) {
    var
      trackFragments = [],
      i = tracks.length;
    // build traf boxes for each track fragment
    while (i--) {
      trackFragments[i] = traf(tracks[i]);
    }
    return box.apply(null, [
      types.moof,
      mfhd(sequenceNumber)
    ].concat(trackFragments));
  };
  /**
   * Returns a movie box.
   * @param tracks {array} the tracks associated with this movie
   * @see ISO/IEC 14496-12:2012(E), section 8.2.1
   */
  moov = function(tracks) {
    var
      i = tracks.length,
      boxes = [];

    while (i--) {
      boxes[i] = trak(tracks[i]);
    }

    return box.apply(null, [types.moov, mvhd(0xffffffff)].concat(boxes).concat(mvex(tracks)));
  };
  mvex = function(tracks) {
    var
      i = tracks.length,
      boxes = [];

    while (i--) {
      boxes[i] = trex(tracks[i]);
    }
    return box.apply(null, [types.mvex].concat(boxes));
  };
  mvhd = function(duration) {
    var
      bytes = new Uint8Array([
        0x00, // version 0
        0x00, 0x00, 0x00, // flags
        0x00, 0x00, 0x00, 0x01, // creation_time
        0x00, 0x00, 0x00, 0x02, // modification_time
        0x00, 0x01, 0x5f, 0x90, // timescale, 90,000 "ticks" per second
        (duration & 0xFF000000) >> 24,
        (duration & 0xFF0000) >> 16,
        (duration & 0xFF00) >> 8,
        duration & 0xFF, // duration
        0x00, 0x01, 0x00, 0x00, // 1.0 rate
        0x01, 0x00, // 1.0 volume
        0x00, 0x00, // reserved
        0x00, 0x00, 0x00, 0x00, // reserved
        0x00, 0x00, 0x00, 0x00, // reserved
        0x00, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, // pre_defined
        0xff, 0xff, 0xff, 0xff // next_track_ID
      ]);
    return box(types.mvhd, bytes);
  };

  sdtp = function(track) {
    var
      samples = track.samples || [],
      bytes = new Uint8Array(4 + samples.length),
      flags,
      i;

    // leave the full box header (4 bytes) all zero

    // write the sample table
    for (i = 0; i < samples.length; i++) {
      flags = samples[i].flags;

      bytes[i + 4] = (flags.dependsOn << 4) |
        (flags.isDependedOn << 2) |
        (flags.hasRedundancy);
    }

    return box(types.sdtp,
               bytes);
  };

  stbl = function(track) {
    return box(types.stbl,
               stsd(track),
               box(types.stts, STTS),
               box(types.stsc, STSC),
               box(types.stsz, STSZ),
               box(types.stco, STCO));
  };

  (function() {
    var videoSample, audioSample;

    stsd = function(track) {

      return box(types.stsd, new Uint8Array([
        0x00, // version 0
        0x00, 0x00, 0x00, // flags
        0x00, 0x00, 0x00, 0x01
      ]), track.type === 'video' ? videoSample(track) : audioSample(track));
    };

    videoSample = function(track) {
      var
        sps = track.sps || [],
        pps = track.pps || [],
        sequenceParameterSets = [],
        pictureParameterSets = [],
        i,
        avc1Box;

      // assemble the SPSs
      for (i = 0; i < sps.length; i++) {
        sequenceParameterSets.push((sps[i].byteLength & 0xFF00) >>> 8);
        sequenceParameterSets.push((sps[i].byteLength & 0xFF)); // sequenceParameterSetLength
        sequenceParameterSets = sequenceParameterSets.concat(Array.prototype.slice.call(sps[i])); // SPS
      }

      // assemble the PPSs
      for (i = 0; i < pps.length; i++) {
        pictureParameterSets.push((pps[i].byteLength & 0xFF00) >>> 8);
        pictureParameterSets.push((pps[i].byteLength & 0xFF));
        pictureParameterSets = pictureParameterSets.concat(Array.prototype.slice.call(pps[i]));
      }

      avc1Box = [
        types.avc1, new Uint8Array([
          0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, // reserved
          0x00, 0x01, // data_reference_index
          0x00, 0x00, // pre_defined
          0x00, 0x00, // reserved
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, // pre_defined
          (track.width & 0xff00) >> 8,
          track.width & 0xff, // width
          (track.height & 0xff00) >> 8,
          track.height & 0xff, // height
          0x00, 0x48, 0x00, 0x00, // horizresolution
          0x00, 0x48, 0x00, 0x00, // vertresolution
          0x00, 0x00, 0x00, 0x00, // reserved
          0x00, 0x01, // frame_count
          0x13,
          0x76, 0x69, 0x64, 0x65,
          0x6f, 0x6a, 0x73, 0x2d,
          0x63, 0x6f, 0x6e, 0x74,
          0x72, 0x69, 0x62, 0x2d,
          0x68, 0x6c, 0x73, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, // compressorname
          0x00, 0x18, // depth = 24
          0x11, 0x11 // pre_defined = -1
        ]),
        box(types.avcC, new Uint8Array([
          0x01, // configurationVersion
          track.profileIdc, // AVCProfileIndication
          track.profileCompatibility, // profile_compatibility
          track.levelIdc, // AVCLevelIndication
          0xff // lengthSizeMinusOne, hard-coded to 4 bytes
        ].concat(
          [sps.length], // numOfSequenceParameterSets
          sequenceParameterSets, // "SPS"
          [pps.length], // numOfPictureParameterSets
          pictureParameterSets // "PPS"
        ))),
        box(types.btrt, new Uint8Array([
          0x00, 0x1c, 0x9c, 0x80, // bufferSizeDB
          0x00, 0x2d, 0xc6, 0xc0, // maxBitrate
          0x00, 0x2d, 0xc6, 0xc0 // avgBitrate
        ]))
      ];

      if (track.sarRatio) {
        var
          hSpacing = track.sarRatio[0],
          vSpacing = track.sarRatio[1];

          avc1Box.push(
            box(types.pasp, new Uint8Array([
              (hSpacing & 0xFF000000) >> 24,
              (hSpacing & 0xFF0000) >> 16,
              (hSpacing & 0xFF00) >> 8,
              hSpacing & 0xFF,
              (vSpacing & 0xFF000000) >> 24,
              (vSpacing & 0xFF0000) >> 16,
              (vSpacing & 0xFF00) >> 8,
              vSpacing & 0xFF
            ]))
          );
      }

      return box.apply(null, avc1Box);
    };

    audioSample = function(track) {
      return box(types.mp4a, new Uint8Array([

        // SampleEntry, ISO/IEC 14496-12
        0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, // reserved
        0x00, 0x01, // data_reference_index

        // AudioSampleEntry, ISO/IEC 14496-12
        0x00, 0x00, 0x00, 0x00, // reserved
        0x00, 0x00, 0x00, 0x00, // reserved
        (track.channelcount & 0xff00) >> 8,
        (track.channelcount & 0xff), // channelcount

        (track.samplesize & 0xff00) >> 8,
        (track.samplesize & 0xff), // samplesize
        0x00, 0x00, // pre_defined
        0x00, 0x00, // reserved

        (track.samplerate & 0xff00) >> 8,
        (track.samplerate & 0xff),
        0x00, 0x00 // samplerate, 16.16

        // MP4AudioSampleEntry, ISO/IEC 14496-14
      ]), esds(track));
    };
  }());

  tkhd = function(track) {
    var result = new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x07, // flags
      0x00, 0x00, 0x00, 0x00, // creation_time
      0x00, 0x00, 0x00, 0x00, // modification_time
      (track.id & 0xFF000000) >> 24,
      (track.id & 0xFF0000) >> 16,
      (track.id & 0xFF00) >> 8,
      track.id & 0xFF, // track_ID
      0x00, 0x00, 0x00, 0x00, // reserved
      (track.duration & 0xFF000000) >> 24,
      (track.duration & 0xFF0000) >> 16,
      (track.duration & 0xFF00) >> 8,
      track.duration & 0xFF, // duration
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // reserved
      0x00, 0x00, // layer
      0x00, 0x00, // alternate_group
      0x01, 0x00, // non-audio track volume
      0x00, 0x00, // reserved
      0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
      (track.width & 0xFF00) >> 8,
      track.width & 0xFF,
      0x00, 0x00, // width
      (track.height & 0xFF00) >> 8,
      track.height & 0xFF,
      0x00, 0x00 // height
    ]);

    return box(types.tkhd, result);
  };

  /**
   * Generate a track fragment (traf) box. A traf box collects metadata
   * about tracks in a movie fragment (moof) box.
   */
  traf = function(track) {
    var trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun,
        sampleDependencyTable, dataOffset,
        upperWordBaseMediaDecodeTime, lowerWordBaseMediaDecodeTime;

    trackFragmentHeader = box(types.tfhd, new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x3a, // flags
      (track.id & 0xFF000000) >> 24,
      (track.id & 0xFF0000) >> 16,
      (track.id & 0xFF00) >> 8,
      (track.id & 0xFF), // track_ID
      0x00, 0x00, 0x00, 0x01, // sample_description_index
      0x00, 0x00, 0x00, 0x00, // default_sample_duration
      0x00, 0x00, 0x00, 0x00, // default_sample_size
      0x00, 0x00, 0x00, 0x00  // default_sample_flags
    ]));

    upperWordBaseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime / (UINT32_MAX + 1));
    lowerWordBaseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime % (UINT32_MAX + 1));

    trackFragmentDecodeTime = box(types.tfdt, new Uint8Array([
      0x01, // version 1
      0x00, 0x00, 0x00, // flags
      // baseMediaDecodeTime
      (upperWordBaseMediaDecodeTime >>> 24) & 0xFF,
      (upperWordBaseMediaDecodeTime >>> 16) & 0xFF,
      (upperWordBaseMediaDecodeTime >>>  8) & 0xFF,
      upperWordBaseMediaDecodeTime & 0xFF,
      (lowerWordBaseMediaDecodeTime >>> 24) & 0xFF,
      (lowerWordBaseMediaDecodeTime >>> 16) & 0xFF,
      (lowerWordBaseMediaDecodeTime >>>  8) & 0xFF,
      lowerWordBaseMediaDecodeTime & 0xFF
    ]));

    // the data offset specifies the number of bytes from the start of
    // the containing moof to the first payload byte of the associated
    // mdat
    dataOffset = (32 + // tfhd
                  20 + // tfdt
                  8 +  // traf header
                  16 + // mfhd
                  8 +  // moof header
                  8);  // mdat header

    // audio tracks require less metadata
    if (track.type === 'audio') {
      trackFragmentRun = trun(track, dataOffset);
      return box(types.traf,
                 trackFragmentHeader,
                 trackFragmentDecodeTime,
                 trackFragmentRun);
    }

    // video tracks should contain an independent and disposable samples
    // box (sdtp)
    // generate one and adjust offsets to match
    sampleDependencyTable = sdtp(track);
    trackFragmentRun = trun(track,
                            sampleDependencyTable.length + dataOffset);
    return box(types.traf,
               trackFragmentHeader,
               trackFragmentDecodeTime,
               trackFragmentRun,
               sampleDependencyTable);
  };

  /**
   * Generate a track box.
   * @param track {object} a track definition
   * @return {Uint8Array} the track box
   */
  trak = function(track) {
    track.duration = track.duration || 0xffffffff;
    return box(types.trak,
               tkhd(track),
               mdia(track));
  };

  trex = function(track) {
    var result = new Uint8Array([
      0x00, // version 0
      0x00, 0x00, 0x00, // flags
      (track.id & 0xFF000000) >> 24,
      (track.id & 0xFF0000) >> 16,
      (track.id & 0xFF00) >> 8,
      (track.id & 0xFF), // track_ID
      0x00, 0x00, 0x00, 0x01, // default_sample_description_index
      0x00, 0x00, 0x00, 0x00, // default_sample_duration
      0x00, 0x00, 0x00, 0x00, // default_sample_size
      0x00, 0x01, 0x00, 0x01 // default_sample_flags
    ]);
    // the last two bytes of default_sample_flags is the sample
    // degradation priority, a hint about the importance of this sample
    // relative to others. Lower the degradation priority for all sample
    // types other than video.
    if (track.type !== 'video') {
      result[result.length - 1] = 0x00;
    }

    return box(types.trex, result);
  };

  (function() {
    var audioTrun, videoTrun, trunHeader;

    // This method assumes all samples are uniform. That is, if a
    // duration is present for the first sample, it will be present for
    // all subsequent samples.
    // see ISO/IEC 14496-12:2012, Section 8.8.8.1
    trunHeader = function(samples, offset) {
      var durationPresent = 0, sizePresent = 0,
          flagsPresent = 0, compositionTimeOffset = 0;

      // trun flag constants
      if (samples.length) {
        if (samples[0].duration !== undefined) {
          durationPresent = 0x1;
        }
        if (samples[0].size !== undefined) {
          sizePresent = 0x2;
        }
        if (samples[0].flags !== undefined) {
          flagsPresent = 0x4;
        }
        if (samples[0].compositionTimeOffset !== undefined) {
          compositionTimeOffset = 0x8;
        }
      }

      return [
        0x00, // version 0
        0x00,
        durationPresent | sizePresent | flagsPresent | compositionTimeOffset,
        0x01, // flags
        (samples.length & 0xFF000000) >>> 24,
        (samples.length & 0xFF0000) >>> 16,
        (samples.length & 0xFF00) >>> 8,
        samples.length & 0xFF, // sample_count
        (offset & 0xFF000000) >>> 24,
        (offset & 0xFF0000) >>> 16,
        (offset & 0xFF00) >>> 8,
        offset & 0xFF // data_offset
      ];
    };

    videoTrun = function(track, offset) {
      var bytesOffest, bytes, header, samples, sample, i;

      samples = track.samples || [];
      offset += 8 + 12 + (16 * samples.length);
      header = trunHeader(samples, offset);
      bytes = new Uint8Array(header.length + samples.length * 16);
      bytes.set(header);
      bytesOffest = header.length;

      for (i = 0; i < samples.length; i++) {
        sample = samples[i];

        bytes[bytesOffest++] = (sample.duration & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.duration & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.duration & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.duration & 0xFF; // sample_duration
        bytes[bytesOffest++] = (sample.size & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.size & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.size & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.size & 0xFF; // sample_size
        bytes[bytesOffest++] = (sample.flags.isLeading << 2) | sample.flags.dependsOn;
        bytes[bytesOffest++] = (sample.flags.isDependedOn << 6) |
            (sample.flags.hasRedundancy << 4) |
            (sample.flags.paddingValue << 1) |
            sample.flags.isNonSyncSample;
        bytes[bytesOffest++] = sample.flags.degradationPriority & 0xF0 << 8;
        bytes[bytesOffest++] = sample.flags.degradationPriority & 0x0F; // sample_flags
        bytes[bytesOffest++] = (sample.compositionTimeOffset & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.compositionTimeOffset & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.compositionTimeOffset & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.compositionTimeOffset & 0xFF; // sample_composition_time_offset
      }
      return box(types.trun, bytes);
    };

    audioTrun = function(track, offset) {
      var bytes, bytesOffest, header, samples, sample, i;

      samples = track.samples || [];
      offset += 8 + 12 + (8 * samples.length);

      header = trunHeader(samples, offset);
      bytes = new Uint8Array(header.length + samples.length * 8);
      bytes.set(header);
      bytesOffest = header.length;

      for (i = 0; i < samples.length; i++) {
        sample = samples[i];
        bytes[bytesOffest++] = (sample.duration & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.duration & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.duration & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.duration & 0xFF; // sample_duration
        bytes[bytesOffest++] = (sample.size & 0xFF000000) >>> 24;
        bytes[bytesOffest++] = (sample.size & 0xFF0000) >>> 16;
        bytes[bytesOffest++] = (sample.size & 0xFF00) >>> 8;
        bytes[bytesOffest++] = sample.size & 0xFF; // sample_size
      }

      return box(types.trun, bytes);
    };

    trun = function(track, offset) {
      if (track.type === 'audio') {
        return audioTrun(track, offset);
      }

      return videoTrun(track, offset);
    };
  }());

  var mp4Generator = {
    ftyp: ftyp,
    mdat: mdat,
    moof: moof,
    moov: moov,
    initSegment: function(tracks) {
      var
        fileType = ftyp(),
        movie = moov(tracks),
        result;

      result = new Uint8Array(fileType.byteLength + movie.byteLength);
      result.set(fileType);
      result.set(movie, fileType.byteLength);
      return result;
    }
  };

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */
  // Convert an array of nal units into an array of frames with each frame being
  // composed of the nal units that make up that frame
  // Also keep track of cummulative data about the frame from the nal units such
  // as the frame duration, starting pts, etc.
  var groupNalsIntoFrames = function(nalUnits) {
    var
      i,
      currentNal,
      currentFrame = [],
      frames = [];

    // TODO added for LHLS, make sure this is OK
    frames.byteLength = 0;
    frames.nalCount = 0;
    frames.duration = 0;

    currentFrame.byteLength = 0;

    for (i = 0; i < nalUnits.length; i++) {
      currentNal = nalUnits[i];

      // Split on 'aud'-type nal units
      if (currentNal.nalUnitType === 'access_unit_delimiter_rbsp') {
        // Since the very first nal unit is expected to be an AUD
        // only push to the frames array when currentFrame is not empty
        if (currentFrame.length) {
          currentFrame.duration = currentNal.dts - currentFrame.dts;
          // TODO added for LHLS, make sure this is OK
          frames.byteLength += currentFrame.byteLength;
          frames.nalCount += currentFrame.length;
          frames.duration += currentFrame.duration;
          frames.push(currentFrame);
        }
        currentFrame = [currentNal];
        currentFrame.byteLength = currentNal.data.byteLength;
        currentFrame.pts = currentNal.pts;
        currentFrame.dts = currentNal.dts;
      } else {
        // Specifically flag key frames for ease of use later
        if (currentNal.nalUnitType === 'slice_layer_without_partitioning_rbsp_idr') {
          currentFrame.keyFrame = true;
        }
        currentFrame.duration = currentNal.dts - currentFrame.dts;
        currentFrame.byteLength += currentNal.data.byteLength;
        currentFrame.push(currentNal);
      }
    }

    // For the last frame, use the duration of the previous frame if we
    // have nothing better to go on
    if (frames.length &&
        (!currentFrame.duration ||
         currentFrame.duration <= 0)) {
      currentFrame.duration = frames[frames.length - 1].duration;
    }

    // Push the final frame
    // TODO added for LHLS, make sure this is OK
    frames.byteLength += currentFrame.byteLength;
    frames.nalCount += currentFrame.length;
    frames.duration += currentFrame.duration;

    frames.push(currentFrame);
    return frames;
  };

  // Convert an array of frames into an array of Gop with each Gop being composed
  // of the frames that make up that Gop
  // Also keep track of cummulative data about the Gop from the frames such as the
  // Gop duration, starting pts, etc.
  var groupFramesIntoGops = function(frames) {
    var
      i,
      currentFrame,
      currentGop = [],
      gops = [];

    // We must pre-set some of the values on the Gop since we
    // keep running totals of these values
    currentGop.byteLength = 0;
    currentGop.nalCount = 0;
    currentGop.duration = 0;
    currentGop.pts = frames[0].pts;
    currentGop.dts = frames[0].dts;

    // store some metadata about all the Gops
    gops.byteLength = 0;
    gops.nalCount = 0;
    gops.duration = 0;
    gops.pts = frames[0].pts;
    gops.dts = frames[0].dts;

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];

      if (currentFrame.keyFrame) {
        // Since the very first frame is expected to be an keyframe
        // only push to the gops array when currentGop is not empty
        if (currentGop.length) {
          gops.push(currentGop);
          gops.byteLength += currentGop.byteLength;
          gops.nalCount += currentGop.nalCount;
          gops.duration += currentGop.duration;
        }

        currentGop = [currentFrame];
        currentGop.nalCount = currentFrame.length;
        currentGop.byteLength = currentFrame.byteLength;
        currentGop.pts = currentFrame.pts;
        currentGop.dts = currentFrame.dts;
        currentGop.duration = currentFrame.duration;
      } else {
        currentGop.duration += currentFrame.duration;
        currentGop.nalCount += currentFrame.length;
        currentGop.byteLength += currentFrame.byteLength;
        currentGop.push(currentFrame);
      }
    }

    if (gops.length && currentGop.duration <= 0) {
      currentGop.duration = gops[gops.length - 1].duration;
    }
    gops.byteLength += currentGop.byteLength;
    gops.nalCount += currentGop.nalCount;
    gops.duration += currentGop.duration;

    // push the final Gop
    gops.push(currentGop);
    return gops;
  };

  /*
   * Search for the first keyframe in the GOPs and throw away all frames
   * until that keyframe. Then extend the duration of the pulled keyframe
   * and pull the PTS and DTS of the keyframe so that it covers the time
   * range of the frames that were disposed.
   *
   * @param {Array} gops video GOPs
   * @returns {Array} modified video GOPs
   */
  var extendFirstKeyFrame = function(gops) {
    var currentGop;

    if (!gops[0][0].keyFrame && gops.length > 1) {
      // Remove the first GOP
      currentGop = gops.shift();

      gops.byteLength -= currentGop.byteLength;
      gops.nalCount -= currentGop.nalCount;

      // Extend the first frame of what is now the
      // first gop to cover the time period of the
      // frames we just removed
      gops[0][0].dts = currentGop.dts;
      gops[0][0].pts = currentGop.pts;
      gops[0][0].duration += currentGop.duration;
    }

    return gops;
  };

  /**
   * Default sample object
   * see ISO/IEC 14496-12:2012, section 8.6.4.3
   */
  var createDefaultSample = function() {
    return {
      size: 0,
      flags: {
        isLeading: 0,
        dependsOn: 1,
        isDependedOn: 0,
        hasRedundancy: 0,
        degradationPriority: 0,
        isNonSyncSample: 1
      }
    };
  };

  /*
   * Collates information from a video frame into an object for eventual
   * entry into an MP4 sample table.
   *
   * @param {Object} frame the video frame
   * @param {Number} dataOffset the byte offset to position the sample
   * @return {Object} object containing sample table info for a frame
   */
  var sampleForFrame = function(frame, dataOffset) {
    var sample = createDefaultSample();

    sample.dataOffset = dataOffset;
    sample.compositionTimeOffset = frame.pts - frame.dts;
    sample.duration = frame.duration;
    sample.size = 4 * frame.length; // Space for nal unit size
    sample.size += frame.byteLength;

    if (frame.keyFrame) {
      sample.flags.dependsOn = 2;
      sample.flags.isNonSyncSample = 0;
    }

    return sample;
  };

  // generate the track's sample table from an array of gops
  var generateSampleTable = function(gops, baseDataOffset) {
    var
      h, i,
      sample,
      currentGop,
      currentFrame,
      dataOffset = baseDataOffset || 0,
      samples = [];

    for (h = 0; h < gops.length; h++) {
      currentGop = gops[h];

      for (i = 0; i < currentGop.length; i++) {
        currentFrame = currentGop[i];

        sample = sampleForFrame(currentFrame, dataOffset);

        dataOffset += sample.size;

        samples.push(sample);
      }
    }
    return samples;
  };

  // generate the track's raw mdat data from an array of gops
  var concatenateNalData = function(gops) {
    var
      h, i, j,
      currentGop,
      currentFrame,
      currentNal,
      dataOffset = 0,
      nalsByteLength = gops.byteLength,
      numberOfNals = gops.nalCount,
      totalByteLength = nalsByteLength + 4 * numberOfNals,
      data = new Uint8Array(totalByteLength),
      view = new DataView(data.buffer);

    // For each Gop..
    for (h = 0; h < gops.length; h++) {
      currentGop = gops[h];

      // For each Frame..
      for (i = 0; i < currentGop.length; i++) {
        currentFrame = currentGop[i];

        // For each NAL..
        for (j = 0; j < currentFrame.length; j++) {
          currentNal = currentFrame[j];

          view.setUint32(dataOffset, currentNal.data.byteLength);
          dataOffset += 4;
          data.set(currentNal.data, dataOffset);
          dataOffset += currentNal.data.byteLength;
        }
      }
    }
    return data;
  };

  // generate the track's sample table from a frame
  var generateSampleTableForFrame = function(frame, baseDataOffset) {
    var
      sample,
      dataOffset = baseDataOffset || 0,
      samples = [];

    sample = sampleForFrame(frame, dataOffset);
    samples.push(sample);

    return samples;
  };

  // generate the track's raw mdat data from a frame
  var concatenateNalDataForFrame = function(frame) {
    var
      i,
      currentNal,
      dataOffset = 0,
      nalsByteLength = frame.byteLength,
      numberOfNals = frame.length,
      totalByteLength = nalsByteLength + 4 * numberOfNals,
      data = new Uint8Array(totalByteLength),
      view = new DataView(data.buffer);

    // For each NAL..
    for (i = 0; i < frame.length; i++) {
      currentNal = frame[i];

      view.setUint32(dataOffset, currentNal.data.byteLength);
      dataOffset += 4;
      data.set(currentNal.data, dataOffset);
      dataOffset += currentNal.data.byteLength;
    }

    return data;
  };

  var frameUtils = {
    groupNalsIntoFrames: groupNalsIntoFrames,
    groupFramesIntoGops: groupFramesIntoGops,
    extendFirstKeyFrame: extendFirstKeyFrame,
    generateSampleTable: generateSampleTable,
    concatenateNalData: concatenateNalData,
    generateSampleTableForFrame: generateSampleTableForFrame,
    concatenateNalDataForFrame: concatenateNalDataForFrame
  };

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */
  var highPrefix = [33, 16, 5, 32, 164, 27];
  var lowPrefix = [33, 65, 108, 84, 1, 2, 4, 8, 168, 2, 4, 8, 17, 191, 252];
  var zeroFill = function(count) {
    var a = [];
    while (count--) {
      a.push(0);
    }
    return a;
  };

  var makeTable = function(metaTable) {
    return Object.keys(metaTable).reduce(function(obj, key) {
      obj[key] = new Uint8Array(metaTable[key].reduce(function(arr, part) {
        return arr.concat(part);
      }, []));
      return obj;
    }, {});
  };


  var silence;

  var silence_1 = function() {
    if (!silence) {
      // Frames-of-silence to use for filling in missing AAC frames
      var coneOfSilence = {
        96000: [highPrefix, [227, 64], zeroFill(154), [56]],
        88200: [highPrefix, [231], zeroFill(170), [56]],
        64000: [highPrefix, [248, 192], zeroFill(240), [56]],
        48000: [highPrefix, [255, 192], zeroFill(268), [55, 148, 128], zeroFill(54), [112]],
        44100: [highPrefix, [255, 192], zeroFill(268), [55, 163, 128], zeroFill(84), [112]],
        32000: [highPrefix, [255, 192], zeroFill(268), [55, 234], zeroFill(226), [112]],
        24000: [highPrefix, [255, 192], zeroFill(268), [55, 255, 128], zeroFill(268), [111, 112], zeroFill(126), [224]],
        16000: [highPrefix, [255, 192], zeroFill(268), [55, 255, 128], zeroFill(268), [111, 255], zeroFill(269), [223, 108], zeroFill(195), [1, 192]],
        12000: [lowPrefix, zeroFill(268), [3, 127, 248], zeroFill(268), [6, 255, 240], zeroFill(268), [13, 255, 224], zeroFill(268), [27, 253, 128], zeroFill(259), [56]],
        11025: [lowPrefix, zeroFill(268), [3, 127, 248], zeroFill(268), [6, 255, 240], zeroFill(268), [13, 255, 224], zeroFill(268), [27, 255, 192], zeroFill(268), [55, 175, 128], zeroFill(108), [112]],
        8000: [lowPrefix, zeroFill(268), [3, 121, 16], zeroFill(47), [7]]
      };
      silence = makeTable(coneOfSilence);
    }
    return silence;
  };

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */
  var
    ONE_SECOND_IN_TS = 90000, // 90kHz clock
    secondsToVideoTs,
    secondsToAudioTs,
    videoTsToSeconds,
    audioTsToSeconds,
    audioTsToVideoTs,
    videoTsToAudioTs,
    metadataTsToSeconds;

  secondsToVideoTs = function(seconds) {
    return seconds * ONE_SECOND_IN_TS;
  };

  secondsToAudioTs = function(seconds, sampleRate) {
    return seconds * sampleRate;
  };

  videoTsToSeconds = function(timestamp) {
    return timestamp / ONE_SECOND_IN_TS;
  };

  audioTsToSeconds = function(timestamp, sampleRate) {
    return timestamp / sampleRate;
  };

  audioTsToVideoTs = function(timestamp, sampleRate) {
    return secondsToVideoTs(audioTsToSeconds(timestamp, sampleRate));
  };

  videoTsToAudioTs = function(timestamp, sampleRate) {
    return secondsToAudioTs(videoTsToSeconds(timestamp), sampleRate);
  };

  /**
   * Adjust ID3 tag or caption timing information by the timeline pts values
   * (if keepOriginalTimestamps is false) and convert to seconds
   */
  metadataTsToSeconds = function(timestamp, timelineStartPts, keepOriginalTimestamps) {
    return videoTsToSeconds(keepOriginalTimestamps ? timestamp : timestamp - timelineStartPts);
  };

  var clock = {
    ONE_SECOND_IN_TS: ONE_SECOND_IN_TS,
    secondsToVideoTs: secondsToVideoTs,
    secondsToAudioTs: secondsToAudioTs,
    videoTsToSeconds: videoTsToSeconds,
    audioTsToSeconds: audioTsToSeconds,
    audioTsToVideoTs: audioTsToVideoTs,
    videoTsToAudioTs: videoTsToAudioTs,
    metadataTsToSeconds: metadataTsToSeconds
  };
  var clock_2 = clock.secondsToVideoTs;
  var clock_4 = clock.videoTsToSeconds;

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */



  /**
   * Sum the `byteLength` properties of the data in each AAC frame
   */
  var sumFrameByteLengths = function(array) {
    var
      i,
      currentObj,
      sum = 0;

    // sum the byteLength's all each nal unit in the frame
    for (i = 0; i < array.length; i++) {
      currentObj = array[i];
      sum += currentObj.data.byteLength;
    }

    return sum;
  };

  // Possibly pad (prefix) the audio track with silence if appending this track
  // would lead to the introduction of a gap in the audio buffer
  var prefixWithSilence = function(
    track,
    frames,
    audioAppendStartTs,
    videoBaseMediaDecodeTime
  ) {
    var
      baseMediaDecodeTimeTs,
      frameDuration = 0,
      audioGapDuration = 0,
      audioFillFrameCount = 0,
      audioFillDuration = 0,
      silentFrame,
      i,
      firstFrame;

    if (!frames.length) {
      return;
    }

    baseMediaDecodeTimeTs =
      clock.audioTsToVideoTs(track.baseMediaDecodeTime, track.samplerate);
    // determine frame clock duration based on sample rate, round up to avoid overfills
    frameDuration = Math.ceil(clock.ONE_SECOND_IN_TS / (track.samplerate / 1024));

    if (audioAppendStartTs && videoBaseMediaDecodeTime) {
      // insert the shortest possible amount (audio gap or audio to video gap)
      audioGapDuration =
        baseMediaDecodeTimeTs - Math.max(audioAppendStartTs, videoBaseMediaDecodeTime);
      // number of full frames in the audio gap
      audioFillFrameCount = Math.floor(audioGapDuration / frameDuration);
      audioFillDuration = audioFillFrameCount * frameDuration;
    }

    // don't attempt to fill gaps smaller than a single frame or larger
    // than a half second
    if (audioFillFrameCount < 1 || audioFillDuration > clock.ONE_SECOND_IN_TS / 2) {
      return;
    }

    silentFrame = silence_1()[track.samplerate];

    if (!silentFrame) {
      // we don't have a silent frame pregenerated for the sample rate, so use a frame
      // from the content instead
      silentFrame = frames[0].data;
    }

    for (i = 0; i < audioFillFrameCount; i++) {
      firstFrame = frames[0];

      frames.splice(0, 0, {
        data: silentFrame,
        dts: firstFrame.dts - frameDuration,
        pts: firstFrame.pts - frameDuration
      });
    }

    track.baseMediaDecodeTime -=
      Math.floor(clock.videoTsToAudioTs(audioFillDuration, track.samplerate));
  };

  // If the audio segment extends before the earliest allowed dts
  // value, remove AAC frames until starts at or after the earliest
  // allowed DTS so that we don't end up with a negative baseMedia-
  // DecodeTime for the audio track
  var trimAdtsFramesByEarliestDts = function(adtsFrames, track, earliestAllowedDts) {
    if (track.minSegmentDts >= earliestAllowedDts) {
      return adtsFrames;
    }

    // We will need to recalculate the earliest segment Dts
    track.minSegmentDts = Infinity;

    return adtsFrames.filter(function(currentFrame) {
      // If this is an allowed frame, keep it and record it's Dts
      if (currentFrame.dts >= earliestAllowedDts) {
        track.minSegmentDts = Math.min(track.minSegmentDts, currentFrame.dts);
        track.minSegmentPts = track.minSegmentDts;
        return true;
      }
      // Otherwise, discard it
      return false;
    });
  };

  // generate the track's raw mdat data from an array of frames
  var generateSampleTable$1 = function(frames) {
    var
      i,
      currentFrame,
      samples = [];

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];
      samples.push({
        size: currentFrame.data.byteLength,
        duration: 1024 // For AAC audio, all samples contain 1024 samples
      });
    }
    return samples;
  };

  // generate the track's sample table from an array of frames
  var concatenateFrameData = function(frames) {
    var
      i,
      currentFrame,
      dataOffset = 0,
      data = new Uint8Array(sumFrameByteLengths(frames));

    for (i = 0; i < frames.length; i++) {
      currentFrame = frames[i];

      data.set(currentFrame.data, dataOffset);
      dataOffset += currentFrame.data.byteLength;
    }
    return data;
  };

  var audioFrameUtils = {
    prefixWithSilence: prefixWithSilence,
    trimAdtsFramesByEarliestDts: trimAdtsFramesByEarliestDts,
    generateSampleTable: generateSampleTable$1,
    concatenateFrameData: concatenateFrameData
  };

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */
  var ONE_SECOND_IN_TS$1 = clock.ONE_SECOND_IN_TS;

  /**
   * Store information about the start and end of the track and the
   * duration for each frame/sample we process in order to calculate
   * the baseMediaDecodeTime
   */
  var collectDtsInfo = function(track, data) {
    if (typeof data.pts === 'number') {
      if (track.timelineStartInfo.pts === undefined) {
        track.timelineStartInfo.pts = data.pts;
      }

      if (track.minSegmentPts === undefined) {
        track.minSegmentPts = data.pts;
      } else {
        track.minSegmentPts = Math.min(track.minSegmentPts, data.pts);
      }

      if (track.maxSegmentPts === undefined) {
        track.maxSegmentPts = data.pts;
      } else {
        track.maxSegmentPts = Math.max(track.maxSegmentPts, data.pts);
      }
    }

    if (typeof data.dts === 'number') {
      if (track.timelineStartInfo.dts === undefined) {
        track.timelineStartInfo.dts = data.dts;
      }

      if (track.minSegmentDts === undefined) {
        track.minSegmentDts = data.dts;
      } else {
        track.minSegmentDts = Math.min(track.minSegmentDts, data.dts);
      }

      if (track.maxSegmentDts === undefined) {
        track.maxSegmentDts = data.dts;
      } else {
        track.maxSegmentDts = Math.max(track.maxSegmentDts, data.dts);
      }
    }
  };

  /**
   * Clear values used to calculate the baseMediaDecodeTime between
   * tracks
   */
  var clearDtsInfo = function(track) {
    delete track.minSegmentDts;
    delete track.maxSegmentDts;
    delete track.minSegmentPts;
    delete track.maxSegmentPts;
  };

  /**
   * Calculate the track's baseMediaDecodeTime based on the earliest
   * DTS the transmuxer has ever seen and the minimum DTS for the
   * current track
   * @param track {object} track metadata configuration
   * @param keepOriginalTimestamps {boolean} If true, keep the timestamps
   *        in the source; false to adjust the first segment to start at 0.
   */
  var calculateTrackBaseMediaDecodeTime = function(track, keepOriginalTimestamps) {
    var
      baseMediaDecodeTime,
      scale,
      minSegmentDts = track.minSegmentDts;

    // Optionally adjust the time so the first segment starts at zero.
    if (!keepOriginalTimestamps) {
      minSegmentDts -= track.timelineStartInfo.dts;
    }

    // track.timelineStartInfo.baseMediaDecodeTime is the location, in time, where
    // we want the start of the first segment to be placed
    baseMediaDecodeTime = track.timelineStartInfo.baseMediaDecodeTime;

    // Add to that the distance this segment is from the very first
    baseMediaDecodeTime += minSegmentDts;

    // baseMediaDecodeTime must not become negative
    baseMediaDecodeTime = Math.max(0, baseMediaDecodeTime);

    if (track.type === 'audio') {
      // Audio has a different clock equal to the sampling_rate so we need to
      // scale the PTS values into the clock rate of the track
      scale = track.samplerate / ONE_SECOND_IN_TS$1;
      baseMediaDecodeTime *= scale;
      baseMediaDecodeTime = Math.floor(baseMediaDecodeTime);
    }

    return baseMediaDecodeTime;
  };

  var trackDecodeInfo = {
    clearDtsInfo: clearDtsInfo,
    calculateTrackBaseMediaDecodeTime: calculateTrackBaseMediaDecodeTime,
    collectDtsInfo: collectDtsInfo
  };

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   *
   * Reads in-band caption information from a video elementary
   * stream. Captions must follow the CEA-708 standard for injection
   * into an MPEG-2 transport streams.
   * @see https://en.wikipedia.org/wiki/CEA-708
   * @see https://www.gpo.gov/fdsys/pkg/CFR-2007-title47-vol1/pdf/CFR-2007-title47-vol1-sec15-119.pdf
   */

  // Supplemental enhancement information (SEI) NAL units have a
  // payload type field to indicate how they are to be
  // interpreted. CEAS-708 caption content is always transmitted with
  // payload type 0x04.
  var USER_DATA_REGISTERED_ITU_T_T35 = 4,
      RBSP_TRAILING_BITS = 128;

  /**
    * Parse a supplemental enhancement information (SEI) NAL unit.
    * Stops parsing once a message of type ITU T T35 has been found.
    *
    * @param bytes {Uint8Array} the bytes of a SEI NAL unit
    * @return {object} the parsed SEI payload
    * @see Rec. ITU-T H.264, 7.3.2.3.1
    */
  var parseSei = function(bytes) {
    var
      i = 0,
      result = {
        payloadType: -1,
        payloadSize: 0
      },
      payloadType = 0,
      payloadSize = 0;

    // go through the sei_rbsp parsing each each individual sei_message
    while (i < bytes.byteLength) {
      // stop once we have hit the end of the sei_rbsp
      if (bytes[i] === RBSP_TRAILING_BITS) {
        break;
      }

      // Parse payload type
      while (bytes[i] === 0xFF) {
        payloadType += 255;
        i++;
      }
      payloadType += bytes[i++];

      // Parse payload size
      while (bytes[i] === 0xFF) {
        payloadSize += 255;
        i++;
      }
      payloadSize += bytes[i++];

      // this sei_message is a 608/708 caption so save it and break
      // there can only ever be one caption message in a frame's sei
      if (!result.payload && payloadType === USER_DATA_REGISTERED_ITU_T_T35) {
        result.payloadType = payloadType;
        result.payloadSize = payloadSize;
        result.payload = bytes.subarray(i, i + payloadSize);
        break;
      }

      // skip the payload and parse the next message
      i += payloadSize;
      payloadType = 0;
      payloadSize = 0;
    }

    return result;
  };

  // see ANSI/SCTE 128-1 (2013), section 8.1
  var parseUserData = function(sei) {
    // itu_t_t35_contry_code must be 181 (United States) for
    // captions
    if (sei.payload[0] !== 181) {
      return null;
    }

    // itu_t_t35_provider_code should be 49 (ATSC) for captions
    if (((sei.payload[1] << 8) | sei.payload[2]) !== 49) {
      return null;
    }

    // the user_identifier should be "GA94" to indicate ATSC1 data
    if (String.fromCharCode(sei.payload[3],
                            sei.payload[4],
                            sei.payload[5],
                            sei.payload[6]) !== 'GA94') {
      return null;
    }

    // finally, user_data_type_code should be 0x03 for caption data
    if (sei.payload[7] !== 0x03) {
      return null;
    }

    // return the user_data_type_structure and strip the trailing
    // marker bits
    return sei.payload.subarray(8, sei.payload.length - 1);
  };

  // see CEA-708-D, section 4.4
  var parseCaptionPackets = function(pts, userData) {
    var results = [], i, count, offset, data;

    // if this is just filler, return immediately
    if (!(userData[0] & 0x40)) {
      return results;
    }

    // parse out the cc_data_1 and cc_data_2 fields
    count = userData[0] & 0x1f;
    for (i = 0; i < count; i++) {
      offset = i * 3;
      data = {
        type: userData[offset + 2] & 0x03,
        pts: pts
      };

      // capture cc data when cc_valid is 1
      if (userData[offset + 2] & 0x04) {
        data.ccData = (userData[offset + 3] << 8) | userData[offset + 4];
        results.push(data);
      }
    }
    return results;
  };

  var discardEmulationPreventionBytes = function(data) {
      var
        length = data.byteLength,
        emulationPreventionBytesPositions = [],
        i = 1,
        newLength, newData;

      // Find all `Emulation Prevention Bytes`
      while (i < length - 2) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0x03) {
          emulationPreventionBytesPositions.push(i + 2);
          i += 2;
        } else {
          i++;
        }
      }

      // If no Emulation Prevention Bytes were found just return the original
      // array
      if (emulationPreventionBytesPositions.length === 0) {
        return data;
      }

      // Create a new array to hold the NAL unit data
      newLength = length - emulationPreventionBytesPositions.length;
      newData = new Uint8Array(newLength);
      var sourceIndex = 0;

      for (i = 0; i < newLength; sourceIndex++, i++) {
        if (sourceIndex === emulationPreventionBytesPositions[0]) {
          // Skip this byte
          sourceIndex++;
          // Remove this position index
          emulationPreventionBytesPositions.shift();
        }
        newData[i] = data[sourceIndex];
      }

      return newData;
  };

  // exports
  var captionPacketParser = {
    parseSei: parseSei,
    parseUserData: parseUserData,
    parseCaptionPackets: parseCaptionPackets,
    discardEmulationPreventionBytes: discardEmulationPreventionBytes,
    USER_DATA_REGISTERED_ITU_T_T35: USER_DATA_REGISTERED_ITU_T_T35
  };

  // -----------------
  // Link To Transport
  // -----------------




  var CaptionStream = function() {

    CaptionStream.prototype.init.call(this);

    this.captionPackets_ = [];

    this.ccStreams_ = [
      new Cea608Stream(0, 0), // eslint-disable-line no-use-before-define
      new Cea608Stream(0, 1), // eslint-disable-line no-use-before-define
      new Cea608Stream(1, 0), // eslint-disable-line no-use-before-define
      new Cea608Stream(1, 1) // eslint-disable-line no-use-before-define
    ];

    this.reset();

    // forward data and done events from CCs to this CaptionStream
    this.ccStreams_.forEach(function(cc) {
      cc.on('data', this.trigger.bind(this, 'data'));
      cc.on('partialdone', this.trigger.bind(this, 'partialdone'));
      cc.on('done', this.trigger.bind(this, 'done'));
    }, this);

  };

  CaptionStream.prototype = new stream();
  CaptionStream.prototype.push = function(event) {
    var sei, userData, newCaptionPackets;

    // only examine SEI NALs
    if (event.nalUnitType !== 'sei_rbsp') {
      return;
    }

    // parse the sei
    sei = captionPacketParser.parseSei(event.escapedRBSP);

    // ignore everything but user_data_registered_itu_t_t35
    if (sei.payloadType !== captionPacketParser.USER_DATA_REGISTERED_ITU_T_T35) {
      return;
    }

    // parse out the user data payload
    userData = captionPacketParser.parseUserData(sei);

    // ignore unrecognized userData
    if (!userData) {
      return;
    }

    // Sometimes, the same segment # will be downloaded twice. To stop the
    // caption data from being processed twice, we track the latest dts we've
    // received and ignore everything with a dts before that. However, since
    // data for a specific dts can be split across packets on either side of
    // a segment boundary, we need to make sure we *don't* ignore the packets
    // from the *next* segment that have dts === this.latestDts_. By constantly
    // tracking the number of packets received with dts === this.latestDts_, we
    // know how many should be ignored once we start receiving duplicates.
    if (event.dts < this.latestDts_) {
      // We've started getting older data, so set the flag.
      this.ignoreNextEqualDts_ = true;
      return;
    } else if ((event.dts === this.latestDts_) && (this.ignoreNextEqualDts_)) {
      this.numSameDts_--;
      if (!this.numSameDts_) {
        // We've received the last duplicate packet, time to start processing again
        this.ignoreNextEqualDts_ = false;
      }
      return;
    }

    // parse out CC data packets and save them for later
    newCaptionPackets = captionPacketParser.parseCaptionPackets(event.pts, userData);
    this.captionPackets_ = this.captionPackets_.concat(newCaptionPackets);
    if (this.latestDts_ !== event.dts) {
      this.numSameDts_ = 0;
    }
    this.numSameDts_++;
    this.latestDts_ = event.dts;
  };

  CaptionStream.prototype.flushCCStreams = function(flushType) {
    this.ccStreams_.forEach(function(cc) {
      return flushType === 'flush' ? cc.flush() : cc.partialFlush();
    }, this);
  };

  CaptionStream.prototype.flushStream = function(flushType) {
    // make sure we actually parsed captions before proceeding
    if (!this.captionPackets_.length) {
      this.flushCCStreams(flushType);
      return;
    }

    // In Chrome, the Array#sort function is not stable so add a
    // presortIndex that we can use to ensure we get a stable-sort
    this.captionPackets_.forEach(function(elem, idx) {
      elem.presortIndex = idx;
    });

    // sort caption byte-pairs based on their PTS values
    this.captionPackets_.sort(function(a, b) {
      if (a.pts === b.pts) {
        return a.presortIndex - b.presortIndex;
      }
      return a.pts - b.pts;
    });

    this.captionPackets_.forEach(function(packet) {
      if (packet.type < 2) {
        // Dispatch packet to the right Cea608Stream
        this.dispatchCea608Packet(packet);
      }
      // this is where an 'else' would go for a dispatching packets
      // to a theoretical Cea708Stream that handles SERVICEn data
    }, this);

    this.captionPackets_.length = 0;
    this.flushCCStreams(flushType);
  };

  CaptionStream.prototype.flush = function() {
    return this.flushStream('flush');
  };

  // Only called if handling partial data
  CaptionStream.prototype.partialFlush = function() {
    return this.flushStream('partialFlush');
  };

  CaptionStream.prototype.reset = function() {
    this.latestDts_ = null;
    this.ignoreNextEqualDts_ = false;
    this.numSameDts_ = 0;
    this.activeCea608Channel_ = [null, null];
    this.ccStreams_.forEach(function(ccStream) {
      ccStream.reset();
    });
  };

  // From the CEA-608 spec:
  /*
   * When XDS sub-packets are interleaved with other services, the end of each sub-packet shall be followed
   * by a control pair to change to a different service. When any of the control codes from 0x10 to 0x1F is
   * used to begin a control code pair, it indicates the return to captioning or Text data. The control code pair
   * and subsequent data should then be processed according to the FCC rules. It may be necessary for the
   * line 21 data encoder to automatically insert a control code pair (i.e. RCL, RU2, RU3, RU4, RDC, or RTD)
   * to switch to captioning or Text.
  */
  // With that in mind, we ignore any data between an XDS control code and a
  // subsequent closed-captioning control code.
  CaptionStream.prototype.dispatchCea608Packet = function(packet) {
    // NOTE: packet.type is the CEA608 field
    if (this.setsTextOrXDSActive(packet)) {
      this.activeCea608Channel_[packet.type] = null;
    } else if (this.setsChannel1Active(packet)) {
      this.activeCea608Channel_[packet.type] = 0;
    } else if (this.setsChannel2Active(packet)) {
      this.activeCea608Channel_[packet.type] = 1;
    }
    if (this.activeCea608Channel_[packet.type] === null) {
      // If we haven't received anything to set the active channel, or the
      // packets are Text/XDS data, discard the data; we don't want jumbled
      // captions
      return;
    }
    this.ccStreams_[(packet.type << 1) + this.activeCea608Channel_[packet.type]].push(packet);
  };

  CaptionStream.prototype.setsChannel1Active = function(packet) {
    return ((packet.ccData & 0x7800) === 0x1000);
  };
  CaptionStream.prototype.setsChannel2Active = function(packet) {
    return ((packet.ccData & 0x7800) === 0x1800);
  };
  CaptionStream.prototype.setsTextOrXDSActive = function(packet) {
    return ((packet.ccData & 0x7100) === 0x0100) ||
      ((packet.ccData & 0x78fe) === 0x102a) ||
      ((packet.ccData & 0x78fe) === 0x182a);
  };

  // ----------------------
  // Session to Application
  // ----------------------

  // This hash maps non-ASCII, special, and extended character codes to their
  // proper Unicode equivalent. The first keys that are only a single byte
  // are the non-standard ASCII characters, which simply map the CEA608 byte
  // to the standard ASCII/Unicode. The two-byte keys that follow are the CEA608
  // character codes, but have their MSB bitmasked with 0x03 so that a lookup
  // can be performed regardless of the field and data channel on which the
  // character code was received.
  var CHARACTER_TRANSLATION = {
    0x2a: 0xe1,     // á
    0x5c: 0xe9,     // é
    0x5e: 0xed,     // í
    0x5f: 0xf3,     // ó
    0x60: 0xfa,     // ú
    0x7b: 0xe7,     // ç
    0x7c: 0xf7,     // ÷
    0x7d: 0xd1,     // Ñ
    0x7e: 0xf1,     // ñ
    0x7f: 0x2588,   // █
    0x0130: 0xae,   // ®
    0x0131: 0xb0,   // °
    0x0132: 0xbd,   // ½
    0x0133: 0xbf,   // ¿
    0x0134: 0x2122, // ™
    0x0135: 0xa2,   // ¢
    0x0136: 0xa3,   // £
    0x0137: 0x266a, // ♪
    0x0138: 0xe0,   // à
    0x0139: 0xa0,   //
    0x013a: 0xe8,   // è
    0x013b: 0xe2,   // â
    0x013c: 0xea,   // ê
    0x013d: 0xee,   // î
    0x013e: 0xf4,   // ô
    0x013f: 0xfb,   // û
    0x0220: 0xc1,   // Á
    0x0221: 0xc9,   // É
    0x0222: 0xd3,   // Ó
    0x0223: 0xda,   // Ú
    0x0224: 0xdc,   // Ü
    0x0225: 0xfc,   // ü
    0x0226: 0x2018, // ‘
    0x0227: 0xa1,   // ¡
    0x0228: 0x2a,   // *
    0x0229: 0x27,   // '
    0x022a: 0x2014, // —
    0x022b: 0xa9,   // ©
    0x022c: 0x2120, // ℠
    0x022d: 0x2022, // •
    0x022e: 0x201c, // “
    0x022f: 0x201d, // ”
    0x0230: 0xc0,   // À
    0x0231: 0xc2,   // Â
    0x0232: 0xc7,   // Ç
    0x0233: 0xc8,   // È
    0x0234: 0xca,   // Ê
    0x0235: 0xcb,   // Ë
    0x0236: 0xeb,   // ë
    0x0237: 0xce,   // Î
    0x0238: 0xcf,   // Ï
    0x0239: 0xef,   // ï
    0x023a: 0xd4,   // Ô
    0x023b: 0xd9,   // Ù
    0x023c: 0xf9,   // ù
    0x023d: 0xdb,   // Û
    0x023e: 0xab,   // «
    0x023f: 0xbb,   // »
    0x0320: 0xc3,   // Ã
    0x0321: 0xe3,   // ã
    0x0322: 0xcd,   // Í
    0x0323: 0xcc,   // Ì
    0x0324: 0xec,   // ì
    0x0325: 0xd2,   // Ò
    0x0326: 0xf2,   // ò
    0x0327: 0xd5,   // Õ
    0x0328: 0xf5,   // õ
    0x0329: 0x7b,   // {
    0x032a: 0x7d,   // }
    0x032b: 0x5c,   // \
    0x032c: 0x5e,   // ^
    0x032d: 0x5f,   // _
    0x032e: 0x7c,   // |
    0x032f: 0x7e,   // ~
    0x0330: 0xc4,   // Ä
    0x0331: 0xe4,   // ä
    0x0332: 0xd6,   // Ö
    0x0333: 0xf6,   // ö
    0x0334: 0xdf,   // ß
    0x0335: 0xa5,   // ¥
    0x0336: 0xa4,   // ¤
    0x0337: 0x2502, // │
    0x0338: 0xc5,   // Å
    0x0339: 0xe5,   // å
    0x033a: 0xd8,   // Ø
    0x033b: 0xf8,   // ø
    0x033c: 0x250c, // ┌
    0x033d: 0x2510, // ┐
    0x033e: 0x2514, // └
    0x033f: 0x2518  // ┘
  };

  var getCharFromCode = function(code) {
    if (code === null) {
      return '';
    }
    code = CHARACTER_TRANSLATION[code] || code;
    return String.fromCharCode(code);
  };

  // the index of the last row in a CEA-608 display buffer
  var BOTTOM_ROW = 14;

  // This array is used for mapping PACs -> row #, since there's no way of
  // getting it through bit logic.
  var ROWS = [0x1100, 0x1120, 0x1200, 0x1220, 0x1500, 0x1520, 0x1600, 0x1620,
              0x1700, 0x1720, 0x1000, 0x1300, 0x1320, 0x1400, 0x1420];

  // CEA-608 captions are rendered onto a 34x15 matrix of character
  // cells. The "bottom" row is the last element in the outer array.
  var createDisplayBuffer = function() {
    var result = [], i = BOTTOM_ROW + 1;
    while (i--) {
      result.push('');
    }
    return result;
  };

  var Cea608Stream = function(field, dataChannel) {
    Cea608Stream.prototype.init.call(this);

    this.field_ = field || 0;
    this.dataChannel_ = dataChannel || 0;

    this.name_ = 'CC' + (((this.field_ << 1) | this.dataChannel_) + 1);

    this.setConstants();
    this.reset();

    this.push = function(packet) {
      var data, swap, char0, char1, text;
      // remove the parity bits
      data = packet.ccData & 0x7f7f;

      // ignore duplicate control codes; the spec demands they're sent twice
      if (data === this.lastControlCode_) {
        this.lastControlCode_ = null;
        return;
      }

      // Store control codes
      if ((data & 0xf000) === 0x1000) {
        this.lastControlCode_ = data;
      } else if (data !== this.PADDING_) {
        this.lastControlCode_ = null;
      }

      char0 = data >>> 8;
      char1 = data & 0xff;

      if (data === this.PADDING_) {
        return;

      } else if (data === this.RESUME_CAPTION_LOADING_) {
        this.mode_ = 'popOn';

      } else if (data === this.END_OF_CAPTION_) {
        // If an EOC is received while in paint-on mode, the displayed caption
        // text should be swapped to non-displayed memory as if it was a pop-on
        // caption. Because of that, we should explicitly switch back to pop-on
        // mode
        this.mode_ = 'popOn';
        this.clearFormatting(packet.pts);
        // if a caption was being displayed, it's gone now
        this.flushDisplayed(packet.pts);

        // flip memory
        swap = this.displayed_;
        this.displayed_ = this.nonDisplayed_;
        this.nonDisplayed_ = swap;

        // start measuring the time to display the caption
        this.startPts_ = packet.pts;

      } else if (data === this.ROLL_UP_2_ROWS_) {
        this.rollUpRows_ = 2;
        this.setRollUp(packet.pts);
      } else if (data === this.ROLL_UP_3_ROWS_) {
        this.rollUpRows_ = 3;
        this.setRollUp(packet.pts);
      } else if (data === this.ROLL_UP_4_ROWS_) {
        this.rollUpRows_ = 4;
        this.setRollUp(packet.pts);
      } else if (data === this.CARRIAGE_RETURN_) {
        this.clearFormatting(packet.pts);
        this.flushDisplayed(packet.pts);
        this.shiftRowsUp_();
        this.startPts_ = packet.pts;

      } else if (data === this.BACKSPACE_) {
        if (this.mode_ === 'popOn') {
          this.nonDisplayed_[this.row_] = this.nonDisplayed_[this.row_].slice(0, -1);
        } else {
          this.displayed_[this.row_] = this.displayed_[this.row_].slice(0, -1);
        }
      } else if (data === this.ERASE_DISPLAYED_MEMORY_) {
        this.flushDisplayed(packet.pts);
        this.displayed_ = createDisplayBuffer();
      } else if (data === this.ERASE_NON_DISPLAYED_MEMORY_) {
        this.nonDisplayed_ = createDisplayBuffer();

      } else if (data === this.RESUME_DIRECT_CAPTIONING_) {
        if (this.mode_ !== 'paintOn') {
          // NOTE: This should be removed when proper caption positioning is
          // implemented
          this.flushDisplayed(packet.pts);
          this.displayed_ = createDisplayBuffer();
        }
        this.mode_ = 'paintOn';
        this.startPts_ = packet.pts;

      // Append special characters to caption text
      } else if (this.isSpecialCharacter(char0, char1)) {
        // Bitmask char0 so that we can apply character transformations
        // regardless of field and data channel.
        // Then byte-shift to the left and OR with char1 so we can pass the
        // entire character code to `getCharFromCode`.
        char0 = (char0 & 0x03) << 8;
        text = getCharFromCode(char0 | char1);
        this[this.mode_](packet.pts, text);
        this.column_++;

      // Append extended characters to caption text
      } else if (this.isExtCharacter(char0, char1)) {
        // Extended characters always follow their "non-extended" equivalents.
        // IE if a "è" is desired, you'll always receive "eè"; non-compliant
        // decoders are supposed to drop the "è", while compliant decoders
        // backspace the "e" and insert "è".

        // Delete the previous character
        if (this.mode_ === 'popOn') {
          this.nonDisplayed_[this.row_] = this.nonDisplayed_[this.row_].slice(0, -1);
        } else {
          this.displayed_[this.row_] = this.displayed_[this.row_].slice(0, -1);
        }

        // Bitmask char0 so that we can apply character transformations
        // regardless of field and data channel.
        // Then byte-shift to the left and OR with char1 so we can pass the
        // entire character code to `getCharFromCode`.
        char0 = (char0 & 0x03) << 8;
        text = getCharFromCode(char0 | char1);
        this[this.mode_](packet.pts, text);
        this.column_++;

      // Process mid-row codes
      } else if (this.isMidRowCode(char0, char1)) {
        // Attributes are not additive, so clear all formatting
        this.clearFormatting(packet.pts);

        // According to the standard, mid-row codes
        // should be replaced with spaces, so add one now
        this[this.mode_](packet.pts, ' ');
        this.column_++;

        if ((char1 & 0xe) === 0xe) {
          this.addFormatting(packet.pts, ['i']);
        }

        if ((char1 & 0x1) === 0x1) {
          this.addFormatting(packet.pts, ['u']);
        }

      // Detect offset control codes and adjust cursor
      } else if (this.isOffsetControlCode(char0, char1)) {
        // Cursor position is set by indent PAC (see below) in 4-column
        // increments, with an additional offset code of 1-3 to reach any
        // of the 32 columns specified by CEA-608. So all we need to do
        // here is increment the column cursor by the given offset.
        this.column_ += (char1 & 0x03);

      // Detect PACs (Preamble Address Codes)
      } else if (this.isPAC(char0, char1)) {

        // There's no logic for PAC -> row mapping, so we have to just
        // find the row code in an array and use its index :(
        var row = ROWS.indexOf(data & 0x1f20);

        // Configure the caption window if we're in roll-up mode
        if (this.mode_ === 'rollUp') {
          // This implies that the base row is incorrectly set.
          // As per the recommendation in CEA-608(Base Row Implementation), defer to the number
          // of roll-up rows set.
          if (row - this.rollUpRows_ + 1 < 0) {
            row = this.rollUpRows_ - 1;
          }

          this.setRollUp(packet.pts, row);
        }

        if (row !== this.row_) {
          // formatting is only persistent for current row
          this.clearFormatting(packet.pts);
          this.row_ = row;
        }
        // All PACs can apply underline, so detect and apply
        // (All odd-numbered second bytes set underline)
        if ((char1 & 0x1) && (this.formatting_.indexOf('u') === -1)) {
            this.addFormatting(packet.pts, ['u']);
        }

        if ((data & 0x10) === 0x10) {
          // We've got an indent level code. Each successive even number
          // increments the column cursor by 4, so we can get the desired
          // column position by bit-shifting to the right (to get n/2)
          // and multiplying by 4.
          this.column_ = ((data & 0xe) >> 1) * 4;
        }

        if (this.isColorPAC(char1)) {
          // it's a color code, though we only support white, which
          // can be either normal or italicized. white italics can be
          // either 0x4e or 0x6e depending on the row, so we just
          // bitwise-and with 0xe to see if italics should be turned on
          if ((char1 & 0xe) === 0xe) {
            this.addFormatting(packet.pts, ['i']);
          }
        }

      // We have a normal character in char0, and possibly one in char1
      } else if (this.isNormalChar(char0)) {
        if (char1 === 0x00) {
          char1 = null;
        }
        text = getCharFromCode(char0);
        text += getCharFromCode(char1);
        this[this.mode_](packet.pts, text);
        this.column_ += text.length;

      } // finish data processing

    };
  };
  Cea608Stream.prototype = new stream();
  // Trigger a cue point that captures the current state of the
  // display buffer
  Cea608Stream.prototype.flushDisplayed = function(pts) {
    var content = this.displayed_
      // remove spaces from the start and end of the string
      .map(function(row) {
        try {
          return row.trim();
        } catch (e) {
          // Ordinarily, this shouldn't happen. However, caption
          // parsing errors should not throw exceptions and
          // break playback.
          // eslint-disable-next-line no-console
          console.error('Skipping malformed caption.');
          return '';
        }
      })
      // combine all text rows to display in one cue
      .join('\n')
      // and remove blank rows from the start and end, but not the middle
      .replace(/^\n+|\n+$/g, '');

    if (content.length) {
      this.trigger('data', {
        startPts: this.startPts_,
        endPts: pts,
        text: content,
        stream: this.name_
      });
    }
  };

  /**
   * Zero out the data, used for startup and on seek
   */
  Cea608Stream.prototype.reset = function() {
    this.mode_ = 'popOn';
    // When in roll-up mode, the index of the last row that will
    // actually display captions. If a caption is shifted to a row
    // with a lower index than this, it is cleared from the display
    // buffer
    this.topRow_ = 0;
    this.startPts_ = 0;
    this.displayed_ = createDisplayBuffer();
    this.nonDisplayed_ = createDisplayBuffer();
    this.lastControlCode_ = null;

    // Track row and column for proper line-breaking and spacing
    this.column_ = 0;
    this.row_ = BOTTOM_ROW;
    this.rollUpRows_ = 2;

    // This variable holds currently-applied formatting
    this.formatting_ = [];
  };

  /**
   * Sets up control code and related constants for this instance
   */
  Cea608Stream.prototype.setConstants = function() {
    // The following attributes have these uses:
    // ext_ :    char0 for mid-row codes, and the base for extended
    //           chars (ext_+0, ext_+1, and ext_+2 are char0s for
    //           extended codes)
    // control_: char0 for control codes, except byte-shifted to the
    //           left so that we can do this.control_ | CONTROL_CODE
    // offset_:  char0 for tab offset codes
    //
    // It's also worth noting that control codes, and _only_ control codes,
    // differ between field 1 and field2. Field 2 control codes are always
    // their field 1 value plus 1. That's why there's the "| field" on the
    // control value.
    if (this.dataChannel_ === 0) {
      this.BASE_     = 0x10;
      this.EXT_      = 0x11;
      this.CONTROL_  = (0x14 | this.field_) << 8;
      this.OFFSET_   = 0x17;
    } else if (this.dataChannel_ === 1) {
      this.BASE_     = 0x18;
      this.EXT_      = 0x19;
      this.CONTROL_  = (0x1c | this.field_) << 8;
      this.OFFSET_   = 0x1f;
    }

    // Constants for the LSByte command codes recognized by Cea608Stream. This
    // list is not exhaustive. For a more comprehensive listing and semantics see
    // http://www.gpo.gov/fdsys/pkg/CFR-2010-title47-vol1/pdf/CFR-2010-title47-vol1-sec15-119.pdf
    // Padding
    this.PADDING_                    = 0x0000;
    // Pop-on Mode
    this.RESUME_CAPTION_LOADING_     = this.CONTROL_ | 0x20;
    this.END_OF_CAPTION_             = this.CONTROL_ | 0x2f;
    // Roll-up Mode
    this.ROLL_UP_2_ROWS_             = this.CONTROL_ | 0x25;
    this.ROLL_UP_3_ROWS_             = this.CONTROL_ | 0x26;
    this.ROLL_UP_4_ROWS_             = this.CONTROL_ | 0x27;
    this.CARRIAGE_RETURN_            = this.CONTROL_ | 0x2d;
    // paint-on mode
    this.RESUME_DIRECT_CAPTIONING_   = this.CONTROL_ | 0x29;
    // Erasure
    this.BACKSPACE_                  = this.CONTROL_ | 0x21;
    this.ERASE_DISPLAYED_MEMORY_     = this.CONTROL_ | 0x2c;
    this.ERASE_NON_DISPLAYED_MEMORY_ = this.CONTROL_ | 0x2e;
  };

  /**
   * Detects if the 2-byte packet data is a special character
   *
   * Special characters have a second byte in the range 0x30 to 0x3f,
   * with the first byte being 0x11 (for data channel 1) or 0x19 (for
   * data channel 2).
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are an special character
   */
  Cea608Stream.prototype.isSpecialCharacter = function(char0, char1) {
    return (char0 === this.EXT_ && char1 >= 0x30 && char1 <= 0x3f);
  };

  /**
   * Detects if the 2-byte packet data is an extended character
   *
   * Extended characters have a second byte in the range 0x20 to 0x3f,
   * with the first byte being 0x12 or 0x13 (for data channel 1) or
   * 0x1a or 0x1b (for data channel 2).
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are an extended character
   */
  Cea608Stream.prototype.isExtCharacter = function(char0, char1) {
    return ((char0 === (this.EXT_ + 1) || char0 === (this.EXT_ + 2)) &&
      (char1 >= 0x20 && char1 <= 0x3f));
  };

  /**
   * Detects if the 2-byte packet is a mid-row code
   *
   * Mid-row codes have a second byte in the range 0x20 to 0x2f, with
   * the first byte being 0x11 (for data channel 1) or 0x19 (for data
   * channel 2).
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are a mid-row code
   */
  Cea608Stream.prototype.isMidRowCode = function(char0, char1) {
    return (char0 === this.EXT_ && (char1 >= 0x20 && char1 <= 0x2f));
  };

  /**
   * Detects if the 2-byte packet is an offset control code
   *
   * Offset control codes have a second byte in the range 0x21 to 0x23,
   * with the first byte being 0x17 (for data channel 1) or 0x1f (for
   * data channel 2).
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are an offset control code
   */
  Cea608Stream.prototype.isOffsetControlCode = function(char0, char1) {
    return (char0 === this.OFFSET_ && (char1 >= 0x21 && char1 <= 0x23));
  };

  /**
   * Detects if the 2-byte packet is a Preamble Address Code
   *
   * PACs have a first byte in the range 0x10 to 0x17 (for data channel 1)
   * or 0x18 to 0x1f (for data channel 2), with the second byte in the
   * range 0x40 to 0x7f.
   *
   * @param  {Integer} char0 The first byte
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the 2 bytes are a PAC
   */
  Cea608Stream.prototype.isPAC = function(char0, char1) {
    return (char0 >= this.BASE_ && char0 < (this.BASE_ + 8) &&
      (char1 >= 0x40 && char1 <= 0x7f));
  };

  /**
   * Detects if a packet's second byte is in the range of a PAC color code
   *
   * PAC color codes have the second byte be in the range 0x40 to 0x4f, or
   * 0x60 to 0x6f.
   *
   * @param  {Integer} char1 The second byte
   * @return {Boolean}       Whether the byte is a color PAC
   */
  Cea608Stream.prototype.isColorPAC = function(char1) {
    return ((char1 >= 0x40 && char1 <= 0x4f) || (char1 >= 0x60 && char1 <= 0x7f));
  };

  /**
   * Detects if a single byte is in the range of a normal character
   *
   * Normal text bytes are in the range 0x20 to 0x7f.
   *
   * @param  {Integer} char  The byte
   * @return {Boolean}       Whether the byte is a normal character
   */
  Cea608Stream.prototype.isNormalChar = function(char) {
    return (char >= 0x20 && char <= 0x7f);
  };

  /**
   * Configures roll-up
   *
   * @param  {Integer} pts         Current PTS
   * @param  {Integer} newBaseRow  Used by PACs to slide the current window to
   *                               a new position
   */
  Cea608Stream.prototype.setRollUp = function(pts, newBaseRow) {
    // Reset the base row to the bottom row when switching modes
    if (this.mode_ !== 'rollUp') {
      this.row_ = BOTTOM_ROW;
      this.mode_ = 'rollUp';
      // Spec says to wipe memories when switching to roll-up
      this.flushDisplayed(pts);
      this.nonDisplayed_ = createDisplayBuffer();
      this.displayed_ = createDisplayBuffer();
    }

    if (newBaseRow !== undefined && newBaseRow !== this.row_) {
      // move currently displayed captions (up or down) to the new base row
      for (var i = 0; i < this.rollUpRows_; i++) {
        this.displayed_[newBaseRow - i] = this.displayed_[this.row_ - i];
        this.displayed_[this.row_ - i] = '';
      }
    }

    if (newBaseRow === undefined) {
      newBaseRow = this.row_;
    }

    this.topRow_ = newBaseRow - this.rollUpRows_ + 1;
  };

  // Adds the opening HTML tag for the passed character to the caption text,
  // and keeps track of it for later closing
  Cea608Stream.prototype.addFormatting = function(pts, format) {
    this.formatting_ = this.formatting_.concat(format);
    var text = format.reduce(function(text, format) {
      return text + '<' + format + '>';
    }, '');
    this[this.mode_](pts, text);
  };

  // Adds HTML closing tags for current formatting to caption text and
  // clears remembered formatting
  Cea608Stream.prototype.clearFormatting = function(pts) {
    if (!this.formatting_.length) {
      return;
    }
    var text = this.formatting_.reverse().reduce(function(text, format) {
      return text + '</' + format + '>';
    }, '');
    this.formatting_ = [];
    this[this.mode_](pts, text);
  };

  // Mode Implementations
  Cea608Stream.prototype.popOn = function(pts, text) {
    var baseRow = this.nonDisplayed_[this.row_];

    // buffer characters
    baseRow += text;
    this.nonDisplayed_[this.row_] = baseRow;
  };

  Cea608Stream.prototype.rollUp = function(pts, text) {
    var baseRow = this.displayed_[this.row_];

    baseRow += text;
    this.displayed_[this.row_] = baseRow;

  };

  Cea608Stream.prototype.shiftRowsUp_ = function() {
    var i;
    // clear out inactive rows
    for (i = 0; i < this.topRow_; i++) {
      this.displayed_[i] = '';
    }
    for (i = this.row_ + 1; i < BOTTOM_ROW + 1; i++) {
      this.displayed_[i] = '';
    }
    // shift displayed rows up
    for (i = this.topRow_; i < this.row_; i++) {
      this.displayed_[i] = this.displayed_[i + 1];
    }
    // clear out the bottom row
    this.displayed_[this.row_] = '';
  };

  Cea608Stream.prototype.paintOn = function(pts, text) {
    var baseRow = this.displayed_[this.row_];

    baseRow += text;
    this.displayed_[this.row_] = baseRow;
  };

  // exports
  var captionStream = {
    CaptionStream: CaptionStream,
    Cea608Stream: Cea608Stream
  };

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */

  var streamTypes = {
    H264_STREAM_TYPE: 0x1B,
    ADTS_STREAM_TYPE: 0x0F,
    METADATA_STREAM_TYPE: 0x15
  };

  var MAX_TS = 8589934592;

  var RO_THRESH = 4294967296;

  var TYPE_SHARED = 'shared';

  var handleRollover = function(value, reference) {
    var direction = 1;

    if (value > reference) {
      // If the current timestamp value is greater than our reference timestamp and we detect a
      // timestamp rollover, this means the roll over is happening in the opposite direction.
      // Example scenario: Enter a long stream/video just after a rollover occurred. The reference
      // point will be set to a small number, e.g. 1. The user then seeks backwards over the
      // rollover point. In loading this segment, the timestamp values will be very large,
      // e.g. 2^33 - 1. Since this comes before the data we loaded previously, we want to adjust
      // the time stamp to be `value - 2^33`.
      direction = -1;
    }

    // Note: A seek forwards or back that is greater than the RO_THRESH (2^32, ~13 hours) will
    // cause an incorrect adjustment.
    while (Math.abs(reference - value) > RO_THRESH) {
      value += (direction * MAX_TS);
    }

    return value;
  };

  var TimestampRolloverStream = function(type) {
    var lastDTS, referenceDTS;

    TimestampRolloverStream.prototype.init.call(this);

    // The "shared" type is used in cases where a stream will contain muxed
    // video and audio. We could use `undefined` here, but having a string
    // makes debugging a little clearer.
    this.type_ = type || TYPE_SHARED;

    this.push = function(data) {

      // Any "shared" rollover streams will accept _all_ data. Otherwise,
      // streams will only accept data that matches their type.
      if (this.type_ !== TYPE_SHARED && data.type !== this.type_) {
        return;
      }

      if (referenceDTS === undefined) {
        referenceDTS = data.dts;
      }

      data.dts = handleRollover(data.dts, referenceDTS);
      data.pts = handleRollover(data.pts, referenceDTS);

      lastDTS = data.dts;

      this.trigger('data', data);
    };

    this.flush = function() {
      referenceDTS = lastDTS;
      this.trigger('done');
    };

    this.endTimeline = function() {
      this.flush();
      this.trigger('endedtimeline');
    };

    this.discontinuity = function() {
      referenceDTS = void 0;
      lastDTS = void 0;
    };

    this.reset = function() {
      this.discontinuity();
      this.trigger('reset');
    };
  };

  TimestampRolloverStream.prototype = new stream();

  var timestampRolloverStream = {
    TimestampRolloverStream: TimestampRolloverStream,
    handleRollover: handleRollover
  };

  var
    percentEncode = function(bytes, start, end) {
      var i, result = '';
      for (i = start; i < end; i++) {
        result += '%' + ('00' + bytes[i].toString(16)).slice(-2);
      }
      return result;
    },
    // return the string representation of the specified byte range,
    // interpreted as UTf-8.
    parseUtf8 = function(bytes, start, end) {
      return decodeURIComponent(percentEncode(bytes, start, end));
    },
    // return the string representation of the specified byte range,
    // interpreted as ISO-8859-1.
    parseIso88591 = function(bytes, start, end) {
      return unescape(percentEncode(bytes, start, end)); // jshint ignore:line
    },
    parseSyncSafeInteger = function(data) {
      return (data[0] << 21) |
              (data[1] << 14) |
              (data[2] << 7) |
              (data[3]);
    },
    tagParsers = {
      TXXX: function(tag) {
        var i;
        if (tag.data[0] !== 3) {
          // ignore frames with unrecognized character encodings
          return;
        }

        for (i = 1; i < tag.data.length; i++) {
          if (tag.data[i] === 0) {
            // parse the text fields
            tag.description = parseUtf8(tag.data, 1, i);
            // do not include the null terminator in the tag value
            tag.value = parseUtf8(tag.data, i + 1, tag.data.length).replace(/\0*$/, '');
            break;
          }
        }
        tag.data = tag.value;
      },
      WXXX: function(tag) {
        var i;
        if (tag.data[0] !== 3) {
          // ignore frames with unrecognized character encodings
          return;
        }

        for (i = 1; i < tag.data.length; i++) {
          if (tag.data[i] === 0) {
            // parse the description and URL fields
            tag.description = parseUtf8(tag.data, 1, i);
            tag.url = parseUtf8(tag.data, i + 1, tag.data.length);
            break;
          }
        }
      },
      PRIV: function(tag) {
        var i;

        for (i = 0; i < tag.data.length; i++) {
          if (tag.data[i] === 0) {
            // parse the description and URL fields
            tag.owner = parseIso88591(tag.data, 0, i);
            break;
          }
        }
        tag.privateData = tag.data.subarray(i + 1);
        tag.data = tag.privateData;
      }
    },
    MetadataStream;

  MetadataStream = function(options) {
    var
      settings = {
        debug: !!(options && options.debug),

        // the bytes of the program-level descriptor field in MP2T
        // see ISO/IEC 13818-1:2013 (E), section 2.6 "Program and
        // program element descriptors"
        descriptor: options && options.descriptor
      },
      // the total size in bytes of the ID3 tag being parsed
      tagSize = 0,
      // tag data that is not complete enough to be parsed
      buffer = [],
      // the total number of bytes currently in the buffer
      bufferSize = 0,
      i;

    MetadataStream.prototype.init.call(this);

    // calculate the text track in-band metadata track dispatch type
    // https://html.spec.whatwg.org/multipage/embedded-content.html#steps-to-expose-a-media-resource-specific-text-track
    this.dispatchType = streamTypes.METADATA_STREAM_TYPE.toString(16);
    if (settings.descriptor) {
      for (i = 0; i < settings.descriptor.length; i++) {
        this.dispatchType += ('00' + settings.descriptor[i].toString(16)).slice(-2);
      }
    }

    this.push = function(chunk) {
      var tag, frameStart, frameSize, frame, i, frameHeader;
      if (chunk.type !== 'timed-metadata') {
        return;
      }

      // if data_alignment_indicator is set in the PES header,
      // we must have the start of a new ID3 tag. Assume anything
      // remaining in the buffer was malformed and throw it out
      if (chunk.dataAlignmentIndicator) {
        bufferSize = 0;
        buffer.length = 0;
      }

      // ignore events that don't look like ID3 data
      if (buffer.length === 0 &&
          (chunk.data.length < 10 ||
            chunk.data[0] !== 'I'.charCodeAt(0) ||
            chunk.data[1] !== 'D'.charCodeAt(0) ||
            chunk.data[2] !== '3'.charCodeAt(0))) {
        if (settings.debug) {
          // eslint-disable-next-line no-console
          console.log('Skipping unrecognized metadata packet');
        }
        return;
      }

      // add this chunk to the data we've collected so far

      buffer.push(chunk);
      bufferSize += chunk.data.byteLength;

      // grab the size of the entire frame from the ID3 header
      if (buffer.length === 1) {
        // the frame size is transmitted as a 28-bit integer in the
        // last four bytes of the ID3 header.
        // The most significant bit of each byte is dropped and the
        // results concatenated to recover the actual value.
        tagSize = parseSyncSafeInteger(chunk.data.subarray(6, 10));

        // ID3 reports the tag size excluding the header but it's more
        // convenient for our comparisons to include it
        tagSize += 10;
      }

      // if the entire frame has not arrived, wait for more data
      if (bufferSize < tagSize) {
        return;
      }

      // collect the entire frame so it can be parsed
      tag = {
        data: new Uint8Array(tagSize),
        frames: [],
        pts: buffer[0].pts,
        dts: buffer[0].dts
      };
      for (i = 0; i < tagSize;) {
        tag.data.set(buffer[0].data.subarray(0, tagSize - i), i);
        i += buffer[0].data.byteLength;
        bufferSize -= buffer[0].data.byteLength;
        buffer.shift();
      }

      // find the start of the first frame and the end of the tag
      frameStart = 10;
      if (tag.data[5] & 0x40) {
        // advance the frame start past the extended header
        frameStart += 4; // header size field
        frameStart += parseSyncSafeInteger(tag.data.subarray(10, 14));

        // clip any padding off the end
        tagSize -= parseSyncSafeInteger(tag.data.subarray(16, 20));
      }

      // parse one or more ID3 frames
      // http://id3.org/id3v2.3.0#ID3v2_frame_overview
      do {
        // determine the number of bytes in this frame
        frameSize = parseSyncSafeInteger(tag.data.subarray(frameStart + 4, frameStart + 8));
        if (frameSize < 1) {
           // eslint-disable-next-line no-console
          return console.log('Malformed ID3 frame encountered. Skipping metadata parsing.');
        }
        frameHeader = String.fromCharCode(tag.data[frameStart],
                                          tag.data[frameStart + 1],
                                          tag.data[frameStart + 2],
                                          tag.data[frameStart + 3]);


        frame = {
          id: frameHeader,
          data: tag.data.subarray(frameStart + 10, frameStart + frameSize + 10)
        };
        frame.key = frame.id;
        if (tagParsers[frame.id]) {
          tagParsers[frame.id](frame);

          // handle the special PRIV frame used to indicate the start
          // time for raw AAC data
          if (frame.owner === 'com.apple.streaming.transportStreamTimestamp') {
            var
              d = frame.data,
              size = ((d[3] & 0x01)  << 30) |
                     (d[4]  << 22) |
                     (d[5] << 14) |
                     (d[6] << 6) |
                     (d[7] >>> 2);

            size *= 4;
            size += d[7] & 0x03;
            frame.timeStamp = size;
            // in raw AAC, all subsequent data will be timestamped based
            // on the value of this frame
            // we couldn't have known the appropriate pts and dts before
            // parsing this ID3 tag so set those values now
            if (tag.pts === undefined && tag.dts === undefined) {
              tag.pts = frame.timeStamp;
              tag.dts = frame.timeStamp;
            }
            this.trigger('timestamp', frame);
          }
        }
        tag.frames.push(frame);

        frameStart += 10; // advance past the frame header
        frameStart += frameSize; // advance past the frame body
      } while (frameStart < tagSize);
      this.trigger('data', tag);
    };
  };
  MetadataStream.prototype = new stream();

  var metadataStream = MetadataStream;

  var TimestampRolloverStream$1 = timestampRolloverStream.TimestampRolloverStream;

  // object types
  var TransportPacketStream, TransportParseStream, ElementaryStream;

  // constants
  var
    MP2T_PACKET_LENGTH = 188, // bytes
    SYNC_BYTE = 0x47;

  /**
   * Splits an incoming stream of binary data into MPEG-2 Transport
   * Stream packets.
   */
  TransportPacketStream = function() {
    var
      buffer = new Uint8Array(MP2T_PACKET_LENGTH),
      bytesInBuffer = 0;

    TransportPacketStream.prototype.init.call(this);

     // Deliver new bytes to the stream.

    /**
     * Split a stream of data into M2TS packets
    **/
    this.push = function(bytes) {
      var
        startIndex = 0,
        endIndex = MP2T_PACKET_LENGTH,
        everything;

      // If there are bytes remaining from the last segment, prepend them to the
      // bytes that were pushed in
      if (bytesInBuffer) {
        everything = new Uint8Array(bytes.byteLength + bytesInBuffer);
        everything.set(buffer.subarray(0, bytesInBuffer));
        everything.set(bytes, bytesInBuffer);
        bytesInBuffer = 0;
      } else {
        everything = bytes;
      }

      // While we have enough data for a packet
      while (endIndex < everything.byteLength) {
        // Look for a pair of start and end sync bytes in the data..
        if (everything[startIndex] === SYNC_BYTE && everything[endIndex] === SYNC_BYTE) {
          // We found a packet so emit it and jump one whole packet forward in
          // the stream
          this.trigger('data', everything.subarray(startIndex, endIndex));
          startIndex += MP2T_PACKET_LENGTH;
          endIndex += MP2T_PACKET_LENGTH;
          continue;
        }
        // If we get here, we have somehow become de-synchronized and we need to step
        // forward one byte at a time until we find a pair of sync bytes that denote
        // a packet
        startIndex++;
        endIndex++;
      }

      // If there was some data left over at the end of the segment that couldn't
      // possibly be a whole packet, keep it because it might be the start of a packet
      // that continues in the next segment
      if (startIndex < everything.byteLength) {
        buffer.set(everything.subarray(startIndex), 0);
        bytesInBuffer = everything.byteLength - startIndex;
      }
    };

    /**
     * Passes identified M2TS packets to the TransportParseStream to be parsed
    **/
    this.flush = function() {
      // If the buffer contains a whole packet when we are being flushed, emit it
      // and empty the buffer. Otherwise hold onto the data because it may be
      // important for decoding the next segment
      if (bytesInBuffer === MP2T_PACKET_LENGTH && buffer[0] === SYNC_BYTE) {
        this.trigger('data', buffer);
        bytesInBuffer = 0;
      }
      this.trigger('done');
    };

    this.endTimeline = function() {
      this.flush();
      this.trigger('endedtimeline');
    };

    this.reset = function() {
      bytesInBuffer = 0;
      this.trigger('reset');
    };
  };
  TransportPacketStream.prototype = new stream();

  /**
   * Accepts an MP2T TransportPacketStream and emits data events with parsed
   * forms of the individual transport stream packets.
   */
  TransportParseStream = function() {
    var parsePsi, parsePat, parsePmt, self;
    TransportParseStream.prototype.init.call(this);
    self = this;

    this.packetsWaitingForPmt = [];
    this.programMapTable = undefined;

    parsePsi = function(payload, psi) {
      var offset = 0;

      // PSI packets may be split into multiple sections and those
      // sections may be split into multiple packets. If a PSI
      // section starts in this packet, the payload_unit_start_indicator
      // will be true and the first byte of the payload will indicate
      // the offset from the current position to the start of the
      // section.
      if (psi.payloadUnitStartIndicator) {
        offset += payload[offset] + 1;
      }

      if (psi.type === 'pat') {
        parsePat(payload.subarray(offset), psi);
      } else {
        parsePmt(payload.subarray(offset), psi);
      }
    };

    parsePat = function(payload, pat) {
      pat.section_number = payload[7]; // eslint-disable-line camelcase
      pat.last_section_number = payload[8]; // eslint-disable-line camelcase

      // skip the PSI header and parse the first PMT entry
      self.pmtPid = (payload[10] & 0x1F) << 8 | payload[11];
      pat.pmtPid = self.pmtPid;
    };

    /**
     * Parse out the relevant fields of a Program Map Table (PMT).
     * @param payload {Uint8Array} the PMT-specific portion of an MP2T
     * packet. The first byte in this array should be the table_id
     * field.
     * @param pmt {object} the object that should be decorated with
     * fields parsed from the PMT.
     */
    parsePmt = function(payload, pmt) {
      var sectionLength, tableEnd, programInfoLength, offset;

      // PMTs can be sent ahead of the time when they should actually
      // take effect. We don't believe this should ever be the case
      // for HLS but we'll ignore "forward" PMT declarations if we see
      // them. Future PMT declarations have the current_next_indicator
      // set to zero.
      if (!(payload[5] & 0x01)) {
        return;
      }

      // overwrite any existing program map table
      self.programMapTable = {
        video: null,
        audio: null,
        'timed-metadata': {}
      };

      // the mapping table ends at the end of the current section
      sectionLength = (payload[1] & 0x0f) << 8 | payload[2];
      tableEnd = 3 + sectionLength - 4;

      // to determine where the table is, we have to figure out how
      // long the program info descriptors are
      programInfoLength = (payload[10] & 0x0f) << 8 | payload[11];

      // advance the offset to the first entry in the mapping table
      offset = 12 + programInfoLength;
      while (offset < tableEnd) {
        var streamType = payload[offset];
        var pid = (payload[offset + 1] & 0x1F) << 8 | payload[offset + 2];

        // only map a single elementary_pid for audio and video stream types
        // TODO: should this be done for metadata too? for now maintain behavior of
        //       multiple metadata streams
        if (streamType === streamTypes.H264_STREAM_TYPE &&
            self.programMapTable.video === null) {
          self.programMapTable.video = pid;
        } else if (streamType === streamTypes.ADTS_STREAM_TYPE &&
                   self.programMapTable.audio === null) {
          self.programMapTable.audio = pid;
        } else if (streamType === streamTypes.METADATA_STREAM_TYPE) {
          // map pid to stream type for metadata streams
          self.programMapTable['timed-metadata'][pid] = streamType;
        }

        // move to the next table entry
        // skip past the elementary stream descriptors, if present
        offset += ((payload[offset + 3] & 0x0F) << 8 | payload[offset + 4]) + 5;
      }

      // record the map on the packet as well
      pmt.programMapTable = self.programMapTable;
    };

    /**
     * Deliver a new MP2T packet to the next stream in the pipeline.
     */
    this.push = function(packet) {
      var
        result = {},
        offset = 4;

      result.payloadUnitStartIndicator = !!(packet[1] & 0x40);

      // pid is a 13-bit field starting at the last bit of packet[1]
      result.pid = packet[1] & 0x1f;
      result.pid <<= 8;
      result.pid |= packet[2];

      // if an adaption field is present, its length is specified by the
      // fifth byte of the TS packet header. The adaptation field is
      // used to add stuffing to PES packets that don't fill a complete
      // TS packet, and to specify some forms of timing and control data
      // that we do not currently use.
      if (((packet[3] & 0x30) >>> 4) > 0x01) {
        offset += packet[offset] + 1;
      }

      // parse the rest of the packet based on the type
      if (result.pid === 0) {
        result.type = 'pat';
        parsePsi(packet.subarray(offset), result);
        this.trigger('data', result);
      } else if (result.pid === this.pmtPid) {
        result.type = 'pmt';
        parsePsi(packet.subarray(offset), result);
        this.trigger('data', result);

        // if there are any packets waiting for a PMT to be found, process them now
        while (this.packetsWaitingForPmt.length) {
          this.processPes_.apply(this, this.packetsWaitingForPmt.shift());
        }
      } else if (this.programMapTable === undefined) {
        // When we have not seen a PMT yet, defer further processing of
        // PES packets until one has been parsed
        this.packetsWaitingForPmt.push([packet, offset, result]);
      } else {
        this.processPes_(packet, offset, result);
      }
    };

    this.processPes_ = function(packet, offset, result) {
      // set the appropriate stream type
      if (result.pid === this.programMapTable.video) {
        result.streamType = streamTypes.H264_STREAM_TYPE;
      } else if (result.pid === this.programMapTable.audio) {
        result.streamType = streamTypes.ADTS_STREAM_TYPE;
      } else {
        // if not video or audio, it is timed-metadata or unknown
        // if unknown, streamType will be undefined
        result.streamType = this.programMapTable['timed-metadata'][result.pid];
      }

      result.type = 'pes';
      result.data = packet.subarray(offset);
      this.trigger('data', result);
    };
  };
  TransportParseStream.prototype = new stream();
  TransportParseStream.STREAM_TYPES  = {
    h264: 0x1b,
    adts: 0x0f
  };

  /**
   * Reconsistutes program elementary stream (PES) packets from parsed
   * transport stream packets. That is, if you pipe an
   * mp2t.TransportParseStream into a mp2t.ElementaryStream, the output
   * events will be events which capture the bytes for individual PES
   * packets plus relevant metadata that has been extracted from the
   * container.
   */
  ElementaryStream = function() {
    var
      self = this,
      // PES packet fragments
      video = {
        data: [],
        size: 0
      },
      audio = {
        data: [],
        size: 0
      },
      timedMetadata = {
        data: [],
        size: 0
      },
      programMapTable,
      parsePes = function(payload, pes) {
        var ptsDtsFlags;

        // get the packet length, this will be 0 for video
        pes.packetLength = 6 + ((payload[4] << 8) | payload[5]);

        // find out if this packets starts a new keyframe
        pes.dataAlignmentIndicator = (payload[6] & 0x04) !== 0;
        // PES packets may be annotated with a PTS value, or a PTS value
        // and a DTS value. Determine what combination of values is
        // available to work with.
        ptsDtsFlags = payload[7];

        // PTS and DTS are normally stored as a 33-bit number.  Javascript
        // performs all bitwise operations on 32-bit integers but javascript
        // supports a much greater range (52-bits) of integer using standard
        // mathematical operations.
        // We construct a 31-bit value using bitwise operators over the 31
        // most significant bits and then multiply by 4 (equal to a left-shift
        // of 2) before we add the final 2 least significant bits of the
        // timestamp (equal to an OR.)
        if (ptsDtsFlags & 0xC0) {
          // the PTS and DTS are not written out directly. For information
          // on how they are encoded, see
          // http://dvd.sourceforge.net/dvdinfo/pes-hdr.html
          pes.pts = (payload[9] & 0x0E) << 27 |
            (payload[10] & 0xFF) << 20 |
            (payload[11] & 0xFE) << 12 |
            (payload[12] & 0xFF) <<  5 |
            (payload[13] & 0xFE) >>>  3;
          pes.pts *= 4; // Left shift by 2
          pes.pts += (payload[13] & 0x06) >>> 1; // OR by the two LSBs
          pes.dts = pes.pts;
          if (ptsDtsFlags & 0x40) {
            pes.dts = (payload[14] & 0x0E) << 27 |
              (payload[15] & 0xFF) << 20 |
              (payload[16] & 0xFE) << 12 |
              (payload[17] & 0xFF) << 5 |
              (payload[18] & 0xFE) >>> 3;
            pes.dts *= 4; // Left shift by 2
            pes.dts += (payload[18] & 0x06) >>> 1; // OR by the two LSBs
          }
        }
        // the data section starts immediately after the PES header.
        // pes_header_data_length specifies the number of header bytes
        // that follow the last byte of the field.
        pes.data = payload.subarray(9 + payload[8]);
      },
      /**
        * Pass completely parsed PES packets to the next stream in the pipeline
       **/
      flushStream = function(stream, type, forceFlush) {
        var
          packetData = new Uint8Array(stream.size),
          event = {
            type: type
          },
          i = 0,
          offset = 0,
          packetFlushable = false,
          fragment;

        // do nothing if there is not enough buffered data for a complete
        // PES header
        if (!stream.data.length || stream.size < 9) {
          return;
        }
        event.trackId = stream.data[0].pid;

        // reassemble the packet
        for (i = 0; i < stream.data.length; i++) {
          fragment = stream.data[i];

          packetData.set(fragment.data, offset);
          offset += fragment.data.byteLength;
        }

        // parse assembled packet's PES header
        parsePes(packetData, event);

        // non-video PES packets MUST have a non-zero PES_packet_length
        // check that there is enough stream data to fill the packet
        packetFlushable = type === 'video' || event.packetLength <= stream.size;

        // flush pending packets if the conditions are right
        if (forceFlush || packetFlushable) {
          stream.size = 0;
          stream.data.length = 0;
        }

        // only emit packets that are complete. this is to avoid assembling
        // incomplete PES packets due to poor segmentation
        if (packetFlushable) {
          self.trigger('data', event);
        }
      };

    ElementaryStream.prototype.init.call(this);

    /**
     * Identifies M2TS packet types and parses PES packets using metadata
     * parsed from the PMT
     **/
    this.push = function(data) {
      ({
        pat: function() {
          // we have to wait for the PMT to arrive as well before we
          // have any meaningful metadata
        },
        pes: function() {
          var stream, streamType;

          switch (data.streamType) {
          case streamTypes.H264_STREAM_TYPE:
            stream = video;
            streamType = 'video';
            break;
          case streamTypes.ADTS_STREAM_TYPE:
            stream = audio;
            streamType = 'audio';
            break;
          case streamTypes.METADATA_STREAM_TYPE:
            stream = timedMetadata;
            streamType = 'timed-metadata';
            break;
          default:
            // ignore unknown stream types
            return;
          }

          // if a new packet is starting, we can flush the completed
          // packet
          if (data.payloadUnitStartIndicator) {
            flushStream(stream, streamType, true);
          }

          // buffer this fragment until we are sure we've received the
          // complete payload
          stream.data.push(data);
          stream.size += data.data.byteLength;
        },
        pmt: function() {
          var
            event = {
              type: 'metadata',
              tracks: []
            };

          programMapTable = data.programMapTable;

          // translate audio and video streams to tracks
          if (programMapTable.video !== null) {
            event.tracks.push({
              timelineStartInfo: {
                baseMediaDecodeTime: 0
              },
              id: +programMapTable.video,
              codec: 'avc',
              type: 'video'
            });
          }
          if (programMapTable.audio !== null) {
            event.tracks.push({
              timelineStartInfo: {
                baseMediaDecodeTime: 0
              },
              id: +programMapTable.audio,
              codec: 'adts',
              type: 'audio'
            });
          }

          self.trigger('data', event);
        }
      })[data.type]();
    };

    this.reset = function() {
      video.size = 0;
      video.data.length = 0;
      audio.size = 0;
      audio.data.length = 0;
      this.trigger('reset');
    };

    /**
     * Flush any remaining input. Video PES packets may be of variable
     * length. Normally, the start of a new video packet can trigger the
     * finalization of the previous packet. That is not possible if no
     * more video is forthcoming, however. In that case, some other
     * mechanism (like the end of the file) has to be employed. When it is
     * clear that no additional data is forthcoming, calling this method
     * will flush the buffered packets.
     */
    this.flushStreams_ = function() {
      // !!THIS ORDER IS IMPORTANT!!
      // video first then audio
      flushStream(video, 'video');
      flushStream(audio, 'audio');
      flushStream(timedMetadata, 'timed-metadata');
    };

    this.flush = function() {
      this.flushStreams_();
      this.trigger('done');
    };
  };
  ElementaryStream.prototype = new stream();

  var m2ts = {
    PAT_PID: 0x0000,
    MP2T_PACKET_LENGTH: MP2T_PACKET_LENGTH,
    TransportPacketStream: TransportPacketStream,
    TransportParseStream: TransportParseStream,
    ElementaryStream: ElementaryStream,
    TimestampRolloverStream: TimestampRolloverStream$1,
    CaptionStream: captionStream.CaptionStream,
    Cea608Stream: captionStream.Cea608Stream,
    MetadataStream: metadataStream
  };

  for (var type in streamTypes) {
    if (streamTypes.hasOwnProperty(type)) {
      m2ts[type] = streamTypes[type];
    }
  }

  var m2ts_1 = m2ts;

  var ONE_SECOND_IN_TS$2 = clock.ONE_SECOND_IN_TS;

  var AdtsStream;

  var
    ADTS_SAMPLING_FREQUENCIES = [
      96000,
      88200,
      64000,
      48000,
      44100,
      32000,
      24000,
      22050,
      16000,
      12000,
      11025,
      8000,
      7350
    ];

  /*
   * Accepts a ElementaryStream and emits data events with parsed
   * AAC Audio Frames of the individual packets. Input audio in ADTS
   * format is unpacked and re-emitted as AAC frames.
   *
   * @see http://wiki.multimedia.cx/index.php?title=ADTS
   * @see http://wiki.multimedia.cx/?title=Understanding_AAC
   */
  AdtsStream = function(handlePartialSegments) {
    var
      buffer,
      frameNum = 0;

    AdtsStream.prototype.init.call(this);

    this.push = function(packet) {
      var
        i = 0,
        frameLength,
        protectionSkipBytes,
        frameEnd,
        oldBuffer,
        sampleCount,
        adtsFrameDuration;

      if (!handlePartialSegments) {
        frameNum = 0;
      }

      if (packet.type !== 'audio') {
        // ignore non-audio data
        return;
      }

      // Prepend any data in the buffer to the input data so that we can parse
      // aac frames the cross a PES packet boundary
      if (buffer) {
        oldBuffer = buffer;
        buffer = new Uint8Array(oldBuffer.byteLength + packet.data.byteLength);
        buffer.set(oldBuffer);
        buffer.set(packet.data, oldBuffer.byteLength);
      } else {
        buffer = packet.data;
      }

      // unpack any ADTS frames which have been fully received
      // for details on the ADTS header, see http://wiki.multimedia.cx/index.php?title=ADTS
      while (i + 5 < buffer.length) {

        // Look for the start of an ADTS header..
        if ((buffer[i] !== 0xFF) || (buffer[i + 1] & 0xF6) !== 0xF0) {
          // If a valid header was not found,  jump one forward and attempt to
          // find a valid ADTS header starting at the next byte
          i++;
          continue;
        }

        // The protection skip bit tells us if we have 2 bytes of CRC data at the
        // end of the ADTS header
        protectionSkipBytes = (~buffer[i + 1] & 0x01) * 2;

        // Frame length is a 13 bit integer starting 16 bits from the
        // end of the sync sequence
        frameLength = ((buffer[i + 3] & 0x03) << 11) |
          (buffer[i + 4] << 3) |
          ((buffer[i + 5] & 0xe0) >> 5);

        sampleCount = ((buffer[i + 6] & 0x03) + 1) * 1024;
        adtsFrameDuration = (sampleCount * ONE_SECOND_IN_TS$2) /
          ADTS_SAMPLING_FREQUENCIES[(buffer[i + 2] & 0x3c) >>> 2];

        frameEnd = i + frameLength;

        // If we don't have enough data to actually finish this ADTS frame, return
        // and wait for more data
        if (buffer.byteLength < frameEnd) {
          return;
        }

        // Otherwise, deliver the complete AAC frame
        this.trigger('data', {
          pts: packet.pts + (frameNum * adtsFrameDuration),
          dts: packet.dts + (frameNum * adtsFrameDuration),
          sampleCount: sampleCount,
          audioobjecttype: ((buffer[i + 2] >>> 6) & 0x03) + 1,
          channelcount: ((buffer[i + 2] & 1) << 2) |
            ((buffer[i + 3] & 0xc0) >>> 6),
          samplerate: ADTS_SAMPLING_FREQUENCIES[(buffer[i + 2] & 0x3c) >>> 2],
          samplingfrequencyindex: (buffer[i + 2] & 0x3c) >>> 2,
          // assume ISO/IEC 14496-12 AudioSampleEntry default of 16
          samplesize: 16,
          data: buffer.subarray(i + 7 + protectionSkipBytes, frameEnd)
        });

        frameNum++;

        // If the buffer is empty, clear it and return
        if (buffer.byteLength === frameEnd) {
          buffer = undefined;
          return;
        }

        // Remove the finished frame from the buffer and start the process again
        buffer = buffer.subarray(frameEnd);
      }
    };

    this.flush = function() {
      frameNum = 0;
      this.trigger('done');
    };

    this.reset = function() {
      buffer = void 0;
      this.trigger('reset');
    };

    this.endTimeline = function() {
      buffer = void 0;
      this.trigger('endedtimeline');
    };
  };

  AdtsStream.prototype = new stream();

  var adts = AdtsStream;

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */

  var ExpGolomb;

  /**
   * Parser for exponential Golomb codes, a variable-bitwidth number encoding
   * scheme used by h264.
   */
  ExpGolomb = function(workingData) {
    var
      // the number of bytes left to examine in workingData
      workingBytesAvailable = workingData.byteLength,

      // the current word being examined
      workingWord = 0, // :uint

      // the number of bits left to examine in the current word
      workingBitsAvailable = 0; // :uint;

    // ():uint
    this.length = function() {
      return (8 * workingBytesAvailable);
    };

    // ():uint
    this.bitsAvailable = function() {
      return (8 * workingBytesAvailable) + workingBitsAvailable;
    };

    // ():void
    this.loadWord = function() {
      var
        position = workingData.byteLength - workingBytesAvailable,
        workingBytes = new Uint8Array(4),
        availableBytes = Math.min(4, workingBytesAvailable);

      if (availableBytes === 0) {
        throw new Error('no bytes available');
      }

      workingBytes.set(workingData.subarray(position,
                                            position + availableBytes));
      workingWord = new DataView(workingBytes.buffer).getUint32(0);

      // track the amount of workingData that has been processed
      workingBitsAvailable = availableBytes * 8;
      workingBytesAvailable -= availableBytes;
    };

    // (count:int):void
    this.skipBits = function(count) {
      var skipBytes; // :int
      if (workingBitsAvailable > count) {
        workingWord          <<= count;
        workingBitsAvailable -= count;
      } else {
        count -= workingBitsAvailable;
        skipBytes = Math.floor(count / 8);

        count -= (skipBytes * 8);
        workingBytesAvailable -= skipBytes;

        this.loadWord();

        workingWord <<= count;
        workingBitsAvailable -= count;
      }
    };

    // (size:int):uint
    this.readBits = function(size) {
      var
        bits = Math.min(workingBitsAvailable, size), // :uint
        valu = workingWord >>> (32 - bits); // :uint
      // if size > 31, handle error
      workingBitsAvailable -= bits;
      if (workingBitsAvailable > 0) {
        workingWord <<= bits;
      } else if (workingBytesAvailable > 0) {
        this.loadWord();
      }

      bits = size - bits;
      if (bits > 0) {
        return valu << bits | this.readBits(bits);
      }
      return valu;
    };

    // ():uint
    this.skipLeadingZeros = function() {
      var leadingZeroCount; // :uint
      for (leadingZeroCount = 0; leadingZeroCount < workingBitsAvailable; ++leadingZeroCount) {
        if ((workingWord & (0x80000000 >>> leadingZeroCount)) !== 0) {
          // the first bit of working word is 1
          workingWord <<= leadingZeroCount;
          workingBitsAvailable -= leadingZeroCount;
          return leadingZeroCount;
        }
      }

      // we exhausted workingWord and still have not found a 1
      this.loadWord();
      return leadingZeroCount + this.skipLeadingZeros();
    };

    // ():void
    this.skipUnsignedExpGolomb = function() {
      this.skipBits(1 + this.skipLeadingZeros());
    };

    // ():void
    this.skipExpGolomb = function() {
      this.skipBits(1 + this.skipLeadingZeros());
    };

    // ():uint
    this.readUnsignedExpGolomb = function() {
      var clz = this.skipLeadingZeros(); // :uint
      return this.readBits(clz + 1) - 1;
    };

    // ():int
    this.readExpGolomb = function() {
      var valu = this.readUnsignedExpGolomb(); // :int
      if (0x01 & valu) {
        // the number is odd if the low order bit is set
        return (1 + valu) >>> 1; // add 1 to make it even, and divide by 2
      }
      return -1 * (valu >>> 1); // divide by two then make it negative
    };

    // Some convenience functions
    // :Boolean
    this.readBoolean = function() {
      return this.readBits(1) === 1;
    };

    // ():int
    this.readUnsignedByte = function() {
      return this.readBits(8);
    };

    this.loadWord();
  };

  var expGolomb = ExpGolomb;

  var H264Stream, NalByteStream;
  var PROFILES_WITH_OPTIONAL_SPS_DATA;

  /**
   * Accepts a NAL unit byte stream and unpacks the embedded NAL units.
   */
  NalByteStream = function() {
    var
      syncPoint = 0,
      i,
      buffer;
    NalByteStream.prototype.init.call(this);

    /*
     * Scans a byte stream and triggers a data event with the NAL units found.
     * @param {Object} data Event received from H264Stream
     * @param {Uint8Array} data.data The h264 byte stream to be scanned
     *
     * @see H264Stream.push
     */
    this.push = function(data) {
      var swapBuffer;

      if (!buffer) {
        buffer = data.data;
      } else {
        swapBuffer = new Uint8Array(buffer.byteLength + data.data.byteLength);
        swapBuffer.set(buffer);
        swapBuffer.set(data.data, buffer.byteLength);
        buffer = swapBuffer;
      }
      var len = buffer.byteLength;

      // Rec. ITU-T H.264, Annex B
      // scan for NAL unit boundaries

      // a match looks like this:
      // 0 0 1 .. NAL .. 0 0 1
      // ^ sync point        ^ i
      // or this:
      // 0 0 1 .. NAL .. 0 0 0
      // ^ sync point        ^ i

      // advance the sync point to a NAL start, if necessary
      for (; syncPoint < len - 3; syncPoint++) {
        if (buffer[syncPoint + 2] === 1) {
          // the sync point is properly aligned
          i = syncPoint + 5;
          break;
        }
      }

      while (i < len) {
        // look at the current byte to determine if we've hit the end of
        // a NAL unit boundary
        switch (buffer[i]) {
        case 0:
          // skip past non-sync sequences
          if (buffer[i - 1] !== 0) {
            i += 2;
            break;
          } else if (buffer[i - 2] !== 0) {
            i++;
            break;
          }

          // deliver the NAL unit if it isn't empty
          if (syncPoint + 3 !== i - 2) {
            this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));
          }

          // drop trailing zeroes
          do {
            i++;
          } while (buffer[i] !== 1 && i < len);
          syncPoint = i - 2;
          i += 3;
          break;
        case 1:
          // skip past non-sync sequences
          if (buffer[i - 1] !== 0 ||
              buffer[i - 2] !== 0) {
            i += 3;
            break;
          }

          // deliver the NAL unit
          this.trigger('data', buffer.subarray(syncPoint + 3, i - 2));
          syncPoint = i - 2;
          i += 3;
          break;
        default:
          // the current byte isn't a one or zero, so it cannot be part
          // of a sync sequence
          i += 3;
          break;
        }
      }
      // filter out the NAL units that were delivered
      buffer = buffer.subarray(syncPoint);
      i -= syncPoint;
      syncPoint = 0;
    };

    this.reset = function() {
      buffer = null;
      syncPoint = 0;
      this.trigger('reset');
    };

    this.flush = function() {
      // deliver the last buffered NAL unit
      if (buffer && buffer.byteLength > 3) {
        this.trigger('data', buffer.subarray(syncPoint + 3));
      }
      // reset the stream state
      buffer = null;
      syncPoint = 0;
      this.trigger('done');
    };

    this.endTimeline = function() {
      this.flush();
      this.trigger('endedtimeline');
    };
  };
  NalByteStream.prototype = new stream();

  // values of profile_idc that indicate additional fields are included in the SPS
  // see Recommendation ITU-T H.264 (4/2013),
  // 7.3.2.1.1 Sequence parameter set data syntax
  PROFILES_WITH_OPTIONAL_SPS_DATA = {
    100: true,
    110: true,
    122: true,
    244: true,
    44: true,
    83: true,
    86: true,
    118: true,
    128: true,
    138: true,
    139: true,
    134: true
  };

  /**
   * Accepts input from a ElementaryStream and produces H.264 NAL unit data
   * events.
   */
  H264Stream = function() {
    var
      nalByteStream = new NalByteStream(),
      self,
      trackId,
      currentPts,
      currentDts,

      discardEmulationPreventionBytes,
      readSequenceParameterSet,
      skipScalingList;

    H264Stream.prototype.init.call(this);
    self = this;

    /*
     * Pushes a packet from a stream onto the NalByteStream
     *
     * @param {Object} packet - A packet received from a stream
     * @param {Uint8Array} packet.data - The raw bytes of the packet
     * @param {Number} packet.dts - Decode timestamp of the packet
     * @param {Number} packet.pts - Presentation timestamp of the packet
     * @param {Number} packet.trackId - The id of the h264 track this packet came from
     * @param {('video'|'audio')} packet.type - The type of packet
     *
     */
    this.push = function(packet) {
      if (packet.type !== 'video') {
        return;
      }
      trackId = packet.trackId;
      currentPts = packet.pts;
      currentDts = packet.dts;

      nalByteStream.push(packet);
    };

    /*
     * Identify NAL unit types and pass on the NALU, trackId, presentation and decode timestamps
     * for the NALUs to the next stream component.
     * Also, preprocess caption and sequence parameter NALUs.
     *
     * @param {Uint8Array} data - A NAL unit identified by `NalByteStream.push`
     * @see NalByteStream.push
     */
    nalByteStream.on('data', function(data) {
      var
        event = {
          trackId: trackId,
          pts: currentPts,
          dts: currentDts,
          data: data
        };

      switch (data[0] & 0x1f) {
      case 0x05:
        event.nalUnitType = 'slice_layer_without_partitioning_rbsp_idr';
        break;
      case 0x06:
        event.nalUnitType = 'sei_rbsp';
        event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
        break;
      case 0x07:
        event.nalUnitType = 'seq_parameter_set_rbsp';
        event.escapedRBSP = discardEmulationPreventionBytes(data.subarray(1));
        event.config = readSequenceParameterSet(event.escapedRBSP);
        break;
      case 0x08:
        event.nalUnitType = 'pic_parameter_set_rbsp';
        break;
      case 0x09:
        event.nalUnitType = 'access_unit_delimiter_rbsp';
        break;
      }
      // This triggers data on the H264Stream
      self.trigger('data', event);
    });
    nalByteStream.on('done', function() {
      self.trigger('done');
    });
    nalByteStream.on('partialdone', function() {
      self.trigger('partialdone');
    });
    nalByteStream.on('reset', function() {
      self.trigger('reset');
    });
    nalByteStream.on('endedtimeline', function() {
      self.trigger('endedtimeline');
    });

    this.flush = function() {
      nalByteStream.flush();
    };

    this.partialFlush = function() {
      nalByteStream.partialFlush();
    };

    this.reset = function() {
      nalByteStream.reset();
    };

    this.endTimeline = function() {
      nalByteStream.endTimeline();
    };

    /**
     * Advance the ExpGolomb decoder past a scaling list. The scaling
     * list is optionally transmitted as part of a sequence parameter
     * set and is not relevant to transmuxing.
     * @param count {number} the number of entries in this scaling list
     * @param expGolombDecoder {object} an ExpGolomb pointed to the
     * start of a scaling list
     * @see Recommendation ITU-T H.264, Section 7.3.2.1.1.1
     */
    skipScalingList = function(count, expGolombDecoder) {
      var
        lastScale = 8,
        nextScale = 8,
        j,
        deltaScale;

      for (j = 0; j < count; j++) {
        if (nextScale !== 0) {
          deltaScale = expGolombDecoder.readExpGolomb();
          nextScale = (lastScale + deltaScale + 256) % 256;
        }

        lastScale = (nextScale === 0) ? lastScale : nextScale;
      }
    };

    /**
     * Expunge any "Emulation Prevention" bytes from a "Raw Byte
     * Sequence Payload"
     * @param data {Uint8Array} the bytes of a RBSP from a NAL
     * unit
     * @return {Uint8Array} the RBSP without any Emulation
     * Prevention Bytes
     */
    discardEmulationPreventionBytes = function(data) {
      var
        length = data.byteLength,
        emulationPreventionBytesPositions = [],
        i = 1,
        newLength, newData;

      // Find all `Emulation Prevention Bytes`
      while (i < length - 2) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0x03) {
          emulationPreventionBytesPositions.push(i + 2);
          i += 2;
        } else {
          i++;
        }
      }

      // If no Emulation Prevention Bytes were found just return the original
      // array
      if (emulationPreventionBytesPositions.length === 0) {
        return data;
      }

      // Create a new array to hold the NAL unit data
      newLength = length - emulationPreventionBytesPositions.length;
      newData = new Uint8Array(newLength);
      var sourceIndex = 0;

      for (i = 0; i < newLength; sourceIndex++, i++) {
        if (sourceIndex === emulationPreventionBytesPositions[0]) {
          // Skip this byte
          sourceIndex++;
          // Remove this position index
          emulationPreventionBytesPositions.shift();
        }
        newData[i] = data[sourceIndex];
      }

      return newData;
    };

    /**
     * Read a sequence parameter set and return some interesting video
     * properties. A sequence parameter set is the H264 metadata that
     * describes the properties of upcoming video frames.
     * @param data {Uint8Array} the bytes of a sequence parameter set
     * @return {object} an object with configuration parsed from the
     * sequence parameter set, including the dimensions of the
     * associated video frames.
     */
    readSequenceParameterSet = function(data) {
      var
        frameCropLeftOffset = 0,
        frameCropRightOffset = 0,
        frameCropTopOffset = 0,
        frameCropBottomOffset = 0,
        sarScale = 1,
        expGolombDecoder, profileIdc, levelIdc, profileCompatibility,
        chromaFormatIdc, picOrderCntType,
        numRefFramesInPicOrderCntCycle, picWidthInMbsMinus1,
        picHeightInMapUnitsMinus1,
        frameMbsOnlyFlag,
        scalingListCount,
        sarRatio,
        aspectRatioIdc,
        i;

      expGolombDecoder = new expGolomb(data);
      profileIdc = expGolombDecoder.readUnsignedByte(); // profile_idc
      profileCompatibility = expGolombDecoder.readUnsignedByte(); // constraint_set[0-5]_flag
      levelIdc = expGolombDecoder.readUnsignedByte(); // level_idc u(8)
      expGolombDecoder.skipUnsignedExpGolomb(); // seq_parameter_set_id

      // some profiles have more optional data we don't need
      if (PROFILES_WITH_OPTIONAL_SPS_DATA[profileIdc]) {
        chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();
        if (chromaFormatIdc === 3) {
          expGolombDecoder.skipBits(1); // separate_colour_plane_flag
        }
        expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_luma_minus8
        expGolombDecoder.skipUnsignedExpGolomb(); // bit_depth_chroma_minus8
        expGolombDecoder.skipBits(1); // qpprime_y_zero_transform_bypass_flag
        if (expGolombDecoder.readBoolean()) { // seq_scaling_matrix_present_flag
          scalingListCount = (chromaFormatIdc !== 3) ? 8 : 12;
          for (i = 0; i < scalingListCount; i++) {
            if (expGolombDecoder.readBoolean()) { // seq_scaling_list_present_flag[ i ]
              if (i < 6) {
                skipScalingList(16, expGolombDecoder);
              } else {
                skipScalingList(64, expGolombDecoder);
              }
            }
          }
        }
      }

      expGolombDecoder.skipUnsignedExpGolomb(); // log2_max_frame_num_minus4
      picOrderCntType = expGolombDecoder.readUnsignedExpGolomb();

      if (picOrderCntType === 0) {
        expGolombDecoder.readUnsignedExpGolomb(); // log2_max_pic_order_cnt_lsb_minus4
      } else if (picOrderCntType === 1) {
        expGolombDecoder.skipBits(1); // delta_pic_order_always_zero_flag
        expGolombDecoder.skipExpGolomb(); // offset_for_non_ref_pic
        expGolombDecoder.skipExpGolomb(); // offset_for_top_to_bottom_field
        numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();
        for (i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
          expGolombDecoder.skipExpGolomb(); // offset_for_ref_frame[ i ]
        }
      }

      expGolombDecoder.skipUnsignedExpGolomb(); // max_num_ref_frames
      expGolombDecoder.skipBits(1); // gaps_in_frame_num_value_allowed_flag

      picWidthInMbsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
      picHeightInMapUnitsMinus1 = expGolombDecoder.readUnsignedExpGolomb();

      frameMbsOnlyFlag = expGolombDecoder.readBits(1);
      if (frameMbsOnlyFlag === 0) {
        expGolombDecoder.skipBits(1); // mb_adaptive_frame_field_flag
      }

      expGolombDecoder.skipBits(1); // direct_8x8_inference_flag
      if (expGolombDecoder.readBoolean()) { // frame_cropping_flag
        frameCropLeftOffset = expGolombDecoder.readUnsignedExpGolomb();
        frameCropRightOffset = expGolombDecoder.readUnsignedExpGolomb();
        frameCropTopOffset = expGolombDecoder.readUnsignedExpGolomb();
        frameCropBottomOffset = expGolombDecoder.readUnsignedExpGolomb();
      }
      if (expGolombDecoder.readBoolean()) {
        // vui_parameters_present_flag
        if (expGolombDecoder.readBoolean()) {
          // aspect_ratio_info_present_flag
          aspectRatioIdc = expGolombDecoder.readUnsignedByte();
          switch (aspectRatioIdc) {
            case 1: sarRatio = [1, 1]; break;
            case 2: sarRatio = [12, 11]; break;
            case 3: sarRatio = [10, 11]; break;
            case 4: sarRatio = [16, 11]; break;
            case 5: sarRatio = [40, 33]; break;
            case 6: sarRatio = [24, 11]; break;
            case 7: sarRatio = [20, 11]; break;
            case 8: sarRatio = [32, 11]; break;
            case 9: sarRatio = [80, 33]; break;
            case 10: sarRatio = [18, 11]; break;
            case 11: sarRatio = [15, 11]; break;
            case 12: sarRatio = [64, 33]; break;
            case 13: sarRatio = [160, 99]; break;
            case 14: sarRatio = [4, 3]; break;
            case 15: sarRatio = [3, 2]; break;
            case 16: sarRatio = [2, 1]; break;
            case 255: {
              sarRatio = [expGolombDecoder.readUnsignedByte() << 8 |
                          expGolombDecoder.readUnsignedByte(),
                          expGolombDecoder.readUnsignedByte() << 8 |
                          expGolombDecoder.readUnsignedByte() ];
              break;
            }
          }
          if (sarRatio) {
            sarScale = sarRatio[0] / sarRatio[1];
          }
        }
      }
      return {
        profileIdc: profileIdc,
        levelIdc: levelIdc,
        profileCompatibility: profileCompatibility,
        width: Math.ceil((((picWidthInMbsMinus1 + 1) * 16) - frameCropLeftOffset * 2 - frameCropRightOffset * 2) * sarScale),
        height: ((2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16) - (frameCropTopOffset * 2) - (frameCropBottomOffset * 2),
        sarRatio: sarRatio
      };
    };

  };
  H264Stream.prototype = new stream();

  var h264 = {
    H264Stream: H264Stream,
    NalByteStream: NalByteStream
  };

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   *
   * Utilities to detect basic properties and metadata about Aac data.
   */

  var ADTS_SAMPLING_FREQUENCIES$1 = [
    96000,
    88200,
    64000,
    48000,
    44100,
    32000,
    24000,
    22050,
    16000,
    12000,
    11025,
    8000,
    7350
  ];

  var isLikelyAacData = function(data) {
    if ((data[0] === 'I'.charCodeAt(0)) &&
        (data[1] === 'D'.charCodeAt(0)) &&
        (data[2] === '3'.charCodeAt(0))) {
      return true;
    }
    return false;
  };

  var parseSyncSafeInteger$1 = function(data) {
    return (data[0] << 21) |
            (data[1] << 14) |
            (data[2] << 7) |
            (data[3]);
  };

  // return a percent-encoded representation of the specified byte range
  // @see http://en.wikipedia.org/wiki/Percent-encoding
  var percentEncode$1 = function(bytes, start, end) {
    var i, result = '';
    for (i = start; i < end; i++) {
      result += '%' + ('00' + bytes[i].toString(16)).slice(-2);
    }
    return result;
  };

  // return the string representation of the specified byte range,
  // interpreted as ISO-8859-1.
  var parseIso88591$1 = function(bytes, start, end) {
    return unescape(percentEncode$1(bytes, start, end)); // jshint ignore:line
  };

  var parseId3TagSize = function(header, byteIndex) {
    var
      returnSize = (header[byteIndex + 6] << 21) |
                   (header[byteIndex + 7] << 14) |
                   (header[byteIndex + 8] << 7) |
                   (header[byteIndex + 9]),
      flags = header[byteIndex + 5],
      footerPresent = (flags & 16) >> 4;

    if (footerPresent) {
      return returnSize + 20;
    }
    return returnSize + 10;
  };

  var parseAdtsSize = function(header, byteIndex) {
    var
      lowThree = (header[byteIndex + 5] & 0xE0) >> 5,
      middle = header[byteIndex + 4] << 3,
      highTwo = header[byteIndex + 3] & 0x3 << 11;

    return (highTwo | middle) | lowThree;
  };

  var parseType = function(header, byteIndex) {
    if ((header[byteIndex] === 'I'.charCodeAt(0)) &&
        (header[byteIndex + 1] === 'D'.charCodeAt(0)) &&
        (header[byteIndex + 2] === '3'.charCodeAt(0))) {
      return 'timed-metadata';
    } else if ((header[byteIndex] & 0xff === 0xff) &&
               ((header[byteIndex + 1] & 0xf0) === 0xf0)) {
      return 'audio';
    }
    return null;
  };

  var parseSampleRate = function(packet) {
    var i = 0;

    while (i + 5 < packet.length) {
      if (packet[i] !== 0xFF || (packet[i + 1] & 0xF6) !== 0xF0) {
        // If a valid header was not found,  jump one forward and attempt to
        // find a valid ADTS header starting at the next byte
        i++;
        continue;
      }
      return ADTS_SAMPLING_FREQUENCIES$1[(packet[i + 2] & 0x3c) >>> 2];
    }

    return null;
  };

  var parseAacTimestamp = function(packet) {
    var frameStart, frameSize, frame, frameHeader;

    // find the start of the first frame and the end of the tag
    frameStart = 10;
    if (packet[5] & 0x40) {
      // advance the frame start past the extended header
      frameStart += 4; // header size field
      frameStart += parseSyncSafeInteger$1(packet.subarray(10, 14));
    }

    // parse one or more ID3 frames
    // http://id3.org/id3v2.3.0#ID3v2_frame_overview
    do {
      // determine the number of bytes in this frame
      frameSize = parseSyncSafeInteger$1(packet.subarray(frameStart + 4, frameStart + 8));
      if (frameSize < 1) {
        return null;
      }
      frameHeader = String.fromCharCode(packet[frameStart],
                                        packet[frameStart + 1],
                                        packet[frameStart + 2],
                                        packet[frameStart + 3]);

      if (frameHeader === 'PRIV') {
        frame = packet.subarray(frameStart + 10, frameStart + frameSize + 10);

        for (var i = 0; i < frame.byteLength; i++) {
          if (frame[i] === 0) {
            var owner = parseIso88591$1(frame, 0, i);
            if (owner === 'com.apple.streaming.transportStreamTimestamp') {
              var d = frame.subarray(i + 1);
              var size = ((d[3] & 0x01)  << 30) |
                         (d[4]  << 22) |
                         (d[5] << 14) |
                         (d[6] << 6) |
                         (d[7] >>> 2);
              size *= 4;
              size += d[7] & 0x03;

              return size;
            }
            break;
          }
        }
      }

      frameStart += 10; // advance past the frame header
      frameStart += frameSize; // advance past the frame body
    } while (frameStart < packet.byteLength);
    return null;
  };

  var utils = {
    isLikelyAacData: isLikelyAacData,
    parseId3TagSize: parseId3TagSize,
    parseAdtsSize: parseAdtsSize,
    parseType: parseType,
    parseSampleRate: parseSampleRate,
    parseAacTimestamp: parseAacTimestamp
  };

  // Constants
  var AacStream;

  /**
   * Splits an incoming stream of binary data into ADTS and ID3 Frames.
   */

  AacStream = function() {
    var
      everything = new Uint8Array(),
      timeStamp = 0;

    AacStream.prototype.init.call(this);

    this.setTimestamp = function(timestamp) {
      timeStamp = timestamp;
    };

    this.push = function(bytes) {
      var
        frameSize = 0,
        byteIndex = 0,
        bytesLeft,
        chunk,
        packet,
        tempLength;

      // If there are bytes remaining from the last segment, prepend them to the
      // bytes that were pushed in
      if (everything.length) {
        tempLength = everything.length;
        everything = new Uint8Array(bytes.byteLength + tempLength);
        everything.set(everything.subarray(0, tempLength));
        everything.set(bytes, tempLength);
      } else {
        everything = bytes;
      }

      while (everything.length - byteIndex >= 3) {
        if ((everything[byteIndex] === 'I'.charCodeAt(0)) &&
            (everything[byteIndex + 1] === 'D'.charCodeAt(0)) &&
            (everything[byteIndex + 2] === '3'.charCodeAt(0))) {

          // Exit early because we don't have enough to parse
          // the ID3 tag header
          if (everything.length - byteIndex < 10) {
            break;
          }

          // check framesize
          frameSize = utils.parseId3TagSize(everything, byteIndex);

          // Exit early if we don't have enough in the buffer
          // to emit a full packet
          // Add to byteIndex to support multiple ID3 tags in sequence
          if (byteIndex + frameSize > everything.length) {
            break;
          }
          chunk = {
            type: 'timed-metadata',
            data: everything.subarray(byteIndex, byteIndex + frameSize)
          };
          this.trigger('data', chunk);
          byteIndex += frameSize;
          continue;
        } else if (((everything[byteIndex] & 0xff) === 0xff) &&
                   ((everything[byteIndex + 1] & 0xf0) === 0xf0)) {

          // Exit early because we don't have enough to parse
          // the ADTS frame header
          if (everything.length - byteIndex < 7) {
            break;
          }

          frameSize = utils.parseAdtsSize(everything, byteIndex);

          // Exit early if we don't have enough in the buffer
          // to emit a full packet
          if (byteIndex + frameSize > everything.length) {
            break;
          }

          packet = {
            type: 'audio',
            data: everything.subarray(byteIndex, byteIndex + frameSize),
            pts: timeStamp,
            dts: timeStamp
          };
          this.trigger('data', packet);
          byteIndex += frameSize;
          continue;
        }
        byteIndex++;
      }
      bytesLeft = everything.length - byteIndex;

      if (bytesLeft > 0) {
        everything = everything.subarray(byteIndex);
      } else {
        everything = new Uint8Array();
      }
    };

    this.reset = function() {
      everything = new Uint8Array();
      this.trigger('reset');
    };

    this.endTimeline = function() {
      everything = new Uint8Array();
      this.trigger('endedtimeline');
    };
  };

  AacStream.prototype = new stream();

  var aac = AacStream;

  // constants
  var AUDIO_PROPERTIES = [
    'audioobjecttype',
    'channelcount',
    'samplerate',
    'samplingfrequencyindex',
    'samplesize'
  ];

  var audioProperties = AUDIO_PROPERTIES;

  var VIDEO_PROPERTIES = [
    'width',
    'height',
    'profileIdc',
    'levelIdc',
    'profileCompatibility',
    'sarRatio'
  ];


  var videoProperties = VIDEO_PROPERTIES;

  var H264Stream$1 = h264.H264Stream;

  var isLikelyAacData$1 = utils.isLikelyAacData;
  var ONE_SECOND_IN_TS$3 = clock.ONE_SECOND_IN_TS;



  // object types
  var VideoSegmentStream, AudioSegmentStream, Transmuxer, CoalesceStream;

  /**
   * Compare two arrays (even typed) for same-ness
   */
  var arrayEquals = function(a, b) {
    var
      i;

    if (a.length !== b.length) {
      return false;
    }

    // compare the value of each element in the array
    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }

    return true;
  };

  var generateVideoSegmentTimingInfo = function(
    baseMediaDecodeTime,
    startDts,
    startPts,
    endDts,
    endPts,
    prependedContentDuration
  ) {
    var
      ptsOffsetFromDts = startPts - startDts,
      decodeDuration = endDts - startDts,
      presentationDuration = endPts - startPts;

    // The PTS and DTS values are based on the actual stream times from the segment,
    // however, the player time values will reflect a start from the baseMediaDecodeTime.
    // In order to provide relevant values for the player times, base timing info on the
    // baseMediaDecodeTime and the DTS and PTS durations of the segment.
    return {
      start: {
        dts: baseMediaDecodeTime,
        pts: baseMediaDecodeTime + ptsOffsetFromDts
      },
      end: {
        dts: baseMediaDecodeTime + decodeDuration,
        pts: baseMediaDecodeTime + presentationDuration
      },
      prependedContentDuration: prependedContentDuration,
      baseMediaDecodeTime: baseMediaDecodeTime
    };
  };

  /**
   * Constructs a single-track, ISO BMFF media segment from AAC data
   * events. The output of this stream can be fed to a SourceBuffer
   * configured with a suitable initialization segment.
   * @param track {object} track metadata configuration
   * @param options {object} transmuxer options object
   * @param options.keepOriginalTimestamps {boolean} If true, keep the timestamps
   *        in the source; false to adjust the first segment to start at 0.
   */
  AudioSegmentStream = function(track, options) {
    var
      adtsFrames = [],
      sequenceNumber = 0,
      earliestAllowedDts = 0,
      audioAppendStartTs = 0,
      videoBaseMediaDecodeTime = Infinity;

    options = options || {};

    AudioSegmentStream.prototype.init.call(this);

    this.push = function(data) {
      trackDecodeInfo.collectDtsInfo(track, data);

      if (track) {
        audioProperties.forEach(function(prop) {
          track[prop] = data[prop];
        });
      }

      // buffer audio data until end() is called
      adtsFrames.push(data);
    };

    this.setEarliestDts = function(earliestDts) {
      earliestAllowedDts = earliestDts;
    };

    this.setVideoBaseMediaDecodeTime = function(baseMediaDecodeTime) {
      videoBaseMediaDecodeTime = baseMediaDecodeTime;
    };

    this.setAudioAppendStart = function(timestamp) {
      audioAppendStartTs = timestamp;
    };

    this.flush = function() {
      var
        frames,
        moof,
        mdat,
        boxes,
        frameDuration;

      // return early if no audio data has been observed
      if (adtsFrames.length === 0) {
        this.trigger('done', 'AudioSegmentStream');
        return;
      }

      frames = audioFrameUtils.trimAdtsFramesByEarliestDts(
        adtsFrames, track, earliestAllowedDts);
      track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(
        track, options.keepOriginalTimestamps);

      audioFrameUtils.prefixWithSilence(
        track, frames, audioAppendStartTs, videoBaseMediaDecodeTime);

      // we have to build the index from byte locations to
      // samples (that is, adts frames) in the audio data
      track.samples = audioFrameUtils.generateSampleTable(frames);

      // concatenate the audio data to constuct the mdat
      mdat = mp4Generator.mdat(audioFrameUtils.concatenateFrameData(frames));

      adtsFrames = [];

      moof = mp4Generator.moof(sequenceNumber, [track]);
      boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

      // bump the sequence number for next time
      sequenceNumber++;

      boxes.set(moof);
      boxes.set(mdat, moof.byteLength);

      trackDecodeInfo.clearDtsInfo(track);

      frameDuration = Math.ceil(ONE_SECOND_IN_TS$3 * 1024 / track.samplerate);

      // TODO this check was added to maintain backwards compatibility (particularly with
      // tests) on adding the timingInfo event. However, it seems unlikely that there's a
      // valid use-case where an init segment/data should be triggered without associated
      // frames. Leaving for now, but should be looked into.
      if (frames.length) {
        this.trigger('timingInfo', {
          start: frames[0].pts,
          end: frames[0].pts + (frames.length * frameDuration)
        });
      }
      this.trigger('data', {track: track, boxes: boxes});
      this.trigger('done', 'AudioSegmentStream');
    };

    this.reset = function() {
      trackDecodeInfo.clearDtsInfo(track);
      adtsFrames = [];
      this.trigger('reset');
    };
  };

  AudioSegmentStream.prototype = new stream();

  /**
   * Constructs a single-track, ISO BMFF media segment from H264 data
   * events. The output of this stream can be fed to a SourceBuffer
   * configured with a suitable initialization segment.
   * @param track {object} track metadata configuration
   * @param options {object} transmuxer options object
   * @param options.alignGopsAtEnd {boolean} If true, start from the end of the
   *        gopsToAlignWith list when attempting to align gop pts
   * @param options.keepOriginalTimestamps {boolean} If true, keep the timestamps
   *        in the source; false to adjust the first segment to start at 0.
   */
  VideoSegmentStream = function(track, options) {
    var
      sequenceNumber = 0,
      nalUnits = [],
      gopsToAlignWith = [],
      config,
      pps;

    options = options || {};

    VideoSegmentStream.prototype.init.call(this);

    delete track.minPTS;

    this.gopCache_ = [];

    /**
      * Constructs a ISO BMFF segment given H264 nalUnits
      * @param {Object} nalUnit A data event representing a nalUnit
      * @param {String} nalUnit.nalUnitType
      * @param {Object} nalUnit.config Properties for a mp4 track
      * @param {Uint8Array} nalUnit.data The nalUnit bytes
      * @see lib/codecs/h264.js
     **/
    this.push = function(nalUnit) {
      trackDecodeInfo.collectDtsInfo(track, nalUnit);

      // record the track config
      if (nalUnit.nalUnitType === 'seq_parameter_set_rbsp' && !config) {
        config = nalUnit.config;
        track.sps = [nalUnit.data];

        videoProperties.forEach(function(prop) {
          track[prop] = config[prop];
        }, this);
      }

      if (nalUnit.nalUnitType === 'pic_parameter_set_rbsp' &&
          !pps) {
        pps = nalUnit.data;
        track.pps = [nalUnit.data];
      }

      // buffer video until flush() is called
      nalUnits.push(nalUnit);
    };

    /**
      * Pass constructed ISO BMFF track and boxes on to the
      * next stream in the pipeline
     **/
    this.flush = function() {
      var
        frames,
        gopForFusion,
        gops,
        moof,
        mdat,
        boxes,
        prependedContentDuration = 0,
        firstGop,
        lastGop;

      // Throw away nalUnits at the start of the byte stream until
      // we find the first AUD
      while (nalUnits.length) {
        if (nalUnits[0].nalUnitType === 'access_unit_delimiter_rbsp') {
          break;
        }
        nalUnits.shift();
      }

      // Return early if no video data has been observed
      if (nalUnits.length === 0) {
        this.resetStream_();
        this.trigger('done', 'VideoSegmentStream');
        return;
      }

      // Organize the raw nal-units into arrays that represent
      // higher-level constructs such as frames and gops
      // (group-of-pictures)
      frames = frameUtils.groupNalsIntoFrames(nalUnits);
      gops = frameUtils.groupFramesIntoGops(frames);

      // If the first frame of this fragment is not a keyframe we have
      // a problem since MSE (on Chrome) requires a leading keyframe.
      //
      // We have two approaches to repairing this situation:
      // 1) GOP-FUSION:
      //    This is where we keep track of the GOPS (group-of-pictures)
      //    from previous fragments and attempt to find one that we can
      //    prepend to the current fragment in order to create a valid
      //    fragment.
      // 2) KEYFRAME-PULLING:
      //    Here we search for the first keyframe in the fragment and
      //    throw away all the frames between the start of the fragment
      //    and that keyframe. We then extend the duration and pull the
      //    PTS of the keyframe forward so that it covers the time range
      //    of the frames that were disposed of.
      //
      // #1 is far prefereable over #2 which can cause "stuttering" but
      // requires more things to be just right.
      if (!gops[0][0].keyFrame) {
        // Search for a gop for fusion from our gopCache
        gopForFusion = this.getGopForFusion_(nalUnits[0], track);

        if (gopForFusion) {
          // in order to provide more accurate timing information about the segment, save
          // the number of seconds prepended to the original segment due to GOP fusion
          prependedContentDuration = gopForFusion.duration;

          gops.unshift(gopForFusion);
          // Adjust Gops' metadata to account for the inclusion of the
          // new gop at the beginning
          gops.byteLength += gopForFusion.byteLength;
          gops.nalCount += gopForFusion.nalCount;
          gops.pts = gopForFusion.pts;
          gops.dts = gopForFusion.dts;
          gops.duration += gopForFusion.duration;
        } else {
          // If we didn't find a candidate gop fall back to keyframe-pulling
          gops = frameUtils.extendFirstKeyFrame(gops);
        }
      }

      // Trim gops to align with gopsToAlignWith
      if (gopsToAlignWith.length) {
        var alignedGops;

        if (options.alignGopsAtEnd) {
          alignedGops = this.alignGopsAtEnd_(gops);
        } else {
          alignedGops = this.alignGopsAtStart_(gops);
        }

        if (!alignedGops) {
          // save all the nals in the last GOP into the gop cache
          this.gopCache_.unshift({
            gop: gops.pop(),
            pps: track.pps,
            sps: track.sps
          });

          // Keep a maximum of 6 GOPs in the cache
          this.gopCache_.length = Math.min(6, this.gopCache_.length);

          // Clear nalUnits
          nalUnits = [];

          // return early no gops can be aligned with desired gopsToAlignWith
          this.resetStream_();
          this.trigger('done', 'VideoSegmentStream');
          return;
        }

        // Some gops were trimmed. clear dts info so minSegmentDts and pts are correct
        // when recalculated before sending off to CoalesceStream
        trackDecodeInfo.clearDtsInfo(track);

        gops = alignedGops;
      }

      trackDecodeInfo.collectDtsInfo(track, gops);

      // First, we have to build the index from byte locations to
      // samples (that is, frames) in the video data
      track.samples = frameUtils.generateSampleTable(gops);

      // Concatenate the video data and construct the mdat
      mdat = mp4Generator.mdat(frameUtils.concatenateNalData(gops));

      track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(
        track, options.keepOriginalTimestamps);

      this.trigger('processedGopsInfo', gops.map(function(gop) {
        return {
          pts: gop.pts,
          dts: gop.dts,
          byteLength: gop.byteLength
        };
      }));

      firstGop = gops[0];
      lastGop = gops[gops.length - 1];

      this.trigger(
        'segmentTimingInfo',
        generateVideoSegmentTimingInfo(
          track.baseMediaDecodeTime,
          firstGop.dts,
          firstGop.pts,
          lastGop.dts + lastGop.duration,
          lastGop.pts + lastGop.duration,
          prependedContentDuration));

      this.trigger('timingInfo', {
        start: gops[0].pts,
        end: gops[gops.length - 1].pts + gops[gops.length - 1].duration
      });

      // save all the nals in the last GOP into the gop cache
      this.gopCache_.unshift({
        gop: gops.pop(),
        pps: track.pps,
        sps: track.sps
      });

      // Keep a maximum of 6 GOPs in the cache
      this.gopCache_.length = Math.min(6, this.gopCache_.length);

      // Clear nalUnits
      nalUnits = [];

      this.trigger('baseMediaDecodeTime', track.baseMediaDecodeTime);
      this.trigger('timelineStartInfo', track.timelineStartInfo);

      moof = mp4Generator.moof(sequenceNumber, [track]);

      // it would be great to allocate this array up front instead of
      // throwing away hundreds of media segment fragments
      boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

      // Bump the sequence number for next time
      sequenceNumber++;

      boxes.set(moof);
      boxes.set(mdat, moof.byteLength);

      this.trigger('data', {track: track, boxes: boxes});

      this.resetStream_();

      // Continue with the flush process now
      this.trigger('done', 'VideoSegmentStream');
    };

    this.reset = function() {
      this.resetStream_();
      nalUnits = [];
      this.gopCache_.length = 0;
      gopsToAlignWith.length = 0;
      this.trigger('reset');
    };

    this.resetStream_ = function() {
      trackDecodeInfo.clearDtsInfo(track);

      // reset config and pps because they may differ across segments
      // for instance, when we are rendition switching
      config = undefined;
      pps = undefined;
    };

    // Search for a candidate Gop for gop-fusion from the gop cache and
    // return it or return null if no good candidate was found
    this.getGopForFusion_ = function(nalUnit) {
      var
        halfSecond = 45000, // Half-a-second in a 90khz clock
        allowableOverlap = 10000, // About 3 frames @ 30fps
        nearestDistance = Infinity,
        dtsDistance,
        nearestGopObj,
        currentGop,
        currentGopObj,
        i;

      // Search for the GOP nearest to the beginning of this nal unit
      for (i = 0; i < this.gopCache_.length; i++) {
        currentGopObj = this.gopCache_[i];
        currentGop = currentGopObj.gop;

        // Reject Gops with different SPS or PPS
        if (!(track.pps && arrayEquals(track.pps[0], currentGopObj.pps[0])) ||
            !(track.sps && arrayEquals(track.sps[0], currentGopObj.sps[0]))) {
          continue;
        }

        // Reject Gops that would require a negative baseMediaDecodeTime
        if (currentGop.dts < track.timelineStartInfo.dts) {
          continue;
        }

        // The distance between the end of the gop and the start of the nalUnit
        dtsDistance = (nalUnit.dts - currentGop.dts) - currentGop.duration;

        // Only consider GOPS that start before the nal unit and end within
        // a half-second of the nal unit
        if (dtsDistance >= -allowableOverlap &&
            dtsDistance <= halfSecond) {

          // Always use the closest GOP we found if there is more than
          // one candidate
          if (!nearestGopObj ||
              nearestDistance > dtsDistance) {
            nearestGopObj = currentGopObj;
            nearestDistance = dtsDistance;
          }
        }
      }

      if (nearestGopObj) {
        return nearestGopObj.gop;
      }
      return null;
    };

    // trim gop list to the first gop found that has a matching pts with a gop in the list
    // of gopsToAlignWith starting from the START of the list
    this.alignGopsAtStart_ = function(gops) {
      var alignIndex, gopIndex, align, gop, byteLength, nalCount, duration, alignedGops;

      byteLength = gops.byteLength;
      nalCount = gops.nalCount;
      duration = gops.duration;
      alignIndex = gopIndex = 0;

      while (alignIndex < gopsToAlignWith.length && gopIndex < gops.length) {
        align = gopsToAlignWith[alignIndex];
        gop = gops[gopIndex];

        if (align.pts === gop.pts) {
          break;
        }

        if (gop.pts > align.pts) {
          // this current gop starts after the current gop we want to align on, so increment
          // align index
          alignIndex++;
          continue;
        }

        // current gop starts before the current gop we want to align on. so increment gop
        // index
        gopIndex++;
        byteLength -= gop.byteLength;
        nalCount -= gop.nalCount;
        duration -= gop.duration;
      }

      if (gopIndex === 0) {
        // no gops to trim
        return gops;
      }

      if (gopIndex === gops.length) {
        // all gops trimmed, skip appending all gops
        return null;
      }

      alignedGops = gops.slice(gopIndex);
      alignedGops.byteLength = byteLength;
      alignedGops.duration = duration;
      alignedGops.nalCount = nalCount;
      alignedGops.pts = alignedGops[0].pts;
      alignedGops.dts = alignedGops[0].dts;

      return alignedGops;
    };

    // trim gop list to the first gop found that has a matching pts with a gop in the list
    // of gopsToAlignWith starting from the END of the list
    this.alignGopsAtEnd_ = function(gops) {
      var alignIndex, gopIndex, align, gop, alignEndIndex, matchFound;

      alignIndex = gopsToAlignWith.length - 1;
      gopIndex = gops.length - 1;
      alignEndIndex = null;
      matchFound = false;

      while (alignIndex >= 0 && gopIndex >= 0) {
        align = gopsToAlignWith[alignIndex];
        gop = gops[gopIndex];

        if (align.pts === gop.pts) {
          matchFound = true;
          break;
        }

        if (align.pts > gop.pts) {
          alignIndex--;
          continue;
        }

        if (alignIndex === gopsToAlignWith.length - 1) {
          // gop.pts is greater than the last alignment candidate. If no match is found
          // by the end of this loop, we still want to append gops that come after this
          // point
          alignEndIndex = gopIndex;
        }

        gopIndex--;
      }

      if (!matchFound && alignEndIndex === null) {
        return null;
      }

      var trimIndex;

      if (matchFound) {
        trimIndex = gopIndex;
      } else {
        trimIndex = alignEndIndex;
      }

      if (trimIndex === 0) {
        return gops;
      }

      var alignedGops = gops.slice(trimIndex);
      var metadata = alignedGops.reduce(function(total, gop) {
        total.byteLength += gop.byteLength;
        total.duration += gop.duration;
        total.nalCount += gop.nalCount;
        return total;
      }, { byteLength: 0, duration: 0, nalCount: 0 });

      alignedGops.byteLength = metadata.byteLength;
      alignedGops.duration = metadata.duration;
      alignedGops.nalCount = metadata.nalCount;
      alignedGops.pts = alignedGops[0].pts;
      alignedGops.dts = alignedGops[0].dts;

      return alignedGops;
    };

    this.alignGopsWith = function(newGopsToAlignWith) {
      gopsToAlignWith = newGopsToAlignWith;
    };
  };

  VideoSegmentStream.prototype = new stream();

  /**
   * A Stream that can combine multiple streams (ie. audio & video)
   * into a single output segment for MSE. Also supports audio-only
   * and video-only streams.
   * @param options {object} transmuxer options object
   * @param options.keepOriginalTimestamps {boolean} If true, keep the timestamps
   *        in the source; false to adjust the first segment to start at media timeline start.
   */
  CoalesceStream = function(options, metadataStream) {
    // Number of Tracks per output segment
    // If greater than 1, we combine multiple
    // tracks into a single segment
    this.numberOfTracks = 0;
    this.metadataStream = metadataStream;

    options = options || {};

    if (typeof options.remux !== 'undefined') {
      this.remuxTracks = !!options.remux;
    } else {
      this.remuxTracks = true;
    }

    if (typeof options.keepOriginalTimestamps === 'boolean') {
      this.keepOriginalTimestamps = options.keepOriginalTimestamps;
    } else {
      this.keepOriginalTimestamps = false;
    }

    this.pendingTracks = [];
    this.videoTrack = null;
    this.pendingBoxes = [];
    this.pendingCaptions = [];
    this.pendingMetadata = [];
    this.pendingBytes = 0;
    this.emittedTracks = 0;

    CoalesceStream.prototype.init.call(this);

    // Take output from multiple
    this.push = function(output) {
      // buffer incoming captions until the associated video segment
      // finishes
      if (output.text) {
        return this.pendingCaptions.push(output);
      }
      // buffer incoming id3 tags until the final flush
      if (output.frames) {
        return this.pendingMetadata.push(output);
      }

      // Add this track to the list of pending tracks and store
      // important information required for the construction of
      // the final segment
      this.pendingTracks.push(output.track);
      this.pendingBytes += output.boxes.byteLength;

      // TODO: is there an issue for this against chrome?
      // We unshift audio and push video because
      // as of Chrome 75 when switching from
      // one init segment to another if the video
      // mdat does not appear after the audio mdat
      // only audio will play for the duration of our transmux.
      if (output.track.type === 'video') {
        this.videoTrack = output.track;
        this.pendingBoxes.push(output.boxes);
      }
      if (output.track.type === 'audio') {
        this.audioTrack = output.track;
        this.pendingBoxes.unshift(output.boxes);
      }
    };
  };

  CoalesceStream.prototype = new stream();
  CoalesceStream.prototype.flush = function(flushSource) {
    var
      offset = 0,
      event = {
        captions: [],
        captionStreams: {},
        metadata: [],
        info: {}
      },
      caption,
      id3,
      initSegment,
      timelineStartPts = 0,
      i;

    if (this.pendingTracks.length < this.numberOfTracks) {
      if (flushSource !== 'VideoSegmentStream' &&
          flushSource !== 'AudioSegmentStream') {
        // Return because we haven't received a flush from a data-generating
        // portion of the segment (meaning that we have only recieved meta-data
        // or captions.)
        return;
      } else if (this.remuxTracks) {
        // Return until we have enough tracks from the pipeline to remux (if we
        // are remuxing audio and video into a single MP4)
        return;
      } else if (this.pendingTracks.length === 0) {
        // In the case where we receive a flush without any data having been
        // received we consider it an emitted track for the purposes of coalescing
        // `done` events.
        // We do this for the case where there is an audio and video track in the
        // segment but no audio data. (seen in several playlists with alternate
        // audio tracks and no audio present in the main TS segments.)
        this.emittedTracks++;

        if (this.emittedTracks >= this.numberOfTracks) {
          this.trigger('done');
          this.emittedTracks = 0;
        }
        return;
      }
    }

    if (this.videoTrack) {
      timelineStartPts = this.videoTrack.timelineStartInfo.pts;
      videoProperties.forEach(function(prop) {
        event.info[prop] = this.videoTrack[prop];
      }, this);
    } else if (this.audioTrack) {
      timelineStartPts = this.audioTrack.timelineStartInfo.pts;
      audioProperties.forEach(function(prop) {
        event.info[prop] = this.audioTrack[prop];
      }, this);
    }

    if (this.videoTrack || this.audioTrack) {
      if (this.pendingTracks.length === 1) {
        event.type = this.pendingTracks[0].type;
      } else {
        event.type = 'combined';
      }

      this.emittedTracks += this.pendingTracks.length;

      initSegment = mp4Generator.initSegment(this.pendingTracks);

      // Create a new typed array to hold the init segment
      event.initSegment = new Uint8Array(initSegment.byteLength);

      // Create an init segment containing a moov
      // and track definitions
      event.initSegment.set(initSegment);

      // Create a new typed array to hold the moof+mdats
      event.data = new Uint8Array(this.pendingBytes);

      // Append each moof+mdat (one per track) together
      for (i = 0; i < this.pendingBoxes.length; i++) {
        event.data.set(this.pendingBoxes[i], offset);
        offset += this.pendingBoxes[i].byteLength;
      }

      // Translate caption PTS times into second offsets to match the
      // video timeline for the segment, and add track info
      for (i = 0; i < this.pendingCaptions.length; i++) {
        caption = this.pendingCaptions[i];
        caption.startTime = clock.metadataTsToSeconds(
          caption.startPts, timelineStartPts, this.keepOriginalTimestamps);
        caption.endTime = clock.metadataTsToSeconds(
          caption.endPts, timelineStartPts, this.keepOriginalTimestamps);

        event.captionStreams[caption.stream] = true;
        event.captions.push(caption);
      }

      // Translate ID3 frame PTS times into second offsets to match the
      // video timeline for the segment
      for (i = 0; i < this.pendingMetadata.length; i++) {
        id3 = this.pendingMetadata[i];
        id3.cueTime = clock.metadataTsToSeconds(
          id3.pts, timelineStartPts, this.keepOriginalTimestamps);

        event.metadata.push(id3);
      }

      // We add this to every single emitted segment even though we only need
      // it for the first
      event.metadata.dispatchType = this.metadataStream.dispatchType;

      // Reset stream state
      this.pendingTracks.length = 0;
      this.videoTrack = null;
      this.pendingBoxes.length = 0;
      this.pendingCaptions.length = 0;
      this.pendingBytes = 0;
      this.pendingMetadata.length = 0;

      // Emit the built segment
      // We include captions and ID3 tags for backwards compatibility,
      // ideally we should send only video and audio in the data event
      this.trigger('data', event);
      // Emit each caption to the outside world
      // Ideally, this would happen immediately on parsing captions,
      // but we need to ensure that video data is sent back first
      // so that caption timing can be adjusted to match video timing
      for (i = 0; i < event.captions.length; i++) {
        caption = event.captions[i];

        this.trigger('caption', caption);
      }
      // Emit each id3 tag to the outside world
      // Ideally, this would happen immediately on parsing the tag,
      // but we need to ensure that video data is sent back first
      // so that ID3 frame timing can be adjusted to match video timing
      for (i = 0; i < event.metadata.length; i++) {
        id3 = event.metadata[i];

        this.trigger('id3Frame', id3);
      }
    }

    // Only emit `done` if all tracks have been flushed and emitted
    if (this.emittedTracks >= this.numberOfTracks) {
      this.trigger('done');
      this.emittedTracks = 0;
    }
  };

  CoalesceStream.prototype.setRemux = function(val) {
    this.remuxTracks = val;
  };
  /**
   * A Stream that expects MP2T binary data as input and produces
   * corresponding media segments, suitable for use with Media Source
   * Extension (MSE) implementations that support the ISO BMFF byte
   * stream format, like Chrome.
   */
  Transmuxer = function(options) {
    var
      self = this,
      hasFlushed = true,
      videoTrack,
      audioTrack;

    Transmuxer.prototype.init.call(this);

    options = options || {};
    this.baseMediaDecodeTime = options.baseMediaDecodeTime || 0;
    this.transmuxPipeline_ = {};

    this.setupAacPipeline = function() {
      var pipeline = {};
      this.transmuxPipeline_ = pipeline;

      pipeline.type = 'aac';
      pipeline.metadataStream = new m2ts_1.MetadataStream();

      // set up the parsing pipeline
      pipeline.aacStream = new aac();
      pipeline.audioTimestampRolloverStream = new m2ts_1.TimestampRolloverStream('audio');
      pipeline.timedMetadataTimestampRolloverStream = new m2ts_1.TimestampRolloverStream('timed-metadata');
      pipeline.adtsStream = new adts();
      pipeline.coalesceStream = new CoalesceStream(options, pipeline.metadataStream);
      pipeline.headOfPipeline = pipeline.aacStream;

      pipeline.aacStream
        .pipe(pipeline.audioTimestampRolloverStream)
        .pipe(pipeline.adtsStream);
      pipeline.aacStream
        .pipe(pipeline.timedMetadataTimestampRolloverStream)
        .pipe(pipeline.metadataStream)
        .pipe(pipeline.coalesceStream);

      pipeline.metadataStream.on('timestamp', function(frame) {
        pipeline.aacStream.setTimestamp(frame.timeStamp);
      });

      pipeline.aacStream.on('data', function(data) {
        if (data.type === 'timed-metadata' && !pipeline.audioSegmentStream) {
          audioTrack = audioTrack || {
            timelineStartInfo: {
              baseMediaDecodeTime: self.baseMediaDecodeTime
            },
            codec: 'adts',
            type: 'audio'
          };
          // hook up the audio segment stream to the first track with aac data
          pipeline.coalesceStream.numberOfTracks++;
          pipeline.audioSegmentStream = new AudioSegmentStream(audioTrack, options);

          pipeline.audioSegmentStream.on('timingInfo',
            self.trigger.bind(self, 'audioTimingInfo'));

          // Set up the final part of the audio pipeline
          pipeline.adtsStream
            .pipe(pipeline.audioSegmentStream)
            .pipe(pipeline.coalesceStream);
        }

        // emit pmt info
        self.trigger('trackinfo', {
          hasAudio: !!audioTrack,
          hasVideo: !!videoTrack
        });
      });

      // Re-emit any data coming from the coalesce stream to the outside world
      pipeline.coalesceStream.on('data', this.trigger.bind(this, 'data'));
      // Let the consumer know we have finished flushing the entire pipeline
      pipeline.coalesceStream.on('done', this.trigger.bind(this, 'done'));
    };

    this.setupTsPipeline = function() {
      var pipeline = {};
      this.transmuxPipeline_ = pipeline;

      pipeline.type = 'ts';
      pipeline.metadataStream = new m2ts_1.MetadataStream();

      // set up the parsing pipeline
      pipeline.packetStream = new m2ts_1.TransportPacketStream();
      pipeline.parseStream = new m2ts_1.TransportParseStream();
      pipeline.elementaryStream = new m2ts_1.ElementaryStream();
      pipeline.timestampRolloverStream = new m2ts_1.TimestampRolloverStream();
      pipeline.adtsStream = new adts();
      pipeline.h264Stream = new H264Stream$1();
      pipeline.captionStream = new m2ts_1.CaptionStream();
      pipeline.coalesceStream = new CoalesceStream(options, pipeline.metadataStream);
      pipeline.headOfPipeline = pipeline.packetStream;

      // disassemble MPEG2-TS packets into elementary streams
      pipeline.packetStream
        .pipe(pipeline.parseStream)
        .pipe(pipeline.elementaryStream)
        .pipe(pipeline.timestampRolloverStream);

      // !!THIS ORDER IS IMPORTANT!!
      // demux the streams
      pipeline.timestampRolloverStream
        .pipe(pipeline.h264Stream);

      pipeline.timestampRolloverStream
        .pipe(pipeline.adtsStream);

      pipeline.timestampRolloverStream
        .pipe(pipeline.metadataStream)
        .pipe(pipeline.coalesceStream);

      // Hook up CEA-608/708 caption stream
      pipeline.h264Stream.pipe(pipeline.captionStream)
        .pipe(pipeline.coalesceStream);

      pipeline.elementaryStream.on('data', function(data) {
        var i;

        var baseMediaDecodeTime = !options.keepOriginalTimestamps ? self.baseMediaDecodeTime : 0;

        if (data.type === 'metadata') {
          i = data.tracks.length;

          // scan the tracks listed in the metadata
          while (i--) {
            if (!videoTrack && data.tracks[i].type === 'video') {
              videoTrack = data.tracks[i];
              videoTrack.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
            } else if (!audioTrack && data.tracks[i].type === 'audio') {
              audioTrack = data.tracks[i];
              audioTrack.timelineStartInfo.baseMediaDecodeTime = baseMediaDecodeTime;
            }
          }

          // hook up the video segment stream to the first track with h264 data
          if (videoTrack && !pipeline.videoSegmentStream) {
            pipeline.coalesceStream.numberOfTracks++;
            pipeline.videoSegmentStream = new VideoSegmentStream(videoTrack, options);

            pipeline.videoSegmentStream.on('timelineStartInfo', function(timelineStartInfo) {
            // When video emits timelineStartInfo data after a flush, we forward that
            // info to the AudioSegmentStream, if it exists, because video timeline
            // data takes precedence.
              if (audioTrack) {
                audioTrack.timelineStartInfo = timelineStartInfo;
                // On the first segment we trim AAC frames that exist before the
                // very earliest DTS we have seen in video because Chrome will
                // interpret any video track with a baseMediaDecodeTime that is
                // non-zero as a gap.
                pipeline.audioSegmentStream.setEarliestDts(timelineStartInfo.dts - self.baseMediaDecodeTime);
              }
            });

            pipeline.videoSegmentStream.on('processedGopsInfo',
              self.trigger.bind(self, 'gopInfo'));
            pipeline.videoSegmentStream.on('segmentTimingInfo',
              self.trigger.bind(self, 'videoSegmentTimingInfo'));

            pipeline.videoSegmentStream.on('baseMediaDecodeTime', function(baseMediaDecodeTime) {
              if (audioTrack) {
                pipeline.audioSegmentStream.setVideoBaseMediaDecodeTime(baseMediaDecodeTime);
              }
            });

            pipeline.videoSegmentStream.on('timingInfo',
              self.trigger.bind(self, 'videoTimingInfo'));

            // Set up the final part of the video pipeline
            pipeline.h264Stream
              .pipe(pipeline.videoSegmentStream)
              .pipe(pipeline.coalesceStream);
          }

          if (audioTrack && !pipeline.audioSegmentStream) {
            // hook up the audio segment stream to the first track with aac data
            pipeline.coalesceStream.numberOfTracks++;
            pipeline.audioSegmentStream = new AudioSegmentStream(audioTrack, options);

            pipeline.audioSegmentStream.on('timingInfo',
              self.trigger.bind(self, 'audioTimingInfo'));

            // Set up the final part of the audio pipeline
            pipeline.adtsStream
              .pipe(pipeline.audioSegmentStream)
              .pipe(pipeline.coalesceStream);
          }

          // emit pmt info
          self.trigger('trackinfo', {
            hasAudio: !!audioTrack,
            hasVideo: !!videoTrack
          });
        }
      });

      // Re-emit any data coming from the coalesce stream to the outside world
      pipeline.coalesceStream.on('data', this.trigger.bind(this, 'data'));
      pipeline.coalesceStream.on('id3Frame', function(id3Frame) {
        id3Frame.dispatchType = pipeline.metadataStream.dispatchType;

        self.trigger('id3Frame', id3Frame);
      });
      pipeline.coalesceStream.on('caption', this.trigger.bind(this, 'caption'));
      // Let the consumer know we have finished flushing the entire pipeline
      pipeline.coalesceStream.on('done', this.trigger.bind(this, 'done'));
    };

    // hook up the segment streams once track metadata is delivered
    this.setBaseMediaDecodeTime = function(baseMediaDecodeTime) {
      var pipeline = this.transmuxPipeline_;

      this.baseMediaDecodeTime = baseMediaDecodeTime;

      if (audioTrack) {
        audioTrack.timelineStartInfo.dts = undefined;
        audioTrack.timelineStartInfo.pts = undefined;
        trackDecodeInfo.clearDtsInfo(audioTrack);
        if (pipeline.audioTimestampRolloverStream) {
          pipeline.audioTimestampRolloverStream.discontinuity();
        }
      }
      if (videoTrack) {
        if (pipeline.videoSegmentStream) {
          pipeline.videoSegmentStream.gopCache_ = [];
        }
        videoTrack.timelineStartInfo.dts = undefined;
        videoTrack.timelineStartInfo.pts = undefined;
        trackDecodeInfo.clearDtsInfo(videoTrack);
        pipeline.captionStream.reset();
      }

      if (pipeline.timestampRolloverStream) {
        pipeline.timestampRolloverStream.discontinuity();
      }
    };

    this.setAudioAppendStart = function(timestamp) {
      if (audioTrack) {
        this.transmuxPipeline_.audioSegmentStream.setAudioAppendStart(timestamp);
      }
    };

    this.setRemux = function(val) {
      var pipeline = this.transmuxPipeline_;

      options.remux = val;

      if (pipeline && pipeline.coalesceStream) {
        pipeline.coalesceStream.setRemux(val);
      }
    };

    this.alignGopsWith = function(gopsToAlignWith) {
      if (videoTrack && this.transmuxPipeline_.videoSegmentStream) {
        this.transmuxPipeline_.videoSegmentStream.alignGopsWith(gopsToAlignWith);
      }
    };

    // feed incoming data to the front of the parsing pipeline
    this.push = function(data) {
      if (hasFlushed) {
        var isAac = isLikelyAacData$1(data);

        if (isAac && this.transmuxPipeline_.type !== 'aac') {
          this.setupAacPipeline();
        } else if (!isAac && this.transmuxPipeline_.type !== 'ts') {
          this.setupTsPipeline();
        }
        hasFlushed = false;
      }
      this.transmuxPipeline_.headOfPipeline.push(data);
    };

    // flush any buffered data
    this.flush = function() {
      hasFlushed = true;
      // Start at the top of the pipeline and flush all pending work
      this.transmuxPipeline_.headOfPipeline.flush();
    };

    this.endTimeline = function() {
      this.transmuxPipeline_.headOfPipeline.endTimeline();
    };

    this.reset = function() {
      if (this.transmuxPipeline_.headOfPipeline) {
        this.transmuxPipeline_.headOfPipeline.reset();
      }
    };

    // Caption data has to be reset when seeking outside buffered range
    this.resetCaptions = function() {
      if (this.transmuxPipeline_.captionStream) {
        this.transmuxPipeline_.captionStream.reset();
      }
    };

  };
  Transmuxer.prototype = new stream();

  var transmuxer = {
    Transmuxer: Transmuxer,
    VideoSegmentStream: VideoSegmentStream,
    AudioSegmentStream: AudioSegmentStream,
    AUDIO_PROPERTIES: audioProperties,
    VIDEO_PROPERTIES: videoProperties,
    // exported for testing
    generateVideoSegmentTimingInfo: generateVideoSegmentTimingInfo
  };
  var transmuxer_1 = transmuxer.Transmuxer;

  /**
   * mux.js
   *
   * Copyright (c) Brightcove
   * Licensed Apache-2.0 https://github.com/videojs/mux.js/blob/master/LICENSE
   */
  var codecs = {
    Adts: adts,
    h264: h264
  };

  var ONE_SECOND_IN_TS$4 = clock.ONE_SECOND_IN_TS;


  /**
   * Constructs a single-track, ISO BMFF media segment from AAC data
   * events. The output of this stream can be fed to a SourceBuffer
   * configured with a suitable initialization segment.
   */
  var AudioSegmentStream$1 = function(track, options) {
    var
      adtsFrames = [],
      sequenceNumber = 0,
      earliestAllowedDts = 0,
      audioAppendStartTs = 0,
      videoBaseMediaDecodeTime = Infinity,
      segmentStartPts = null,
      segmentEndPts = null;

    options = options || {};

    AudioSegmentStream$1.prototype.init.call(this);

    this.push = function(data) {
      trackDecodeInfo.collectDtsInfo(track, data);

      if (track) {
        audioProperties.forEach(function(prop) {
          track[prop] = data[prop];
        });
      }

      // buffer audio data until end() is called
      adtsFrames.push(data);
    };

    this.setEarliestDts = function(earliestDts) {
      earliestAllowedDts = earliestDts;
    };

    this.setVideoBaseMediaDecodeTime = function(baseMediaDecodeTime) {
      videoBaseMediaDecodeTime = baseMediaDecodeTime;
    };

    this.setAudioAppendStart = function(timestamp) {
      audioAppendStartTs = timestamp;
    };

    this.processFrames_ = function() {
      var
        frames,
        moof,
        mdat,
        boxes,
        timingInfo;

      // return early if no audio data has been observed
      if (adtsFrames.length === 0) {
        return;
      }

      frames = audioFrameUtils.trimAdtsFramesByEarliestDts(
        adtsFrames, track, earliestAllowedDts);
      if (frames.length === 0) {
        // return early if the frames are all after the earliest allowed DTS
        // TODO should we clear the adtsFrames?
        return;
      }

      track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(
        track, options.keepOriginalTimestamps);

      audioFrameUtils.prefixWithSilence(
        track, frames, audioAppendStartTs, videoBaseMediaDecodeTime);

      // we have to build the index from byte locations to
      // samples (that is, adts frames) in the audio data
      track.samples = audioFrameUtils.generateSampleTable(frames);

      // concatenate the audio data to constuct the mdat
      mdat = mp4Generator.mdat(audioFrameUtils.concatenateFrameData(frames));

      adtsFrames = [];

      moof = mp4Generator.moof(sequenceNumber, [track]);

      // bump the sequence number for next time
      sequenceNumber++;

      track.initSegment = mp4Generator.initSegment([track]);

      // it would be great to allocate this array up front instead of
      // throwing away hundreds of media segment fragments
      boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

      boxes.set(moof);
      boxes.set(mdat, moof.byteLength);

      trackDecodeInfo.clearDtsInfo(track);

      if (segmentStartPts === null) {
        segmentEndPts = segmentStartPts = frames[0].pts;
      }

      segmentEndPts += frames.length * (ONE_SECOND_IN_TS$4 * 1024 / track.samplerate);

      timingInfo = { start: segmentStartPts };

      this.trigger('timingInfo', timingInfo);
      this.trigger('data', {track: track, boxes: boxes});
    };

    this.flush = function() {
      this.processFrames_();
      // trigger final timing info
      this.trigger('timingInfo', {
        start: segmentStartPts,
        end: segmentEndPts
      });
      this.resetTiming_();
      this.trigger('done', 'AudioSegmentStream');
    };

    this.partialFlush = function() {
      this.processFrames_();
      this.trigger('partialdone', 'AudioSegmentStream');
    };

    this.endTimeline = function() {
      this.flush();
      this.trigger('endedtimeline', 'AudioSegmentStream');
    };

    this.resetTiming_ = function() {
      trackDecodeInfo.clearDtsInfo(track);
      segmentStartPts = null;
      segmentEndPts = null;
    };

    this.reset = function() {
      this.resetTiming_();
      adtsFrames = [];
      this.trigger('reset');
    };
  };

  AudioSegmentStream$1.prototype = new stream();

  var audioSegmentStream = AudioSegmentStream$1;

  var VideoSegmentStream$1 = function(track, options) {
    var
      sequenceNumber = 0,
      nalUnits = [],
      frameCache = [],
      // gopsToAlignWith = [],
      config,
      pps,
      segmentStartPts = null,
      segmentEndPts = null,
      gops,
      ensureNextFrameIsKeyFrame = true;

    options = options || {};

    VideoSegmentStream$1.prototype.init.call(this);

    this.push = function(nalUnit) {
      trackDecodeInfo.collectDtsInfo(track, nalUnit);
      if (typeof track.timelineStartInfo.dts === 'undefined') {
        track.timelineStartInfo.dts = nalUnit.dts;
      }

      // record the track config
      if (nalUnit.nalUnitType === 'seq_parameter_set_rbsp' && !config) {
        config = nalUnit.config;
        track.sps = [nalUnit.data];

        videoProperties.forEach(function(prop) {
          track[prop] = config[prop];
        }, this);
      }

      if (nalUnit.nalUnitType === 'pic_parameter_set_rbsp' &&
          !pps) {
        pps = nalUnit.data;
        track.pps = [nalUnit.data];
      }

      // buffer video until flush() is called
      nalUnits.push(nalUnit);
    };

    this.processNals_ = function(cacheLastFrame) {
      var i;

      nalUnits = frameCache.concat(nalUnits);

      // Throw away nalUnits at the start of the byte stream until
      // we find the first AUD
      while (nalUnits.length) {
        if (nalUnits[0].nalUnitType === 'access_unit_delimiter_rbsp') {
          break;
        }
        nalUnits.shift();
      }

      // Return early if no video data has been observed
      if (nalUnits.length === 0) {
        return;
      }

      var frames = frameUtils.groupNalsIntoFrames(nalUnits);

      if (!frames.length) {
        return;
      }

      // note that the frame cache may also protect us from cases where we haven't
      // pushed data for the entire first or last frame yet
      frameCache = frames[frames.length - 1];

      if (cacheLastFrame) {
        frames.pop();
        frames.duration -= frameCache.duration;
        frames.nalCount -= frameCache.length;
        frames.byteLength -= frameCache.byteLength;
      }

      if (!frames.length) {
        nalUnits = [];
        return;
      }

      this.trigger('timelineStartInfo', track.timelineStartInfo);

      if (ensureNextFrameIsKeyFrame) {
        gops = frameUtils.groupFramesIntoGops(frames);

        if (!gops[0][0].keyFrame) {
          gops = frameUtils.extendFirstKeyFrame(gops);

          if (!gops[0][0].keyFrame) {
            // we haven't yet gotten a key frame, so reset nal units to wait for more nal
            // units
            nalUnits = ([].concat.apply([], frames)).concat(frameCache);
            frameCache = [];
            return;
          }

          frames = [].concat.apply([], gops);
          frames.duration = gops.duration;
        }
        ensureNextFrameIsKeyFrame = false;
      }

      if (segmentStartPts === null) {
        segmentStartPts = frames[0].pts;
        segmentEndPts = segmentStartPts;
      }

      segmentEndPts += frames.duration;

      this.trigger('timingInfo', {
        start: segmentStartPts,
        end: segmentEndPts
      });

      for (i = 0; i < frames.length; i++) {
        var frame = frames[i];

        track.samples = frameUtils.generateSampleTableForFrame(frame);

        var mdat = mp4Generator.mdat(frameUtils.concatenateNalDataForFrame(frame));

        trackDecodeInfo.clearDtsInfo(track);
        trackDecodeInfo.collectDtsInfo(track, frame);

        track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(
          track, options.keepOriginalTimestamps);

        var moof = mp4Generator.moof(sequenceNumber, [track]);

        sequenceNumber++;

        track.initSegment = mp4Generator.initSegment([track]);

        var boxes = new Uint8Array(moof.byteLength + mdat.byteLength);

        boxes.set(moof);
        boxes.set(mdat, moof.byteLength);

        this.trigger('data', {
          track: track,
          boxes: boxes,
          sequence: sequenceNumber,
          videoFrameDts: frame.dts,
          videoFramePts: frame.pts
        });
      }

      nalUnits = [];
    };

    this.resetTimingAndConfig_ = function() {
      config = undefined;
      pps = undefined;
      segmentStartPts = null;
      segmentEndPts = null;
    };

    this.partialFlush = function() {
      this.processNals_(true);
      this.trigger('partialdone', 'VideoSegmentStream');
    };

    this.flush = function() {
      this.processNals_(false);
      // reset config and pps because they may differ across segments
      // for instance, when we are rendition switching
      this.resetTimingAndConfig_();
      this.trigger('done', 'VideoSegmentStream');
    };

    this.endTimeline = function() {
      this.flush();
      this.trigger('endedtimeline', 'VideoSegmentStream');
    };

    this.reset = function() {
      this.resetTimingAndConfig_();
      frameCache = [];
      nalUnits = [];
      ensureNextFrameIsKeyFrame = true;
      this.trigger('reset');
    };
  };

  VideoSegmentStream$1.prototype = new stream();

  var videoSegmentStream = VideoSegmentStream$1;

  var isLikelyAacData$2 = utils.isLikelyAacData;




  var createPipeline = function(object) {
    object.prototype = new stream();
    object.prototype.init.call(object);

    return object;
  };

  var tsPipeline = function(options) {
    var
      pipeline = {
        type: 'ts',
        tracks: {
          audio: null,
          video: null
        },
        packet: new m2ts_1.TransportPacketStream(),
        parse: new m2ts_1.TransportParseStream(),
        elementary: new m2ts_1.ElementaryStream(),
        timestampRollover: new m2ts_1.TimestampRolloverStream(),
        adts: new codecs.Adts(),
        h264: new codecs.h264.H264Stream(),
        captionStream: new m2ts_1.CaptionStream(),
        metadataStream: new m2ts_1.MetadataStream()
    };

    pipeline.headOfPipeline = pipeline.packet;

    // Transport Stream
    pipeline.packet
      .pipe(pipeline.parse)
      .pipe(pipeline.elementary)
      .pipe(pipeline.timestampRollover);

    // H264
    pipeline.timestampRollover
      .pipe(pipeline.h264);

    // Hook up CEA-608/708 caption stream
    pipeline.h264
      .pipe(pipeline.captionStream);

    pipeline.timestampRollover
      .pipe(pipeline.metadataStream);

    // ADTS
    pipeline.timestampRollover
      .pipe(pipeline.adts);

    pipeline.elementary.on('data', function(data) {
      if (data.type !== 'metadata') {
        return;
      }

      for (var i = 0; i < data.tracks.length; i++) {
        if (!pipeline.tracks[data.tracks[i].type]) {
          pipeline.tracks[data.tracks[i].type] = data.tracks[i];
        }
      }

      if (pipeline.tracks.video && !pipeline.videoSegmentStream) {
        pipeline.videoSegmentStream = new videoSegmentStream(pipeline.tracks.video, options);

        pipeline.videoSegmentStream.on('timelineStartInfo', function(timelineStartInfo) {
          if (pipeline.tracks.audio) {
            pipeline.audioSegmentStream.setEarliestDts(timelineStartInfo.dts - options.baseMediaDecodeTime);
          }
        });

        pipeline.videoSegmentStream.on('timingInfo',
                                       pipeline.trigger.bind(pipeline, 'videoTimingInfo'));

        pipeline.videoSegmentStream.on('data', function(data) {
          pipeline.trigger('data', {
            type: 'video',
            data: data
          });
        });

        pipeline.videoSegmentStream.on('done',
                                       pipeline.trigger.bind(pipeline, 'done'));
        pipeline.videoSegmentStream.on('partialdone',
                                       pipeline.trigger.bind(pipeline, 'partialdone'));
        pipeline.videoSegmentStream.on('endedtimeline',
                                       pipeline.trigger.bind(pipeline, 'endedtimeline'));

        pipeline.h264
          .pipe(pipeline.videoSegmentStream);
      }

      if (pipeline.tracks.audio && !pipeline.audioSegmentStream) {
        pipeline.audioSegmentStream = new audioSegmentStream(pipeline.tracks.audio, options);

        pipeline.audioSegmentStream.on('data', function(data) {
          pipeline.trigger('data', {
            type: 'audio',
            data: data
          });
        });

        pipeline.audioSegmentStream.on('done',
                                       pipeline.trigger.bind(pipeline, 'done'));
        pipeline.audioSegmentStream.on('partialdone',
                                       pipeline.trigger.bind(pipeline, 'partialdone'));
        pipeline.audioSegmentStream.on('endedtimeline',
                                       pipeline.trigger.bind(pipeline, 'endedtimeline'));

        pipeline.audioSegmentStream.on('timingInfo',
                                       pipeline.trigger.bind(pipeline, 'audioTimingInfo'));

        pipeline.adts
          .pipe(pipeline.audioSegmentStream);
      }

      // emit pmt info
      pipeline.trigger('trackinfo', {
        hasAudio: !!pipeline.tracks.audio,
        hasVideo: !!pipeline.tracks.video
      });
    });

    pipeline.captionStream.on('data', function(caption) {
      var timelineStartPts;

      if (pipeline.tracks.video) {
        timelineStartPts = pipeline.tracks.video.timelineStartInfo.pts || 0;
      } else {
        // This will only happen if we encounter caption packets before
        // video data in a segment. This is an unusual/unlikely scenario,
        // so we assume the timeline starts at zero for now.
        timelineStartPts = 0;
      }

      // Translate caption PTS times into second offsets into the
      // video timeline for the segment
      caption.startTime = clock.metadataTsToSeconds(caption.startPts, timelineStartPts, options.keepOriginalTimestamps);
      caption.endTime = clock.metadataTsToSeconds(caption.endPts, timelineStartPts, options.keepOriginalTimestamps);

      pipeline.trigger('caption', caption);
    });

    pipeline = createPipeline(pipeline);

    pipeline.metadataStream.on('data', pipeline.trigger.bind(pipeline, 'id3Frame'));

    return pipeline;
  };

  var aacPipeline = function(options) {
    var
      pipeline = {
      type: 'aac',
      tracks: {
        audio: null
      },
      metadataStream: new m2ts_1.MetadataStream(),
      aacStream: new aac(),
      audioRollover: new m2ts_1.TimestampRolloverStream('audio'),
      timedMetadataRollover: new m2ts_1.TimestampRolloverStream('timed-metadata'),
      adtsStream: new adts(true)
    };

    // set up the parsing pipeline
    pipeline.headOfPipeline = pipeline.aacStream;

    pipeline.aacStream
      .pipe(pipeline.audioRollover)
      .pipe(pipeline.adtsStream);
    pipeline.aacStream
      .pipe(pipeline.timedMetadataRollover)
      .pipe(pipeline.metadataStream);

    pipeline.metadataStream.on('timestamp', function(frame) {
      pipeline.aacStream.setTimestamp(frame.timeStamp);
    });

    pipeline.aacStream.on('data', function(data) {
      if (data.type !== 'timed-metadata' || pipeline.audioSegmentStream) {
        return;
      }

      pipeline.tracks.audio = pipeline.tracks.audio || {
        timelineStartInfo: {
          baseMediaDecodeTime: !options.keepOriginalTimestamps ? options.baseMediaDecodeTime : 0
        },
        codec: 'adts',
        type: 'audio'
      };

      // hook up the audio segment stream to the first track with aac data
      pipeline.audioSegmentStream = new audioSegmentStream(pipeline.tracks.audio, options);

      pipeline.audioSegmentStream.on('data', function(data) {
        pipeline.trigger('data', {
          type: 'audio',
          data: data
        });
      });

      pipeline.audioSegmentStream.on('partialdone',
                                     pipeline.trigger.bind(pipeline, 'partialdone'));
      pipeline.audioSegmentStream.on('done', pipeline.trigger.bind(pipeline, 'done'));
      pipeline.audioSegmentStream.on('endedtimeline',
                                     pipeline.trigger.bind(pipeline, 'endedtimeline'));
      pipeline.audioSegmentStream.on('timingInfo',
                                     pipeline.trigger.bind(pipeline, 'audioTimingInfo'));

      // Set up the final part of the audio pipeline
      pipeline.adtsStream
        .pipe(pipeline.audioSegmentStream);

      pipeline.trigger('trackinfo', {
        hasAudio: !!pipeline.tracks.audio,
        hasVideo: !!pipeline.tracks.video
      });
    });

    // set the pipeline up as a stream before binding to get access to the trigger function
    pipeline = createPipeline(pipeline);

    pipeline.metadataStream.on('data', pipeline.trigger.bind(pipeline, 'id3Frame'));

    return pipeline;
  };

  var setupPipelineListeners = function(pipeline, transmuxer) {
    pipeline.on('data', transmuxer.trigger.bind(transmuxer, 'data'));
    pipeline.on('done', transmuxer.trigger.bind(transmuxer, 'done'));
    pipeline.on('partialdone', transmuxer.trigger.bind(transmuxer, 'partialdone'));
    pipeline.on('endedtimeline', transmuxer.trigger.bind(transmuxer, 'endedtimeline'));
    pipeline.on('audioTimingInfo', transmuxer.trigger.bind(transmuxer, 'audioTimingInfo'));
    pipeline.on('videoTimingInfo', transmuxer.trigger.bind(transmuxer, 'videoTimingInfo'));
    pipeline.on('trackinfo', transmuxer.trigger.bind(transmuxer, 'trackinfo'));
    pipeline.on('id3Frame', function(event) {
      // add this to every single emitted segment even though it's only needed for the first
      event.dispatchType = pipeline.metadataStream.dispatchType;
      // keep original time, can be adjusted if needed at a higher level
      event.cueTime = clock.videoTsToSeconds(event.pts);

      transmuxer.trigger('id3Frame', event);
    });
    pipeline.on('caption', function(event) {
      transmuxer.trigger('caption', event);
    });
  };

  var Transmuxer$1 = function(options) {
    var
      pipeline = null,
      hasFlushed = true;

    options = options || {};

    Transmuxer$1.prototype.init.call(this);
    options.baseMediaDecodeTime = options.baseMediaDecodeTime || 0;

    this.push = function(bytes) {
      if (hasFlushed) {
        var isAac = isLikelyAacData$2(bytes);

        if (isAac && (!pipeline || pipeline.type !== 'aac')) {
          pipeline = aacPipeline(options);
          setupPipelineListeners(pipeline, this);
        } else if (!isAac && (!pipeline || pipeline.type !== 'ts')) {
          pipeline = tsPipeline(options);
          setupPipelineListeners(pipeline, this);
        }
        hasFlushed = false;
      }

      pipeline.headOfPipeline.push(bytes);
    };

    this.flush = function() {
      if (!pipeline) {
        return;
      }

      hasFlushed = true;
      pipeline.headOfPipeline.flush();
    };

    this.partialFlush = function() {
      if (!pipeline) {
        return;
      }

      pipeline.headOfPipeline.partialFlush();
    };

    this.endTimeline = function() {
      if (!pipeline) {
        return;
      }

      pipeline.headOfPipeline.endTimeline();
    };

    this.reset = function() {
      if (!pipeline) {
        return;
      }

      pipeline.headOfPipeline.reset();
    };

    this.setBaseMediaDecodeTime = function(baseMediaDecodeTime) {
      options.baseMediaDecodeTime = baseMediaDecodeTime;

      if (!pipeline) {
        return;
      }

      if (pipeline.tracks.audio) {
        pipeline.tracks.audio.timelineStartInfo.dts = undefined;
        pipeline.tracks.audio.timelineStartInfo.pts = undefined;
        trackDecodeInfo.clearDtsInfo(pipeline.tracks.audio);
        if (pipeline.audioRollover) {
          pipeline.audioRollover.discontinuity();
        }
      }
      if (pipeline.tracks.video) {
        if (pipeline.videoSegmentStream) {
          pipeline.videoSegmentStream.gopCache_ = [];
        }
        pipeline.tracks.video.timelineStartInfo.dts = undefined;
        pipeline.tracks.video.timelineStartInfo.pts = undefined;
        trackDecodeInfo.clearDtsInfo(pipeline.tracks.video);
        // pipeline.captionStream.reset();
      }

      if (pipeline.timestampRollover) {
        pipeline.timestampRollover.discontinuity();

      }
    };

    this.setRemux = function(val) {
      options.remux = val;

      if (pipeline && pipeline.coalesceStream) {
        pipeline.coalesceStream.setRemux(val);
      }
    };


    this.setAudioAppendStart = function(audioAppendStart) {
      if (!pipeline || !pipeline.tracks.audio || !pipeline.audioSegmentStream) {
        return;
      }

      pipeline.audioSegmentStream.setAudioAppendStart(audioAppendStart);
    };

    // TODO GOP alignment support
    // Support may be a bit trickier than with full segment appends, as GOPs may be split
    // and processed in a more granular fashion
    this.alignGopsWith = function(gopsToAlignWith) {
      return;
    };
  };

  Transmuxer$1.prototype = new stream();

  var transmuxer$1 = Transmuxer$1;

  /* global self */

  var typeFromStreamString = function typeFromStreamString(streamString) {
    if (streamString === 'AudioSegmentStream') {
      return 'audio';
    }

    return streamString === 'VideoSegmentStream' ? 'video' : '';
  };
  /**
   * Re-emits transmuxer events by converting them into messages to the
   * world outside the worker.
   *
   * @param {Object} transmuxer the transmuxer to wire events on
   * @private
   */


  var wireFullTransmuxerEvents = function wireFullTransmuxerEvents(self, transmuxer) {
    transmuxer.on('data', function (segment) {
      // transfer ownership of the underlying ArrayBuffer
      // instead of doing a copy to save memory
      // ArrayBuffers are transferable but generic TypedArrays are not
      // @link https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#Passing_data_by_transferring_ownership_(transferable_objects)
      var initArray = segment.initSegment;
      segment.initSegment = {
        data: initArray.buffer,
        byteOffset: initArray.byteOffset,
        byteLength: initArray.byteLength
      };
      var typedArray = segment.data;
      segment.data = typedArray.buffer;
      self.postMessage({
        action: 'data',
        segment: segment,
        byteOffset: typedArray.byteOffset,
        byteLength: typedArray.byteLength
      }, [segment.data]);
    });
    transmuxer.on('done', function (data) {
      self.postMessage({
        action: 'done'
      });
    });
    transmuxer.on('gopInfo', function (gopInfo) {
      self.postMessage({
        action: 'gopInfo',
        gopInfo: gopInfo
      });
    });
    transmuxer.on('videoSegmentTimingInfo', function (timingInfo) {
      var videoSegmentTimingInfo = {
        start: {
          decode: clock_4(timingInfo.start.dts),
          presentation: clock_4(timingInfo.start.pts)
        },
        end: {
          decode: clock_4(timingInfo.end.dts),
          presentation: clock_4(timingInfo.end.pts)
        },
        baseMediaDecodeTime: clock_4(timingInfo.baseMediaDecodeTime)
      };

      if (timingInfo.prependedContentDuration) {
        videoSegmentTimingInfo.prependedContentDuration = clock_4(timingInfo.prependedContentDuration);
      }

      self.postMessage({
        action: 'videoSegmentTimingInfo',
        videoSegmentTimingInfo: videoSegmentTimingInfo
      });
    });
    transmuxer.on('id3Frame', function (id3Frame) {
      self.postMessage({
        action: 'id3Frame',
        id3Frame: id3Frame
      });
    });
    transmuxer.on('caption', function (caption) {
      self.postMessage({
        action: 'caption',
        caption: caption
      });
    });
    transmuxer.on('trackinfo', function (trackInfo) {
      self.postMessage({
        action: 'trackinfo',
        trackInfo: trackInfo
      });
    });
    transmuxer.on('audioTimingInfo', function (audioTimingInfo) {
      // convert to video TS since we prioritize video time over audio
      self.postMessage({
        action: 'audioTimingInfo',
        audioTimingInfo: {
          start: clock_4(audioTimingInfo.start),
          end: clock_4(audioTimingInfo.end)
        }
      });
    });
    transmuxer.on('videoTimingInfo', function (videoTimingInfo) {
      self.postMessage({
        action: 'videoTimingInfo',
        videoTimingInfo: {
          start: clock_4(videoTimingInfo.start),
          end: clock_4(videoTimingInfo.end)
        }
      });
    });
  };

  var wirePartialTransmuxerEvents = function wirePartialTransmuxerEvents(self, transmuxer) {
    transmuxer.on('data', function (event) {
      // transfer ownership of the underlying ArrayBuffer
      // instead of doing a copy to save memory
      // ArrayBuffers are transferable but generic TypedArrays are not
      // @link https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#Passing_data_by_transferring_ownership_(transferable_objects)
      var initSegment = {
        data: event.data.track.initSegment.buffer,
        byteOffset: event.data.track.initSegment.byteOffset,
        byteLength: event.data.track.initSegment.byteLength
      };
      var boxes = {
        data: event.data.boxes.buffer,
        byteOffset: event.data.boxes.byteOffset,
        byteLength: event.data.boxes.byteLength
      };
      var segment = {
        boxes: boxes,
        initSegment: initSegment,
        type: event.type,
        sequence: event.data.sequence
      };

      if (typeof event.data.videoFrameDts !== 'undefined') {
        segment.videoFrameDtsTime = clock_4(event.data.videoFrameDts);
      }

      if (typeof event.data.videoFramePts !== 'undefined') {
        segment.videoFramePtsTime = clock_4(event.data.videoFramePts);
      }

      self.postMessage({
        action: 'data',
        segment: segment
      }, [segment.boxes.data, segment.initSegment.data]);
    });
    transmuxer.on('id3Frame', function (id3Frame) {
      self.postMessage({
        action: 'id3Frame',
        id3Frame: id3Frame
      });
    });
    transmuxer.on('caption', function (caption) {
      self.postMessage({
        action: 'caption',
        caption: caption
      });
    });
    transmuxer.on('done', function (data) {
      self.postMessage({
        action: 'done',
        type: typeFromStreamString(data)
      });
    });
    transmuxer.on('partialdone', function (data) {
      self.postMessage({
        action: 'partialdone',
        type: typeFromStreamString(data)
      });
    });
    transmuxer.on('endedsegment', function (data) {
      self.postMessage({
        action: 'endedSegment',
        type: typeFromStreamString(data)
      });
    });
    transmuxer.on('trackinfo', function (trackInfo) {
      self.postMessage({
        action: 'trackinfo',
        trackInfo: trackInfo
      });
    });
    transmuxer.on('audioTimingInfo', function (audioTimingInfo) {
      // This can happen if flush is called when no
      // audio has been processed. This should be an
      // unusual case, but if it does occur should not
      // result in valid data being returned
      if (audioTimingInfo.start === null) {
        self.postMessage({
          action: 'audioTimingInfo',
          audioTimingInfo: audioTimingInfo
        });
        return;
      } // convert to video TS since we prioritize video time over audio


      var timingInfoInSeconds = {
        start: clock_4(audioTimingInfo.start)
      };

      if (audioTimingInfo.end) {
        timingInfoInSeconds.end = clock_4(audioTimingInfo.end);
      }

      self.postMessage({
        action: 'audioTimingInfo',
        audioTimingInfo: timingInfoInSeconds
      });
    });
    transmuxer.on('videoTimingInfo', function (videoTimingInfo) {
      var timingInfoInSeconds = {
        start: clock_4(videoTimingInfo.start)
      };

      if (videoTimingInfo.end) {
        timingInfoInSeconds.end = clock_4(videoTimingInfo.end);
      }

      self.postMessage({
        action: 'videoTimingInfo',
        videoTimingInfo: timingInfoInSeconds
      });
    });
  };
  /**
   * All incoming messages route through this hash. If no function exists
   * to handle an incoming message, then we ignore the message.
   *
   * @class MessageHandlers
   * @param {Object} options the options to initialize with
   */


  var MessageHandlers = /*#__PURE__*/function () {
    function MessageHandlers(self, options) {
      this.options = options || {};
      this.self = self;
      this.init();
    }
    /**
     * initialize our web worker and wire all the events.
     */


    var _proto = MessageHandlers.prototype;

    _proto.init = function init() {
      if (this.transmuxer) {
        this.transmuxer.dispose();
      }

      this.transmuxer = this.options.handlePartialData ? new transmuxer$1(this.options) : new transmuxer_1(this.options);

      if (this.options.handlePartialData) {
        wirePartialTransmuxerEvents(this.self, this.transmuxer);
      } else {
        wireFullTransmuxerEvents(this.self, this.transmuxer);
      }
    }
    /**
     * Adds data (a ts segment) to the start of the transmuxer pipeline for
     * processing.
     *
     * @param {ArrayBuffer} data data to push into the muxer
     */
    ;

    _proto.push = function push(data) {
      // Cast array buffer to correct type for transmuxer
      var segment = new Uint8Array(data.data, data.byteOffset, data.byteLength);
      this.transmuxer.push(segment);
    }
    /**
     * Recreate the transmuxer so that the next segment added via `push`
     * start with a fresh transmuxer.
     */
    ;

    _proto.reset = function reset() {
      this.transmuxer.reset();
    }
    /**
     * Set the value that will be used as the `baseMediaDecodeTime` time for the
     * next segment pushed in. Subsequent segments will have their `baseMediaDecodeTime`
     * set relative to the first based on the PTS values.
     *
     * @param {Object} data used to set the timestamp offset in the muxer
     */
    ;

    _proto.setTimestampOffset = function setTimestampOffset(data) {
      var timestampOffset = data.timestampOffset || 0;
      this.transmuxer.setBaseMediaDecodeTime(Math.round(clock_2(timestampOffset)));
    };

    _proto.setAudioAppendStart = function setAudioAppendStart(data) {
      this.transmuxer.setAudioAppendStart(Math.ceil(clock_2(data.appendStart)));
    };

    _proto.setRemux = function setRemux(data) {
      this.transmuxer.setRemux(data.remux);
    }
    /**
     * Forces the pipeline to finish processing the last segment and emit it's
     * results.
     *
     * @param {Object} data event data, not really used
     */
    ;

    _proto.flush = function flush(data) {
      this.transmuxer.flush(); // transmuxed done action is fired after both audio/video pipelines are flushed

      self.postMessage({
        action: 'done',
        type: 'transmuxed'
      });
    };

    _proto.partialFlush = function partialFlush(data) {
      this.transmuxer.partialFlush(); // transmuxed partialdone action is fired after both audio/video pipelines are flushed

      self.postMessage({
        action: 'partialdone',
        type: 'transmuxed'
      });
    };

    _proto.endTimeline = function endTimeline() {
      this.transmuxer.endTimeline(); // transmuxed endedtimeline action is fired after both audio/video pipelines end their
      // timelines

      self.postMessage({
        action: 'endedtimeline',
        type: 'transmuxed'
      });
    };

    _proto.alignGopsWith = function alignGopsWith(data) {
      this.transmuxer.alignGopsWith(data.gopsToAlignWith.slice());
    };

    return MessageHandlers;
  }();
  /**
   * Our web worker interface so that things can talk to mux.js
   * that will be running in a web worker. the scope is passed to this by
   * webworkify.
   *
   * @param {Object} self the scope for the web worker
   */


  var TransmuxerWorker = function TransmuxerWorker(self) {
    self.onmessage = function (event) {
      if (event.data.action === 'init' && event.data.options) {
        this.messageHandlers = new MessageHandlers(self, event.data.options);
        return;
      }

      if (!this.messageHandlers) {
        this.messageHandlers = new MessageHandlers(self);
      }

      if (event.data && event.data.action && event.data.action !== 'init') {
        if (this.messageHandlers[event.data.action]) {
          this.messageHandlers[event.data.action](event.data);
        }
      }
    };
  };

  var transmuxerWorker = new TransmuxerWorker(self);

  return transmuxerWorker;

}());
