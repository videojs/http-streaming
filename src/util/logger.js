import videojs from 'video.js';

const logger = (source) => {
  if (videojs.log.debug) {
    return videojs.log.debug.bind(videojs, 'VHS:', `${source} >`);
  }

  return function() {};
};

const diagnosticStyles = 'background: black; padding: 3px; color: green';
const diagnosticLabel = '%cDiagnostic';

export const diagnosticLog = (...args) => {
  console.log(diagnosticLabel, diagnosticStyles, ...args); // eslint-disable-line
};

const diagnosticStyles2 = 'background: black; padding: 3px; color: red';
const diagnosticLabel2 = '%cDiagnostic';

export const diagnosticLog2 = (...args) => {
  console.log(diagnosticLabel2, diagnosticStyles2, ...args); // eslint-disable-line
};

export default logger;
