import QUnit from 'qunit';
import {
  useFakeEnvironment
} from './test-helpers.js';
import * as MediaGroups from '../src/media-groups';
import PlaylistLoader from '../src/playlist-loader';
import DashPlaylistLoader from '../src/dash-playlist-loader';
import noop from '../src/util/noop';
import { parseManifest } from '../src/manifest.js';
import manifests from 'create-test-data!manifests';

const sharedHooks = {
  beforeEach(assert) {
    this.env = useFakeEnvironment(assert);
    this.clock = this.env.clock;
    this.requests = this.env.requests;
  },
  afterEach(assert) {
    this.env.restore();
  }
};

QUnit.module('MediaGroups', function() {
  QUnit.module('general', sharedHooks);

  QUnit.test(
    'createMediaTypes creates skeleton object for all supported media groups',
    function(assert) {
      const noopToString = noop.toString();
      const result = MediaGroups.createMediaTypes();

      assert.ok(result.AUDIO, 'created AUDIO media group object');
      assert.deepEqual(
        result.AUDIO.groups, {},
        'created empty object for AUDIO groups'
      );
      assert.deepEqual(
        result.AUDIO.tracks, {},
        'created empty object for AUDIO tracks'
      );
      assert.equal(
        result.AUDIO.activePlaylistLoader, null,
        'AUDIO activePlaylistLoader is null'
      );
      assert.equal(
        result.AUDIO.activeGroup.toString(), noopToString,
        'created noop function for AUDIO activeGroup'
      );
      assert.equal(
        result.AUDIO.activeTrack.toString(), noopToString,
        'created noop function for AUDIO activeTrack'
      );
      assert.equal(
        result.AUDIO.onGroupChanged.toString(), noopToString,
        'created noop function for AUDIO onGroupChanged'
      );
      assert.equal(
        result.AUDIO.onTrackChanged.toString(), noopToString,
        'created noop function for AUDIO onTrackChanged'
      );

      assert.ok(result.SUBTITLES, 'created SUBTITLES media group object');
      assert.deepEqual(
        result.SUBTITLES.groups, {},
        'created empty object for SUBTITLES groups'
      );
      assert.deepEqual(
        result.SUBTITLES.tracks, {},
        'created empty object for SUBTITLES tracks'
      );
      assert.equal(
        result.SUBTITLES.activePlaylistLoader, null,
        'SUBTITLES activePlaylistLoader is null'
      );
      assert.equal(
        result.SUBTITLES.activeGroup.toString(), noopToString,
        'created noop function for SUBTITLES activeGroup'
      );
      assert.equal(
        result.SUBTITLES.activeTrack.toString(), noopToString,
        'created noop function for SUBTITLES activeTrack'
      );
      assert.equal(
        result.SUBTITLES.onGroupChanged.toString(), noopToString,
        'created noop function for SUBTITLES onGroupChanged'
      );
      assert.equal(
        result.SUBTITLES.onTrackChanged.toString(), noopToString,
        'created noop function for SUBTITLES onTrackChanged'
      );

      assert.ok(result['CLOSED-CAPTIONS'], 'created CLOSED-CAPTIONS media group object');
      assert.deepEqual(
        result['CLOSED-CAPTIONS'].groups, {},
        'created empty object for CLOSED-CAPTIONS groups'
      );
      assert.deepEqual(
        result['CLOSED-CAPTIONS'].tracks, {},
        'created empty object for CLOSED-CAPTIONS tracks'
      );
      assert.equal(
        result['CLOSED-CAPTIONS'].activePlaylistLoader, null,
        'CLOSED-CAPTIONS activePlaylistLoader is null'
      );
      assert.equal(
        result['CLOSED-CAPTIONS'].activeGroup.toString(), noopToString,
        'created noop function for CLOSED-CAPTIONS activeGroup'
      );
      assert.equal(
        result['CLOSED-CAPTIONS'].activeTrack.toString(), noopToString,
        'created noop function for CLOSED-CAPTIONS activeTrack'
      );
      assert.equal(
        result['CLOSED-CAPTIONS'].onGroupChanged.toString(), noopToString,
        'created noop function for CLOSED-CAPTIONS onGroupChanged'
      );
      assert.equal(
        result['CLOSED-CAPTIONS'].onTrackChanged.toString(), noopToString,
        'created noop function for CLOSED-CAPTIONS onTrackChanged'
      );
    }
  );

  QUnit.test(
    'stopLoaders pauses segment loader and playlist loader when available',
    function(assert) {
      let segmentLoaderAbortCalls = 0;
      let segmentLoaderPauseCalls = 0;
      let playlistLoaderPauseCalls = 0;

      const segmentLoader = {
        abort: () => segmentLoaderAbortCalls++,
        pause: () => segmentLoaderPauseCalls++
      };
      const playlistLoader = {
        pause: () => playlistLoaderPauseCalls++
      };
      const mediaType = { activePlaylistLoader: null };

      MediaGroups.stopLoaders(segmentLoader, mediaType);

      assert.equal(segmentLoaderAbortCalls, 1, 'aborted segment loader');
      assert.equal(segmentLoaderPauseCalls, 1, 'paused segment loader');
      assert.equal(playlistLoaderPauseCalls, 0, 'no pause when no active playlist loader');

      mediaType.activePlaylistLoader = playlistLoader;

      MediaGroups.stopLoaders(segmentLoader, mediaType);

      assert.equal(segmentLoaderAbortCalls, 2, 'aborted segment loader');
      assert.equal(segmentLoaderPauseCalls, 2, 'paused segment loader');
      assert.equal(playlistLoaderPauseCalls, 1, 'pause active playlist loader');
      assert.equal(
        mediaType.activePlaylistLoader, null,
        'clears active playlist loader for media group'
      );
    }
  );

  QUnit.test(
    'startLoaders starts playlist loader when appropriate',
    function(assert) {
      let playlistLoaderLoadCalls = 0;
      const media = null;

      const playlistLoader = {
        load: () => playlistLoaderLoadCalls++,
        media: () => media
      };
      const mediaType = { activePlaylistLoader: null };

      MediaGroups.startLoaders(playlistLoader, mediaType);

      assert.equal(playlistLoaderLoadCalls, 1, 'called load on playlist loader');
      assert.strictEqual(
        mediaType.activePlaylistLoader, playlistLoader,
        'set active playlist loader for media group'
      );
    }
  );

  QUnit.test('activeTrack returns the correct audio track', function(assert) {
    const type = 'AUDIO';
    const settings = { mediaTypes: MediaGroups.createMediaTypes() };
    const tracks = settings.mediaTypes[type].tracks;
    const activeTrack = MediaGroups.activeTrack[type](type, settings);

    assert.equal(activeTrack(), null, 'returns null when empty track list');

    tracks.track1 = { id: 'track1', enabled: false };
    tracks.track2 = { id: 'track2', enabled: false };
    tracks.track3 = { id: 'track3', enabled: false };

    assert.equal(activeTrack(), null, 'returns null when no active tracks');

    tracks.track3.enabled = true;

    assert.strictEqual(activeTrack(), tracks.track3, 'returns active track');

    tracks.track1.enabled = true;

    // video.js treats the first enabled track in the track list as the active track
    // so we want the same behavior here
    assert.strictEqual(activeTrack(), tracks.track1, 'returns first active track');

    tracks.track1.enabled = false;

    assert.strictEqual(activeTrack(), tracks.track3, 'returns active track');

    tracks.track3.enabled = false;

    assert.equal(activeTrack(), null, 'returns null when no active tracks');
  });

  QUnit.test('activeTrack returns the correct subtitle track', function(assert) {
    const type = 'SUBTITLES';
    const settings = { mediaTypes: MediaGroups.createMediaTypes() };
    const tracks = settings.mediaTypes[type].tracks;
    const activeTrack = MediaGroups.activeTrack[type](type, settings);

    assert.equal(activeTrack(), null, 'returns null when empty track list');

    tracks.track1 = { id: 'track1', mode: 'disabled' };
    tracks.track2 = { id: 'track2', mode: 'disabled' };
    tracks.track3 = { id: 'track3', mode: 'disabled' };

    assert.equal(activeTrack(), null, 'returns null when no active tracks');

    tracks.track3.mode = 'showing';

    assert.strictEqual(activeTrack(), tracks.track3, 'returns active track');

    tracks.track1.mode = 'showing';

    // video.js treats the first enabled track in the track list as the active track
    // so we want the same behavior here
    assert.strictEqual(activeTrack(), tracks.track1, 'returns first active track');

    tracks.track1.mode = 'disabled';

    assert.strictEqual(activeTrack(), tracks.track3, 'returns active track');

    tracks.track2.mode = 'hidden';
    tracks.track3.mode = 'disabled';

    assert.equal(activeTrack(), tracks.track2, 'returns hidden active track');

    tracks.track2.mode = 'disabled';

    assert.equal(activeTrack(), null, 'returns null when no active tracks');
  });

  ['AUDIO', 'SUBTITLES'].forEach(function(groupType) {
    QUnit.module(`${groupType} activeGroup `, {
      beforeEach(assert) {
        sharedHooks.beforeEach.call(this, assert);

        this.media = null;

        this.settings = {
          mediaTypes: MediaGroups.createMediaTypes(),
          mainPlaylistLoader: {
            media: () => this.media
          }
        };

        this.groups = this.settings.mediaTypes[groupType].groups;
        this.tracks = this.settings.mediaTypes[groupType].tracks;
        this.activeTrack = MediaGroups.activeTrack[groupType](groupType, this.settings);
        this.activeGroup = MediaGroups.activeGroup(groupType, this.settings);
      },
      afterEach(assert) {
        sharedHooks.afterEach.call(this, assert);
      }
    });

    QUnit.test('activeGroup without media', function(assert) {
      assert.equal(this.activeGroup(), null, 'no media or groups');

      this.groups.foo = [{ id: 'en' }, { id: 'fr' }];
      this.groups.bar = [{ id: 'en' }, { id: 'fr' }];

      assert.equal(this.activeGroup(), null, 'no media, with groups');
    });

    QUnit.test('activeGroup with media but no group', function(assert) {
      this.media = {attributes: {}};
      this.groups.main = [{ id: 'en' }, { id: 'fr' }];

      assert.equal(this.activeGroup(), this.groups.main, 'main when there is a main');

      delete this.groups.main;
      this.groups.foo = [{id: 'en'}, {id: 'fr'}];

      assert.equal(this.activeGroup(), this.groups.foo, 'the only group if there is only one');

      this.groups.foo = [{id: 'en'}, {id: 'fr'}];
      this.groups.bar = [{id: 'en'}, {id: 'fr'}];

      assert.equal(this.activeGroup(), null, 'too many groups to select one');
    });

    QUnit.test('activeGroup with media and group', function(assert) {
      this.media = {attributes: {AUDIO: 'foo'}};

      this.groups.main = [{ id: 'en' }, { id: 'fr' }];
      this.groups.foo = [{ id: 'en' }, { id: 'fr' }];

      assert.deepEqual(this.activeGroup(), this.groups.foo, 'selected attribute group');
    });

    QUnit.test('activeGroup passed a track', function(assert) {
      this.media = {attributes: {AUDIO: 'foo'}};

      this.groups.main = [{ id: 'en' }, { id: 'fr' }];
      this.groups.foo = [{ id: 'en' }, { id: 'fr' }];

      assert.equal(this.activeGroup(null), null, 'no group when passed null track');
      assert.deepEqual(this.activeGroup({id: 'en'}), this.groups.foo[0], 'returns track when passed a valid track');
      assert.equal(this.activeGroup({id: 'baz'}), null, 'no group with invalid track');
    });

    if (groupType === 'AUDIO') {
      QUnit.test('hls audio only playlist returns correct group', function(assert) {
        this.media = {
          id: 'fr-bar',
          attributes: {CODECS: 'mp4a.40.2'}
        };

        this.settings.main = {
          mediaGroups: {
            AUDIO: this.groups
          }
        };

        this.groups.main = [{ id: 'en', uri: 'en.ts'}, { id: 'fr', uri: 'fr.ts' }];
        this.groups.foo = [{ id: 'en-foo', uri: 'en-foo.ts' }, { id: 'fr-foo', uri: 'fr-foo.ts' }];
        this.groups.bar = [{ id: 'en-bar', uri: 'en-foo.ts' }, { id: 'fr-bar', uri: 'fr-bar.ts' }];

        assert.deepEqual(this.activeGroup(), this.groups.bar, 'selected matching group');
      });

      QUnit.test('dash audio only playlist returns correct group', function(assert) {
        this.media = {
          uri: 'fr-bar-1.ts',
          attributes: {CODECS: 'mp4a.40.2'}
        };

        this.settings.main = {
          mediaGroups: {
            AUDIO: this.groups
          }
        };

        ['main', 'foo', 'bar'].forEach((key) => {
          this.groups[key] = [{
            label: 'en',
            playlists: [
              {id: `en-${key}-0`, uri: `en-${key}-0.ts`},
              {id: `en-${key}-1`, uri: `en-${key}-1.ts`}
            ]
          }, {
            label: 'fr',
            playlists: [
              {id: `fr-${key}-0`, uri: `fr-${key}-0.ts`},
              {id: `fr-${key}-1`, uri: `fr-${key}-1.ts`}
            ]
          }];
        });

        assert.deepEqual(this.activeGroup(), this.groups.bar, 'selected matching group');
      });

      QUnit.test('audio only without group match', function(assert) {
        this.media = {
          id: 'nope',
          attributes: {CODECS: 'mp4a.40.2'}
        };

        this.settings.main = {
          mediaGroups: {
            AUDIO: this.groups
          }
        };

        this.groups.main = [{ id: 'en', uri: 'en.ts'}, { id: 'fr', uri: 'fr.ts' }];
        this.groups.foo = [{ id: 'en-foo', uri: 'en-foo.ts' }, { id: 'fr-foo', uri: 'fr-foo.ts' }];
        this.groups.bar = [{ id: 'en-bar', uri: 'en-foo.ts' }, { id: 'fr-bar', uri: 'fr-bar.ts' }];

        assert.deepEqual(this.activeGroup(), null, 'selected no group');
      });
    }

    QUnit.module(`${groupType} getActiveGroup `, {
      beforeEach(assert) {
        sharedHooks.beforeEach.call(this, assert);

        const settings = {mediaTypes: {}};

        this.groupType = settings.mediaTypes[groupType] = {
          activeGroup: () => {},
          activeTrack: () => {}
        };

        this.getActiveGroup = MediaGroups.getActiveGroup(groupType, settings);
      },
      afterEach(assert) {
        sharedHooks.afterEach.call(this, assert);
      }
    });

    QUnit.test('works as expected', function(assert) {
      assert.equal(this.getActiveGroup(), null, 'no active group, without active track');

      this.groupType.activeTrack = () => ({id: 'en'});
      this.groupType.activeGroup = () => ({foo: true});

      assert.deepEqual(this.getActiveGroup(), {foo: true}, 'returns activeGroup with active track');
    });
  });

  QUnit.module('onGroupChanging', sharedHooks);

  QUnit.test('onGroupChanging aborts and pauses segment loaders', function(assert) {
    const calls = {
      abort: 0,
      pause: 0
    };
    const segmentLoader = {
      abort: () => calls.abort++,
      pause: () => calls.pause++
    };

    const settings = {
      segmentLoaders: {
        AUDIO: segmentLoader
      },
      mediaTypes: {
        AUDIO: {}
      }
    };
    const type = 'AUDIO';

    const onGroupChanging = MediaGroups.onGroupChanging(type, settings);

    assert.deepEqual(calls, {abort: 0, pause: 0}, 'no calls yet');

    onGroupChanging();

    assert.deepEqual(calls, {abort: 1, pause: 1}, 'one abort one pause');
  });

  QUnit.module('onGroupChanged', sharedHooks);

  QUnit.test(
    'onGroupChanged updates active playlist loader and resyncs segment loader',
    function(assert) {
      let mainSegmentLoaderResetCalls = 0;
      let segmentLoaderResyncCalls = 0;
      let segmentLoaderPauseCalls = 0;

      const type = 'AUDIO';
      const media = { attributes: { AUDIO: 'main' } };
      const mainSegmentLoader = { resetEverything: () => mainSegmentLoaderResetCalls++ };
      const segmentLoader = {
        abort() {},
        pause: () => segmentLoaderPauseCalls++,
        load() {},
        playlist() {},
        resyncLoader: () => segmentLoaderResyncCalls++
      };
      const mockPlaylistLoader = () => {
        return {
          media: () => media,
          load() {},
          pause() {}
        };
      };
      const mainPlaylistLoader = mockPlaylistLoader();
      const settings = {
        segmentLoaders: {
          AUDIO: segmentLoader,
          main: mainSegmentLoader
        },
        mediaTypes: MediaGroups.createMediaTypes(),
        mainPlaylistLoader
      };
      const mediaType = settings.mediaTypes[type];
      const groups = mediaType.groups;
      const tracks = mediaType.tracks;

      groups.main = [
        { id: 'en', playlistLoader: null },
        { id: 'fr', playlistLoader: mockPlaylistLoader() },
        { id: 'es', playlistLoader: mockPlaylistLoader() }
      ];
      tracks.en = { id: 'en', enabled: false };
      tracks.fr = { id: 'fr', enabled: false };
      tracks.es = { id: 'es', enabled: false };
      mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
      mediaType.activeGroup = MediaGroups.activeGroup(type, settings);
      mediaType.getActiveGroup = MediaGroups.getActiveGroup(type, settings);

      const onGroupChanged = MediaGroups.onGroupChanged(type, settings);

      onGroupChanged();

      assert.equal(segmentLoaderPauseCalls, 1, 'paused loader with no active group');
      assert.equal(mainSegmentLoaderResetCalls, 0, 'no reset when no active group');
      assert.equal(segmentLoaderResyncCalls, 0, 'no resync when no active group');

      tracks.en.enabled = true;

      onGroupChanged();

      assert.equal(segmentLoaderPauseCalls, 2, 'loaders paused on group change');
      assert.equal(
        mainSegmentLoaderResetCalls, 0,
        'no reset changing from no active playlist loader to group with no playlist loader'
      );
      assert.equal(
        segmentLoaderResyncCalls, 0,
        'no resync changing to group with no playlist loader'
      );

      mediaType.lastGroup_ = null;
      mediaType.activePlaylistLoader = groups.main[1].playlistLoader;
      onGroupChanged();

      assert.equal(segmentLoaderPauseCalls, 3, 'loaders paused on group change');
      assert.equal(
        mainSegmentLoaderResetCalls, 1,
        'reset changing from active playlist loader to group with no playlist loader'
      );
      assert.equal(
        segmentLoaderResyncCalls, 0,
        'no resync changing to group with no playlist loader'
      );

      mediaType.lastGroup_ = null;
      tracks.en.enabled = false;
      tracks.fr.enabled = true;
      mediaType.activePlaylistLoader = groups.main[2].playlistLoader;
      onGroupChanged();

      assert.equal(segmentLoaderPauseCalls, 4, 'loaders paused on group change');
      assert.equal(
        mainSegmentLoaderResetCalls, 1,
        'no reset changing to group with playlist loader'
      );
      assert.equal(
        segmentLoaderResyncCalls, 1,
        'resync changing to group with playlist loader'
      );
      assert.strictEqual(
        mediaType.activePlaylistLoader, groups.main[1].playlistLoader,
        'sets the correct active playlist loader'
      );

      mediaType.lastGroup_ = null;
      groups.main[1].isMainPlaylist = true;

      onGroupChanged();

      assert.equal(segmentLoaderPauseCalls, 5, 'loaders paused on group change');
      assert.equal(mainSegmentLoaderResetCalls, 1, 'main segment loader not reset');

      onGroupChanged();

      assert.equal(segmentLoaderPauseCalls, 5, 'loader not paused without group change');
      assert.equal(mainSegmentLoaderResetCalls, 1, 'main segment loader not reset without group change');

    }
  );

  QUnit.module('onTrackChanged', sharedHooks);

  QUnit.test(
    'onTrackChanged updates active playlist loader and resets segment loader',
    function(assert) {
      let mainSegmentLoaderResetCalls = 0;
      const mainSegmentLoaderSetAudioCalls = [];
      let segmentLoaderResetCalls = 0;
      const segmentLoaderSetAudioCalls = [];
      let segmentLoaderPauseCalls = 0;
      let segmentLoaderTrack;

      const type = 'AUDIO';
      const media = { attributes: { AUDIO: 'main' } };
      const mainSegmentLoader = {
        setAudio: (enable) => mainSegmentLoaderSetAudioCalls.push(enable),
        resetEverything: () => mainSegmentLoaderResetCalls++
      };
      const segmentLoader = {
        abort() {},
        pause: () => segmentLoaderPauseCalls++,
        playlist() {},
        setAudio: (enable) => segmentLoaderSetAudioCalls.push(enable),
        resetEverything: () => segmentLoaderResetCalls++
      };
      const mockPlaylistLoader = () => {
        return {
          media: () => media,
          load() {},
          pause() {}
        };
      };
      const mainPlaylistLoader = mockPlaylistLoader();
      const settings = {
        segmentLoaders: {
          AUDIO: segmentLoader,
          main: mainSegmentLoader
        },
        mediaTypes: MediaGroups.createMediaTypes(),
        mainPlaylistLoader
      };
      const mediaType = settings.mediaTypes[type];
      const groups = mediaType.groups;
      const tracks = mediaType.tracks;

      groups.main = [
        { id: 'en', playlistLoader: null },
        { id: 'fr', playlistLoader: mockPlaylistLoader() },
        { id: 'es', playlistLoader: mockPlaylistLoader() }
      ];
      tracks.en = { id: 'en', enabled: false };
      tracks.fr = { id: 'fr', enabled: false };
      tracks.es = { id: 'es', enabled: false };
      mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
      mediaType.activeGroup = MediaGroups.activeGroup(type, settings);
      mediaType.getActiveGroup = MediaGroups.getActiveGroup(type, settings);

      const onTrackChanged = MediaGroups.onTrackChanged(type, settings);

      onTrackChanged();

      assert.equal(segmentLoaderPauseCalls, 1, 'loaders paused on track change');
      assert.equal(mainSegmentLoaderResetCalls, 0, 'no main reset when no active group');
      assert.equal(mainSegmentLoaderSetAudioCalls.length, 0, 'no main setAudio when no active group');
      assert.equal(segmentLoaderResetCalls, 0, 'no reset when no active group');
      assert.equal(segmentLoaderSetAudioCalls.length, 0, 'no setAudio when no active group');

      tracks.en.enabled = true;

      onTrackChanged();

      assert.equal(segmentLoaderPauseCalls, 2, 'loaders paused on track change');
      assert.equal(
        mainSegmentLoaderResetCalls, 1,
        'main reset when changing to group with no playlist loader'
      );
      assert.equal(
        mainSegmentLoaderSetAudioCalls.length, 1,
        'main audio set when changing to group with no playlist loader'
      );
      assert.ok(mainSegmentLoaderSetAudioCalls[0], 'main audio set to true');
      assert.equal(
        segmentLoaderResetCalls, 0,
        'no reset changing to group with no playlist loader'
      );
      assert.equal(
        segmentLoaderSetAudioCalls.length, 0,
        'no audio set when changing to group with no playlist loader'
      );

      tracks.en.enabled = false;
      tracks.fr.enabled = true;
      mediaType.activePlaylistLoader = groups.main[1].playlistLoader;

      onTrackChanged();

      assert.equal(segmentLoaderPauseCalls, 3, 'loaders paused on track change');
      assert.equal(
        mainSegmentLoaderResetCalls, 1,
        'no main reset changing to group with playlist loader'
      );
      assert.equal(
        mainSegmentLoaderSetAudioCalls.length, 2,
        'main audio set when changing to group with playlist loader'
      );
      assert.notOk(mainSegmentLoaderSetAudioCalls[1], 'main audio set to true');
      assert.equal(
        segmentLoaderResetCalls, 0,
        'no reset when active group hasn\'t changed'
      );
      assert.equal(segmentLoaderSetAudioCalls.length, 1, 'set audio on track change');
      assert.ok(segmentLoaderSetAudioCalls[0], 'enabled audio on track change');
      assert.strictEqual(
        mediaType.activePlaylistLoader, groups.main[1].playlistLoader,
        'sets the correct active playlist loader'
      );

      tracks.fr.enabled = false;
      tracks.es.enabled = true;

      onTrackChanged();

      assert.equal(segmentLoaderPauseCalls, 4, 'loaders paused on track change');
      assert.equal(
        mainSegmentLoaderResetCalls, 1,
        'no main reset changing to group with playlist loader'
      );
      assert.equal(
        mainSegmentLoaderSetAudioCalls.length, 3,
        'main audio set when changing to group with playlist loader'
      );
      assert.notOk(
        mainSegmentLoaderSetAudioCalls[2],
        'main audio set to false when changing to group with playlist loader'
      );
      assert.equal(segmentLoaderSetAudioCalls.length, 2, 'audio set on track change');
      assert.ok(segmentLoaderSetAudioCalls[1], 'audio enabled on track change');
      assert.equal(segmentLoaderResetCalls, 1, 'reset on track change');
      assert.strictEqual(
        mediaType.activePlaylistLoader, groups.main[2].playlistLoader,
        'sets the correct active playlist loader'
      );

      // setting the track on the segment loader only applies to the SUBTITLES case.
      // even though this test is testing type AUDIO, aside from this difference of setting
      // the track, the functionality between the types is the same.
      segmentLoader.track = (track) => {
        segmentLoaderTrack = track;
      };

      tracks.fr.enabled = true;
      tracks.es.enabled = false;

      onTrackChanged();

      assert.equal(segmentLoaderPauseCalls, 5, 'loaders paused on track change');
      assert.equal(
        mainSegmentLoaderResetCalls, 1,
        'no main reset changing to group with playlist loader'
      );
      assert.equal(
        mainSegmentLoaderSetAudioCalls.length, 4,
        'main audio set when changing to group with playlist loader'
      );
      assert.notOk(
        mainSegmentLoaderSetAudioCalls[3],
        'main audio set to false when changing to group with playlist loader'
      );
      assert.equal(segmentLoaderSetAudioCalls.length, 3, 'audio set on track change');
      assert.ok(segmentLoaderSetAudioCalls[2], 'audio enabled on track change');
      assert.equal(
        segmentLoaderResetCalls, 2,
        'reset on track change'
      );
      assert.strictEqual(
        mediaType.activePlaylistLoader, groups.main[1].playlistLoader,
        'sets the correct active playlist loader'
      );
      assert.strictEqual(
        segmentLoaderTrack, tracks.fr,
        'set the correct track on the segment loader'
      );
    }
  );

  const createMocker = ({calls = [], args = []} = {}) => {
    const obj = {calls: {}, args: {}};

    calls.forEach(function(key) {
      obj.calls[key] = 0;
      obj[key] = () => {
        obj.calls[key]++;
      };
    });

    args.forEach(function(key) {
      obj.args[key] = [];
      obj[key] = (v) => {
        obj.args[key].push(v);
      };
    });

    return obj;
  };

  const mockSegmentLoader = () => createMocker({
    calls: ['abort', 'pause', 'resetEverything'],
    args: ['setAudio', 'track']
  });
  const mockPlaylistLoader = () => createMocker({
    calls: ['pause', 'load'],
    args: ['fastQualityChange_']
  });

  const mocksAreZero = (mocks, assert) => {
    Object.keys(mocks).forEach(function(name) {
      const mock = mocks[name];

      Object.keys(mock.calls).forEach(function(key) {
        assert.equal(mock.calls[key], 0, `${name} ${key} not called`);
      });

      Object.keys(mock.args).forEach(function(key) {
        assert.equal(mock.args[key].length, 0, `${name} ${key} not called`);
      });
    });
  };

  QUnit.test('onTrackChanged with isMainPlaylist', function(assert) {
    this.media = {id: 'en', attributes: {AUDIO: 'main'}};
    this.nextMedia = {id: 'fr', attributes: {AUDIO: 'main'}};

    const audioSegmentLoader = mockSegmentLoader();
    const mainSegmentLoader = mockSegmentLoader();
    const mainPlaylistLoader = Object.assign(mockPlaylistLoader(), {
      media: () => this.media
    });
    const playlistController_ = Object.assign(mockPlaylistLoader(), {
      media: () => this.media,
      selectPlaylist: () => this.nextMedia
    });
    const mocks = {audioSegmentLoader, mainSegmentLoader, playlistController_, mainPlaylistLoader};
    const type = 'AUDIO';
    const settings = {
      segmentLoaders: {
        AUDIO: audioSegmentLoader,
        main: mainSegmentLoader
      },
      mediaTypes: MediaGroups.createMediaTypes(),
      mainPlaylistLoader,
      vhs: {
        playlistController_
      }
    };
    const mediaType = settings.mediaTypes[type];
    const groups = mediaType.groups;
    const tracks = mediaType.tracks;

    groups.main = [
      { id: 'en', playlistLoader: null, isMainPlaylist: true },
      { id: 'fr', playlistLoader: null, isMainPlaylist: true },
      { id: 'es', playlistLoader: null, isMainPlaylist: true }
    ];
    tracks.en = { id: 'en', enabled: true };
    tracks.fr = { id: 'fr', enabled: false };
    tracks.es = { id: 'es', enabled: false };
    mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
    mediaType.activeGroup = MediaGroups.activeGroup(type, settings);
    mediaType.getActiveGroup = MediaGroups.getActiveGroup(type, settings);

    const onTrackChanged = MediaGroups.onTrackChanged(type, settings);

    // intial track setup does nothing.
    onTrackChanged();

    assert.equal(audioSegmentLoader.calls.pause, 1, 'audioSegmentLoader pause called');
    assert.equal(audioSegmentLoader.calls.abort, 1, 'audioSegmentLoader abort called');

    audioSegmentLoader.calls.pause = 0;
    audioSegmentLoader.calls.abort = 0;

    // verify that all other mocks are zero
    mocksAreZero(mocks, assert);

    tracks.en.enabled = false;
    tracks.fr.enabled = true;

    onTrackChanged();

    assert.equal(audioSegmentLoader.calls.pause, 1, 'audioSegmentLoader pause called on track change');
    assert.equal(audioSegmentLoader.calls.abort, 1, 'audioSegmentLoader abort called on track change');
    assert.equal(mainSegmentLoader.calls.resetEverything, 1, 'mainSegmentLoader resetEverything called on track change');
    assert.equal(mainPlaylistLoader.calls.pause, 1, 'mainPlaylistLoader pause called on track change');
    assert.deepEqual(
      playlistController_.args.fastQualityChange_,
      [this.nextMedia],
      'fastQualityChange_ called on track change'
    );

    audioSegmentLoader.calls.pause = 0;
    audioSegmentLoader.calls.abort = 0;
    mainSegmentLoader.calls.resetEverything = 0;
    mainPlaylistLoader.calls.pause = 0;
    playlistController_.args.fastQualityChange_.length = 0;

    mocksAreZero(mocks, assert);

    // mock track change without media change (via selectPlaylist)
    this.media = this.nextMedia;
    settings.mediaTypes.AUDIO.lastTrack_ = {id: 'en'};
    onTrackChanged();

    assert.equal(audioSegmentLoader.calls.pause, 1, 'audioSegmentLoader pause called');
    assert.equal(audioSegmentLoader.calls.abort, 1, 'audioSegmentLoader abort called');

    audioSegmentLoader.calls.pause = 0;
    audioSegmentLoader.calls.abort = 0;

    mocksAreZero(mocks, assert);

    tracks.en.enabled = true;
    tracks.fr.enabled = false;
    this.nextMedia = {id: 'en'};

    onTrackChanged();

    assert.equal(audioSegmentLoader.calls.pause, 1, 'audioSegmentLoader pause called on track change');
    assert.equal(audioSegmentLoader.calls.abort, 1, 'audioSegmentLoader abort called on track change');
    assert.equal(mainSegmentLoader.calls.resetEverything, 1, 'mainSegmentLoader resetEverything called on track change');
    assert.equal(mainPlaylistLoader.calls.pause, 1, 'mainPlaylistLoader pause called on track change');
    assert.deepEqual(
      playlistController_.args.fastQualityChange_,
      [this.nextMedia],
      'fastQualityChange_ called on track change'
    );

    audioSegmentLoader.calls.pause = 0;
    audioSegmentLoader.calls.abort = 0;
    mainSegmentLoader.calls.resetEverything = 0;
    mainPlaylistLoader.calls.pause = 0;
    playlistController_.args.fastQualityChange_.length = 0;

    mocksAreZero(mocks, assert);

    // no changes as track is the same.
    onTrackChanged();
    mocksAreZero(mocks, assert);

  });

  QUnit.test(
    'switches to default audio track when an error is encountered',
    function(assert) {
      let excludePlaylistCalls = 0;
      let onTrackChangedCalls = 0;

      const type = 'AUDIO';
      const segmentLoader = { abort() {}, pause() {} };
      const mainPlaylistLoader = {
        media() {
          return { attributes: { AUDIO: 'main' } };
        }
      };
      const settings = {
        segmentLoaders: { AUDIO: segmentLoader },
        mediaTypes: MediaGroups.createMediaTypes(),
        excludePlaylist: () => excludePlaylistCalls++,
        mainPlaylistLoader
      };
      const mediaType = settings.mediaTypes[type];
      const groups = mediaType.groups;
      const tracks = mediaType.tracks;

      mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
      mediaType.activeGroup = MediaGroups.activeGroup(type, settings);
      mediaType.onTrackChanged = () => onTrackChangedCalls++;

      const onError = MediaGroups.onError[type](type, settings);

      groups.main = [ { id: 'en', default: true }, { id: 'fr'}, { id: 'es'} ];
      tracks.en = { id: 'en', enabed: false };
      tracks.fr = { id: 'fr', enabed: true };
      tracks.es = { id: 'es', enabed: false };

      onError();

      assert.equal(excludePlaylistCalls, 0, 'did not exclude current playlist');
      assert.equal(onTrackChangedCalls, 1, 'called onTrackChanged after changing to default');
      assert.equal(tracks.en.enabled, true, 'enabled default track');
      assert.equal(tracks.fr.enabled, false, 'disabled active track');
      assert.equal(tracks.es.enabled, false, 'disabled track still disabled');
      assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');
      this.env.log.warn.callCount = 0;

      onError();

      assert.equal(excludePlaylistCalls, 1, 'excluded current playlist');
      assert.equal(onTrackChangedCalls, 1, 'did not call onTrackChanged after exclusion');
      assert.equal(tracks.en.enabled, true, 'default track still enabled');
      assert.equal(tracks.fr.enabled, false, 'disabled track still disabled');
      assert.equal(tracks.es.enabled, false, 'disabled track still disabled');
      assert.equal(this.env.log.warn.callCount, 0, 'no warning logged');
    }
  );

  QUnit.test('disables subtitle track when an error is encountered', function(assert) {
    let onTrackChangedCalls = 0;
    const type = 'SUBTITLES';
    const segmentLoader = { abort() {}, pause() {} };
    const settings = {
      segmentLoaders: { SUBTITLES: segmentLoader },
      mediaTypes: MediaGroups.createMediaTypes()
    };
    const mediaType = settings.mediaTypes[type];
    const tracks = mediaType.tracks;

    mediaType.activeTrack = MediaGroups.activeTrack[type](type, settings);
    mediaType.onTrackChanged = () => onTrackChangedCalls++;

    const onError = MediaGroups.onError[type](type, settings);

    tracks.en = { id: 'en', mode: 'disabled' };
    tracks.fr = { id: 'fr', mode: 'disabled' };
    tracks.es = { id: 'es', mode: 'showing' };

    onError();

    assert.equal(onTrackChangedCalls, 1, 'called onTrackChanged after disabling track');
    assert.equal(tracks.en.mode, 'disabled', 'disabled track still disabled');
    assert.equal(tracks.fr.mode, 'disabled', 'disabled track still disabled');
    assert.equal(tracks.es.mode, 'disabled', 'disabled active track');
    assert.equal(this.env.log.warn.callCount, 1, 'logged a warning');
    this.env.log.warn.callCount = 0;
  });

  QUnit.module('setupListeners', sharedHooks);
  QUnit.test('setupListeners adds correct playlist loader listeners', function(assert) {
    const settings = {
      tech: {},
      requestOptions: {},
      segmentLoaders: {
        AUDIO: {},
        SUBTITLES: {}
      },
      mediaTypes: MediaGroups.createMediaTypes()
    };
    const listeners = [];
    const on = (event, cb) => listeners.push([event, cb]);
    const playlistLoader = { on };
    let type = 'SUBTITLES';

    MediaGroups.setupListeners[type](type, playlistLoader, settings);

    assert.equal(listeners.length, 3, 'setup 3 event listeners');
    assert.equal(listeners[0][0], 'loadedmetadata', 'setup loadedmetadata listener');
    assert.equal(typeof listeners[0][1], 'function', 'setup loadedmetadata listener');
    assert.equal(listeners[1][0], 'loadedplaylist', 'setup loadedmetadata listener');
    assert.equal(typeof listeners[1][1], 'function', 'setup loadedmetadata listener');
    assert.equal(listeners[2][0], 'error', 'setup loadedmetadata listener');
    assert.equal(typeof listeners[2][1], 'function', 'setup loadedmetadata listener');

    listeners.length = 0;

    type = 'AUDIO';

    MediaGroups.setupListeners[type](type, playlistLoader, settings);

    assert.equal(listeners.length, 3, 'setup 3 event listeners');
    assert.equal(listeners[0][0], 'loadedmetadata', 'setup loadedmetadata listener');
    assert.equal(typeof listeners[0][1], 'function', 'setup loadedmetadata listener');
    assert.equal(listeners[1][0], 'loadedplaylist', 'setup loadedmetadata listener');
    assert.equal(typeof listeners[1][1], 'function', 'setup loadedmetadata listener');
    assert.equal(listeners[2][0], 'error', 'setup loadedmetadata listener');
    assert.equal(typeof listeners[2][1], 'function', 'setup loadedmetadata listener');

    listeners.length = 0;

    MediaGroups.setupListeners[type](type, null, settings);

    assert.equal(listeners.length, 0, 'no event listeners setup when no playlist loader');
  });

  QUnit.module('initialize', {
    beforeEach(assert) {
      this.mediaTypes = MediaGroups.createMediaTypes();
      this.mainLoader = {
        setAudio() {}
      };
      this.audioLoader = {
        on() {},
        setAudio() {}
      };
      this.main = {
        mediaGroups: {
          'AUDIO': {},
          'SUBTITLES': {},
          'CLOSED-CAPTIONS': {}
        },
        playlists: []
      };
      this.settings = {
        mode: 'html5',
        mainPlaylistLoader: {main: this.main},
        vhs: {
          options_: {}
        },
        tech: {
          options_: {},
          addRemoteTextTrack(track) {
            return { track };
          }
        },
        segmentLoaders: {
          AUDIO: this.audioLoader,
          SUBTITLES: { on() {} },
          main: this.mainLoader
        },
        requestOptions: { withCredentials: false, timeout: 10 },
        main: this.main,
        mediaTypes: this.mediaTypes,
        excludePlaylist() {},
        sourceType: 'hls'
      };
    }
  });

  QUnit.test(
    'initialize audio forces default track when no audio groups provided',
    function(assert) {
      const type = 'AUDIO';

      MediaGroups.initialize[type](type, this.settings);

      assert.deepEqual(
        this.main.mediaGroups[type],
        { main: { default: { default: true} } }, 'forced default audio group'
      );
      assert.deepEqual(
        this.mediaTypes[type].groups,
        { main: [ { id: 'default', playlistLoader: null, default: true } ] },
        'creates group properties and no playlist loader'
      );
      assert.ok(this.mediaTypes[type].tracks.default, 'created default track');
    }
  );

  QUnit.test(
    'initialize audio correctly generates tracks and playlist loaders',
    function(assert) {
      const type = 'AUDIO';

      this.main.playlists = [
        {resolvedUri: 'video/fr.m3u8', attributes: {AUDIO: 'aud1', CODECS: 'avc1.4d400d'}}
      ];
      this.main.mediaGroups[type].aud1 = {
        en: { default: true, language: 'en' },
        fr: { default: false, language: 'fr', resolvedUri: 'aud1/fr.m3u8' }
      };
      this.main.mediaGroups[type].aud2 = {
        en: { default: true, language: 'en' },
        fr: { default: false, language: 'fr', resolvedUri: 'aud2/fr.m3u8' }
      };

      MediaGroups.initialize[type](type, this.settings);

      assert.notOk(this.main.mediaGroups[type].main, 'no default main group added');
      assert.deepEqual(
        this.mediaTypes[type].groups,
        {
          aud1: [
            { id: 'en', default: true, language: 'en', playlistLoader: null },
            { id: 'fr', default: false, language: 'fr', resolvedUri: 'aud1/fr.m3u8',
              // just so deepEqual passes since there is no other way to get the object
              // reference for the playlist loader. Assertions below will confirm that this is
              // not null.
              playlistLoader: this.mediaTypes[type].groups.aud1[1].playlistLoader }
          ],
          aud2: [
            { id: 'en', default: true, language: 'en', playlistLoader: null },
            { id: 'fr', default: false, language: 'fr', resolvedUri: 'aud2/fr.m3u8',
              // just so deepEqual passes since there is no other way to get the object
              // reference for the playlist loader. Assertions below will confirm that this is
              // not null.
              playlistLoader: this.mediaTypes[type].groups.aud2[1].playlistLoader }
          ]
        }, 'creates group properties'
      );
      assert.ok(
        this.mediaTypes[type].groups.aud1[1].playlistLoader,
        'playlistLoader created for non muxed audio group'
      );
      assert.ok(
        this.mediaTypes[type].groups.aud2[1].playlistLoader,
        'playlistLoader created for non muxed audio group'
      );
      assert.ok(this.mediaTypes[type].tracks.en, 'created audio track');
      assert.ok(this.mediaTypes[type].tracks.fr, 'created audio track');
    }
  );

  QUnit.test(
    'initialize subtitles correctly generates tracks and playlist loaders',
    function(assert) {
      const type = 'SUBTITLES';

      this.main.mediaGroups[type].sub1 = {
        'en': { language: 'en', default: true, resolvedUri: 'sub1/en.m3u8' },
        'en-forced': { language: 'en', resolvedUri: 'sub1/en-forced.m3u8', forced: true },
        'fr': { language: 'fr', resolvedUri: 'sub1/fr.m3u8' }
      };
      this.main.mediaGroups[type].sub2 = {
        'en': { language: 'en', resolvedUri: 'sub2/en.m3u8' },
        'en-forced': { language: 'en', resolvedUri: 'sub2/en-forced.m3u8', forced: true },
        'fr': { language: 'fr', resolvedUri: 'sub2/fr.m3u8' }
      };

      MediaGroups.initialize[type](type, this.settings);

      assert.deepEqual(
        this.mediaTypes[type].groups,
        {
          sub1: [
            { id: 'en', language: 'en', default: true, resolvedUri: 'sub1/en.m3u8',
              playlistLoader: this.mediaTypes[type].groups.sub1[0].playlistLoader },
            { id: 'fr', language: 'fr', resolvedUri: 'sub1/fr.m3u8',
              playlistLoader: this.mediaTypes[type].groups.sub1[1].playlistLoader }
          ],
          sub2: [
            { id: 'en', language: 'en', resolvedUri: 'sub2/en.m3u8',
              playlistLoader: this.mediaTypes[type].groups.sub2[0].playlistLoader },
            { id: 'fr', language: 'fr', resolvedUri: 'sub2/fr.m3u8',
              playlistLoader: this.mediaTypes[type].groups.sub2[1].playlistLoader }
          ]
        }, 'creates group properties'
      );
      assert.ok(
        this.mediaTypes[type].groups.sub1[0].playlistLoader,
        'playlistLoader created'
      );
      assert.ok(
        this.mediaTypes[type].groups.sub1[1].playlistLoader,
        'playlistLoader created'
      );
      assert.ok(
        this.mediaTypes[type].groups.sub2[0].playlistLoader,
        'playlistLoader created'
      );
      assert.ok(
        this.mediaTypes[type].groups.sub2[1].playlistLoader,
        'playlistLoader created'
      );
      assert.ok(this.mediaTypes[type].tracks.en, 'created text track');
      assert.equal(this.mediaTypes[type].tracks.en.default, undefined, 'No autoselect, no default');
      assert.ok(this.mediaTypes[type].tracks.fr, 'created text track');
    }
  );

  QUnit.test(
    'initialize subtitles correctly with auto select',
    function(assert) {
      const type = 'SUBTITLES';

      this.main.mediaGroups[type].sub1 = {
        'en': { language: 'en', default: true, autoselect: true, resolvedUri: 'sub1/en.m3u8' },
        'en-forced': { language: 'en', resolvedUri: 'sub1/en-forced.m3u8', forced: true },
        'fr': { language: 'fr', resolvedUri: 'sub1/fr.m3u8' }
      };
      this.main.mediaGroups[type].sub2 = {
        'en': { language: 'en', resolvedUri: 'sub2/en.m3u8' },
        'en-forced': { language: 'en', resolvedUri: 'sub2/en-forced.m3u8', forced: true },
        'fr': { language: 'fr', resolvedUri: 'sub2/fr.m3u8' }
      };

      MediaGroups.initialize[type](type, this.settings);

      assert.equal(this.mediaTypes[type].tracks.en.default, true, 'en track auto selected');
    }
  );

  QUnit.test(
    'initialize closed-captions correctly generates tracks and NO loaders',
    function(assert) {
      const type = 'CLOSED-CAPTIONS';

      this.main.mediaGroups[type].CCs = {
        en608: { language: 'en', default: true, autoselect: true, instreamId: 'CC1' },
        en708: { language: 'en', instreamId: 'SERVICE1' },
        fr608: { language: 'fr', instreamId: 'CC3' },
        fr708: { language: 'fr', instreamId: 'SERVICE3' },
        kr708: { language: 'kor', instreamId: 'SERVICE4' }
      };

      // verify that captionServices option can modify properties
      this.settings.tech.options_.vhs = {
        captionServices: {
          SERVICE4: {
            label: 'Korean',
            default: true
          }
        }
      };

      MediaGroups.initialize[type](type, this.settings);

      assert.deepEqual(
        this.mediaTypes[type].groups,
        {
          CCs: [
            { id: 'en608', default: true, autoselect: true, language: 'en', instreamId: 'CC1' },
            { id: 'en708', language: 'en', instreamId: 'SERVICE1' },
            { id: 'fr608', language: 'fr', instreamId: 'CC3' },
            { id: 'fr708', language: 'fr', instreamId: 'SERVICE3' },
            { id: 'kr708', language: 'kor', instreamId: 'SERVICE4' }
          ]
        }, 'creates group properties'
      );
      assert.ok(this.mediaTypes[type].tracks.en608, 'created text track');
      assert.ok(this.mediaTypes[type].tracks.fr608, 'created text track');
      assert.equal(this.mediaTypes[type].tracks.en608.default, true, 'en608 track auto selected');
      assert.deepEqual(this.mediaTypes[type].tracks.kr708, {
        id: 'SERVICE4',
        kind: 'captions',
        language: 'kor',
        label: 'Korean',
        default: true
      }, 'kr708 fields are overriden by the options');
    }
  );

  QUnit.test('initialize audio correctly uses HLS source type', function(assert) {

    this.main.playlists = [
      {resolvedUri: 'video/fr.m3u8', attributes: {AUDIO: 'aud1', CODECS: 'avc1.4d400d'}}
    ];
    this.main.mediaGroups.AUDIO.aud1 = {
      en: { default: true, language: 'en' },
      fr: { default: false, language: 'fr', resolvedUri: 'aud1/fr.m3u8' }
    };
    this.settings.sourceType = 'hls';

    MediaGroups.initialize.AUDIO('AUDIO', this.settings);

    assert.notOk(
      this.mediaTypes.AUDIO.groups.aud1[0].playlistLoader,
      'no playlist loader because muxed (no URI)'
    );
    assert.ok(
      this.mediaTypes.AUDIO.groups.aud1[1].playlistLoader instanceof PlaylistLoader,
      'playlist loader is an HLS playlist loader'
    );
  });

  QUnit.test('no audio loader for audio only with duplicated audio groups', function(assert) {
    this.main.mediaGroups.AUDIO.aud1 = {
      en: { default: true, language: 'en', resolvedUri: 'en.m3u8'}
    };

    this.settings.sourceType = 'hls';

    this.settings.main.playlists = [
      {resolvedUri: 'en.m3u8', attributes: {AUDIO: 'aud1', CODECS: 'mp4a.40.2'}}
    ];
    MediaGroups.initialize.AUDIO('AUDIO', this.settings);

    assert.notOk(
      this.mediaTypes.AUDIO.groups.aud1[0].playlistLoader,
      'no loader as audio group is the same as main renditions'
    );
  });

  QUnit.test('audio loader created with audio group duplicated as audio only rendition', function(assert) {
    this.main.mediaGroups.AUDIO.aud1 = {
      en: { default: true, language: 'en', resolvedUri: 'en.m3u8' }
    };

    this.settings.sourceType = 'hls';

    this.settings.main.playlists = [
      {resolvedUri: 'video/en.m3u8', attributes: {AUDIO: 'aud1'}},
      {resolvedUri: 'en.m3u8', attributes: {AUDIO: 'aud1'}}
    ];
    MediaGroups.initialize.AUDIO('AUDIO', this.settings);

    assert.ok(
      this.mediaTypes.AUDIO.groups.aud1[0].playlistLoader,
      'audio loader created'
    );
  });

  QUnit.test('initialize audio correctly uses DASH source type', function(assert) {
    // allow async methods to resolve before next test
    const done = assert.async();

    this.main.playlists = [
      {resolvedUri: 'video/fr.m3u8', attributes: {AUDIO: 'aud1', CODECS: 'avc1.4d400d'}}
    ];

    this.main.mediaGroups.AUDIO.aud1 = {
      // playlists are resolved, no URI for DASH
      // use strings as playlists to simplify test to prevent playlist object code path
      // which assumes there a MastPlaylistLoader
      en: { default: true, language: 'en', playlists: ['playlist-1'] },
      fr: { default: false, language: 'fr', playlists: ['playlist-2'] }
    };
    this.settings.sourceType = 'dash';

    MediaGroups.initialize.AUDIO('AUDIO', this.settings);

    assert.ok(
      this.mediaTypes.AUDIO.groups.aud1[0].playlistLoader instanceof DashPlaylistLoader,
      'playlist loader is a DASH playlist loader'
    );
    assert.ok(
      this.mediaTypes.AUDIO.groups.aud1[1].playlistLoader instanceof DashPlaylistLoader,
      'playlist loader is a DASH playlist loader'
    );

    done();
  });

  QUnit.test(
    'initialize audio does not create DASH playlist loader if no playlists',
    function(assert) {
      this.main.mediaGroups.AUDIO.aud1 = {
        en: { default: true, language: 'en' },
        fr: { default: false, language: 'fr' }
      };
      this.settings.sourceType = 'dash';

      MediaGroups.initialize.AUDIO('AUDIO', this.settings);

      assert.notOk(
        this.mediaTypes.AUDIO.groups.aud1[0].playlistLoader,
        'no playlist loader when misconfigured'
      );
      assert.notOk(
        this.mediaTypes.AUDIO.groups.aud1[1].playlistLoader,
        'no playlist loader when misconfigured'
      );
    }
  );

  QUnit.skip('initialize audio does not create playlist loader for alternate tracks with' +
' main stream as URI attribute', function(assert) {
    this.main.mediaGroups.AUDIO.aud1 = {
      en: { default: true, language: 'en', resolvedUri: 'main.m3u8' },
      fr: { default: false, language: 'fr', resolvedUri: 'audio/fr.m3u8' }
    };
    this.main.playlists = [{
      attributes: { AUDIO: 'aud1' },
      resolvedUri: 'main.m3u8'
    }];

    MediaGroups.initialize.AUDIO('AUDIO', this.settings);

    assert.notOk(
      this.mediaTypes.AUDIO.groups.aud1[0].resolvedUri,
      'resolvedUri proeprty deleted'
    );
    assert.notOk(
      this.mediaTypes.AUDIO.groups.aud1[0].playlistLoader,
      'no playlist loader for alternate audio in main stream'
    );
    assert.ok(
      this.mediaTypes.AUDIO.groups.aud1[1].playlistLoader instanceof PlaylistLoader,
      'playlist loader for alternate audio not in main stream'
    );
  });

  QUnit.test('initialize subtitles correctly uses HLS source type', function(assert) {
    this.main.mediaGroups.SUBTITLES.sub1 = {
      en: { language: 'en', resolvedUri: 'sub1/en.m3u8' },
      fr: { language: 'fr', resolvedUri: 'sub1/fr.m3u8' }
    };
    this.settings.sourceType = 'hls';

    MediaGroups.initialize.SUBTITLES('SUBTITLES', this.settings);

    assert.ok(
      this.mediaTypes.SUBTITLES.groups.sub1[0].playlistLoader instanceof PlaylistLoader,
      'playlist loader is an HLS playlist loader'
    );
    assert.ok(
      this.mediaTypes.SUBTITLES.groups.sub1[1].playlistLoader instanceof PlaylistLoader,
      'playlist loader is an HLS playlist loader'
    );
  });

  QUnit.test('initialize audio correctly uses vhs-json source type', function(assert) {
    const manifestString = manifests.media;
    const audioPlaylist = parseManifest({ manifestString });

    this.main.playlists = [
      {resolvedUri: 'video/fr.m3u8', attributes: {AUDIO: 'aud1', CODECS: 'avc1.4d400d'}}
    ];

    this.main.mediaGroups.AUDIO.aud1 = {
      en: {
        default: true,
        language: 'en',
        playlists: [audioPlaylist]
      }
    };
    this.settings.sourceType = 'vhs-json';

    MediaGroups.initialize.AUDIO('AUDIO', this.settings);

    const playlistLoader = this.mediaTypes.AUDIO.groups.aud1[0].playlistLoader;

    assert.ok(
      playlistLoader instanceof PlaylistLoader,
      'playlist loader is a standard playlist loader'
    );
    assert.deepEqual(playlistLoader.src, audioPlaylist, 'passed the audio playlist');
  });

  QUnit.test('initialize subtitles correctly uses DASH source type', function(assert) {
    // allow async methods to resolve before next test
    const done = assert.async();

    this.main.mediaGroups.SUBTITLES.sub1 = {
      // playlists are resolved, no URI for DASH
      // use strings as playlists to simplify test to prevent playlist object code path
      // which assumes there a MastPlaylistLoader
      en: { language: 'en', playlists: ['playlist-1'] },
      fr: { language: 'fr', playlists: ['playlist-2'] }
    };
    this.settings.sourceType = 'dash';

    MediaGroups.initialize.AUDIO('AUDIO', this.settings);

    MediaGroups.initialize.SUBTITLES('SUBTITLES', this.settings);

    assert.ok(
      this.mediaTypes.SUBTITLES.groups.sub1[0].playlistLoader instanceof DashPlaylistLoader,
      'playlist loader is a DASH playlist loader'
    );
    assert.ok(
      this.mediaTypes.SUBTITLES.groups.sub1[1].playlistLoader instanceof DashPlaylistLoader,
      'playlist loader is a DASH playlist loader'
    );

    done();
  });

  QUnit.test('initialize subtitles correctly uses vhs-json source type', function(assert) {
    const manifestString = manifests.subtitles;
    const subtitlesPlaylist = parseManifest({ manifestString });

    this.main.mediaGroups.SUBTITLES.sub1 = {
      en: {
        language: 'en',
        playlists: [subtitlesPlaylist]
      }
    };
    this.settings.sourceType = 'vhs-json';

    MediaGroups.initialize.SUBTITLES('SUBTITLES', this.settings);

    const playlistLoader = this.mediaTypes.SUBTITLES.groups.sub1[0].playlistLoader;

    assert.ok(
      playlistLoader instanceof PlaylistLoader,
      'playlist loader is a standard playlist loader'
    );
    assert.deepEqual(
      playlistLoader.src,
      subtitlesPlaylist,
      'passed the subtitles playlist'
    );
  });

  QUnit.module('setupMediaGroups', {
    beforeEach(assert) {
      this.mediaTypes = MediaGroups.createMediaTypes();
      this.mainLoader = {
        audioDisabled_: false,
        setAudio(enable) {
          this.audioDisabled_ = !enable;
        },
        on() {},
        abort() {},
        pause() {}
      };
      this.audioLoader = {
        audioDisabled_: false,
        setAudio(enable) {
          this.audioDisabled_ = !enable;
        },
        on() {},
        abort() {},
        pause() {},
        resyncLoader() {}
      };
      this.main = {
        mediaGroups: {
          'AUDIO': {},
          'SUBTITLES': {},
          'CLOSED-CAPTIONS': {}
        }
      };
      this.media = null;
      this.settings = {
        mode: 'html5',
        mainPlaylistLoader: {
          main: this.main,
          media: () => this.media,
          on() {}
        },
        vhs: {
          on() {},
          xhr() {}
        },
        tech: {
          addRemoteTextTrack(track) {
            return { track };
          },
          audioTracks() {
            return {
              addEventListener() {},
              addTrack() {}
            };
          },
          remoteTextTracks() {
            return {
              addEventListener() {}
            };
          },
          clearTracks() {}
        },
        segmentLoaders: {
          AUDIO: this.audioLoader,
          SUBTITLES: { on() {} },
          main: this.mainLoader
        },
        requestOptions: { withCredentials: false, timeout: 10 },
        main: this.main,
        mediaTypes: this.mediaTypes,
        excludePlaylist() {},
        sourceType: 'hls'
      };
    }
  });

  QUnit.test('audio true for main loader if no audio loader', function(assert) {
    this.media = {attributes: {}, resolvedUri: 'main.m3u8'};
    this.main.playlists = [this.media];

    MediaGroups.setupMediaGroups(this.settings);

    assert.notOk(
      this.mainLoader.audioDisabled_,
      'main loader: audio enabled'
    );

    // audio loader remains unchanged as there's no need for an audio loader
  });

  QUnit.test('audio false for main loader if audio loader', function(assert) {
    this.media = {resolvedUri: 'video/en.m3u8', attributes: {AUDIO: 'aud1'}};
    this.main.playlists = [this.media];
    this.main.mediaGroups.AUDIO.aud1 = {
      en: { default: true, language: 'en', resolvedUri: 'aud1/en.m3u8' }
    };

    MediaGroups.setupMediaGroups(this.settings);

    assert.ok(
      this.mainLoader.audioDisabled_,
      'main loader: audio disabled'
    );
    assert.notOk(
      this.audioLoader.audioDisabled_,
      'audio loader: audio enabled'
    );
  });

  QUnit.test('audio true for main loader if alternate tracks with main stream as URI attribute', function(assert) {
    this.media = {resolvedUri: 'en.m3u8', attributes: {AUDIO: 'aud1'}};
    this.main.playlists = [this.media];
    this.main.mediaGroups.AUDIO.aud1 = {
      en: { default: true, language: 'en', resolvedUri: 'en.m3u8' }
    };

    MediaGroups.setupMediaGroups(this.settings);

    assert.notOk(
      this.mainLoader.audioDisabled_,
      'main loader: audio enabled'
    );

    // audio loader remains unchanged as there's no need for an audio loader
  });
});
