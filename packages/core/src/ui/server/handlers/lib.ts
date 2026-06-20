import { SessionLockedError } from "../../../runtime/session/errors.js";
import type { UiSessionAccess } from "../types.js";

export const assertUnlocked = (session: Pick<UiSessionAccess, "isUnlocked">) => {
  if (!session.isUnlocked()) {
    throw new SessionLockedError();
  }
};
