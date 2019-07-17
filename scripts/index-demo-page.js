/* global window document */
/* eslint-disable no-var, object-shorthand, no-console */
(function(window) {
  // all relevant elements
  var urlButton = document.getElementById('load-url');
  var sources = document.getElementById('load-source');
  var stateEls = {};

  var getInputValue = function(el) {
    if (el.type === 'url' || el.type === 'text') {
      return encodeURIComponent(el.value);
    } else if (el.type === 'checkbox') {
      return el.checked;
    }

    console.warn('unhandled input type ' + el.type);
  };

  var setInputValue = function(el, value) {
    if (el.type === 'url' || el.type === 'text') {
      el.value = decodeURIComponent(value);
    } else {
      el.checked = value === 'true' ? true : false;
    }

  };

  var newEvent = function(name) {
    var event;

    if (typeof window.Event === 'function') {
      event = new window.Event(name);
    } else {
      event = document.createEvent('Event');
      event.initEvent(name, true, true);
    }

    return event;
  };

  // taken from video.js
  var getFileExtension = function(path) {
    var splitPathRe;
    var pathParts;

    if (typeof path === 'string') {
      splitPathRe = /^(\/?)([\s\S]*?)((?:\.{1,2}|[^\/]+?)(\.([^\.\/\?]+)))(?:[\/]*|[\?].*)$/i;
      pathParts = splitPathRe.exec(path);

      if (pathParts) {
        return pathParts.pop().toLowerCase();
      }
    }

    return '';
  };

  var saveState = function() {
    var query = '';

    if (!window.history.replaceState) {
      return;
    }

    Object.keys(stateEls).forEach(function(elName) {
      var symbol = query.length ? '&' : '?';

      query += symbol + elName + '=' + getInputValue(stateEls[elName]);
    });

    window.history.replaceState({}, 'vhs demo', query);
  };

  var loadState = function() {
    var params = {get: function(param) {
      return null;
    }};

    if (window.URLSearchParams) {
      params = new window.URLSearchParams(window.location.search);
    }

    return Object.keys(stateEls).reduce(function(acc, elName) {
      acc[elName] = typeof params.get(elName) !== 'object' ? params.get(elName) : getInputValue(stateEls[elName]);
      return acc;
    }, {});
  };

  var reloadScripts = function(urls, cb) {
    var el = document.getElementById('reload-scripts');
    var onload = function() {
      var script;

      if (!urls.length) {
        cb();
        return;
      }

      script = document.createElement('script');

      script.src = urls.shift();
      script.onload = onload;

      el.appendChild(script);
    };

    if (!el) {
      el = document.createElement('div');
      el.id = 'reload-scripts';
      document.body.appendChild(el);
    }

    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }

    onload();
  };

  ['debug', 'autoplay', 'muted', 'minified', 'partial', 'url', 'type'].forEach(function(name) {
    stateEls[name] = document.getElementById(name);
  });

  window.startDemo = function(cb) {
    var state = loadState();

    Object.keys(state).forEach(function(elName) {
      setInputValue(stateEls[elName], state[elName]);
    });

    // if there is a "url" param in the query params set url
    // and selected index to that
    Array.prototype.forEach.call(sources.options, function(s, i) {
      if (s.value === state.url) {
        sources.selectedIndex = i;
      }
    });

    stateEls.muted.addEventListener('change', function(event) {
      saveState();
      window.player.muted(event.target.checked);
    });

    stateEls.autoplay.addEventListener('change', function(event) {
      saveState();
      window.player.autoplay(event.target.checked);
    });

    stateEls.debug.addEventListener('change', function(event) {
      saveState();
      window.videojs.log.level(event.target.checked ? 'debug' : 'info');
    });

    stateEls.partial.addEventListener('change', function(event) {
      saveState();

      window.videojs.options = window.videojs.options || {};
      window.videojs.options.hls = window.videojs.options.hls || {};
      window.videojs.options.hls.handlePartialData = event.target.checked;

      if (window.player) {
        window.player.src(window.player.currentSource());
      }
    });

    stateEls.minified.addEventListener('change', function(event) {
      var urls = [
        'node_modules/video.js/dist/alt/video.core',
        'node_modules/videojs-contrib-eme/dist/videojs-contrib-eme',
        'node_modules/videojs-contrib-quality-levels/dist/videojs-contrib-quality-levels',
        'dist/videojs-http-streaming'
      ].map(function(url) {
        return url + (event.target.checked ? '.min' : '') + '.js';
      });

      saveState();

      if (window.player) {
        window.player.dispose();
        delete window.player;
      }
      if (window.videojs) {
        delete window.videojs;
      }

      reloadScripts(urls, function() {
        var player;
        var fixture = document.getElementById('player-fixture');
        var videoEl = document.createElement('video-js');

        videoEl.setAttribute('controls', '');
        videoEl.className = 'vjs-default-skin';
        fixture.appendChild(videoEl);

        stateEls.partial.dispatchEvent(newEvent('change'));

        player = window.player = window.videojs(videoEl, {
          html5: {
            hls: {
              overrideNative: !window.videojs.browser.IS_SAFARI
            }
          }
        });

        player.width(640);
        player.height(264);

        // configure videojs-contrib-eme
        player.eme();

        stateEls.debug.dispatchEvent(newEvent('change'));
        stateEls.muted.dispatchEvent(newEvent('change'));
        stateEls.autoplay.dispatchEvent(newEvent('change'));

        // run the load url handler for the intial source
        if (stateEls.url.value) {
          urlButton.dispatchEvent(newEvent('click'));
        } else {
          sources.dispatchEvent(newEvent('change'));
        }
        cb(player);
      });
    });

    const urlButtonClick = function(event) {
      var ext;
      var type = stateEls.type.value;

      if (!type.trim()) {
        ext = getFileExtension(stateEls.url.value);

        if (ext === 'mpd') {
          type = 'application/dash+xml';
        } else if (ext === 'm3u8') {
          type = 'application/x-mpegURL';
        }
      }

      saveState();

      window.player.src({
        src: stateEls.url.value,
        type: type
      });
    };

    urlButton.addEventListener('click', urlButtonClick);
    urlButton.addEventListener('tap', urlButtonClick);

    sources.addEventListener('change', function(event) {
      var src = sources.options[sources.selectedIndex].value;

      stateEls.url.value = src;
      stateEls.type.value = '';

      urlButton.dispatchEvent(newEvent('click'));
    });

    // run the change handler for the first time
    stateEls.minified.dispatchEvent(newEvent('change'));
  };
}(window));
