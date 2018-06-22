/**
 * @file sync-controller.js
 */

import {sumDurations} from './playlist';
import videojs from 'video.js';
import logger from './util/logger';

export const syncPointStrategies = [
  // Stategy "VOD": Handle the VOD-case where the sync-point is *always*
  //                the equivalence display-time 0 === segment-index 0
  {
    name: 'VOD',
    run: (syncController, playlist, duration, currentTimeline, currentTime) => {
      if (duration !== Infinity) {
        let syncPoint = {
          time: 0,
          segmentIndex: 0
        };

        return syncPoint;
      }
      return null;
    }
  },
  // Stategy "ProgramDateTime": We have a program-date-time tag in this playlist
  {
    name: 'ProgramDateTime',
    run: (syncController, playlist, duration, currentTimeline, currentTime) => {
      if (!syncController.datetimeToDisplayTime) {
        return null;
      }

      let segments = playlist.segments || [];
      let syncPoint = null;
      let lastDistance = null;

      currentTime = currentTime || 0;

      for (let i = 0; i < segments.length; i++) {
        let segment = segments[i];

        if (segment.dateTimeObject) {
          let segmentTime = segment.dateTimeObject.getTime() / 1000;
          let segmentStart = segmentTime + syncController.datetimeToDisplayTime;
          let distance = Math.abs(currentTime - segmentStart);

          // Once the distance begins to increase, we have passed
          // currentTime and can stop looking for better candidates
          if (lastDistance !== null && lastDistance < distance) {
            break;
          }

          lastDistance = distance;
          syncPoint = {
            time: segmentStart,
            segmentIndex: i
          };
        }
      }
      return syncPoint;
    }
  },
  // Stategy "Segment": We have a known time mapping for a timeline and a
  //                    segment in the current timeline with timing data
  {
    name: 'Segment',
    run: (syncController, playlist, duration, currentTimeline, currentTime) => {
      let segments = playlist.segments || [];
      let syncPoint = null;
      let lastDistance = null;

      currentTime = currentTime || 0;

      for (let i = 0; i < segments.length; i++) {
        let segment = segments[i];

        if (segment.timeline === currentTimeline &&
            typeof segment.start !== 'undefined') {
          let distance = Math.abs(currentTime - segment.start);

          // Once the distance begins to increase, we have passed
          // currentTime and can stop looking for better candidates
          if (lastDistance !== null && lastDistance < distance) {
            break;
          }

          if (!syncPoint || lastDistance === null || lastDistance >= distance) {
            lastDistance = distance;
            syncPoint = {
              time: segment.start,
              segmentIndex: i
            };
          }

        }
      }
      return syncPoint;
    }
  },
  // Stategy "Discontinuity": We have a discontinuity with a known
  //                          display-time
  {
    name: 'Discontinuity',
    run: (syncController, playlist, duration, currentTimeline, currentTime) => {
      let syncPoint = null;

      currentTime = currentTime || 0;

      if (playlist.discontinuityStarts && playlist.discontinuityStarts.length) {
        let lastDistance = null;

        for (let i = 0; i < playlist.discontinuityStarts.length; i++) {
          let segmentIndex = playlist.discontinuityStarts[i];
          let discontinuity = playlist.discontinuitySequence + i + 1;
          let discontinuitySync = syncController.discontinuities[discontinuity];

          if (discontinuitySync) {
            let distance = Math.abs(currentTime - discontinuitySync.time);

            // Once the distance begins to increase, we have passed
            // currentTime and can stop looking for better candidates
            if (lastDistance !== null && lastDistance < distance) {
              break;
            }

            if (!syncPoint || lastDistance === null || lastDistance >= distance) {
              lastDistance = distance;
              syncPoint = {
                time: discontinuitySync.time,
                segmentIndex
              };
            }
          }
        }
      }
      return syncPoint;
    }
  },
  // Stategy "Playlist": We have a playlist with a known mapping of
  //                     segment index to display time
  {
    name: 'Playlist',
    run: (syncController, playlist, duration, currentTimeline, currentTime) => {
      if (playlist.syncInfo) {
        let syncPoint = {
          time: playlist.syncInfo.time,
          segmentIndex: playlist.syncInfo.mediaSequence - playlist.mediaSequence
        };

        return syncPoint;
      }
      return null;
    }
  }
];

export default class SyncController extends videojs.EventTarget {
  constructor(options = {}) {
    super();
    // ...for synching across variants
    this.timelines = [];
    this.discontinuities = [];
    this.datetimeToDisplayTime = null;

    this.logger_ = logger('SyncController');
  }

  /**
   * Find a sync-point for the playlist specified
   *
   * A sync-point is defined as a known mapping from display-time to
   * a segment-index in the current playlist.
   *
   * @param {Playlist} playlist
   *        The playlist that needs a sync-point
   * @param {Number} duration
   *        Duration of the MediaSource (Infinite if playing a live source)
   * @param {Number} currentTimeline
   *        The last timeline from which a segment was loaded
   * @returns {Object}
   *          A sync-point object
   */
  getSyncPoint(playlist, duration, currentTimeline, currentTime) {
    const syncPoints = this.runStrategies_(playlist,
                                           duration,
                                           currentTimeline,
                                           currentTime);

    if (!syncPoints.length) {
      // Signal that we need to attempt to get a sync-point manually
      // by fetching a segment in the playlist and constructing
      // a sync-point from that information
      return null;
    }

    // Now find the sync-point that is closest to the currentTime because
    // that should result in the most accurate guess about which segment
    // to fetch
    return this.selectSyncPoint_(syncPoints, { key: 'time', value: currentTime });
  }

  /**
   * Calculate the amount of time that has expired off the playlist during playback
   *
   * @param {Playlist} playlist
   *        Playlist object to calculate expired from
   * @param {Number} duration
   *        Duration of the MediaSource (Infinity if playling a live source)
   * @returns {Number|null}
   *          The amount of time that has expired off the playlist during playback. Null
   *          if no sync-points for the playlist can be found.
   */
  getExpiredTime(playlist, duration) {
    if (!playlist || !playlist.segments) {
      return null;
    }

    const syncPoints = this.runStrategies_(playlist,
                                           duration,
                                           playlist.discontinuitySequence,
                                           0);

    // Without sync-points, there is not enough information to determine the expired time
    if (!syncPoints.length) {
      return null;
    }

    const syncPoint = this.selectSyncPoint_(syncPoints, {
      key: 'segmentIndex',
      value: 0
    });

    // If the sync-point is beyond the start of the playlist, we want to subtract the
    // duration from index 0 to syncPoint.segmentIndex instead of adding.
    if (syncPoint.segmentIndex > 0) {
      syncPoint.time *= -1;
    }

    return Math.abs(syncPoint.time + sumDurations(playlist, syncPoint.segmentIndex, 0));
  }

  /**
   * Runs each sync-point strategy and returns a list of sync-points returned by the
   * strategies
   *
   * @private
   * @param {Playlist} playlist
   *        The playlist that needs a sync-point
   * @param {Number} duration
   *        Duration of the MediaSource (Infinity if playing a live source)
   * @param {Number} currentTimeline
   *        The last timeline from which a segment was loaded
   * @returns {Array}
   *          A list of sync-point objects
   */
  runStrategies_(playlist, duration, currentTimeline, currentTime) {
    let syncPoints = [];

    // Try to find a sync-point in by utilizing various strategies...
    for (let i = 0; i < syncPointStrategies.length; i++) {
      let strategy = syncPointStrategies[i];
      let syncPoint = strategy.run(this,
                                   playlist,
                                   duration,
                                   currentTimeline,
                                   currentTime);

      if (syncPoint) {
        syncPoint.strategy = strategy.name;
        syncPoints.push({
          strategy: strategy.name,
          syncPoint
        });
      }
    }

    return syncPoints;
  }

  /**
   * Selects the sync-point nearest the specified target
   *
   * @private
   * @param {Array} syncPoints
   *        List of sync-points to select from
   * @param {Object} target
   *        Object specifying the property and value we are targeting
   * @param {String} target.key
   *        Specifies the property to target. Must be either 'time' or 'segmentIndex'
   * @param {Number} target.value
   *        The value to target for the specified key.
   * @returns {Object}
   *          The sync-point nearest the target
   */
  selectSyncPoint_(syncPoints, target) {
    let bestSyncPoint = syncPoints[0].syncPoint;
    let bestDistance = Math.abs(syncPoints[0].syncPoint[target.key] - target.value);
    let bestStrategy = syncPoints[0].strategy;

    for (let i = 1; i < syncPoints.length; i++) {
      let newDistance = Math.abs(syncPoints[i].syncPoint[target.key] - target.value);

      if (newDistance < bestDistance) {
        bestDistance = newDistance;
        bestSyncPoint = syncPoints[i].syncPoint;
        bestStrategy = syncPoints[i].strategy;
      }
    }

    this.logger_(`syncPoint for [${target.key}: ${target.value}] chosen with strategy` +
      ` [${bestStrategy}]: [time:${bestSyncPoint.time},` +
      ` segmentIndex:${bestSyncPoint.segmentIndex}]`);

    return bestSyncPoint;
  }

  /**
   * Save any meta-data present on the segments when segments leave
   * the live window to the playlist to allow for synchronization at the
   * playlist level later.
   *
   * @param {Playlist} oldPlaylist - The previous active playlist
   * @param {Playlist} newPlaylist - The updated and most current playlist
   */
  saveExpiredSegmentInfo(oldPlaylist, newPlaylist) {
    let mediaSequenceDiff = newPlaylist.mediaSequence - oldPlaylist.mediaSequence;

    // When a segment expires from the playlist and it has a start time
    // save that information as a possible sync-point reference in future
    for (let i = mediaSequenceDiff - 1; i >= 0; i--) {
      let lastRemovedSegment = oldPlaylist.segments[i];

      if (lastRemovedSegment && typeof lastRemovedSegment.start !== 'undefined') {
        newPlaylist.syncInfo = {
          mediaSequence: oldPlaylist.mediaSequence + i,
          time: lastRemovedSegment.start
        };
        this.logger_(`playlist refresh sync: [time:${newPlaylist.syncInfo.time},` +
          ` mediaSequence: ${newPlaylist.syncInfo.mediaSequence}]`);
        this.trigger('syncinfoupdate');
        break;
      }
    }
  }

  /**
   * Save the mapping from playlist's ProgramDateTime to display. This should
   * only ever happen once at the start of playback.
   *
   * @param {Playlist} playlist - The currently active playlist
   */
  setDateTimeMapping(playlist) {
    if (!this.datetimeToDisplayTime &&
        playlist.segments &&
        playlist.segments.length &&
        playlist.segments[0].dateTimeObject) {
      let playlistTimestamp = playlist.segments[0].dateTimeObject.getTime() / 1000;

      this.datetimeToDisplayTime = -playlistTimestamp;
    }
  }

  saveSegmentTimingInfo(segmentInfo) {
    if (this.calculateSegmentTimeMapping_(segmentInfo, segmentInfo.timingInfo)) {
      this.saveDiscontinuitySyncInfo_(segmentInfo);

      // If the playlist does not have sync information yet, record that information
      // now with segment timing information
      if (!segmentInfo.playlist.syncInfo) {
        segmentInfo.playlist.syncInfo = {
          mediaSequence: segmentInfo.playlist.mediaSequence + segmentInfo.mediaIndex,
          time: segmentInfo.segment.start
        };
      }
    }
  }

  timestampOffsetForTimeline(timeline) {
    if (typeof this.timelines[timeline] === 'undefined') {
      return null;
    }
    return this.timelines[timeline].time;
  }

  mappingForTimeline(timeline) {
    if (typeof this.timelines[timeline] === 'undefined') {
      return null;
    }
    return this.timelines[timeline].mapping;
  }

  /**
   * Use the "media time" for a segment to generate a mapping to "display time" and
   * save that display time to the segment.
   *
   * @private
   * @param {SegmentInfo} segmentInfo
   *        The current active request information
   * @param {object} timingInfo
   *        The start and end time of the current segment in "media time"
   * @returns {Boolean}
   *          Returns false if segment time mapping could not be calculated
   */
  calculateSegmentTimeMapping_(segmentInfo, timingInfo) {
    let segment = segmentInfo.segment;
    let mappingObj = this.timelines[segmentInfo.timeline];

    if (segmentInfo.timestampOffset !== null) {
      mappingObj = {
        time: segmentInfo.startOfSegment,
        mapping: segmentInfo.startOfSegment - timingInfo.start
      };
      this.timelines[segmentInfo.timeline] = mappingObj;
      this.trigger('timestampoffset');

      this.logger_(`time mapping for timeline ${segmentInfo.timeline}: ` +
        `[time: ${mappingObj.time}] [mapping: ${mappingObj.mapping}]`);

      segment.start = segmentInfo.startOfSegment;
      segment.end = timingInfo.end + mappingObj.mapping;
    } else if (mappingObj) {
      segment.start = timingInfo.start + mappingObj.mapping;
      segment.end = timingInfo.end + mappingObj.mapping;
    } else {
      return false;
    }

    return true;
  }

  /**
   * Each time we have discontinuity in the playlist, attempt to calculate the location
   * in display of the start of the discontinuity and save that. We also save an accuracy
   * value so that we save values with the most accuracy (closest to 0.)
   *
   * @private
   * @param {SegmentInfo} segmentInfo - The current active request information
   */
  saveDiscontinuitySyncInfo_(segmentInfo) {
    let playlist = segmentInfo.playlist;
    let segment = segmentInfo.segment;

    // If the current segment is a discontinuity then we know exactly where
    // the start of the range and it's accuracy is 0 (greater accuracy values
    // mean more approximation)
    if (segment.discontinuity) {
      this.discontinuities[segment.timeline] = {
        time: segment.start,
        accuracy: 0
      };
    } else if (playlist.discontinuityStarts && playlist.discontinuityStarts.length) {
      // Search for future discontinuities that we can provide better timing
      // information for and save that information for sync purposes
      for (let i = 0; i < playlist.discontinuityStarts.length; i++) {
        let segmentIndex = playlist.discontinuityStarts[i];
        let discontinuity = playlist.discontinuitySequence + i + 1;
        let mediaIndexDiff = segmentIndex - segmentInfo.mediaIndex;
        let accuracy = Math.abs(mediaIndexDiff);

        if (!this.discontinuities[discontinuity] ||
             this.discontinuities[discontinuity].accuracy > accuracy) {
          let time;

          if (mediaIndexDiff < 0) {
            time = segment.start - sumDurations(playlist,
                                                segmentInfo.mediaIndex,
                                                segmentIndex);
          } else {
            time = segment.end + sumDurations(playlist,
                                              segmentInfo.mediaIndex + 1,
                                              segmentIndex);
          }

          this.discontinuities[discontinuity] = {
            time,
            accuracy
          };
        }
      }
    }
  }
}
