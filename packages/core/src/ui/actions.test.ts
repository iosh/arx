import { describe, expect, it } from "vitest";
import { uiActions } from "./actions.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "./protocol/index.js";
import { parseUiMethodParams } from "./protocol/index.js";
import { uiMethods } from "./protocol/methods.js";

type UiClient = Parameters<typeof uiActions>[0];

const createTestClient = (call: UiClient["call"]): UiClient => {
  return {
    connect: async () => {},
    call,
    on: () => () => {},
    destroy: () => {},
    extend: function <E extends Record<string, unknown>>(
      this: UiClient & Record<string, unknown>,
      extension: (client: UiClient) => E,
    ) {
      return Object.assign(this, extension(this as UiClient)) as UiClient & E;
    },
  };
};

describe("ui actions", () => {
  it("invokes all uiMethods keys exactly", () => {
    const called = new Set<string | number | symbol>();

    const client = createTestClient(
      async <M extends UiMethodName>(_method: M, _params?: UiMethodParams<M>): Promise<UiMethodResult<M>> => {
        parseUiMethodParams(_method, _params);
        called.add(_method);
        return null as unknown as UiMethodResult<M>;
      },
    );

    const actions = uiActions(client);

    void actions.entry.getLaunchContext({ environment: "popup" });
    void actions.entry.getBootstrap({ environment: "popup" });
    void actions.onboarding.openTab({ reason: "manual_open" });

    expect([...called].sort()).toEqual(Object.keys(uiMethods).sort());
  });

  it("passes parameters exactly as provided", async () => {
    const capturedParams: unknown[] = [];
    const client = createTestClient(async <M extends UiMethodName>(_method: M, params?: UiMethodParams<M>) => {
      capturedParams.push(params);
      return null as unknown as UiMethodResult<M>;
    });

    const actions = uiActions(client);

    await actions.onboarding.openTab({ reason: "manual_open" });
    expect(capturedParams[capturedParams.length - 1]).toEqual({ reason: "manual_open" });
  });

  it("keeps host activation groups available", () => {
    const client = createTestClient(async <M extends UiMethodName>(_method: M, _params?: UiMethodParams<M>) => {
      return null as unknown as UiMethodResult<M>;
    });

    const actions = uiActions(client);

    expect(typeof actions.entry.getLaunchContext).toBe("function");
    expect(typeof actions.entry.getBootstrap).toBe("function");
    expect(typeof actions.onboarding.openTab).toBe("function");
  });
});
