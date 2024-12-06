import QUnit from 'qunit';
import {
  forEachMediaGroup,
  mergeSegments,
  mergeSegment,
  mergeMedia,
  forEachPlaylist,
  mergeManifest
} from '../../src/playlist-loader/utils.js';
import {absoluteUrl} from '../test-helpers.js';

QUnit.module('Playlist Loader Utils', function(hooks) {

  QUnit.module('forEachMediaGroup');

  QUnit.test('does not error when passed null', function(assert) {
    assert.expect(1);
    let i = 0;

    forEachMediaGroup(null, function(props, type, group, label) {
      i++;
    });

    assert.equal(i, 0, 'did not loop');
  });

  QUnit.test('does not error without groups', function(assert) {
    assert.expect(1);
    const manifest = {};

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      i++;
    });

    assert.equal(i, 0, 'did not loop');
  });

  QUnit.test('does not error with no group keys', function(assert) {
    assert.expect(1);
    const manifest = {
      mediaGroups: {
        SUBTITLES: {}
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      i++;
    });

    assert.equal(i, 0, 'did not loop');
  });

  QUnit.test('does not error with null group key', function(assert) {
    assert.expect(1);
    const manifest = {
      mediaGroups: {
        SUBTITLES: {en: null}
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      i++;
    });

    assert.equal(i, 0, 'did not loop');
  });

  QUnit.test('does not error with null label key', function(assert) {
    assert.expect(1);
    const manifest = {
      mediaGroups: {
        SUBTITLES: {en: {main: null}}
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      i++;
    });

    assert.equal(i, 0, 'did not loop');
  });

  QUnit.test('does not error with empty label keys', function(assert) {
    assert.expect(1);
    const manifest = {
      mediaGroups: {
        SUBTITLES: {en: {}}
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      i++;
    });

    assert.equal(i, 0, 'did not loop');
  });

  QUnit.test('can loop over subtitle groups', function(assert) {
    assert.expect(16);
    const manifest = {
      mediaGroups: {
        SUBTITLES: {
          en: {
            main: {foo: 'bar'},
            alt: {fizz: 'buzz'}
          },
          es: {
            main: {a: 'b'},
            alt: {yes: 'no'}
          }
        }
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      if (i === 0) {
        assert.deepEqual(props, {foo: 'bar'});
        assert.deepEqual(type, 'SUBTITLES');
        assert.deepEqual(group, 'en');
        assert.deepEqual(label, 'main');
      } else if (i === 1) {
        assert.deepEqual(props, {fizz: 'buzz'});
        assert.deepEqual(type, 'SUBTITLES');
        assert.deepEqual(group, 'en');
        assert.deepEqual(label, 'alt');
      } else if (i === 2) {
        assert.deepEqual(props, {a: 'b'});
        assert.deepEqual(type, 'SUBTITLES');
        assert.deepEqual(group, 'es');
        assert.deepEqual(label, 'main');
      } else if (i === 3) {
        assert.deepEqual(props, {yes: 'no'});
        assert.deepEqual(type, 'SUBTITLES');
        assert.deepEqual(group, 'es');
        assert.deepEqual(label, 'alt');
      }

      i++;
    });

  });

  QUnit.test('can loop over audio groups', function(assert) {
    assert.expect(16);
    const manifest = {
      mediaGroups: {
        AUDIO: {
          en: {
            main: {foo: 'bar'},
            alt: {fizz: 'buzz'}
          },
          es: {
            main: {a: 'b'},
            alt: {yes: 'no'}
          }
        }
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      if (i === 0) {
        assert.deepEqual(props, {foo: 'bar'});
        assert.deepEqual(type, 'AUDIO');
        assert.deepEqual(group, 'en');
        assert.deepEqual(label, 'main');
      } else if (i === 1) {
        assert.deepEqual(props, {fizz: 'buzz'});
        assert.deepEqual(type, 'AUDIO');
        assert.deepEqual(group, 'en');
        assert.deepEqual(label, 'alt');
      } else if (i === 2) {
        assert.deepEqual(props, {a: 'b'});
        assert.deepEqual(type, 'AUDIO');
        assert.deepEqual(group, 'es');
        assert.deepEqual(label, 'main');
      } else if (i === 3) {
        assert.deepEqual(props, {yes: 'no'});
        assert.deepEqual(type, 'AUDIO');
        assert.deepEqual(group, 'es');
        assert.deepEqual(label, 'alt');
      }

      i++;
    });
  });

  QUnit.test('can loop over both groups', function(assert) {
    assert.expect(16);
    const manifest = {
      mediaGroups: {
        AUDIO: {
          en: {
            main: {foo: 'bar'}
          },
          es: {
            main: {a: 'b'}
          }
        },
        SUBTITLES: {
          en: {
            main: {foo: 'bar'}
          },
          es: {
            main: {a: 'b'}
          }
        }
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      if (i === 0) {
        assert.deepEqual(props, {foo: 'bar'});
        assert.deepEqual(type, 'AUDIO');
        assert.deepEqual(group, 'en');
        assert.deepEqual(label, 'main');
      } else if (i === 1) {
        assert.deepEqual(props, {a: 'b'});
        assert.deepEqual(type, 'AUDIO');
        assert.deepEqual(group, 'es');
        assert.deepEqual(label, 'main');
      } else if (i === 2) {
        assert.deepEqual(props, {foo: 'bar'});
        assert.deepEqual(type, 'SUBTITLES');
        assert.deepEqual(group, 'en');
        assert.deepEqual(label, 'main');
      } else if (i === 3) {
        assert.deepEqual(props, {a: 'b'});
        assert.deepEqual(type, 'SUBTITLES');
        assert.deepEqual(group, 'es');
        assert.deepEqual(label, 'main');
      }
      i++;
    });
  });

  QUnit.test('can loop over both groups', function(assert) {
    assert.expect(16);
    const manifest = {
      mediaGroups: {
        AUDIO: {
          en: {
            main: {foo: 'bar'}
          },
          es: {
            main: {a: 'b'}
          }
        },
        SUBTITLES: {
          en: {
            main: {foo: 'bar'}
          },
          es: {
            main: {a: 'b'}
          }
        }
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      if (i === 0) {
        assert.deepEqual(props, {foo: 'bar'});
        assert.deepEqual(type, 'AUDIO');
        assert.deepEqual(group, 'en');
        assert.deepEqual(label, 'main');
      } else if (i === 1) {
        assert.deepEqual(props, {a: 'b'});
        assert.deepEqual(type, 'AUDIO');
        assert.deepEqual(group, 'es');
        assert.deepEqual(label, 'main');
      } else if (i === 2) {
        assert.deepEqual(props, {foo: 'bar'});
        assert.deepEqual(type, 'SUBTITLES');
        assert.deepEqual(group, 'en');
        assert.deepEqual(label, 'main');
      } else if (i === 3) {
        assert.deepEqual(props, {a: 'b'});
        assert.deepEqual(type, 'SUBTITLES');
        assert.deepEqual(group, 'es');
        assert.deepEqual(label, 'main');
      }
      i++;
    });
  });

  QUnit.test('can stop looping by returning a true value', function(assert) {
    assert.expect(1);
    const manifest = {
      mediaGroups: {
        AUDIO: {
          en: {
            main: {foo: 'bar'}
          },
          es: {
            main: {a: 'b'}
          }
        },
        SUBTITLES: {
          en: {
            main: {foo: 'bar'}
          },
          es: {
            main: {a: 'b'}
          }
        }
      }
    };

    let i = 0;

    forEachMediaGroup(manifest, function(props, type, group, label) {
      i++;

      if (i === 2) {
        return true;
      }

    });

    assert.equal(i, 2, 'loop was stopped early');
  });

  QUnit.module('mergeSegments');

  QUnit.test('no oldSegments', function(assert) {
    const {updated, segments} = mergeSegments({
      oldSegments: null,
      newSegments: [{duration: 1}]
    });

    assert.true(updated, 'was updated');
    assert.deepEqual(
      segments,
      [{duration: 1}],
      'result as expected'
    );
  });

  QUnit.test('keeps timing info from old segment', function(assert) {
    const {updated, segments} = mergeSegments({
      oldSegments: [{duration: 1, timingInfo: {audio: {start: 1, end: 2}}}],
      newSegments: [{duration: 1}]
    });

    assert.false(updated, 'was not updated');
    assert.deepEqual(
      segments,
      [{duration: 1, timingInfo: {audio: {start: 1, end: 2}}}],
      'result as expected'
    );
  });

  QUnit.test('keeps map from old segment', function(assert) {
    const {updated, segments} = mergeSegments({
      oldSegments: [{map: {uri: 'foo.uri'}, duration: 1}],
      newSegments: [{duration: 1}]
    });

    assert.false(updated, 'was not updated');
    assert.deepEqual(
      segments,
      [{duration: 1, map: {uri: 'foo.uri', resolvedUri: absoluteUrl('foo.uri')}}],
      'result as expected'
    );
  });

  QUnit.test('adds map to all new segment', function(assert) {
    const {updated, segments} = mergeSegments({
      oldSegments: [],
      newSegments: [{map: {uri: 'foo.uri'}, duration: 1}, {duration: 1}]
    });

    assert.true(updated, 'was updated');
    assert.deepEqual(
      segments,
      [
        {duration: 1, map: {uri: 'foo.uri', resolvedUri: absoluteUrl('foo.uri')}},
        {duration: 1, map: {uri: 'foo.uri', resolvedUri: absoluteUrl('foo.uri')}}
      ],
      'result as expected'
    );
  });

  QUnit.test('resolves all segment uris', function(assert) {
    const {updated, segments} = mergeSegments({
      oldSegments: [],
      newSegments: [{
        uri: 'segment.mp4',
        map: {
          uri: 'init.mp4',
          key: {uri: 'mapkey.uri'}
        },
        key: {uri: 'key.uri'},
        parts: [{uri: 'part1.uri'}, {resolvedUri: absoluteUrl('part2.uri'), uri: 'part2.uri'}],
        preloadHints: [{uri: 'hint1.uri'}, {resolvedUri: absoluteUrl('hint2.uri'), uri: 'hint2.uri'}]
      }]
    });

    assert.true(updated, 'was updated');
    assert.deepEqual(segments, [{
      uri: 'segment.mp4',
      resolvedUri: absoluteUrl('segment.mp4'),
      map: {
        uri: 'init.mp4',
        resolvedUri: absoluteUrl('init.mp4'),
        key: {uri: 'mapkey.uri', resolvedUri: absoluteUrl('mapkey.uri')}
      },
      key: {uri: 'key.uri', resolvedUri: absoluteUrl('key.uri')},
      parts: [
        {uri: 'part1.uri', resolvedUri: absoluteUrl('part1.uri')},
        {uri: 'part2.uri', resolvedUri: absoluteUrl('part2.uri')}
      ],
      preloadHints: [
        {uri: 'hint1.uri', resolvedUri: absoluteUrl('hint1.uri')},
        {uri: 'hint2.uri', resolvedUri: absoluteUrl('hint2.uri')}
      ]
    }], 'result as expected');
  });

  QUnit.test('resolves all segment uris using baseUri', function(assert) {
    const baseUri = 'http://example.com';
    const {updated, segments} = mergeSegments({
      baseUri: 'http://example.com/media.m3u8',
      oldSegments: [],
      newSegments: [{
        uri: 'segment.mp4',
        map: {
          uri: 'init.mp4',
          key: {uri: 'mapkey.uri'}
        },
        key: {uri: 'key.uri'},
        parts: [{uri: 'part.uri'}],
        preloadHints: [{uri: 'hint.uri'}]
      }]
    });

    assert.true(updated, 'was updated');
    assert.deepEqual(segments, [{
      uri: 'segment.mp4',
      resolvedUri: `${baseUri}/segment.mp4`,
      map: {
        uri: 'init.mp4',
        resolvedUri: `${baseUri}/init.mp4`,
        key: {uri: 'mapkey.uri', resolvedUri: `${baseUri}/mapkey.uri`}
      },
      key: {uri: 'key.uri', resolvedUri: `${baseUri}/key.uri`},
      parts: [{uri: 'part.uri', resolvedUri: `${baseUri}/part.uri`}],
      preloadHints: [{uri: 'hint.uri', resolvedUri: `${baseUri}/hint.uri`}]
    }], 'result as expected');
  });

  QUnit.test('can merge on an offset', function(assert) {
    const {updated, segments} = mergeSegments({
      oldSegments: [{uri: '1', duration: 1}, {uri: '2', duration: 1}, {uri: '3', duration: 1, foo: 'bar'}],
      newSegments: [{uri: '2', duration: 1}, {uri: '3', duration: 1}],
      offset: 1
    });

    assert.true(updated, 'was updated');
    assert.deepEqual(
      segments,
      [
        {duration: 1, uri: '2', resolvedUri: absoluteUrl('2')},
        {duration: 1, uri: '3', resolvedUri: absoluteUrl('3'), foo: 'bar'}
      ],
      'result as expected'
    );
  });

  QUnit.module('mergeSegment');

  QUnit.test('updated without old segment', function(assert) {
    const oldSegment = null;
    const newSegment = {uri: 'foo.mp4'};
    const result = mergeSegment(oldSegment, newSegment);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(result.segment, {uri: 'foo.mp4'}, 'as expected');
  });

  QUnit.test('updated if new segment has no parts', function(assert) {
    const oldSegment = {uri: 'foo.mp4', parts: [{uri: 'foo-p1.mp4'}]};
    const newSegment = {uri: 'foo.mp4'};
    const result = mergeSegment(oldSegment, newSegment);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(result.segment, {uri: 'foo.mp4'}, 'as expected');
  });

  QUnit.test('updated if new segment has no preloadHints', function(assert) {
    const oldSegment = {uri: 'foo.mp4', preloadHints: [{uri: 'foo-p1.mp4'}]};
    const newSegment = {uri: 'foo.mp4'};
    const result = mergeSegment(oldSegment, newSegment);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(result.segment, {uri: 'foo.mp4'}, 'as expected');
  });

  QUnit.test('updated with different number of parts', function(assert) {
    const oldSegment = {uri: 'foo.mp4', parts: [{uri: 'foo-p1.mp4'}]};
    const newSegment = {uri: 'foo.mp4', parts: [{uri: 'foo-p1.mp4'}, {uri: 'foo-p2.mp4'}]};
    const result = mergeSegment(oldSegment, newSegment);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(result.segment, {
      uri: 'foo.mp4',
      parts: [
        {uri: 'foo-p1.mp4'},
        {uri: 'foo-p2.mp4'}
      ]
    }, 'as expected');
  });

  QUnit.test('preload removed if new segment lacks it', function(assert) {
    const oldSegment = {preload: true};
    const newSegment = {uri: 'foo.mp4'};
    const result = mergeSegment(oldSegment, newSegment);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(result.segment, {uri: 'foo.mp4'}, 'as expected');
  });

  QUnit.test('if old segment was not skipped skipped is removed', function(assert) {
    const oldSegment = {uri: 'foo.mp4'};
    const newSegment = {skipped: true};
    const result = mergeSegment(oldSegment, newSegment);

    assert.false(result.updated, 'was not updated');
    assert.deepEqual(result.segment, {uri: 'foo.mp4'}, 'as expected');
  });

  QUnit.test('merges part properties', function(assert) {
    const oldSegment = {uri: 'foo.mp4', parts: [{uri: 'part', foo: 'bar'}]};
    const newSegment = {uri: 'foo.mp4', parts: [{uri: 'part'}]};
    const result = mergeSegment(oldSegment, newSegment);

    assert.false(result.updated, 'was not updated');
    assert.deepEqual(result.segment, {uri: 'foo.mp4', parts: [{uri: 'part', foo: 'bar'}]}, 'as expected');
  });

  QUnit.module('mergeMedia');

  QUnit.test('is updated without old media', function(assert) {
    const oldMedia = null;
    const newMedia = {mediaSequence: 0};
    const result = mergeMedia({
      oldMedia,
      newMedia,
      baseUri: null
    });

    assert.true(result.updated, 'was updated');
    assert.deepEqual(
      result.media,
      {mediaSequence: 0, segments: []},
      'as expected'
    );
  });

  QUnit.test('is updated if key added', function(assert) {
    const oldMedia = {mediaSequence: 0};
    const newMedia = {mediaSequence: 0, endList: true};
    const result = mergeMedia({
      oldMedia,
      newMedia,
      baseUri: null
    });

    assert.true(result.updated, 'was updated');
    assert.deepEqual(
      result.media,
      {mediaSequence: 0, segments: [], endList: true},
      'as expected'
    );
  });

  QUnit.test('is updated if key changes', function(assert) {
    const oldMedia = {mediaSequence: 0, preloadSegment: {parts: [{duration: 1}]}};
    const newMedia = {mediaSequence: 0, preloadSegment: {parts: [{duration: 1}, {duration: 1}]}};
    const result = mergeMedia({
      oldMedia,
      newMedia,
      baseUri: null
    });

    assert.true(result.updated, 'was updated');
    assert.deepEqual(
      result.media,
      {
        mediaSequence: 0,
        preloadSegment: {parts: [{duration: 1}, {duration: 1}]},
        segments: []
      },
      'as expected'
    );
  });

  QUnit.test('is updated if key removed', function(assert) {
    const oldMedia = {mediaSequence: 0, preloadSegment: {parts: [{duration: 1}]}};
    const newMedia = {mediaSequence: 0};
    const result = mergeMedia({
      oldMedia,
      newMedia,
      baseUri: null
    });

    assert.true(result.updated, 'was updated');
    assert.deepEqual(
      result.media,
      {
        mediaSequence: 0,
        segments: []
      },
      'as expected'
    );
  });

  QUnit.module('forEachPlaylist');

  QUnit.test('loops over playlists and group playlists', function(assert) {
    const manifest = {
      playlists: [{one: 'one'}, {two: 'two'}],
      mediaGroups: {
        AUDIO: {
          en: {
            main: {foo: 'bar', playlists: [{three: 'three'}]}
          },
          es: {
            main: {a: 'b', playlists: [{four: 'four' }]}
          }
        },
        SUBTITLES: {
          en: {
            main: {foo: 'bar', playlists: [{five: 'five'}]}
          },
          es: {
            main: {a: 'b', playlists: [{six: 'six'}]}
          }
        }
      }
    };

    let i = 0;

    forEachPlaylist(manifest, function(playlist, index, array) {
      if (i === 0) {
        assert.deepEqual(playlist, {one: 'one'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.playlists, 'array is correct');
      } else if (i === 1) {
        assert.deepEqual(playlist, {two: 'two'}, 'playlist as expected');
        assert.equal(index, 1, 'index as expected');
        assert.equal(array, manifest.playlists, 'array is correct');
      } else if (i === 2) {
        assert.deepEqual(playlist, {three: 'three'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.mediaGroups.AUDIO.en.main.playlists, 'array is correct');
      } else if (i === 3) {
        assert.deepEqual(playlist, {four: 'four'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.mediaGroups.AUDIO.es.main.playlists, 'array is correct');
      } else if (i === 4) {
        assert.deepEqual(playlist, {five: 'five'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.mediaGroups.SUBTITLES.en.main.playlists, 'array is correct');
      } else if (i === 5) {
        assert.deepEqual(playlist, {six: 'six'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.mediaGroups.SUBTITLES.es.main.playlists, 'array is correct');
      }
      i++;
    });

    assert.equal(i, 6, 'six playlists');
  });

  QUnit.test('loops over just groups', function(assert) {
    const manifest = {
      mediaGroups: {
        AUDIO: {
          en: {
            main: {foo: 'bar', playlists: [{three: 'three'}]}
          },
          es: {
            main: {a: 'b', playlists: [{four: 'four' }]}
          }
        },
        SUBTITLES: {
          en: {
            main: {foo: 'bar', playlists: [{five: 'five'}]}
          },
          es: {
            main: {a: 'b', playlists: [{six: 'six'}]}
          }
        }
      }
    };

    let i = 0;

    forEachPlaylist(manifest, function(playlist, index, array) {
      if (i === 0) {
        assert.deepEqual(playlist, {three: 'three'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.mediaGroups.AUDIO.en.main.playlists, 'array is correct');
      } else if (i === 1) {
        assert.deepEqual(playlist, {four: 'four'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.mediaGroups.AUDIO.es.main.playlists, 'array is correct');
      } else if (i === 2) {
        assert.deepEqual(playlist, {five: 'five'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.mediaGroups.SUBTITLES.en.main.playlists, 'array is correct');
      } else if (i === 3) {
        assert.deepEqual(playlist, {six: 'six'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.mediaGroups.SUBTITLES.es.main.playlists, 'array is correct');
      }
      i++;
    });

    assert.equal(i, 4, 'four playlists');
  });

  QUnit.test('loops over playlists only', function(assert) {
    const manifest = {
      playlists: [{one: 'one'}, {two: 'two'}]
    };

    let i = 0;

    forEachPlaylist(manifest, function(playlist, index, array) {
      if (i === 0) {
        assert.deepEqual(playlist, {one: 'one'}, 'playlist as expected');
        assert.equal(index, 0, 'index as expected');
        assert.equal(array, manifest.playlists, 'array is correct');
      } else if (i === 1) {
        assert.deepEqual(playlist, {two: 'two'}, 'playlist as expected');
        assert.equal(index, 1, 'index as expected');
        assert.equal(array, manifest.playlists, 'array is correct');
      }
      i++;
    });

    assert.equal(i, 2, 'two playlists');
  });

  QUnit.test('does not error when passed null', function(assert) {
    assert.expect(1);
    let i = 0;

    forEachPlaylist(null, function(playlist, index, array) {
      i++;
    });

    assert.equal(i, 0, 'did not loop');
  });

  QUnit.test('does not error without groups', function(assert) {
    assert.expect(1);
    const manifest = {};

    let i = 0;

    forEachPlaylist(manifest, function(playlist, index, array) {
      i++;
    });

    assert.equal(i, 0, 'did not loop');
  });

  QUnit.test('can stop in media groups', function(assert) {
    const manifest = {
      mediaGroups: {
        AUDIO: {
          en: {
            main: {foo: 'bar', playlists: [{three: 'three'}]}
          },
          es: {
            main: {a: 'b', playlists: [{four: 'four' }]}
          }
        },
        SUBTITLES: {
          en: {
            main: {foo: 'bar', playlists: [{five: 'five'}]}
          },
          es: {
            main: {a: 'b', playlists: [{six: 'six'}]}
          }
        }
      }
    };

    let i = 0;

    forEachPlaylist(manifest, function(playlist, index, array) {
      i++;
      return true;
    });

    assert.equal(i, 1, 'looped once');
  });

  QUnit.test('can stop in playlists', function(assert) {
    const manifest = {
      playlists: [{one: 'one'}, {two: 'two'}]
    };

    let i = 0;

    forEachPlaylist(manifest, function(playlist, index, array) {
      i++;
      return true;
    });

    assert.equal(i, 1, 'looped once');
  });

  QUnit.module('mergeManifest');

  QUnit.test('is updated without manifest a', function(assert) {
    const oldManifest = null;
    const newManifest = {mediaSequence: 0};
    const result = mergeManifest(oldManifest, newManifest);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(
      result.manifest,
      {mediaSequence: 0},
      'as expected'
    );
  });

  QUnit.test('is updated if b lack key that a has', function(assert) {
    const oldManifest = {mediaSequence: 0, foo: 'bar'};
    const newManifest = {mediaSequence: 0};
    const result = mergeManifest(oldManifest, newManifest);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(
      result.manifest,
      {mediaSequence: 0},
      'as expected'
    );
  });

  QUnit.test('is updated if a lack key that b has', function(assert) {
    const oldManifest = {mediaSequence: 0};
    const newManifest = {mediaSequence: 0, foo: 'bar'};
    const result = mergeManifest(oldManifest, newManifest);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(
      result.manifest,
      {mediaSequence: 0, foo: 'bar'},
      'as expected'
    );
  });

  QUnit.test('is updated if key value is different', function(assert) {
    const oldManifest = {mediaSequence: 0};
    const newManifest = {mediaSequence: 1};
    const result = mergeManifest(oldManifest, newManifest);

    assert.true(result.updated, 'was updated');
    assert.deepEqual(
      result.manifest,
      {mediaSequence: 1},
      'as expected'
    );
  });

  QUnit.test('is not updated if key value is the same', function(assert) {
    const oldManifest = {mediaSequence: 0};
    const newManifest = {mediaSequence: 0};
    const result = mergeManifest(oldManifest, newManifest);

    assert.false(result.updated, 'was not updated');
    assert.deepEqual(
      result.manifest,
      {mediaSequence: 0},
      'as expected'
    );
  });

  QUnit.test('is not updated if key value is the same', function(assert) {
    const oldManifest = {mediaSequence: 0};
    const newManifest = {mediaSequence: 0};
    const result = mergeManifest(oldManifest, newManifest);

    assert.false(result.updated, 'was not updated');
    assert.deepEqual(
      result.manifest,
      {mediaSequence: 0},
      'as expected'
    );
  });

  QUnit.test('is not updated if key value is changed but ignored', function(assert) {
    const oldManifest = {mediaSequence: 0};
    const newManifest = {mediaSequence: 1};
    const result = mergeManifest(oldManifest, newManifest, ['mediaSequence']);

    assert.false(result.updated, 'was not updated');
    assert.deepEqual(
      result.manifest,
      {mediaSequence: 1},
      'as expected'
    );
  });

  QUnit.test('excluded key is not brought over', function(assert) {
    const oldManifest = {mediaSequence: 0, foo: 'bar'};
    const newManifest = {mediaSequence: 0};
    const result = mergeManifest(oldManifest, newManifest, ['foo']);

    assert.false(result.updated, 'was not updated');
    assert.deepEqual(
      result.manifest,
      {mediaSequence: 0},
      'as expected'
    );
  });
});

