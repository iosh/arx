import { describe, expect, it } from "vitest";
import { ApprovalKinds } from "../controllers/approval/types.js";
import { ApprovalChainDerivationFallbacks, deriveApprovalChainContext } from "./shared.js";

describe("deriveApprovalChainContext", () => {
  it("allows namespace active fallback for connection approvals", () => {
    const context = deriveApprovalChainContext(
      {
        id: "approval-1",
        kind: ApprovalKinds.RequestPermissions,
        namespace: "eip155",
      },
      {
        networkPreferences: {
          getActiveChainRef: (namespace: string) => (namespace === "eip155" ? "eip155:10" : null),
        },
      },
      {
        fallback: ApprovalChainDerivationFallbacks.NamespaceActive,
      },
    );

    expect(context).toEqual({ namespace: "eip155", chainRef: "eip155:10" });
  });

  it("rejects missing chain context for high-risk approvals without request or record chainRef", () => {
    expect(() =>
      deriveApprovalChainContext(
        {
          id: "approval-2",
          kind: ApprovalKinds.SignMessage,
          namespace: "eip155",
        },
        {
          networkPreferences: {
            getActiveChainRef: () => "eip155:10",
          },
        },
        {
          fallback: ApprovalChainDerivationFallbacks.None,
        },
      ),
    ).toThrow(/could not resolve a chainRef/i);
  });
});
