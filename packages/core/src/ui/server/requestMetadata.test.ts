import { describe, expect, it } from "vitest";
import { getUiRequestExecutionPlan, parseUiRequestMetadata } from "./requestMetadata.js";

describe("parseUiRequestMetadata", () => {
  it("marks entry bootstrap as a query", () => {
    const metadata = parseUiRequestMetadata({
      type: "ui:request",
      id: "req-1",
      method: "ui.entry.getBootstrap",
      params: { environment: "popup" },
    });

    expect(metadata).toMatchObject({
      method: "ui.entry.getBootstrap",
      plan: {
        kind: "query",
      },
    });
  });

  it("marks onboarding openTab as a command", () => {
    const metadata = parseUiRequestMetadata({
      type: "ui:request",
      id: "req-2",
      method: "ui.onboarding.openTab",
      params: { reason: "manual_open" },
    });

    expect(metadata).toMatchObject({
      method: "ui.onboarding.openTab",
      plan: {
        kind: "command",
      },
    });
  });

  it("keeps command/query intent available through getUiRequestExecutionPlan", () => {
    expect(
      getUiRequestExecutionPlan({
        type: "ui:request",
        id: "req-3",
        method: "ui.onboarding.openTab",
        params: { reason: "manual_open" },
      }),
    ).toEqual({
      kind: "command",
    });
  });
});
