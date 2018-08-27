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

### mp4Video.mp4

Copy only the first two video frames, leave out audio.
movflags:
* frag\_keyframe: "Start a new fragment at each video keyframe."
* empty\_moov: "Write an initial moov atom directly at the start of the file, without describing any samples in it."
* omit\_tfhd\_offset: "Do not write any absolute base\_data\_offset in tfhd atoms. This avoids tying fragments to absolute byte positions in the file/streams." (see also: https://www.w3.org/TR/mse-byte-stream-format-isobmff/#movie-fragment-relative-addressing)

```
$ ffmpeg -i file.mp4 -movflags frag_keyframe+empty_moov+omit_tfhd_offset -vframes 2 -an -vcodec copy mp4Video.mp4
```

### mp4Audio.mp4

Copy only the first two audio frames, leave out video.
movflags:
* frag\_keyframe: "Start a new fragment at each video keyframe."
* empty\_moov: "Write an initial moov atom directly at the start of the file, without describing any samples in it."
* omit\_tfhd\_offset: "Do not write any absolute base\_data\_offset in tfhd atoms. This avoids tying fragments to absolute byte positions in the file/streams." (see also: https://www.w3.org/TR/mse-byte-stream-format-isobmff/#movie-fragment-relative-addressing)

```
$ ffmpeg -i file.mp4 -movflags frag_keyframe+empty_moov+omit_tfhd_offset -vframes 2 -an -vcodec copy mp4Audio.mp4
```
