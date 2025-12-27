import { describe, expect, it } from "vitest";
import { ArxError, ArxReasons, arxError, isArxError } from "./index.js";

describe("ArxError", () => {
  it("creates an ArxError with kind/reason/message", () => {
    const err = arxError({ reason: ArxReasons.VaultLocked, message: "Vault is locked" });
    expect(err).toBeInstanceOf(ArxError);
    expect(err.kind).toBe("ArxError");
    expect(err.reason).toBe(ArxReasons.VaultLocked);
    expect(err.message).toBe("Vault is locked");
    expect(isArxError(err)).toBe(true);
  });

  it("serializes without cause", () => {
    const cause = new Error("secret");
    const err = arxError({ reason: ArxReasons.RpcInternal, message: "Internal error", cause });
    const json = JSON.parse(JSON.stringify(err)) as { kind: string; reason: string; message: string; cause?: unknown };
    expect(json.kind).toBe("ArxError");
    expect(json.reason).toBe(ArxReasons.RpcInternal);
    expect(json.message).toBe("Internal error");
    expect("cause" in json).toBe(false);
  });
});
