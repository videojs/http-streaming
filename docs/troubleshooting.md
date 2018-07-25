# Troubleshooting Guide

## Other troubleshooting guides

[mux.js](https://github.com/videojs/mux.js/blob/master/docs/troubleshooting.md)

## Table of Contents
- [Content plays on Mac but not on Windows](content-plays-on-mac-but-not-windows)
- ["No compatible source was found" on IE11 Win 7](no-compatible-source-was-found-on-ie11-win-7)

## Content plays on Mac but not Windows

Some browsers may not be able to play audio sample rates higher than 48 kHz. See https://docs.microsoft.com/en-gb/windows/desktop/medfound/aac-decoder#format-constraints

Potential solution: re-encode with a Windows supported audio sample rate

## "No compatible source was found" on IE11 Win 7

videojs-http-streaming does not support Flash HLS playback (like the videojs-contrib-hls plugin did)

Solution: please use the FlasHLS source handler https://github.com/brightcove/videojs-flashls-source-handler
