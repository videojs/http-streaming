/**
 * Verify that an object is only an object and not null.
 *
 * @param {Object} obj
 *        The obj to check
 *
 * @return {boolean}
 *         If the objects is actually an object and not null.
 */
const isObject = (obj) =>
  !!obj && typeof obj === 'object';

/**
 * A function to check if two objects are equal
 * to any depth.
 *
 * @param {Object} a
 *        The first object.
 *
 * @param {Object} b
 *        The second object.
 *
 * @return {boolean}
 *         If the objects are equal or not.
 */
const deepEqual = function(a, b) {
  // equal
  if (a === b) {
    return true;
  }

  // if one or the other is not an object and they
  // are not equal (as checked above) then they are not
  // deepEqual
  if (!isObject(a) || !isObject(b)) {
    return false;
  }

  const aKeys = Object.keys(a);

  // they have different number of keys
  if (aKeys.length !== Object.keys(b).length) {
    return false;
  }

  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];

    if (!deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
};

export default deepEqual;
