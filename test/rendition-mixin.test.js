import QUnit from 'qunit';
import { createPlaylistID } from '../src/manifest';
import RenditionMixin from '../src/rendition-mixin.js';
import videojs from 'video.js';

const makeMockPlaylist = function(options) {
  options = options || {};

  const playlist = {
    segments: [],
    attributes: {}
  };

  playlist.attributes.BANDWIDTH = options.bandwidth;

  if ('width' in options) {
    playlist.attributes.RESOLUTION = playlist.attributes.RESOLUTION || {};

    playlist.attributes.RESOLUTION.width = options.width;
  }

  if ('height' in options) {
    playlist.attributes.RESOLUTION = playlist.attributes.RESOLUTION || {};

    playlist.attributes.RESOLUTION.height = options.height;
  }

  if ('excludeUntil' in options) {
    playlist.excludeUntil = options.excludeUntil;
  }

  if ('uri' in options) {
    playlist.uri = options.uri;
  }

  if ('disabled' in options) {
    playlist.disabled = options.disabled;
  }

  return playlist;
};

const makeMockVhsHandler = function(playlistOptions, handlerOptions) {
  const mcp = {
    fastQualityChange_: () => {
      mcp.fastQualityChange_.calls++;
    },
    smoothQualityChange_: () => {
      mcp.smoothQualityChange_.calls++;
    }
  };

  mcp.fastQualityChange_.calls = 0;
  mcp.smoothQualityChange_.calls = 0;

  const vhsHandler = {
    masterPlaylistController_: mcp,
    options_: handlerOptions || {}
  };

  vhsHandler.playlists = new videojs.EventTarget();
  vhsHandler.playlists.master = { playlists: [] };

  playlistOptions.forEach((playlist, i) => {
    vhsHandler.playlists.master.playlists[i] = makeMockPlaylist(playlist);

    if (playlist.uri) {
      const id = createPlaylistID(i, playlist.uri);

      vhsHandler.playlists.master.playlists[i].id = id;
      vhsHandler.playlists.master.playlists[id] =
        vhsHandler.playlists.master.playlists[i];
    }
  });

  return vhsHandler;
};

QUnit.module('Rendition Selector API Mixin');

QUnit.test('adds the representations API to VhsHandler', function(assert) {
  const vhsHandler = makeMockVhsHandler([
    {}
  ]);

  RenditionMixin(vhsHandler);

  assert.equal(
    typeof vhsHandler.representations, 'function',
    'added the representations API'
  );
});

QUnit.test('returns proper number of representations', function(assert) {
  const vhsHandler = makeMockVhsHandler([
    {}, {}, {}
  ]);

  RenditionMixin(vhsHandler);

  const renditions = vhsHandler.representations();

  assert.equal(renditions.length, 3, 'number of renditions is 3');
});

QUnit.test('returns representations in playlist order', function(assert) {
  const vhsHandler = makeMockVhsHandler([
    {
      bandwidth: 10
    },
    {
      bandwidth: 20
    },
    {
      bandwidth: 30
    }
  ]);

  RenditionMixin(vhsHandler);

  const renditions = vhsHandler.representations();

  assert.equal(renditions[0].bandwidth, 10, 'rendition has bandwidth 10');
  assert.equal(renditions[1].bandwidth, 20, 'rendition has bandwidth 20');
  assert.equal(renditions[2].bandwidth, 30, 'rendition has bandwidth 30');
});

QUnit.test('returns representations with width and height if present', function(assert) {
  const vhsHandler = makeMockVhsHandler([
    {
      bandwidth: 10,
      width: 100,
      height: 200
    },
    {
      bandwidth: 20,
      width: 500,
      height: 600
    },
    {
      bandwidth: 30
    }
  ]);

  RenditionMixin(vhsHandler);

  const renditions = vhsHandler.representations();

  assert.equal(renditions[0].width, 100, 'rendition has a width of 100');
  assert.equal(renditions[0].height, 200, 'rendition has a height of 200');
  assert.equal(renditions[1].width, 500, 'rendition has a width of 500');
  assert.equal(renditions[1].height, 600, 'rendition has a height of 600');
  assert.equal(renditions[2].width, undefined, 'rendition has a width of undefined');
  assert.equal(renditions[2].height, undefined, 'rendition has a height of undefined');
});

QUnit.test(
  'incompatible playlists are not included in the representations list',
  function(assert) {
    const vhsHandler = makeMockVhsHandler([
      {
        bandwidth: 0,
        excludeUntil: Infinity,
        uri: 'media0.m3u8'
      },
      {
        bandwidth: 0,
        excludeUntil: 0,
        uri: 'media1.m3u8'
      },
      {
        bandwidth: 0,
        excludeUntil: Date.now() + 999999,
        uri: 'media2.m3u8'
      },
      {
        bandwidth: 0,
        excludeUntil: 1,
        uri: 'media3.m3u8'
      },
      {
        bandwidth: 0,
        uri: 'media4.m3u8'
      }
    ]);

    RenditionMixin(vhsHandler);

    const renditions = vhsHandler.representations();

    assert.equal(renditions.length, 4, 'incompatible rendition not added');
    assert.equal(renditions[0].id, '1-media1.m3u8', 'rendition is enabled');
    assert.equal(renditions[1].id, '2-media2.m3u8', 'rendition is enabled');
    assert.equal(renditions[2].id, '3-media3.m3u8', 'rendition is enabled');
    assert.equal(renditions[3].id, '4-media4.m3u8', 'rendition is enabled');
  }
);

QUnit.test(
  'setting a representation to disabled sets disabled to true',
  function(assert) {
    let renditiondisabled = 0;
    const vhsHandler = makeMockVhsHandler([
      {
        bandwidth: 0,
        excludeUntil: 0,
        uri: 'media0.m3u8'
      },
      {
        bandwidth: 0,
        excludeUntil: 0,
        uri: 'media1.m3u8'
      }
    ]);
    const playlists = vhsHandler.playlists.master.playlists;

    vhsHandler.playlists.on('renditiondisabled', function() {
      renditiondisabled++;
    });

    RenditionMixin(vhsHandler);

    const renditions = vhsHandler.representations();

    assert.equal(renditiondisabled, 0, 'renditiondisabled event has not been triggered');
    renditions[0].enabled(false);

    assert.equal(renditiondisabled, 1, 'renditiondisabled event has been triggered');
    assert.equal(playlists[0].disabled, true, 'rendition has been disabled');
    assert.equal(playlists[1].disabled, undefined, 'rendition has not been disabled');
    assert.equal(
      playlists[0].excludeUntil, 0,
      'excludeUntil not touched when disabling a rendition'
    );
    assert.equal(
      playlists[1].excludeUntil, 0,
      'excludeUntil not touched when disabling a rendition'
    );
  }
);

QUnit.test(
  'changing the enabled state of a representation calls fastQualityChange_ by default',
  function(assert) {
    let renditionEnabledEvents = 0;
    const vhsHandler = makeMockVhsHandler([
      {
        bandwidth: 0,
        disabled: true,
        uri: 'media0.m3u8'
      },
      {
        bandwidth: 0,
        uri: 'media1.m3u8'
      }
    ]);
    const mpc = vhsHandler.masterPlaylistController_;

    vhsHandler.playlists.on('renditionenabled', function() {
      renditionEnabledEvents++;
    });

    RenditionMixin(vhsHandler);

    const renditions = vhsHandler.representations();

    assert.equal(mpc.fastQualityChange_.calls, 0, 'fastQualityChange_ was never called');
    assert.equal(
      renditionEnabledEvents, 0,
      'renditionenabled event has not been triggered'
    );

    renditions[0].enabled(true);

    assert.equal(mpc.fastQualityChange_.calls, 1, 'fastQualityChange_ was called once');
    assert.equal(
      renditionEnabledEvents, 1,
      'renditionenabled event has been triggered once'
    );

    renditions[1].enabled(false);

    assert.equal(mpc.fastQualityChange_.calls, 2, 'fastQualityChange_ was called twice');
  }
);

QUnit.test(
  'changing the enabled state of a representation calls smoothQualityChange_ ' +
  'when the flag is set',
  function(assert) {
    let renditionEnabledEvents = 0;
    const vhsHandler = makeMockVhsHandler([
      {
        bandwidth: 0,
        disabled: true,
        uri: 'media0.m3u8'
      },
      {
        bandwidth: 0,
        uri: 'media1.m3u8'
      }
    ], {
      smoothQualityChange: true
    });
    const mpc = vhsHandler.masterPlaylistController_;

    vhsHandler.playlists.on('renditionenabled', function() {
      renditionEnabledEvents++;
    });

    RenditionMixin(vhsHandler);

    const renditions = vhsHandler.representations();

    assert.equal(mpc.smoothQualityChange_.calls, 0, 'smoothQualityChange_ was never called');
    assert.equal(
      renditionEnabledEvents, 0,
      'renditionenabled event has not been triggered'
    );

    renditions[0].enabled(true);

    assert.equal(mpc.smoothQualityChange_.calls, 1, 'smoothQualityChange_ was called once');
    assert.equal(
      renditionEnabledEvents, 1,
      'renditionenabled event has been triggered once'
    );

    renditions[1].enabled(false);

    assert.equal(mpc.smoothQualityChange_.calls, 2, 'smoothQualityChange_ was called twice');
  }
);
