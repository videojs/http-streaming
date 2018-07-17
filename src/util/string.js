export const uintToString = (uintArray) =>
  decodeURIComponent(escape(String.fromCharCode.apply(null, uintArray)));
