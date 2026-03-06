import type { UiSnapshot } from "../../protocol/schemas.js";
import type { UiHandlers } from "../types.js";

export const createSnapshotHandlers = (buildSnapshot: () => UiSnapshot): Pick<UiHandlers, "ui.snapshot.get"> => {
  return {
    "ui.snapshot.get": async () => buildSnapshot(),
  };
};
