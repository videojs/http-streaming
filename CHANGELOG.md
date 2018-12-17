<a name="1.5.1"></a>
## [1.5.1](https://github.com/videojs/http-streaming/compare/v1.5.0...v1.5.1) (2018-12-06)

### Bug Fixes

* added missing manifest information on to segments (EXT-X-PROGRAM-DATE-TIME) ([#236](https://github.com/videojs/http-streaming/issues/236)) ([a35dd09](https://github.com/videojs/http-streaming/commit/a35dd09))
* remove player props on dispose to stop middleware  ([#229](https://github.com/videojs/http-streaming/issues/229)) ([cd13f9f](https://github.com/videojs/http-streaming/commit/cd13f9f))

### Documentation

* add dash to package.json description ([#267](https://github.com/videojs/http-streaming/issues/267)) ([3296c68](https://github.com/videojs/http-streaming/commit/3296c68))
* add documentation for reloadSourceOnError ([#266](https://github.com/videojs/http-streaming/issues/266)) ([7448b37](https://github.com/videojs/http-streaming/commit/7448b37))

<a name="1.5.0"></a>
# [1.5.0](https://github.com/videojs/http-streaming/compare/v1.4.2...v1.5.0) (2018-11-13)

### Features

* Add useBandwidthFromLocalStorage option ([#275](https://github.com/videojs/http-streaming/issues/275)) ([60c88ae](https://github.com/videojs/http-streaming/commit/60c88ae))

### Bug Fixes

* don't wait for requests to finish when encountering an error in media-segment-request ([#286](https://github.com/videojs/http-streaming/issues/286)) ([970e3ce](https://github.com/videojs/http-streaming/commit/970e3ce))
* throttle final playlist reloads when using DASH ([#277](https://github.com/videojs/http-streaming/issues/277)) ([1c2887a](https://github.com/videojs/http-streaming/commit/1c2887a))

<a name="1.4.2"></a>
## [1.4.2](https://github.com/videojs/http-streaming/compare/v1.4.1...v1.4.2) (2018-11-01)

### Chores

* pin to node 8 for now ([#279](https://github.com/videojs/http-streaming/issues/279)) ([f900dc4](https://github.com/videojs/http-streaming/commit/f900dc4))
* update mux.js to 5.0.1 ([#282](https://github.com/videojs/http-streaming/issues/282)) ([af6ee4f](https://github.com/videojs/http-streaming/commit/af6ee4f))

<a name="1.4.1"></a>
## [1.4.1](https://github.com/videojs/http-streaming/compare/v1.4.0...v1.4.1) (2018-10-25)

### Bug Fixes

* **subtitles:** set default property if default and autoselect are both enabled ([#239](https://github.com/videojs/http-streaming/issues/239)) ([ee594e5](https://github.com/videojs/http-streaming/commit/ee594e5))

<a name="1.4.0"></a>
# [1.4.0](https://github.com/videojs/http-streaming/compare/v1.3.1...v1.4.0) (2018-10-24)

### Features

* limited experimental DASH multiperiod support ([#268](https://github.com/videojs/http-streaming/issues/268)) ([a213807](https://github.com/videojs/http-streaming/commit/a213807))
* smoothQualityChange flag ([#235](https://github.com/videojs/http-streaming/issues/235)) ([0e4fdf9](https://github.com/videojs/http-streaming/commit/0e4fdf9))

### Bug Fixes

* immediately setup EME if available ([#263](https://github.com/videojs/http-streaming/issues/263)) ([7577e90](https://github.com/videojs/http-streaming/commit/7577e90))

<a name="1.3.1"></a>
## [1.3.1](https://github.com/videojs/http-streaming/compare/v1.3.0...v1.3.1) (2018-10-15)

### Bug Fixes

* ensure content loops ([#259](https://github.com/videojs/http-streaming/issues/259)) ([26300df](https://github.com/videojs/http-streaming/commit/26300df))

<a name="1.3.0"></a>
# [1.3.0](https://github.com/videojs/http-streaming/compare/v1.2.6...v1.3.0) (2018-10-05)

### Features

* add an option to ignore player size in selection logic ([#238](https://github.com/videojs/http-streaming/issues/238)) ([7ae42b1](https://github.com/videojs/http-streaming/commit/7ae42b1))

### Documentation

* Update CONTRIBUTING.md ([#242](https://github.com/videojs/http-streaming/issues/242)) ([9d83e9d](https://github.com/videojs/http-streaming/commit/9d83e9d))

<a name="1.2.6"></a>
## [1.2.6](https://github.com/videojs/http-streaming/compare/v1.2.5...v1.2.6) (2018-09-21)

### Bug Fixes

* stutter after fast quality change in IE/Edge ([#213](https://github.com/videojs/http-streaming/issues/213)) ([2c0d9b2](https://github.com/videojs/http-streaming/commit/2c0d9b2))

### Documentation

* update issue template to link to the troubleshooting guide ([#215](https://github.com/videojs/http-streaming/issues/215)) ([413f0e8](https://github.com/videojs/http-streaming/commit/413f0e8))
* update README notes for video.js 7 ([#200](https://github.com/videojs/http-streaming/issues/200)) ([d68ce0c](https://github.com/videojs/http-streaming/commit/d68ce0c))
* update troubleshooting guide for Edge/mobile Chrome ([#216](https://github.com/videojs/http-streaming/issues/216)) ([21e5335](https://github.com/videojs/http-streaming/commit/21e5335))

<a name="1.2.5"></a>
## [1.2.5](https://github.com/videojs/http-streaming/compare/v1.2.4...v1.2.5) (2018-08-24)

### Bug Fixes

* fix replay functionality ([#204](https://github.com/videojs/http-streaming/issues/204)) ([fd6be83](https://github.com/videojs/http-streaming/commit/fd6be83))

<a name="1.2.4"></a>
## [1.2.4](https://github.com/videojs/http-streaming/compare/v1.2.3...v1.2.4) (2018-08-13)

### Bug Fixes

* Remove buffered data on fast quality switches ([#113](https://github.com/videojs/http-streaming/issues/113)) ([bc94fbb](https://github.com/videojs/http-streaming/commit/bc94fbb))

<a name="1.2.3"></a>
## [1.2.3](https://github.com/videojs/http-streaming/compare/v1.2.2...v1.2.3) (2018-08-09)

### Chores

* link to minified example in main page ([#189](https://github.com/videojs/http-streaming/issues/189)) ([15a7f92](https://github.com/videojs/http-streaming/commit/15a7f92))
* use netlify for easier testing ([#188](https://github.com/videojs/http-streaming/issues/188)) ([d2e0d35](https://github.com/videojs/http-streaming/commit/d2e0d35))

<a name="1.2.2"></a>
## [1.2.2](https://github.com/videojs/http-streaming/compare/v1.2.1...v1.2.2) (2018-08-07)

### Bug Fixes

* typeof minification ([#182](https://github.com/videojs/http-streaming/issues/182)) ([7c68335](https://github.com/videojs/http-streaming/commit/7c68335))
* Use middleware and a wrapped function for seeking instead of relying on unreliable 'seeking' events ([#161](https://github.com/videojs/http-streaming/issues/161)) ([6c68761](https://github.com/videojs/http-streaming/commit/6c68761))

### Chores

* add logo ([#184](https://github.com/videojs/http-streaming/issues/184)) ([a55626c](https://github.com/videojs/http-streaming/commit/a55626c))

### Documentation

* add note for Safari captions error ([#174](https://github.com/videojs/http-streaming/issues/174)) ([7b03530](https://github.com/videojs/http-streaming/commit/7b03530))

### Tests

* add support for real segments in tests ([#178](https://github.com/videojs/http-streaming/issues/178)) ([2b07fca](https://github.com/videojs/http-streaming/commit/2b07fca))

<a name="1.2.1"></a>
## [1.2.1](https://github.com/videojs/http-streaming/compare/v1.2.0...v1.2.1) (2018-07-17)

### Bug Fixes

* convert non-latin characters in IE ([#157](https://github.com/videojs/http-streaming/issues/157)) ([17678fb](https://github.com/videojs/http-streaming/commit/17678fb))

<a name="1.2.0"></a>
# [1.2.0](https://github.com/videojs/http-streaming/compare/v1.1.0...v1.2.0) (2018-07-16)

### Features

* **captions:** write in-band captions from DASH fmp4 segments to the textTrack API ([#108](https://github.com/videojs/http-streaming/issues/108)) ([7c11911](https://github.com/videojs/http-streaming/commit/7c11911))

### Chores

* add welcome bot config from video.js ([#150](https://github.com/videojs/http-streaming/issues/150)) ([922cfee](https://github.com/videojs/http-streaming/commit/922cfee))

<a name="1.1.0"></a>
# [1.1.0](https://github.com/videojs/http-streaming/compare/v1.0.2...v1.1.0) (2018-06-06)

### Features

* Utilize option to override native on tech ([#76](https://github.com/videojs/http-streaming/issues/76)) ([5c7ab4c](https://github.com/videojs/http-streaming/commit/5c7ab4c))

### Chores

* update tests and pages for video.js 7 ([#102](https://github.com/videojs/http-streaming/issues/102)) ([d6f5005](https://github.com/videojs/http-streaming/commit/d6f5005))

<a name="1.0.2"></a>
## [1.0.2](https://github.com/videojs/http-streaming/compare/v1.0.1...v1.0.2) (2018-05-17)

### Bug Fixes

* make project Video.js 7 ready ([#92](https://github.com/videojs/http-streaming/issues/92)) ([decad87](https://github.com/videojs/http-streaming/commit/decad87))
* make sure that es build is babelified ([#97](https://github.com/videojs/http-streaming/issues/97)) ([5f0428d](https://github.com/videojs/http-streaming/commit/5f0428d))

### Documentation

* update documentation with a glossary and intro page, added DASH background ([#94](https://github.com/videojs/http-streaming/issues/94)) ([4b0fde9](https://github.com/videojs/http-streaming/commit/4b0fde9))

<a name="1.0.1"></a>
## [1.0.1](https://github.com/videojs/http-streaming/compare/v1.0.0...v1.0.1) (2018-04-12)

### Bug Fixes

* minified build ([#84](https://github.com/videojs/http-streaming/issues/84)) ([2402ac6](https://github.com/videojs/http-streaming/commit/2402ac6))

<a name="1.0.0"></a>
# [1.0.0](https://github.com/videojs/http-streaming/compare/v0.9.0...v1.0.0) (2018-04-10)

### Chores

* sync videojs-contrib-hls updates ([#75](https://github.com/videojs/http-streaming/issues/75)) ([9223588](https://github.com/videojs/http-streaming/commit/9223588))
* update the aes-decrypter ([#71](https://github.com/videojs/http-streaming/issues/71)) ([27ed914](https://github.com/videojs/http-streaming/commit/27ed914))

### Documentation

* update docs for overrideNative ([#77](https://github.com/videojs/http-streaming/issues/77)) ([98ca6d3](https://github.com/videojs/http-streaming/commit/98ca6d3))
* update known issues for fmp4 captions ([#79](https://github.com/videojs/http-streaming/issues/79)) ([c418301](https://github.com/videojs/http-streaming/commit/c418301))

<a name="0.9.0"></a>
# [0.9.0](https://github.com/videojs/http-streaming/compare/v0.8.0...v0.9.0) (2018-03-30)

### Features

* support in-manifest DRM data ([#60](https://github.com/videojs/http-streaming/issues/60)) ([a1cad82](https://github.com/videojs/http-streaming/commit/a1cad82))

<a name="0.8.0"></a>
# [0.8.0](https://github.com/videojs/http-streaming/compare/v0.7.2...v0.8.0) (2018-03-30)

### Code Refactoring

* export corrections ([#68](https://github.com/videojs/http-streaming/issues/68)) ([aab3b90](https://github.com/videojs/http-streaming/commit/aab3b90))
* use rollup for build ([#69](https://github.com/videojs/http-streaming/issues/69)) ([c28c25c](https://github.com/videojs/http-streaming/commit/c28c25c))

# 0.7.0
* feat: Live support for DASH

# 0.6.1
* use webwackify for webworkers to support webpack bundle ([#50](https://github.com/videojs/http-streaming/pull/45))

# 0.5.3
* fix: program date time handling ([#45](https://github.com/videojs/http-streaming/pull/45))
  * update m3u8-parser to v4.2.0
  * use segment program date time info
* feat: Adding support for segments in Period and Representation ([#47](https://github.com/videojs/http-streaming/pull/47))
* wait for both main and audio loaders for endOfStream if main starting media unknown ([#44](https://github.com/videojs/http-streaming/pull/44))

# 0.5.2
* add debug logging statement for seekable updates ([#40](https://github.com/videojs/http-streaming/pull/40))

# 0.5.1
* Fix audio only streams with EXT-X-MEDIA tags ([#34](https://github.com/videojs/http-streaming/pull/34))
* Merge videojs-contrib-hls master into http-streaming master ([#35](https://github.com/videojs/http-streaming/pull/35))
  * Update sinon to 1.10.3=
  * Update videojs-contrib-quality-levels to ^2.0.4
  * Fix test for event handler cleanup on dispose by calling event handling methods
* fix: Don't reset eme options ([#32](https://github.com/videojs/http-streaming/pull/32))

# 0.5.0
* update mpd-parser to support more segment list types ([#27](https://github.com/videojs/http-streaming/issues/27))

# 0.4.0
* Removed Flash support ([#15](https://github.com/videojs/http-streaming/issues/15))
* Blacklist playlists not supported by browser media source before initial selection ([#17](https://github.com/videojs/http-streaming/issues/17))

# 0.3.1
* Skip flash-based source handler with DASH sources ([#14](https://github.com/videojs/http-streaming/issues/14))

# 0.3.0
* Added additional properties to the stats object ([#10](https://github.com/videojs/http-streaming/issues/10))

# 0.2.1
* Updated the mpd-parser to fix IE11 DASH support ([#12](https://github.com/videojs/http-streaming/issues/12))

# 0.2.0
* Initial DASH Support ([#8](https://github.com/videojs/http-streaming/issues/8))

# 0.1.0
* Initial release, based on [videojs-contrib-hls 5.12.2](https://github.com/videojs/videojs-contrib-hls)

