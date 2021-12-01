# Migration Guide from 2.x to 3.x

## All `hls-` events were removed
All `hls-` prefixed events were removed. If you were listening to any of those events, you should switch the prefix from `hls-` to `vhs-`.
For example, if you were listening to `hls-gap-skip`:
```js
player.tech().on('hls-gap-skip', () => {
  console.log('a gap has been skipped');
});
```
you should now listening to `vhs-gap-skip`:
```js
player.tech().on('vhs-gap-skip', () => {
  console.log('a gap has been skipped');
});
```

See [VHS Usage Events](../#vhs-usage-events) for more information on these events.

## player properties for accessing VHS
All player level properties to access VHS have been removed.

If you were using any of the following:
* `player.vhs`
* `player.hls`
* `player.dash`

You should switch that to accessing the `vhs` property on the tech like so:
```js
player.tech().vhs
```
