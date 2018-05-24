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

