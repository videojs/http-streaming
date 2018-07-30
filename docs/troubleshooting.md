# Troubleshooting Guide

## Other troubleshooting guides

For issues around data embedded into media segments (e.g., 608 captions), see the [mux.js troubleshooting guide](https://github.com/videojs/mux.js/blob/master/docs/troubleshooting.md).

## Table of Contents
- [Content plays on Mac but not on Windows](#content-plays-on-mac-but-not-windows)
- ["No compatible source was found" on IE11 Win 7](#no-compatible-source-was-found-on-ie11-win-7)
- [CORS: No Access-Control-Allow-Origin header](#cors-no-access-control-allow-origin-header)
- [Desktop Safari/iOS Safari/Android Chrome/Edge exhibit different behavior from other browsers](#desktop-safariios-safariandroid-chromeedge-exhibit-different-behavior-from-other-browsers)
- [media_err_decode error on Desktop Safari](#media_err_decode-error-on-desktop-safari)

## Content plays on Mac but not Windows

Some browsers may not be able to play audio sample rates higher than 48 kHz. See https://docs.microsoft.com/en-gb/windows/desktop/medfound/aac-decoder#format-constraints

Potential solution: re-encode with a Windows supported audio sample rate

## "No compatible source was found" on IE11 Win 7

videojs-http-streaming does not support Flash HLS playback (like the videojs-contrib-hls plugin does)

Solution: include the FlasHLS source handler https://github.com/brightcove/videojs-flashls-source-handler#usage

## CORS: No Access-Control-Allow-Origin header

If you see an error along the lines of

```
XMLHttpRequest cannot load ... No 'Access-Control-Allow-Origin' header is present on the requested resource. Origin ... is therefore not allowed access.
```

you need to properly configure CORS on your server: https://github.com/videojs/http-streaming#hosting-considerations

## Desktop Safari/iOS Safari/Android Chrome/Edge exhibit different behavior from other browsers

Some browsers support native playback of certain streaming formats. By default, we defer to the native players. However, this means that features specific to videojs-http-streaming will not be available.

Solution: use videojs-http-streaming based playback on those devices: https://github.com/videojs/http-streaming#overridenative

## MEDIA_ERR_DECODE error on Desktop Safari

This error may occur for a number of reasons, as it is particularly common for misconfigured content. One instance of misconfiguration is if the source manifest has `CLOSED-CAPTIONS=NONE` and an external text track is loaded into the player. Safari does not allow the inclusion any captions if the manifest indicates that captions will not be provided.

Solution: remove `CLOSED-CAPTIONS=NONE` from the manifest

