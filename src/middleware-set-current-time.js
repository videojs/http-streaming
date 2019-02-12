import videojs from 'video.js';

// since VHS handles HLS and DASH (and in the future, more types), use * to capture all
videojs.use('*', (player) => {
  return {
    setSource(srcObj, next) {
      // pass null as the first argument to indicate that the source is not rejected
      next(null, srcObj);
    },

    // VHS needs to know when seeks happen. For external seeks (generated at the player
    // level), this middleware will capture the action. For internal seeks (generated at
    // the tech level), we use a wrapped function so that we can handle it on our own
    // (specified elsewhere).
    setCurrentTime(time) {
      if (player.vhs &&
          player.currentSource().src === player.vhs.source_.src) {
        player.vhs.setCurrentTime(time);
      }

      return time;
    },

    // Sync VHS after play requests.
    // This specifically handles replay where the order of actions is
    // play, video element will seek to 0 (skipping the setCurrentTime middleware)
    // then triggers a play event.
    play() {
      if (player.vhs &&
          player.currentSource().src === player.vhs.source_.src) {
        player.vhs.setCurrentTime(player.tech_.currentTime());
      }
    }
  };
});
