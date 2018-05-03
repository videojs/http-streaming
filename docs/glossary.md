# Glossary

**Playlist**: This is a representation of an HLS or DASH manifest.

**Master Playlist Controller**: This acts as the gateway for the playback engine to interact with the player. It interacts with the SegmentLoaders, PlaylistLoaders, PlaybackWatcher, etc.

**Playlist Loader**: This will request the source and load the master manifest. It also interacts with the ABR algorithm to pick a media playlist or wraps a media playlist if it is provided as the source. There are more details about the playlist loader [here](./arch.md).

**Media Playlist**: This is a manifest that represents a single rendition of the source.

**Segment Loader**: This controlls the requesting and appending of segments on to the browser's [SourceBuffers](https://developer.mozilla.org/en-US/docs/Web/API/SourceBuffer).

**ABR(Adaptive Bitrate) Algorithm**: This is defined in selectPlaylist and is described more [here](./bitrate-switching.md).

**Playback Watcher**: This handles seeking to live when playing a live source with a live window, or skipping over gaps in content. This is described in detail [here]().

**Sync Controller**: This will attempt to create a mapping between the segment index and a display time on the player.