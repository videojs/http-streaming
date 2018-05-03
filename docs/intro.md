# HLS Overview
The HLS project polyfills support for [HTTP Live Streaming](https://developer.apple.com/library/ios/documentation/NetworkingInternet/Conceptual/StreamingMediaGuide/Introduction/Introduction.html) (HLS) video format. This document is intended as a primer for anyone interested in contributing or just better understanding how bits from a server get turned into video on their display.

## HTTP Live Streaming
HLS has two primary characteristics that distinguish it from other video formats:

- Delivered over HTTP(S): it uses the standard application protocol of the web to deliver all its data
- Segmented: longer videos are broken up into smaller chunks which can be downloaded independently and switched between at runtime

A standard HLS stream consists of a *Master Playlist* which references one or more *Media Playlists*. Each Media Playlist contains references one or more sequential video segments. All these components form a logical hierarchy that informs the player of the different quality levels of the video available and how to address the individual segments of video at each of those levels:

![HLS Format](hls-format.png)

HLS streams can be delivered in two different modes: a "static" mode for videos that can be played back from any point, often referred to as video-on-demand (VOD); or a "live" mode where later portions of the video become available as time goes by. In the static mode, the Master and Media playlists are fixed. The player is guaranteed that the set of video segments referenced by those playlists will not change over time.

Live mode can work in one of two ways. For truly live events, the most common configuration is for each individual Media Playlist to only include the latest video segment and a small number of consecutive previous segments. In this mode, the player may be able to seek backwards a short time in the video but probably not all the way back to the beginning. In the other live configuration, new video segments can be appended to the Media Playlists but older segments are never removed. This configuration allows the player to seek back to the beginning of the stream at any time during the broadcast and transitions seamlessly to the static stream type when the event finishes.

If you're interested in a more in-depth treatment of the HLS format, check out [Apple's documentation](https://developer.apple.com/library/ios/documentation/NetworkingInternet/Conceptual/StreamingMediaGuide/Introduction/Introduction.html) and the IETF [Draft Specification](https://datatracker.ietf.org/doc/draft-pantos-http-live-streaming/).

# Further Documentation

- [Arch](arch.md)
- [Glossary](glossary.md)
- [Adaptive Bitrate Switching](bitrate-switching.md)
- [Multiple Alternative Audio Tracks](multiple-alternative-audio-tracks.md)

# Helpful Tools
- [FFmpeg](http://trac.ffmpeg.org/wiki/CompilationGuide)
- [Thumbcoil](http://thumb.co.il/)