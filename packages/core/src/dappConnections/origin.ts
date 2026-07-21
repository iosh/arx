import { DappOriginInvalidError } from "./errors.js";

export const parseDappOrigin = (sourceUrl: string): string => {
  let url: URL;

  try {
    url = new URL(sourceUrl);
  } catch {
    throw new DappOriginInvalidError(sourceUrl);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DappOriginInvalidError(sourceUrl);
  }

  return url.origin;
};
