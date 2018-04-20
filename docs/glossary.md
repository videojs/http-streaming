# Glossary

**Master Playlist Controller**: This is the starting point of the project and acts as the controller for the playback engine. It interacts with the SegmentLoaders, PlaylistLoaders, PlaybackWatcher, etc.
**Playlist Loader**: This will request the source and load the master manifest. It also interacts with the ABR algorithm to pick a media playlist or wraps a media playlist if it is provided as the source.
**Media Playlist**: This is a manifest that represents a single rendition of the source.
**ABR(Adaptive Bitrate) Algorithm**: this is defined in [selectPlaylist]() and is described more [here](./bitrate-switching.md).
**Playback Watcher**: This handles seeking to live when playing a live source with a live window, or skipping over gaps in content. This is described in detail [here]().