# Media Groups Rewrite

These are used to represent:
- alternate audio tracks in HLS (sometimes referred to as MAAT in the source)
- audio tracks in DASH
- text tracks (VTT) defined in both DASH and HLS

## Current State

Currently, [MediaGroups][mg] interacts with several different classes, which can be difficult to follow and has cause bugs in the past. These components are:
- multiple [DashPlaylistLoaders][dpl] or [PlaylistLoaders][pl]
- [PlaylistController][PC]
- multiple [SegmentLoaders][sl]

[MediaGroups][mg] are **setup** by the `loadedmetadata` handler for the `mainPlaylistLoader` (video playlist loader) of a source; contained in the [PlaylistController][PC] (PC). The [PC] will pass in an `audioSegmentLoader` and `subtitleSegmentLoader` to be shared by the `AUDIO` and `SUBTITLE` mediaGroups respectively.

This **setup** includes creating either [DashPlaylistLoaders][dpl] or [PlaylistLoaders][pl] for each track described in the manifest and a corresponding HTML Track (either audio or text).

This **setup** also includes adding listeners on the created child [(Dash)PlaylistLoaders][pl] for `loadedmetadata` and `loadedplaylist`.

When these listeners are **triggered**, they set a playlist on the respective [SegmentLoader][sl] and can call `load()` on that loader to start requesting media segments.

## Problems

For this architecture to work, the events must be called at just the right time, with the respective PlaylistLoaders and SegmentLoaders in the right state and with the right metadata already loaded.

Data is passed back and forth between these classes sometimes within method calls, as arguments, and sometimes due to an event being triggered and listened to at the right time. This makes it difficult to understand the interaction between the different pieces and difficult to debug issues caused by timing differences in edge-cases.

We have encountered a number of bugs that are due to this architecture.

## Future Considerations

Currently, videojs-http-streaming (VHS) does not support multiple video tracks. This is because we have a strict definition of the `mainSegmentLoader` which only allows one video playlist to be loaded at a time. Any refactors should consider multiple video tracks in the solution.

## Future Ideas

Considering that we could have multiple tracks of all media types, it may be the most accurate to **always** use MediaGroups for all content. This would include HLS without alternate audio tracks and DASH for all cases. In this way, the PlaylistController could delegate much of the interaction handling for the PlaylistLoaders and SegmentLoaders to the MediaGroups class which would act as a specialized controller.

[dpl]: ../src/dash-playlist-loader.js
[mg]: ../src/media-groups.js
[pl]: ../src/playlist-loader.js
[PC]: ../src/playlist-controller.js
[sl]: ../src/segment-loader.js
