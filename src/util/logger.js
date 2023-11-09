import videojs from 'video.js';

const logger = (source) => {
  if (videojs.log.debug) {
    return videojs.log.debug.bind(videojs, 'VHS:', `${source} >`);
  }

  return function() {};
};

const diagnosticStyles = 'background: #333; padding: 3px; color: #bada55';
const diagnosticLabel = '%cDiagnostic';

export const diagnosticLog = (...args) => {
  console.log(diagnosticLabel, diagnosticStyles, ...args); // eslint-disable-line
};

export default logger;
