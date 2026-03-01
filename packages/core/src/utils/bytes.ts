export const copyBytes = (input: Uint8Array): Uint8Array => new Uint8Array(input);

export const zeroize = (buffer: Uint8Array): void => {
  buffer.fill(0);
};
