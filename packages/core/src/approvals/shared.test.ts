import { describe, expect, it } from "vitest";
import { ApprovalKinds } from "../controllers/approval/types.js";
import { deriveApprovalChainContext } from "./shared.js";

describe("deriveApprovalChainContext", () => {
  it("prefers namespace-specific active chain over an incompatible global active chain", () => {
    const context = deriveApprovalChainContext(
      {
        id: "approval-1",
        kind: ApprovalKinds.RequestPermissions,
        namespace: "eip155",
      },
      {
        network: {
          getState: () => ({ activeChainRef: "solana:101" }),
        },
        networkPreferences: {
          getActiveChainRef: (namespace: string) => (namespace === "eip155" ? "eip155:10" : null),
        },
      },
    );

    expect(context).toEqual({ namespace: "eip155", chainRef: "eip155:10" });
  });
});
