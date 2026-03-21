import { describe, expect, it } from "vitest";
import { ApprovalKinds } from "../controllers/approval/types.js";
import { deriveApprovalReviewContext, parseAccountSelectionDecision, parseNoDecision } from "./shared.js";

describe("deriveApprovalReviewContext", () => {
  it("uses the approval record chain context by default", () => {
    const context = deriveApprovalReviewContext({
      id: "approval-1",
      kind: ApprovalKinds.RequestPermissions,
      namespace: "eip155",
      chainRef: "eip155:10",
    });

    expect(context).toEqual({ namespace: "eip155", reviewChainRef: "eip155:10", source: "record" });
  });

  it("rejects request overrides that cross namespaces", () => {
    expect(() =>
      deriveApprovalReviewContext(
        {
          id: "approval-2",
          kind: ApprovalKinds.SignMessage,
          namespace: "eip155",
          chainRef: "eip155:1",
        },
        { request: { chainRef: "conflux:cfx" } },
      ),
    ).toThrow(/mismatched namespace and chainref/i);
  });
});

describe("approval decision parsing", () => {
  it("parses unique non-empty accountKeys decisions", () => {
    expect(
      parseAccountSelectionDecision(ApprovalKinds.RequestAccounts, {
        accountKeys: [
          "eip155:0000000000000000000000000000000000000000",
          "eip155:1111111111111111111111111111111111111111",
        ],
      }),
    ).toEqual({
      accountKeys: [
        "eip155:0000000000000000000000000000000000000000",
        "eip155:1111111111111111111111111111111111111111",
      ],
    });
  });

  it("rejects duplicate accountKeys decisions", () => {
    expect(() =>
      parseAccountSelectionDecision(ApprovalKinds.RequestPermissions, {
        accountKeys: [
          "eip155:0000000000000000000000000000000000000000",
          "eip155:0000000000000000000000000000000000000000",
        ],
      }),
    ).toThrow(/accountkeys/i);
  });

  it("rejects decision payloads for no-decision kinds", () => {
    expect(() => parseNoDecision(ApprovalKinds.SignMessage, { anything: true })).toThrow(/does not accept/i);
  });
});
