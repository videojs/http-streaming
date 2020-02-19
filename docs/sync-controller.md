# Sync Controller

## Purpose

The [SyncController][sc] (SC) is responsible for maintaining synchronization across different Segment Loaders. The [SC] is shared by Main(Video)/Audio [Segment Loader][sl] and [VTT Segment Loader][vttsl] to take segment loading decisions based on the state of the [SC].

## Properties

1. `timelines[x]` refers to the media-time for the first segment loaded with timeline x.
2. `discontinuities[x]` refers to the time and accuracy(based on segment number), for the discontinuity segment number x, in the media playlist.
3. `lastBufferedSegmentTimestamp` refers to the timestamp information for the last segment loaded by the segment loader.

## Other useful information
For LIVE/VOD workflows, the discontinuity information (segment with discontinuity) might not be consistent across media-playlists(audio/video/vtt). So, for segment loading decisions, we're leveraging `lastBufferedSegmentTimestamp`.
for example: 

####Manifest(video,format=m3u8-aapl)
```
#EXTM3U
#EXT-X-VERSION:4
#EXT-X-ALLOW-CACHE:NO
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-TARGETDURATION:17
#EXT-X-PROGRAM-DATE-TIME:2020-02-12T09:52:26Z
#EXTINF:16.666000,no-desc
Fragments(video=0,format=m3u8-aapl)
#EXTINF:16.666000,no-desc
Fragments(video=1499940,format=m3u8-aapl)
#EXTINF:16.667000,no-desc
Fragments(video=2999880,format=m3u8-aapl)
#EXTINF:16.667000,no-desc
Fragments(video=4499910,format=m3u8-aapl)
#EXTINF:16.666000,no-desc
Fragments(video=5999940,format=m3u8-aapl)
#EXTINF:14.300000,no-desc
Fragments(video=7499880,format=m3u8-aapl)
``` 

####Manifest(audio_und,format=m3u8-aapl)
```
#EXTM3U
#EXT-X-VERSION:4
#EXT-X-ALLOW-CACHE:NO
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-TARGETDURATION:17
#EXT-X-PROGRAM-DATE-TIME:2020-02-12T09:52:26Z
#EXTINF:16.624989,no-desc
Fragments(audio_und=2911,format=m3u8-aapl)
#EXTINF:16.671926,no-desc
Fragments(audio_und=736073,format=m3u8-aapl)
#EXTINF:16.671926,no-desc
Fragments(audio_und=1471305,format=m3u8-aapl)
#EXTINF:16.671926,no-desc
Fragments(audio_und=2206537,format=m3u8-aapl)
#EXTINF:16.625488,no-desc
Fragments(audio_und=2941769,format=m3u8-aapl)
#EXTINF:14.326712,no-desc
Fragments(audio_und=3674953,format=m3u8-aapl)
```

####Manifest(textstream_und,format=m3u8-aapl)
```
#EXTM3U
#EXT-X-VERSION:4
#EXT-X-ALLOW-CACHE:NO
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-TARGETDURATION:4
#EXT-X-PROGRAM-DATE-TIME:2020-02-12T09:52:26Z
#EXTINF:2.944000,no-desc
Fragments(textstream_und=16896,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=64000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=128000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=192000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=256000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=320000,format=m3u8-aapl)
#EXT-X-PROGRAM-DATE-TIME:2020-02-12T09:53:32.944Z
#EXT-X-DISCONTINUITY
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1088000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1152000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1216000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1280000,format=m3u8-aapl)
#EXT-X-PROGRAM-DATE-TIME:2020-02-12T09:53:52.944Z
#EXT-X-DISCONTINUITY
#EXTINF:2.000000,no-desc
Fragments(textstream_und=1408000,format=m3u8-aapl)
#EXT-X-PROGRAM-DATE-TIME:2020-02-12T09:53:58.944Z
#EXT-X-DISCONTINUITY
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1504000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1568000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1632000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1696000,format=m3u8-aapl)
#EXTINF:4.000000,no-desc
Fragments(textstream_und=1760000,format=m3u8-aapl)
```


[sc]: ../src/sync-controller.js
[pl]: ../src/playlist-loader.js
[sl]: ../src/segment-loader.js
[vttsl]: ../src/vtt-segment-loader.js
[vhs]: intro.md
