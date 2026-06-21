import { describe, expect, it } from "vitest";
import { getUiRequestExecutionPlan, parseUiRequestMetadata } from "./requestMetadata.js";

describe("parseUiRequestMetadata", () => {
  it("marks snapshot.get as a query", () => {
    const metadata = parseUiRequestMetadata({
      type: "ui:request",
      id: "req-1",
      method: "ui.snapshot.get",
    });

    expect(metadata).toMatchObject({
      method: "ui.snapshot.get",
      plan: {
        kind: "query",
      },
    });
  });

  it("marks unlock as a command", () => {
    const metadata = parseUiRequestMetadata({
      type: "ui:request",
      id: "req-2",
      method: "ui.session.unlock",
      params: { password: "secret" },
    });

    expect(metadata).toMatchObject({
      method: "ui.session.unlock",
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
