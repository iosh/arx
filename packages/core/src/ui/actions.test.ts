import { describe, expect, it } from "vitest";
import { uiActions, uiActionsByMethod } from "./actions.js";
import { uiMethods } from "./methods.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "./protocol.js";

describe("ui actions", () => {
  it("covers all uiMethods keys exactly", () => {
    const client = {
      call: async <M extends UiMethodName>(_method: M, _params?: UiMethodParams<M>): Promise<UiMethodResult<M>> => {
        return null as unknown as UiMethodResult<M>;
      },
    };

    const byMethod = uiActionsByMethod(client as any);
    uiActions(client as any);

    const actionKeys = Object.keys(byMethod).sort();
    const methodKeys = Object.keys(uiMethods).sort();

    expect(actionKeys).toEqual(methodKeys);
  });
});
