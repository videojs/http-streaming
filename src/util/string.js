export const uint8ToUtf8 = (uintArray) =>
  decodeURIComponent(escape(String.fromCharCode.apply(null, uintArray)));

export const arrayBufferToHexString = (buffer) => {
  return Array.from(buffer).map((val) => val.toString(16).padStart(2, '0')).join('');
};
