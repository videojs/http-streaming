const deepEqualObject = function(a, b) {
  if (!a || !b) {
    return false;
  }

  if (a === b) {
    return true;
  }

  const akeys = Object.keys(a).sort();
  const bkeys = Object.keys(b).sort();

  // different number of keys
  if (akeys.length !== bkeys.length) {
    return false;
  }

  for (let i = 0; i < akeys.length; i++) {
    // different key in sorted list
    if (akeys[i] !== bkeys[i]) {
      return false;
    }
    const aVal = a[akeys[i]];
    const bVal = b[bkeys[i]];

    // different value type
    if (typeof aVal !== typeof bVal) {
      return false;
    }

    if (Array.isArray(aVal) || typeof aVal === 'object') {
      if (!deepEqualObject(aVal, bVal)) {
        return false;
      }
      continue;
    } else if (aVal !== bVal) {
      return false;
    }
  }

  return true;
};

export default deepEqualObject;
