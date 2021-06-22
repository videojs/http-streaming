import { module, test } from 'qunit';
import document from 'global/document';
import {
  TEST_ONLY_SIMPLE_SELECTOR,
  simpleSelector,
  movingAverageBandwidthSelector,
  minRebufferMaxBandwidthSelector,
  lowestBitrateCompatibleVariantSelector
} from '../src/playlist-selectors';
import Config from '../src/config';

module('Playlist Selectors', {
  beforeEach(assert) {
    const video = document.createElement('video');

    this.vhs = {
      tech_: {
        el() {
          return video;
        }
      },
      playlists: {
        master: {
          playlists: []
        }
      }
    };
  },
  afterEach() {

  }
});

test('Exponential moving average has a configurable decay parameter', function(assert) {
  let playlist;
  const instantAverage = movingAverageBandwidthSelector(1.0);

  this.vhs.playlists.master.playlists = [
    { attributes: { BANDWIDTH: 1 } },
    { attributes: { BANDWIDTH: 50 } },
    { attributes: { BANDWIDTH: 100 } }
  ];
  this.vhs.systemBandwidth = 50 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = instantAverage.call(this.vhs);
  assert.equal(playlist.attributes.BANDWIDTH, 50, 'selected the middle playlist');

  this.vhs.systemBandwidth = 100 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = instantAverage.call(this.vhs);
  assert.equal(playlist.attributes.BANDWIDTH, 100, 'selected the top playlist');

  const fiftyPercentDecay = movingAverageBandwidthSelector(0.5);

  this.vhs.systemBandwidth = 100 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = fiftyPercentDecay.call(this.vhs);
  assert.equal(playlist.attributes.BANDWIDTH, 100, 'selected the top playlist');

  // average = decay * systemBandwidth + (1 - decay) * average
  // bandwidth = 0.5 * systemBandwidth + 0.5 * (100 * variance + 1)
  // 50 * variance + 1 = 0.5 * (systemBandwidth + (100 * variance + 1))
  // 2 * 50 * variance + 2 = systemBandwidth + (100 * variance + 1)
  // 100 * variance + 2 - (100 * variance + 1) = systemBandwidth
  // 1 = systemBandwidth
  this.vhs.systemBandwidth = 1;
  playlist = fiftyPercentDecay.call(this.vhs);
  assert.equal(playlist.attributes.BANDWIDTH, 50, 'selected the middle playlist');
});

test('Calling exponential moving average wont decay average unless new bandwidth data was provided', function(assert) {
  let playlist;
  const simSel = simpleSelector;
  const bandwidthAverages = [];

  const resetSimpleSelector = TEST_ONLY_SIMPLE_SELECTOR((...args) => {
    // second argument to simpleSelector is the average
    bandwidthAverages.push(args[1]);
    return simSel(...args);
  });

  this.vhs.playlists.master.playlists = [
    { attributes: { BANDWIDTH: 1 } },
    { attributes: { BANDWIDTH: 50 } },
    { attributes: { BANDWIDTH: 100 } }
  ];

  const fiftyPercentDecay = movingAverageBandwidthSelector(0.50);

  this.vhs.systemBandwidth = 50 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = fiftyPercentDecay.call(this.vhs);
  assert.equal(playlist.attributes.BANDWIDTH, 50, 'selected the middle playlist');

  this.vhs.systemBandwidth = 1000 * Config.BANDWIDTH_VARIANCE + 1;
  playlist = fiftyPercentDecay.call(this.vhs);
  assert.equal(playlist.attributes.BANDWIDTH, 100, 'selected the top playlist');

  // using the systemBandwidth values above, 50->1000
  // we decay into 1000 after 50 iterations
  let i = 50;

  while (i--) {
    playlist = fiftyPercentDecay.call(this.vhs);
  }

  assert.equal(
    bandwidthAverages[bandwidthAverages.length - 1],
    bandwidthAverages[1],
    'bandwidth should only change when we get new bandwidth data'
  );

  resetSimpleSelector();
});

test(
  'minRebufferMaxBandwidthSelector picks highest rendition without rebuffering',
  function(assert) {
    const master = this.vhs.playlists.master;
    const currentTime = 0;
    let bandwidth = 2000;
    const duration = 100;
    const segmentDuration = 10;
    let timeUntilRebuffer = 5;
    const currentTimeline = 0;
    const syncController = {
      getSyncPoint: (playlist) => playlist.syncPoint
    };

    const settings = () => {
      return {
        master,
        currentTime,
        bandwidth,
        duration,
        segmentDuration,
        timeUntilRebuffer,
        currentTimeline,
        syncController
      };
    };

    master.playlists = [
      { attributes: { BANDWIDTH: 100 }, syncPoint: false },
      { attributes: { BANDWIDTH: 500 }, syncPoint: false },
      { attributes: { BANDWIDTH: 1000 }, syncPoint: false },
      { attributes: { BANDWIDTH: 2000 }, syncPoint: true },
      { attributes: { BANDWIDTH: 5000 }, syncPoint: false }
    ];

    let result = minRebufferMaxBandwidthSelector(settings());

    assert.equal(result.playlist, master.playlists[1], 'selected the correct playlist');
    assert.equal(result.rebufferingImpact, 0, 'impact on rebuffering is 0');

    master.playlists = [
      { attributes: { BANDWIDTH: 100 }, syncPoint: false },
      { attributes: { BANDWIDTH: 500 }, syncPoint: false },
      { attributes: { BANDWIDTH: 1000 }, syncPoint: true },
      { attributes: { BANDWIDTH: 2000 }, syncPoint: true },
      { attributes: { BANDWIDTH: 5000 }, syncPoint: false }
    ];

    result = minRebufferMaxBandwidthSelector(settings());

    assert.equal(result.playlist, master.playlists[2], 'selected the corerct playlist');
    assert.equal(result.rebufferingImpact, 0, 'impact on rebuffering is 0');

    bandwidth = 500;
    timeUntilRebuffer = 3;

    result = minRebufferMaxBandwidthSelector(settings());

    assert.equal(result.playlist, master.playlists[0], 'selected the correct playlist');
    assert.equal(result.rebufferingImpact, 1, 'impact on rebuffering is 1 second');
  }
);

test(
  'lowestBitrateCompatibleVariantSelector picks lowest non-audio playlist',
  function(assert) {
    // Set this up out of order to make sure that the function sorts all
    // playlists by bandwidth
    this.vhs.playlists.master.playlists = [
      { attributes: { BANDWIDTH: 10, CODECS: 'mp4a.40.2' } },
      { attributes: { BANDWIDTH: 100, CODECS: 'mp4a.40.2, avc1.4d400d' } },
      { attributes: { BANDWIDTH: 50, CODECS: 'mp4a.40.2, avc1.4d400d' } }
    ];

    const expectedPlaylist = this.vhs.playlists.master.playlists[2];
    const testPlaylist = lowestBitrateCompatibleVariantSelector.call(this.vhs);

    assert.equal(
      testPlaylist, expectedPlaylist,
      'Selected lowest compatible playlist with video assets'
    );
  }
);

test(
  'lowestBitrateCompatibleVariantSelector return null if no video exists',
  function(assert) {
    this.vhs.playlists.master.playlists = [
      { attributes: { BANDWIDTH: 50, CODECS: 'mp4a.40.2' } },
      { attributes: { BANDWIDTH: 10, CODECS: 'mp4a.40.2' } },
      { attributes: { BANDWIDTH: 100, CODECS: 'mp4a.40.2' } }
    ];

    const testPlaylist = lowestBitrateCompatibleVariantSelector.call(this.vhs);

    assert.equal(
      testPlaylist, null,
      'Returned null playlist since no video assets exist'
    );
  }
);

test('simpleSelector switches up even without resolution information', function(assert) {
  const master = this.vhs.playlists.master;

  master.playlists = [
    { attributes: { BANDWIDTH: 100 } },
    { attributes: { BANDWIDTH: 1000 } }
  ];

  const selectedPlaylist = simpleSelector(master, 2000, 1, 1, false);

  assert.equal(selectedPlaylist, master.playlists[1], 'selected the correct playlist');
});

// A set of playlists that were defined using non-traditional encoding.
// The resolutions were selected using a per-title encoding technique
// that ensures the resolution maximizes quality at a given bitrate.
const trickyPlaylists = [
  { attributes: { BANDWIDTH: 2362080, RESOLUTION: { width: 1280, height: 720 } } },
  { attributes: { BANDWIDTH: 1390830, RESOLUTION: { width: 1280, height: 720 } } },
  { attributes: { BANDWIDTH: 866114, RESOLUTION: { width: 1024, height: 576 } } },
  { attributes: { BANDWIDTH: 573028, RESOLUTION: { width: 768, height: 432 } } },
  { attributes: { BANDWIDTH: 3482070, RESOLUTION: { width: 1920, height: 1080 } } },
  { attributes: { BANDWIDTH: 6151620, RESOLUTION: { width: 1920, height: 1080 } } }
];

test('simpleSelector limits using resolution information when it exists', function(assert) {
  const master = this.vhs.playlists.master;

  master.playlists = trickyPlaylists;

  const selectedPlaylist = simpleSelector(master, Config.INITIAL_BANDWIDTH, 444, 790, true);

  assert.equal(selectedPlaylist, master.playlists[3], 'selected the playlist with the lowest bandwidth higher than player resolution');
});

test('simpleSelector can not limit based on resolution information', function(assert) {
  const master = this.vhs.playlists.master;

  master.playlists = trickyPlaylists;

  const selectedPlaylist = simpleSelector(master, Config.INITIAL_BANDWIDTH, 444, 790, false);

  assert.equal(selectedPlaylist, master.playlists[4], 'selected a playlist based solely on bandwidth');
});

test('simpleSelector chooses between current audio playlists for audio only', function(assert) {
  const audioPlaylists = [
    {id: 'foo'},
    {id: 'bar', attributes: {BANDWIDTH: 534216}}
  ];
  const masterPlaylistController = {
    getAudioTrackPlaylists_: () => audioPlaylists
  };
  const master = this.vhs.playlists.master;

  master.mediaGroups = {
    AUDIO: {
      main: {
        en: {id: 'en', playlists: audioPlaylists}
      }
    }
  };

  const selectedPlaylist = simpleSelector(master, Config.INITIAL_BANDWIDTH, 444, 790, false, masterPlaylistController);

  assert.equal(selectedPlaylist, audioPlaylists[1], 'selected an audio based solely on bandwidth');
});
