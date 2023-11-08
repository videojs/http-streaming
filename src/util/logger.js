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
  const diagnostic = [`%cDiagnostic`]

  console.log(diagnosticLabel, diagnosticStyles, ...args);
}

export default logger;
