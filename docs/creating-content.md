# Creating Content

## Commands for creating tests streams

### Streams with EXT-X-PROGRAM-DATE-TIME for testing seekToProgramTime and convertToProgramTime

lavfi and testsrc are provided for creating a test stream in ffmpeg
-g 300 sets the GOP size to 300 (keyframe interval, at 30fps, one keyframe every 10 seconds)
-f hls sets the format to HLS (creates an m3u8 and TS segments)
-hls\_time 10 sets the goal segment size to 10 seconds
-hls\_list\_size 20 sets the number of segments in the m3u8 file to 20
-program\_date\_time an hls flag for setting #EXT-X-PROGRAM-DATE-TIME on each segment

```
ffmpeg \
  -f lavfi \
  -i testsrc=duration=200:size=1280x720:rate=30 \
  -g 300 \
  -f hls \
  -hls_time 10 \
  -hls_list_size 20 \
  -hls_flags program_date_time \
  stream.m3u8
```
