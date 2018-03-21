/**
 * Returns a list of gops in the buffer that have a pts value of 3 seconds or more in
 * front of current time.
 *
 * @param {Array} buffer
 *        The current buffer of gop information
 * @param {Number} currentTime
 *        The current time
 * @param {Double} mapping
 *        Offset to map display time to stream presentation time
 * @return {Array}
 *         List of gops considered safe to append over
 */
export const gopsSafeToAlignWith = (buffer, currentTime, mapping) => {
  if (!currentTime || !buffer.length) {
    return [];
  }

  // pts value for current time + 3 seconds to give a bit more wiggle room
  const currentTimePts = Math.ceil((currentTime - mapping + 3) * 90000);

  let i;

  for (i = 0; i < buffer.length; i++) {
    if (buffer[i].pts > currentTimePts) {
      break;
    }
  }

  return buffer.slice(i);
};

/**
 * Removes gop information in buffer that overlaps with provided start and end
 *
 * @param {Array} buffer
 *        The current buffer of gop information
 * @param {Double} start
 *        position to start the remove at
 * @param {Double} end
 *        position to end the remove at
 * @param {Double} mapping
 *        Offset to map display time to stream presentation time
 */
export const removeGopBuffer = (buffer, start, end, mapping) => {
  const startPts = Math.ceil((start - mapping) * 90000);
  const endPts = Math.ceil((end - mapping) * 90000);
  const updatedBuffer = buffer.slice();

  let i = buffer.length;

  while (i--) {
    if (buffer[i].pts <= endPts) {
      break;
    }
  }

  if (i === -1) {
    // no removal because end of remove range is before start of buffer
    return updatedBuffer;
  }

  let j = i + 1;

  while (j--) {
    if (buffer[j].pts <= startPts) {
      break;
    }
  }

  // clamp remove range start to 0 index
  j = Math.max(j, 0);

  updatedBuffer.splice(j, i - j + 1);

  return updatedBuffer;
};

/**
 * Appends gop information (timing and byteLength) received by the transmuxer for the
 * gops appended in the last call to appendBuffer
 *
 * @param {Array} buffer
 *        The current buffer of gop information
 * @param {Array} gops
 *        List of new gop information
 * @param {boolean} replace
 *        If true, replace the buffer with the new gop information. If false, append the
 *        new gop information to the buffer in the right location of time.
 * @return {Array}
 *         Updated list of gop information
 */
export const updateGopBuffer = (buffer, gops, replace) => {
  if (!gops.length) {
    return buffer;
  }

  if (replace) {
    // If we are in safe append mode, then completely overwrite the gop buffer
    // with the most recent appeneded data. This will make sure that when appending
    // future segments, we only try to align with gops that are both ahead of current
    // time and in the last segment appended.
    return gops.slice();
  }

  const start = gops[0].pts;

  let i = 0;

  for (i; i < buffer.length; i++) {
    if (buffer[i].pts >= start) {
      break;
    }
  }

  return buffer.slice(0, i).concat(gops);
};
