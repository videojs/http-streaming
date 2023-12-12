export const uint8ToUtf8 = (uintArray) =>
  decodeURIComponent(escape(String.fromCharCode.apply(null, uintArray)));

export const bufferToHexString = (buffer) => {
  const uInt8Buffer = new Uint8Array(buffer);

  return Array.from(uInt8Buffer).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
