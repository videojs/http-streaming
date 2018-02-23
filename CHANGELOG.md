CHANGELOG
=========

--------------------
## HEAD (Unreleased)
_(none)_

--------------------
## 0.5.2
* add debug logging statement for seekable updates ([#40](https://github.com/videojs/http-streaming/pull/40))

## 0.5.1
* Fix audio only streams with EXT-X-MEDIA tags ([#34](https://github.com/videojs/http-streaming/pull/34))
* Merge videojs-contrib-hls master into http-streaming master ([#35](https://github.com/videojs/http-streaming/pull/35))
  * Update sinon to 1.10.3=
  * Update videojs-contrib-quality-levels to ^2.0.4
  * Fix test for event handler cleanup on dispose by calling event handling methods
* fix: Don't reset eme options ([#32](https://github.com/videojs/http-streaming/pull/32))

## 0.5.0
* update mpd-parser to support more segment list types ([#27](https://github.com/videojs/http-streaming/issues/27))

## 0.4.0
* Removed Flash support ([#15](https://github.com/videojs/http-streaming/issues/15))
* Blacklist playlists not supported by browser media source before initial selection ([#17](https://github.com/videojs/http-streaming/issues/17))

## 0.3.1
* Skip flash-based source handler with DASH sources ([#14](https://github.com/videojs/http-streaming/issues/14))

## 0.3.0
* Added additional properties to the stats object ([#10](https://github.com/videojs/http-streaming/issues/10))

## 0.2.1
* Updated the mpd-parser to fix IE11 DASH support ([#12](https://github.com/videojs/http-streaming/issues/12))

## 0.2.0
* Initial DASH Support ([#8](https://github.com/videojs/http-streaming/issues/8))

## 0.1.0
* Initial release, based on [videojs-contrib-hls 5.12.2](https://github.com/videojs/videojs-contrib-hls)

