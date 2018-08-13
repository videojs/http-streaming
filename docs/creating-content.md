# Creating Content

## Commands used for segments in `test/segments` dir

### video.ts

Copy only the first two video frames, leave out audio.

```
$ ffmpeg -i index0.ts -vframes 2 -an -vcodec copy video.ts
```

### audio.ts

Copy only the first two audio frames, leave out video.

```
$ ffmpeg -i index0.ts -aframes 2 -vn -acodec copy audio.ts
```
