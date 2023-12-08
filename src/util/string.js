export const uint8ToUtf8 = (uintArray) =>
  decodeURIComponent(escape(String.fromCharCode.apply(null, uintArray)));

export const arrayBufferToHexString = (buffer) => {
  return Array.from(new Uint8Array(buffer)).map((val) => val.toString(16).padStart(2, '0')).join('');
};
