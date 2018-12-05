# How to get stream time from player time

## Definitions

NOTE: All times referenced in seconds unless otherwise specified.

*Player Time*: any time that can be gotten/set from player.currentTime() (e.g., any time within player.seekable().start(0) to player.seekable().end(0))
*Stream Time*: any time set within one of the stream's segments used by video frames (e.g., dts, pts, base media decode time), natively uses clock values, but referenced in seconds throughout the document
*Program Time*: any time referencing the real world (e.g., EXT-X-PROGRAM-DATE-TIME)
*Start of Segment*: the pts (presentation timestamp) value of the first frame in a segment

## Overview

In order to convert from a *player time* to a *stream time*, two things are required:

1. An anchor point must be chosen to match up a *player time* and a *stream time*
1. The offset must be determined between the *player time* and the *stream time* at that point

Two anchor points that are usable are the time since the start of a new timeline (e.g., the time since the last discontinuity or start of the stream), and the start of a segment. Because each segment is tagged with its *program time*, using the segment start as the anchor point is the easiest solution, since it's the closest point to the time to convert, and it doesn't require us to track time changes across multiple segments.

To make use of the segment start, and to calculate the offset between the two, a few properties are needed:

1. The start of the segment before transmuxing
1. Time changes made to the segment during transmuxing
1. The start of the segment after transmuxing

While the start of the segment before and after transmuxing is trivial to retrieve, getting the time changes made during transmuxing is more complicated, as we must account for any trimming, prepending, and gap filling made during the transmux stage. However, the required use-case only requires determining the position of a video frame, allowing us to ignore any changes made to the audio timeline (because VHS uses video as the timeline of truth), and allowing us to ignore a couple of the video changes made.

What follows are the changes made to a video stream by the transmuxer that could modify the timeline, and if they must be accounted for in the conversion:

* Keyframe Pulling
  * Used when: the segment doesn't start with a keyframe.
  * Impact: the keyframe with the lowest dts value in the segment is "pulled" back to the first dts value in the segment, and all frames in-between are dropped.
  * Need to account in time conversion? No. If a keyframe is pulled, and frames before it are dropped, then the segment will maintain the same segment duration, and the viewer is only seeing the keyframe during that period.
* GOP Fusion
  * Used when: the segment doesn't start with a keyframe.
  * Impact: if GOPs were saved from previous segment appends, the last GOP will be prepended to the segment.
  * Need to account in time conversion? Yes. The segment is artificially extended, so while it shouldn't impact the stream time itself (since it will overlap with content already appended), it will impact the post transmux start of segment.
* GOPS to Align With
  * Used when: switching renditions, or appending segments with overlapping GOPs (intersecting time ranges).
  * Impact: GOPs in the segment will be dropped until there are no overlapping GOPs with previous segments.
  * Need to account in time conversion? No. So long as we aren't switching renditions, and the content is sane enough to not contain overlapping GOPs, this should not have a meaningful impact.

Among the changes, with only GOP Fusion having an impact, the task becomes simpler. Instead of accounting for any changes to the video stream, only those from GOP Fusion should be accounted for. Since GOP fusion will potentially only prepend frames to the segment, we just need the number of seconds prepended to the segment when offsetting the time. As such, we can add the following properties to each segment:

```
segment: {
  ...
  videoTimingInfo: {
    // start of segment (stream time)
    originalStart
    // number of seconds prepended by GOP fusion
    transmuxerPrependedSeconds
    // start of transmuxed segment (player time)
    transmuxedStart
  }
}
```

## The Formula

With the properties listed above, calculating a *stream time* from a *player time* is given as follows:

```
const playerTimeToStreamTime = (playerTime, segment) => {
  const originalStart = segment.videoTimingInfo.originalStart;
  const transmuxerPrependedSeconds = segment.videoTimingInfo.transmuxerPrependedSeconds;
  const transmuxedStart = segment.videoTimingInfo.transmuxedStart;

  // get the proper start of new content (not prepended old content) from the segment, in player time
  const startOfSegment = transmuxedStart + prependedSeconds;
  const offsetFromSegmentStart = playerTime - startOfSegment;

  return originalStart + offsetFromSegmentStart;
};
```

The *stream time* can be converted to *program time* by taking the EXT-X-PROGRAM-DATE-TIME tagged on the segment and adding *stream time* - segment.videoTimingInfo.originalStart.

## Examples

```
// Stream Times:
//   segment1: 30.1 => 32.1
//   segment2: 32.1 => 34.1
//   segment3: 34.1 => 36.1
//
// Player Times:
//   segment1: 0 => 2
//   segment2: 2 => 4
//   segment3: 4 => 6

const segment2 = {
  videoTimingInfo: {
    originalStart: 32.1,
    transmuxerPrependedSeconds: 0.3,
    transmuxedStart: 1.7
  }
};
playerTimeToStreamTime(2.5, segment2);
// startOfSegment = 1.7 + 0.3 = 2
// offsetFromSegmentStart = 2.5 - 2 = 0.5
// return 32.1 + 0.5 = 32.6

const segment3 = {
  videoTimingInfo: {
    originalStart: 34.1,
    transmuxerPrependedSeconds: 0.2,
    transmuxedStart: 3.8
  }
};
playerTimeToStreamTime(4, segment3);
// startOfSegment = 3.8 + 0.2 = 4
// offsetFromSegmentStart = 4 - 4 = 0
// return 34.1 + 0 = 34.1
```

## Transmux Before Append Changes

Even though segment timing values are retained for transmux before append, the formula does not need to change, as all that matters for calculation is the offset from the transmuxed segment start, which can then be applied to the stream time start of segment, or the program time start of segment.
