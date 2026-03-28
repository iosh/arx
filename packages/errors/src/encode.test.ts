import { describe, expect, it } from "vitest";
import { arxError } from "./ArxError.js";
import { encodeDappError, encodeUiError, sanitizeJsonRpcErrorObject } from "./encode.js";
import { ArxReasons } from "./reasons.js";

describe("error encoders", () => {
  it("uses generic dapp defaults instead of the internal ArxError message", () => {
    expect(
      encodeDappError(
        arxError({
          reason: ArxReasons.PermissionDenied,
          message: "domain-specific deny text",
          data: { origin: "https://dapp.example" },
        }),
        { surface: "dapp", namespace: "eip155" },
      ),
    ).toEqual({
      code: 4100,
      message: "Unauthorized",
      data: { origin: "https://dapp.example" },
    });
  });

  it("omits dapp data for ui-only reasons", () => {
    expect(
      encodeDappError(
        arxError({
          reason: ArxReasons.VaultInvalidPassword,
          message: "Invalid password",
          data: { attempt: 1 },
        }),
        { surface: "dapp", namespace: "eip155" },
      ),
    ).toEqual({
      code: 4100,
      message: "Unauthorized",
    });
  });

  it("keeps the runtime message for UI and falls back to the generic default when needed", () => {
    expect(
      encodeUiError(
        arxError({
          reason: ArxReasons.PermissionDenied,
          message: "",
          data: { retryable: true },
        }),
        { surface: "ui", namespace: "eip155" },
      ),
    ).toEqual({
      reason: ArxReasons.PermissionDenied,
      message: "Permission denied",
      data: { retryable: true },
    });
  });

  it("keeps generic chain reasons off eip155-specific compatibility codes", () => {
    expect(
      encodeDappError(
        arxError({
          reason: ArxReasons.ChainNotSupported,
          message: "chain is unavailable in this surface",
          data: { chainRef: "solana:101" },
        }),
        { surface: "dapp", namespace: "unknown" },
      ),
    ).toEqual({
      code: -32602,
      message: "Invalid params",
      data: { chainRef: "solana:101" },
    });
  });

  it("sanitizes passthrough JSON-RPC errors before surfacing them", () => {
    expect(
      sanitizeJsonRpcErrorObject({
        code: -32000,
        message: "Upstream error",
        data: { value: 1n },
      }),
    ).toEqual({
      code: -32000,
      message: "Upstream error",
    });
  });
});
