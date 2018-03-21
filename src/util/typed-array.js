export const concatTypedArrays = (arr1, arr2) => {
  let tempArray = new Uint8Array(arr1.length + arr2.length);

  for (let i = 0; i < arr1.length; i++) {
    tempArray[i] = arr1[i];
  }

  for (let i = 0; i < arr2.length; i++) {
    tempArray[i + arr1.length] = arr2[i];
  }

  return tempArray;
};
