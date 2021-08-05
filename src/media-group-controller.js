import logger from './util/logger';
import {playlistMatch} from './playlist.js';
import videojs from 'video.js';
import DashMainPlaylistLoader from './dash-playlist-loader.js';
import HlsMainPlaylistLoader from './hls-playlist-loader.js';

const DashMediaPlaylistLoader = {};
const HlsMediaPlaylistLoader = {};

const groupMatch = (variants, media) => {
  const variantLabels = Object.keys(variants);

  for (let i = 0; i < variantLabels.length; i++) {
    const variant = variants[variantLabels[i]];

    if (playlistMatch(media, variant)) {
      return true;
    }

    if (variant.playlists && groupMatch(variant.playlists, media)) {
      return true;
    }
  }

  return false;
};

const getDefaultGroup = (groups) => {
  const groupKeys = Object.keys(groups);

  if (!groupKeys.length) {
    return;
  }

  // the "main" group if we have one
  if (groups.main) {
    return groups.main;
  }

  // otherwise retrun the first group
  return groups[groupKeys[0]];
};

const isTrackActive = ({type, track}) => {
  if (type === 'AUDIO') {
    return track.enabled;
  } else if (type === 'VIDEO') {
    return track.selected;
  } else if (type === 'CLOSED-CAPTIONS' || type === 'SUBTITLES') {
    return track.mode === 'showing' || track.mode === 'hidden';
  }
};

const changeTrackState = ({type, track, enabled}) => {
  if (type === 'AUDIO') {
    track.enabled = enabled;
  } else if (type === 'VIDEO') {
    track.selected = enabled;
  } else if (type === 'CLOSED-CAPTIONS' || type === 'SUBTITLES') {
    track.mode = enabled ? 'showing' : 'disabled';
  }
};

const groupToTrack = ({type, name, properties, tech}) => {
  if (type === 'AUDIO') {
    let kind = properties.default ? 'main' : 'alternative';

    if (properties.characteristics &&
        properties.characteristics.indexOf('public.accessibility.describes-video') >= 0) {
      kind = 'main-desc';
    }

    return new videojs.AudioTrack({
      id: name,
      kind,
      enabled: false,
      language: properties.language,
      label: name
    });
  }

  // TODO: merge 608/708 props
  // TODO: should we use addRemoteTextTrack
  if (type === 'SUBTITLES' || type === 'CLOSED-CAPTIONS') {
    return new videojs.TextTrack({
      id: properties.instreamId,
      kind: type === 'SUBTITLES' ? 'subtitles' : 'captions',
      language: properties.language,
      label: properties.label || name,
      tech
    });
  }

  if (type === 'VIDEO') {
    return new videojs.VideoTrack({
      id: name,
      kind: 'main',
      language: properties.language,
      selected: false,
      label: name
    });
  }
};

const typeToTrackName = (type) => {
  if (type === 'AUDIO') {
    return 'audio';
  } else if (type === 'VIDEO') {
    return 'video';
  } else if (type === 'SUBTITLES' || type === 'CLOSED-CAPTIONS') {
    return 'text';
  }
};

// BipBop Audio 1, BipBop Audio 2

class MediaGroup {
  constructor({type, group, id, tracks, loaders, tech}) {
    this.logger_ = logger(`MediaGroup[${type}-${id}]`);
    this.group = group;
    this.type = type;
    this.id = id;
    this.active_ = false;

    for (const groupTrackName in group) {
      if (!tracks[groupTrackName]) {
        tracks[groupTrackName] = groupToTrack({
          type: this.type,
          name: groupTrackName,
          properties: group[groupTrackName],
          tech
        });
        // loaders[groupTrackName] = new PlaylistLoader();
      }
    }
  }

  getGroupTrack(trackId) {
    return this.group[trackId];
  }
}

class MediaGroupType {
  constructor({type, tech}) {
    this.type = type;
    this.tech_ = tech;
    this.trackList = this.tech_[`${typeToTrackName(this.type)}Tracks`]();
    this.logger_ = logger(`MediaGroupType[${this.type}]`);
    this.reset();

    this.handleMainMediaChanging_ = this.handleMainMediaChanging_.bind(this);
    this.handleMainMediaChanged_ = this.handleMainMediaChanged_.bind(this);
    this.handleTrackChanged_ = this.handleTrackChanged_.bind(this);

    this.activePlaylistLoader_ = null;
    this.segmentLoader_ = null;
  }

  init({groupIdObject, mainMediaGroupType, segmentLoaderSettings}) {
    this.reset();

    this.isMainMediaGroupType_ = mainMediaGroupType === this;

    segmentLoaderSettings.loaderType = this.isMainMediaGroupType_ ? 'main' : this.type.toLowerCase();

    if (!this.isMainMediaGroupType_) {
      mainMediaGroupType.on('changing', this.handleMainMediaChanging_);
      mainMediaGroupType.on('changed', this.handleMainMediaChanged_);
    }

    for (const groupId in groupIdObject) {
      this.groups[groupId] = new MediaGroup({
        id: groupId,
        type: this.type,
        group: groupIdObject[groupId],
        tracks: this.tracks,
        tech: this.tech_
      });
    }

    this.defaultGroup = getDefaultGroup(this.groups);

    for (const trackId in this.tracks) {
      const groupTrack = this.defaultGroup && this.defaultGroup.getGroupTrack(trackId);

      if (groupTrack && groupTrack.default) {
        this.defaultTrack = this.tracks[trackId];
      }
      this.trackList.addTrack(this.tracks[trackId]);
    }

    const activeGroupVariant = this.getActiveGroupVariant();

    if (activeGroupVariant.groupTrack) {
      changeTrackState({
        track: activeGroupVariant.activeTrack,
        enabled: true,
        type: this.type
      });
    }

    this.trackList.addEventListener('change', this.handleTrackChanged_);
  }

  changeActivePlaylistLoader_(loader) {
    this.trigger('changing');

    if (this.activePlaylistLoader_) {
      this.activePlaylistLoader_.abort();
      this.activePlaylistLoader_.pause();
      this.activePlaylistLoader_ = null;
    }

    if (loader) {
      this.activePlaylistLoader_ = loader;
      this.activePlaylistLoader_.load();
    }

    this.trigger('changed');
  }

  handleTrackChanged_() {
    // track change will happen when the media group finishes changing.
    if (this.mainMediaGroupChanging_) {
      return;
    }

    this.handleGroupChanged_();
  }

  /**
   * determine if main media changing will change our group.
   */
  handleMainMediaChanging_() {
    this.mainMediaGroupChanging_ = true;
    const currentGroup = this.getActiveGroup(this.mainMediaGroupType.currentMedia());
    const nextGroup = this.getActiveGroup(this.mainMediaGroupType.pendingMedia());
    const groupChanged = (!currentGroup && nextGroup) ||
      (currentGroup && !nextGroup) ||
      (currentGroup && nextGroup && currentGroup.id !== nextGroup.id);

    // if the group is going to be changing,
    // reset and stop the segment/playlist loader.
    if (!groupChanged) {
      return;
    }

    if (this.segmentLoader) {
      this.segmentLoader.abort();
      this.segmentLoader.pause();
    }
    if (this.activePlaylistLoader_) {
      // TODO
    }
  }

  handleMainMediaChanged_() {
    this.mainMediaGroupChanging_ = null;

    this.getActiveGroupVariant();
  }

  getActiveGroup(mainMedia = this.mainMediaGroupType.media()) {
    const currentGroup = mainMedia && mainMedia.attributes && mainMedia.attributes[this.type];

    let group = {};

    // if we have a group listed for the active media
    // and that group exists, that is the active group.
    if (currentGroup && this.groups[currentGroup]) {
      group = this.groups[currentGroup];
    } else {
      const groupKeys = Object.keys(this.groups);

      // if we don't have an active media group listed
      // but we do have active media groups. See if the
      // main media is equivalent to any of our groups.
      for (let i = 0; i < groupKeys.length; i++) {
        const groupTracks = this.groups[groupKeys[i]];

        if (groupMatch(groupTracks, mainMedia)) {
          group = this.groups[groupKeys[i]];
          break;
        }
      }
    }

    return group;
  }

  getActiveTrack() {
    for (let i = 0; i < this.trackList.length; i++) {
      const track = this.trackList[i];

      if (isTrackActive({type: this.type, track})) {
        return track;
      }
    }
  }

  getActiveGroupVariant(mainMedia = this.mainPlaylistLoader.media()) {
    const activeGroup = this.getActiveGroup(mainMedia) || this.defaultGroup;
    const activeTrack = this.getActiveTrack() || this.defaultTrack;

    const groupTrack = activeGroup && activeTrack && activeGroup.getGroupTrack(activeTrack.id);

    return {
      groupTrack,
      activeTrack
    };
  }

  reset() {
    if (this.segmentLoader) {
      this.segmentLoader.abort();
      this.segmentLoader.pause();
    }
    for (const groupId in this.groups) {
      this.groups[groupId].dispose();
    }
    this.groups = {};
    this.tracks = {};
    this.defaultGroup = null;
    this.tech_.clearTracks(typeToTrackName(this.type));
  }

  dispose() {
    this.reset();
  }
}

class MediaGroupController {
  constructor({tech, mainPlaylistLoader, segmentLoaderSettings, playlistLoaderSettings}) {
    this.segmentLoaderSettings_ = segmentLoaderSettings;
    this.tech_ = tech;
    this.mediaGroups = {};
    this.handleMainLoaded_ = this.handleMainLoaded_.bind(this);
    this.mainPlaylistLoader.on('loadedmetadata', this.handleMainLoaded_);

    ['AUDIO', 'VIDEO', 'SUBTITLES', 'CLOSED-CAPTIONS'].forEach(function(type) {
      this.mediaGroups[type] = new MediaGroupType({type, tech});
    });
  }

  handleMainLoaded_() {
    const mainPlaylist = this.mainPlaylistLoader.master;
    const mainMediaGroupType = this.mediaGroups.VIDEO;

    // TODO: Create a playlist loader for every playlist and media group playlist.
    // TODO: determine the mainMediaGroupType
    this.loaders = {};

    mainPlaylist.playlists.forEach((playlist) => {
      let loader;

      if (mainPlaylist instanceof DashMainPlaylistLoader) {
        loader = new DashMediaPlaylistLoader(this.playlistLoaderSettings_, playlist);
      } else if (mainPlaylist instanceof HlsMainPlaylistLoader) {
        loader = new HlsMediaPlaylistLoader(this.playlistLoaderSettings_, playlist);
      }

      this.loaders[loader.uri()] = loader;
    });

    Object.keys(this.mediaGroups).forEach((type) => {
      this.mediaGroups[type].init({
        mainMediaGroupType,
        groupIdObject: mainPlaylist.mediaGroups[type],
        loaders: this.loaders,
        segmentLoaderSettings: this.segmentLoaderSettings_
      });
    });
  }

  mainSegmentLoader() {
    return this.mainMediaGroupType.segmentLoader;
  }

  mainPlaylistLoader() {
    return this.mainMediaGroupType.activePlaylistLoader;
  }

  isMediaGroupActive(type) {
    return !!this.mediaGroups[type].activePlaylistLoader;
  }

  getActiveTrack(type) {
    if (!this.isMediaGroupActive(type)) {
      return;
    }
    return this.mediaGroups[type].getActiveTrack();
  }

  getActiveGroup(type) {
    if (!this.isMediaGroupActive(type)) {
      return;
    }
    return this.mediaGroups[type].getActiveGroup();
  }

  getActiveVariant(type) {
    if (!this.isMediaGroupActive(type)) {
      return;
    }
    return this.mediaGroups[type].getActiveGroup();
  }
}

export default MediaGroupController;
