// eslint-disable-next-line no-undef
const videojs = window.videojs;

class RenditionMenuItem extends videojs.getComponent('MenuItem') {
  constructor(player, options = {}) {
    options.selectable = true;
    options.multiSelectable = false;

    super(player, options);
  }

  handleClick() {
    this.player().log(`${this.options_.index}: ${this.options_.label} selected`);
    this.parentComponent_.children().forEach((item) => {
      if (item !== this) {
        item.selected(false);
      }
    });
    super.handleClick();

    const levels = this.player().qualityLevels();

    for (let i = 0; i < levels.length; i++) {
      if (this.options_.index === 'auto') {
        levels[i].enabled = true;
      } else if (this.options_.index === i) {
        levels[i].enabled = true;
      } else {
        levels[i].enabled = false;
      }
    }
  }
}

videojs.registerComponent('RentitionMenuItem', RenditionMenuItem);

class RenditionMenuButton extends videojs.getComponent('MenuButton') {
  constructor(player, options = {}) {
    options.controlText = 'Auto';

    super(player, options);

    this.el_.setAttribute('aria-label', this.localize('Rendition selector'));
    // this.addClass('vjs-visible-text'); - vjs-visible-text too specific for menu buttons
    this.$('button').classList.add('vjs-visible-text');
    this.levels = this.player().qualityLevels();

    this.levels.on('change', this.updateControlText.bind(this));
  }

  updateControlText() {
    let text = `${this.levels[this.levels.selectedIndex].height}p`;

    if (this.items[0].isSelected_) {
      text += ' (Auto)';
    }

    this.player().controlBar.renditionMenuButton.controlText(text);
  }

  createItems() {
    let items = [
      new RenditionMenuItem(this.player(), {
        label: 'Auto',
        controlText: 'Auto',
        selected: true,
        index: 'auto'
      })
    ];

    if (this.levels) {
      items = items.concat(Array.from(this.levels).map((level, index) => {
        const label = `${level.height || '?'}p @ ${level.bitrate || '?'}`;

        return new RenditionMenuItem(this.player(), {
          label,
          controlText: label,
          index
        });
      }));
    }

    return items;
  }
}

videojs.registerComponent('RenditionMenuButton', RenditionMenuButton);

class RenditionSelector extends videojs.getPlugin('plugin') {
  constructor(player, options) {
    super(player, options);

    this.update_ = videojs.fn.debounce(this.update_.bind(this), 100, false, this.player);

    player.ready(() => {
      this.button = player.controlBar.renditionMenuButton = player.controlBar.addChild('RenditionMenuButton', {}, player.controlBar.children().indexOf(player.controlBar.getChild('PictureInPictureToggle')));

      player.qualityLevels().on(['addqualitylevel', 'removequalitylevel'], this.update_);
    });
  }

  update_() {
    this.button.update();
  }
}

videojs.registerPlugin('renditionSelector', RenditionSelector);
