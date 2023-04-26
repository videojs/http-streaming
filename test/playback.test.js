import QUnit from 'qunit';
import videojs from 'video.js';
import window from 'global/window';
import document from 'global/document';
import '../src/videojs-http-streaming';
import 'videojs-contrib-eme';
import dashManifestObject from '../scripts/dash-manifest-object.json';
import hlsManifestObject from '../scripts/hls-manifest-object.json';

const playFor = function(player, time, cb) {
  const targetTime = player.currentTime() + time;

  const checkPlayerTime = function() {
    window.setTimeout(() => {
      if (player.tech_ && player.tech_.el_ && player.currentTime() <= targetTime) {
        return checkPlayerTime();
      }
      cb();
    }, 100);
  };

  if (player.paused()) {
    const playPromise = player.play();

    // assert an error on playback failure or check player time after play has started.
    if (typeof playPromise !== 'undefined' && typeof playPromise.then === 'function') {
      playPromise.then(checkPlayerTime).catch((e) => {
        QUnit.assert.notOk(true, 'play promise failed with error', e);
      });
      return;
    }
  }

  checkPlayerTime();
};

QUnit.module('Playback', {
  beforeEach(assert) {
    assert.timeout(50000);

    this.fixture = document.getElementById('qunit-fixture');

    const done = assert.async();
    const video = document.createElement('video-js');

    // uncomment these lines when deugging
    // videojs.log.level('debug');
    // this.fixture.style.position = 'inherit';

    video.setAttribute('controls', '');
    video.setAttribute('muted', '');
    video.width = 600;
    video.height = 300;
    video.defaultPlaybackRate = 16;

    this.fixture.appendChild(video);
    this.player = videojs(video, {
      html5: {
        vhs: {
          overrideNative: true
        }
      }
    });

    this.player.eme();
    this.player.ready(done, true);
  },
  afterEach() {
    this.player.dispose();
  }
});

QUnit.test('Advanced Bip Bop default speed', function(assert) {
  const done = assert.async();

  this.player.defaultPlaybackRate(1);

  assert.expect(2);
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('Advanced Bip Bop', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('replay', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  // seek to near the end of the video
  playFor(player, 1, function() {
    player.currentTime(player.duration() - 1);
  });

  player.one('ended', function() {
    player.one('timeupdate', function() {
      assert.ok(player.currentTime() < 10, 'played');
      assert.equal(player.error(), null, 'has no player errors');

      done();
    });

    player.play();
  });

  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('playlist with fmp4 segments', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 6, function() {
    assert.ok(true, 'played for at least six seconds to hit the change in container format');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('playlist with fmp4 and ts segments', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 6, function() {
    assert.ok(true, 'played for at least six seconds to hit the change in container format');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://d2zihajmogu5jn.cloudfront.net/ts-fmp4/index.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('Advanced Bip Bop preload=none', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  player.preload('none');

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
    type: 'application/x-mpegURL'
  });
});

QUnit.test('Big Buck Bunny', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    done();
  });

  player.src({
    src: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    type: 'application/dash+xml'
  });
});

QUnit.test('Live DASH', function(assert) {
  const done = assert.async();
  const player = this.player;

  // must set playback rate to 1 so that the manifest will refresh during playback
  // and we'll be able to check whether seekable has updated
  player.defaultPlaybackRate(1);

  player.one('playing', function() {
    const firstSeekable = player.seekable();
    const firstSeekableEnd = firstSeekable.end(firstSeekable.length - 1);

    playFor(player, 5, function() {
      assert.ok(true, 'played for at least 5 seconds');
      assert.equal(player.error(), null, 'has no player errors');

      const seekable = player.seekable();
      const seekableEnd = seekable.end(seekable.length - 1);

      assert.notEqual(seekableEnd, firstSeekableEnd, 'the seekable end has changed');
      assert.ok(seekableEnd > firstSeekableEnd, 'seekable end has progressed');

      done();
    });
  });

  player.src({
    src: 'https://livesim.dashif.org/livesim/segtimeline_1/testpic_2s/Manifest.mpd',
    type: 'application/dash+xml'
  });

  player.play();
});

QUnit.test('Multiperiod dash works and can end', function(assert) {
  const done = assert.async();

  assert.expect(2);
  const player = this.player;

  playFor(player, 2, function() {
    assert.ok(true, 'played for at least two seconds');
    assert.equal(player.error(), null, 'has no player errors');

    player.one('ended', () => {
      assert.ok(true, 'triggered ended event');
      done();
    });

    player.currentTime(player.duration() - 0.5);

    done();
  });

  player.src({
    src: 'https://media.axprod.net/TestVectors/v7-Clear/Manifest_MultiPeriod.mpd',
    type: 'application/dash+xml'
  });
});

// These videos don't work on firefox consistenly. Seems like
// firefox has lower performance or more aggressive throttling than chrome
// which causes a variety of issues.
if (!videojs.browser.IS_FIREFOX) {
  QUnit.test('Big Buck Bunny audio only, groups & renditions same uri', function(assert) {
    const done = assert.async();

    assert.expect(2);
    const player = this.player;

    playFor(player, 2, function() {
      assert.ok(true, 'played for at least two seconds');
      assert.equal(player.error(), null, 'has no player errors');

      done();
    });

    player.src({
      src: 'https://d2zihajmogu5jn.cloudfront.net/audio-only-dupe-groups/prog_index.m3u8',
      type: 'application/x-mpegURL'
    });
  });

  QUnit.test('Big Buck Bunny Demuxed av, audio only rendition same as group', function(assert) {
    const done = assert.async();

    assert.expect(2);
    const player = this.player;

    playFor(player, 25, function() {
      assert.ok(true, 'played for at least 25 seconds');
      assert.equal(player.error(), null, 'has no player errors');

      done();
    });

    player.src({
      src: 'https://d2zihajmogu5jn.cloudfront.net/demuxed-ts-with-audio-only-rendition/master.m3u8',
      type: 'application/x-mpegURL'
    });
  });

  QUnit.test('DASH sidx', function(assert) {
    const done = assert.async();
    const player = this.player;

    playFor(player, 2, function() {
      assert.ok(true, 'played for at least two seconds');
      assert.equal(player.error(), null, 'no errors');

      player.one('ended', () => {
        assert.ok(true, 'triggered ended event');
        done();
      });

      // Firefox sometimes won't loop if seeking directly to the duration, or to too close
      // to the duration (e.g., 10ms from duration). 100ms seems to work.
      player.currentTime(player.duration() - 0.5);
    });

    player.src({
      src: 'https://dash.akamaized.net/dash264/TestCases/10a/1/iis_forest_short_poem_multi_lang_480p_single_adapt_aaclc_sidx.mpd',
      type: 'application/dash+xml'
    });
  });

  QUnit.test('DASH sidx with alt audio should end', function(assert) {
    const done = assert.async();
    const player = this.player;

    player.one('ended', () => {
      assert.ok(true, 'triggered ended');
      assert.equal(player.error(), null, 'no errors');
      done();
    });

    /* eslint-disable max-nested-callbacks */
    playFor(player, 1, () => {
      // switch audio playlist
      player.audioTracks()[1].enabled = true;

      playFor(player, 1, () => {
        player.currentTime(player.duration() - 5);
      });
    });
    /* eslint-enable max-nested-callbacks */

    player.src({
      src: 'https://dash.akamaized.net/dash264/TestCases/10a/1/iis_forest_short_poem_multi_lang_480p_single_adapt_aaclc_sidx.mpd',
      type: 'application/dash+xml'
    });
  });

  QUnit.test('DRM Dash', function(assert) {
    const done = assert.async();
    const player = this.player;

    player.one('ended', () => {
      assert.ok(true, 'triggered ended');
      assert.equal(player.error(), null, 'no errors');
      done();
    });

    /* eslint-disable max-nested-callbacks */
    playFor(player, 1, () => {
      // switch audio playlist
      player.audioTracks()[1].enabled = true;

      playFor(player, 1, () => {
        player.currentTime(player.duration() - 5);
      });
    });
    /* eslint-enable max-nested-callbacks */

    player.src({
      src: 'https://media.axprod.net/TestVectors/v7-MultiDRM-SingleKey/Manifest.mpd',
      type: 'application/dash+xml',
      keySystems: {
        'com.microsoft.playready': {
          url: 'https://drm-widevine-licensing.axtest.net/AcquireLicense',
          licenseHeaders: {
            'X-AxDRM-Message': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2ZXJzaW9uIjoxLCJjb21fa2V5X2lkIjoiYjMzNjRlYjUtNTFmNi00YWUzLThjOTgtMzNjZWQ1ZTMxYzc4IiwibWVzc2FnZSI6eyJ0eXBlIjoiZW50aXRsZW1lbnRfbWVzc2FnZSIsImtleXMiOlt7ImlkIjoiOWViNDA1MGQtZTQ0Yi00ODAyLTkzMmUtMjdkNzUwODNlMjY2IiwiZW5jcnlwdGVkX2tleSI6ImxLM09qSExZVzI0Y3Iya3RSNzRmbnc9PSJ9XX19.4lWwW46k-oWcah8oN18LPj5OLS5ZU-_AQv7fe0JhNjA'
          }
        },
        'com.widevine.alpha': {
          url: 'https://drm-widevine-licensing.axtest.net/AcquireLicense',
          licenseHeaders: {
            'X-AxDRM-Message': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2ZXJzaW9uIjoxLCJjb21fa2V5X2lkIjoiYjMzNjRlYjUtNTFmNi00YWUzLThjOTgtMzNjZWQ1ZTMxYzc4IiwibWVzc2FnZSI6eyJ0eXBlIjoiZW50aXRsZW1lbnRfbWVzc2FnZSIsImtleXMiOlt7ImlkIjoiOWViNDA1MGQtZTQ0Yi00ODAyLTkzMmUtMjdkNzUwODNlMjY2IiwiZW5jcnlwdGVkX2tleSI6ImxLM09qSExZVzI0Y3Iya3RSNzRmbnc9PSJ9XX19.4lWwW46k-oWcah8oN18LPj5OLS5ZU-_AQv7fe0JhNjA'
          }
        }
      }
    });
  });

  // TODO: why does this make the next test
  // throw an "The operation was aborted." on firefox
  QUnit.test('loops', function(assert) {
    const done = assert.async();
    const player = this.player;

    player.loop(true);
    player.src({
      src: 'https://s3.amazonaws.com/_bc_dml/example-content/bipbop-advanced/bipbop_16x9_variant.m3u8',
      type: 'application/x-mpegURL'
    });
    player.one('playing', function() {
      player.tech(true).vhs.mediaSource.addEventListener('sourceended', () => {
        player.tech(true).vhs.mediaSource.addEventListener('sourceopen', () => {
          assert.ok(true, 'sourceopen triggered after ending stream');
          done();
        });
      });

      // Firefox sometimes won't loop if seeking directly to the duration, or to too close
      // to the duration (e.g., 10ms from duration). 100ms seems to work.
      player.currentTime(player.duration() - 0.5);
    });
    player.play();
  });
}

QUnit.test('zero-length id3 segment', function(assert) {
  const done = assert.async();
  const player = this.player;

  player.src({
    src: '/test/manifests/zeroLength.m3u8',
    type: 'application/x-mpegURL'
  });

  player.on('loadedmetadata', function() {
    assert.equal(
      player.textTracks()[1].cues[0].text,
      'test zero length',
      'we got a cue point with the correct text value'
    );
    done();
  });
});

const hlsDataUri = 'data:application/x-mpegurl;charset=utf-8,%23EXTM3U%0D%0A%0D%0A%23EXT-X-MEDIA%3ATYPE%3DAUDIO%2CGROUP-ID%3D%22bipbop_audio%22%2CLANGUAGE%3D%22eng%22%2CNAME%3D%22BipBop%20Audio%201%22%2CAUTOSELECT%3DYES%2CDEFAULT%3DYES%0D%0A%23EXT-X-MEDIA%3ATYPE%3DAUDIO%2CGROUP-ID%3D%22bipbop_audio%22%2CLANGUAGE%3D%22eng%22%2CNAME%3D%22BipBop%20Audio%202%22%2CAUTOSELECT%3DNO%2CDEFAULT%3DNO%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Falternate_audio_aac_sinewave%2Fprog_index.m3u8%22%0D%0A%0D%0A%0D%0A%23EXT-X-MEDIA%3ATYPE%3DSUBTITLES%2CGROUP-ID%3D%22subs%22%2CNAME%3D%22English%22%2CDEFAULT%3DYES%2CAUTOSELECT%3DYES%2CFORCED%3DNO%2CLANGUAGE%3D%22en%22%2CCHARACTERISTICS%3D%22public.accessibility.transcribes-spoken-dialog%2C%20public.accessibility.describes-music-and-sound%22%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fsubtitles%2Feng%2Fprog_index.m3u8%22%0D%0A%23EXT-X-MEDIA%3ATYPE%3DSUBTITLES%2CGROUP-ID%3D%22subs%22%2CNAME%3D%22English%20%28Forced%29%22%2CDEFAULT%3DNO%2CAUTOSELECT%3DNO%2CFORCED%3DYES%2CLANGUAGE%3D%22en%22%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fsubtitles%2Feng_forced%2Fprog_index.m3u8%22%0D%0A%23EXT-X-MEDIA%3ATYPE%3DSUBTITLES%2CGROUP-ID%3D%22subs%22%2CNAME%3D%22Fran%C3%83%C2%A7ais%22%2CDEFAULT%3DNO%2CAUTOSELECT%3DYES%2CFORCED%3DNO%2CLANGUAGE%3D%22fr%22%2CCHARACTERISTICS%3D%22public.accessibility.transcribes-spoken-dialog%2C%20public.accessibility.describes-music-and-sound%22%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fsubtitles%2Ffra%2Fprog_index.m3u8%22%0D%0A%23EXT-X-MEDIA%3ATYPE%3DSUBTITLES%2CGROUP-ID%3D%22subs%22%2CNAME%3D%22Fran%C3%83%C2%A7ais%20%28Forced%29%22%2CDEFAULT%3DNO%2CAUTOSELECT%3DNO%2CFORCED%3DYES%2CLANGUAGE%3D%22fr%22%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fsubtitles%2Ffra_forced%2Fprog_index.m3u8%22%0D%0A%23EXT-X-MEDIA%3ATYPE%3DSUBTITLES%2CGROUP-ID%3D%22subs%22%2CNAME%3D%22Espa%C3%83%C2%B1ol%22%2CDEFAULT%3DNO%2CAUTOSELECT%3DYES%2CFORCED%3DNO%2CLANGUAGE%3D%22es%22%2CCHARACTERISTICS%3D%22public.accessibility.transcribes-spoken-dialog%2C%20public.accessibility.describes-music-and-sound%22%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fsubtitles%2Fspa%2Fprog_index.m3u8%22%0D%0A%23EXT-X-MEDIA%3ATYPE%3DSUBTITLES%2CGROUP-ID%3D%22subs%22%2CNAME%3D%22Espa%C3%83%C2%B1ol%20%28Forced%29%22%2CDEFAULT%3DNO%2CAUTOSELECT%3DNO%2CFORCED%3DYES%2CLANGUAGE%3D%22es%22%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fsubtitles%2Fspa_forced%2Fprog_index.m3u8%22%0D%0A%23EXT-X-MEDIA%3ATYPE%3DSUBTITLES%2CGROUP-ID%3D%22subs%22%2CNAME%3D%22%C3%A6%C2%97%C2%A5%C3%A6%C2%9C%C2%AC%C3%A8%C2%AA%C2%9E%22%2CDEFAULT%3DNO%2CAUTOSELECT%3DYES%2CFORCED%3DNO%2CLANGUAGE%3D%22ja%22%2CCHARACTERISTICS%3D%22public.accessibility.transcribes-spoken-dialog%2C%20public.accessibility.describes-music-and-sound%22%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fsubtitles%2Fjpn%2Fprog_index.m3u8%22%0D%0A%23EXT-X-MEDIA%3ATYPE%3DSUBTITLES%2CGROUP-ID%3D%22subs%22%2CNAME%3D%22%C3%A6%C2%97%C2%A5%C3%A6%C2%9C%C2%AC%C3%A8%C2%AA%C2%9E%20%28Forced%29%22%2CDEFAULT%3DNO%2CAUTOSELECT%3DNO%2CFORCED%3DYES%2CLANGUAGE%3D%22ja%22%2CURI%3D%22https%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fsubtitles%2Fjpn_forced%2Fprog_index.m3u8%22%0D%0A%0D%0A%0D%0A%23EXT-X-STREAM-INF%3ABANDWIDTH%3D263851%2CCODECS%3D%22mp4a.40.2%2C%20avc1.4d400d%22%2CRESOLUTION%3D416x234%2CAUDIO%3D%22bipbop_audio%22%2CSUBTITLES%3D%22subs%22%0D%0Ahttps%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fgear1%2Fprog_index.m3u8%0D%0A%0D%0A%23EXT-X-STREAM-INF%3ABANDWIDTH%3D577610%2CCODECS%3D%22mp4a.40.2%2C%20avc1.4d401e%22%2CRESOLUTION%3D640x360%2CAUDIO%3D%22bipbop_audio%22%2CSUBTITLES%3D%22subs%22%0D%0Ahttps%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fgear2%2Fprog_index.m3u8%0D%0A%0D%0A%23EXT-X-STREAM-INF%3ABANDWIDTH%3D915905%2CCODECS%3D%22mp4a.40.2%2C%20avc1.4d401f%22%2CRESOLUTION%3D960x540%2CAUDIO%3D%22bipbop_audio%22%2CSUBTITLES%3D%22subs%22%0D%0Ahttps%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fgear3%2Fprog_index.m3u8%0D%0A%0D%0A%23EXT-X-STREAM-INF%3ABANDWIDTH%3D1030138%2CCODECS%3D%22mp4a.40.2%2C%20avc1.4d401f%22%2CRESOLUTION%3D1280x720%2CAUDIO%3D%22bipbop_audio%22%2CSUBTITLES%3D%22subs%22%0D%0Ahttps%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fgear4%2Fprog_index.m3u8%0D%0A%0D%0A%23EXT-X-STREAM-INF%3ABANDWIDTH%3D1924009%2CCODECS%3D%22mp4a.40.2%2C%20avc1.4d401f%22%2CRESOLUTION%3D1920x1080%2CAUDIO%3D%22bipbop_audio%22%2CSUBTITLES%3D%22subs%22%0D%0Ahttps%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fgear5%2Fprog_index.m3u8%0D%0A%0D%0A%23EXT-X-STREAM-INF%3ABANDWIDTH%3D41457%2CCODECS%3D%22mp4a.40.2%22%2CAUDIO%3D%22bipbop_audio%22%2CSUBTITLES%3D%22subs%22%0D%0Ahttps%3A%2F%2Fd2zihajmogu5jn.cloudfront.net%2Fbipbop-advanced%2Fgear0%2Fprog_index.m3u8';

QUnit.test('hls data uri', function(assert) {
  const done = assert.async();
  const player = this.player;

  player.src({
    src: hlsDataUri,
    type: 'application/x-mpegURL'
  });

  playFor(player, 3, () => {
    // switch audio playlist
    player.audioTracks()[1].enabled = true;
    assert.ok(true, 'played muxed audio');

    playFor(player, 3, () => {
      assert.ok(true, 'played alternative audio');
      done();
    });
  });
});

const dashDataUri = 'data:application/dash+xml;charset=utf-8,%3CMPD%20mediaPresentationDuration=%22PT634.566S%22%20minBufferTime=%22PT2.00S%22%20profiles=%22urn:hbbtv:dash:profile:isoff-live:2012,urn:mpeg:dash:profile:isoff-live:2011%22%20type=%22static%22%20xmlns=%22urn:mpeg:dash:schema:mpd:2011%22%20xmlns:xsi=%22http://www.w3.org/2001/XMLSchema-instance%22%20xsi:schemaLocation=%22urn:mpeg:DASH:schema:MPD:2011%20DASH-MPD.xsd%22%3E%20%3CBaseURL%3Ehttps://dash.akamaized.net/akamai/bbb_30fps/%3C/BaseURL%3E%20%3CPeriod%3E%20%20%3CAdaptationSet%20mimeType=%22video/mp4%22%20contentType=%22video%22%20subsegmentAlignment=%22true%22%20subsegmentStartsWithSAP=%221%22%20par=%2216:9%22%3E%20%20%20%3CSegmentTemplate%20duration=%22120%22%20timescale=%2230%22%20media=%22$RepresentationID$/$RepresentationID$_$Number$.m4v%22%20startNumber=%221%22%20initialization=%22$RepresentationID$/$RepresentationID$_0.m4v%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_1024x576_2500k%22%20codecs=%22avc1.64001f%22%20bandwidth=%223134488%22%20width=%221024%22%20height=%22576%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_1280x720_4000k%22%20codecs=%22avc1.64001f%22%20bandwidth=%224952892%22%20width=%221280%22%20height=%22720%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_1920x1080_8000k%22%20codecs=%22avc1.640028%22%20bandwidth=%229914554%22%20width=%221920%22%20height=%221080%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_320x180_200k%22%20codecs=%22avc1.64000d%22%20bandwidth=%22254320%22%20width=%22320%22%20height=%22180%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_320x180_400k%22%20codecs=%22avc1.64000d%22%20bandwidth=%22507246%22%20width=%22320%22%20height=%22180%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_480x270_600k%22%20codecs=%22avc1.640015%22%20bandwidth=%22759798%22%20width=%22480%22%20height=%22270%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_640x360_1000k%22%20codecs=%22avc1.64001e%22%20bandwidth=%221254758%22%20width=%22640%22%20height=%22360%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_640x360_800k%22%20codecs=%22avc1.64001e%22%20bandwidth=%221013310%22%20width=%22640%22%20height=%22360%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_768x432_1500k%22%20codecs=%22avc1.64001e%22%20bandwidth=%221883700%22%20width=%22768%22%20height=%22432%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_30fps_3840x2160_12000k%22%20codecs=%22avc1.640033%22%20bandwidth=%2214931538%22%20width=%223840%22%20height=%222160%22%20frameRate=%2230%22%20sar=%221:1%22%20scanType=%22progressive%22/%3E%20%20%3C/AdaptationSet%3E%20%20%3CAdaptationSet%20mimeType=%22audio/mp4%22%20contentType=%22audio%22%20subsegmentAlignment=%22true%22%20subsegmentStartsWithSAP=%221%22%3E%20%20%20%3CAccessibility%20schemeIdUri=%22urn:tva:metadata:cs:AudioPurposeCS:2007%22%20value=%226%22/%3E%20%20%20%3CRole%20schemeIdUri=%22urn:mpeg:dash:role:2011%22%20value=%22main%22/%3E%20%20%20%3CSegmentTemplate%20duration=%22192512%22%20timescale=%2248000%22%20media=%22$RepresentationID$/$RepresentationID$_$Number$.m4a%22%20startNumber=%221%22%20initialization=%22$RepresentationID$/$RepresentationID$_0.m4a%22/%3E%20%20%20%3CRepresentation%20id=%22bbb_a64k%22%20codecs=%22mp4a.40.5%22%20bandwidth=%2267071%22%20audioSamplingRate=%2248000%22%3E%20%20%20%20%3CAudioChannelConfiguration%20schemeIdUri=%22urn:mpeg:dash:23003:3:audio_channel_configuration:2011%22%20value=%222%22/%3E%20%20%20%3C/Representation%3E%20%20%3C/AdaptationSet%3E%20%3C/Period%3E%3C/MPD%3E';

QUnit.test('dash data uri', function(assert) {
  const done = assert.async();
  const player = this.player;

  player.src({
    src: dashDataUri,
    type: 'application/dash+xml'
  });

  playFor(player, 3, () => {
    // switch audio playlist
    assert.ok(true, 'played for 3 seconds');
    done();
  });
});

QUnit.test('dash manifest object', function(assert) {
  const done = assert.async();
  const player = this.player;

  player.src({
    src: `data:application/vnd.videojs.vhs+json,${JSON.stringify(dashManifestObject)}`,
    type: 'application/vnd.videojs.vhs+json'
  });

  playFor(player, 3, () => {
    assert.ok(true, 'played for 3 seconds');
    done();
  });
});

QUnit.test('hls manifest object', function(assert) {
  const done = assert.async();
  const player = this.player;

  player.src({
    src: `data:application/vnd.videojs.vhs+json,${JSON.stringify(hlsManifestObject)}`,
    type: 'application/vnd.videojs.vhs+json'
  });

  playFor(player, 3, () => {
    assert.ok(true, 'played for 3 seconds');
    done();
  });
});
