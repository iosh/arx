export const uniqueSortedStrings = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].sort();
