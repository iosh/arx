export const addHexPrefix = (value: string): string => (value.startsWith("0x") ? value : `0x${value}`);
