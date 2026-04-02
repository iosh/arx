import { UiProtocolError, UiRemoteError } from "@arx/core/ui";
import { describe, expect, it } from "vitest";
import {
  getErrorMessage,
  getInitErrorMessage,
  getUnlockErrorMessage,
  isUserRejection,
  isWalletError,
} from "./errorUtils";

describe("errorUtils", () => {
  it("treats UiRemoteError as the wallet-owned error shape", () => {
    const error = new UiRemoteError({
      reason: "ApprovalRejected",
      message: "Rejected",
    });

    expect(isWalletError(error)).toBe(true);
    expect(isUserRejection(error)).toBe(true);
    expect(getErrorMessage(error)).toBe("Request rejected by user");
  });

  it("maps UiProtocolError to a generic user-facing message", () => {
    expect(getErrorMessage(new UiProtocolError("UI protocol error: Invalid reply envelope"))).toBe(
      "Unexpected wallet response. Please try again.",
    );
  });

  it("keeps remote reason handling for unlock and init flows", () => {
    expect(
      getUnlockErrorMessage(
        new UiRemoteError({
          reason: "VaultInvalidPassword",
          message: "Invalid password",
        }),
      ),
    ).toBe("Incorrect password. Please try again.");

    expect(
      getInitErrorMessage(
        new UiRemoteError({
          reason: "VaultNotInitialized",
          message: "Vault is not initialized",
        }),
      ),
    ).toBe("Vault is not initialized");
  });
});
