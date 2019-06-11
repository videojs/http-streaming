/* eslint-disable no-var, object-shorthand, no-console */
(function(window) {
  // all relevant elements
  var urlForm = document.getElementById('load-url');
  var sources = document.getElementById('load-source');
  var stateEls = {};

  ['debug', 'autoplay', 'muted', 'minified', 'partial', 'url'].forEach(function(name) {
    stateEls[name] = document.getElementById(name);
  });

  var getInputValue = function(el) {
    if (el.type === 'url') {
      return el.value;
    } else if (el.type === 'checkbox') {
      return el.checked;
    }

    console.warn('unhandled input type ' + el.type);
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

    window.history.replaceState(null, null, query);
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

  window.startDemo = function(cb) {
    var state = loadState();

    Object.keys(state).forEach(function(elName) {
      var el = stateEls[elName];

      if (el.type === 'url') {
        el.value = state[elName];
      } else {
        el.checked = state[elName] === 'true' ? true : false;
      }
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

        stateEls.partial.dispatchEvent(new CustomEvent('change'));

        player = window.player = window.videojs(videoEl, {
          html5: {
            hls: {
              overrideNative: !window.videojs.browser.IS_SAFARI
            }
          }
        });

        // configure videojs-contrib-eme
        player.eme();

        stateEls.debug.dispatchEvent(new CustomEvent('change'));
        stateEls.muted.dispatchEvent(new CustomEvent('change'));
        stateEls.autoplay.dispatchEvent(new CustomEvent('change'));

        // run the load url handler for the intial source
        urlForm.dispatchEvent(new CustomEvent('submit'));
        cb(player);
      });
    });

    urlForm.addEventListener('submit', function(event) {
      var type = 'application/x-mpegURL';

      event.preventDefault();

      if (getFileExtension(stateEls.url.value) === 'mpd') {
        type = 'application/dash+xml';
      }

      saveState();

      window.player.src({
        src: stateEls.url.value,
        type: type
      });
      return false;
    });

    sources.addEventListener('change', function(event) {
      event.preventDefault();
      stateEls.url.value = sources.options[sources.selectedIndex].value;
      urlForm.dispatchEvent(new CustomEvent('submit'));
      return false;
    });

    // run the change handler for the first time
    stateEls.minified.dispatchEvent(new CustomEvent('change'));
  };
}(window));
