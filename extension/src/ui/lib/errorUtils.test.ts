import { deserializeArxError } from "@arx/core";
import { InvokeProtocolError } from "@arx/core/invoke";
import { describe, expect, it } from "vitest";
import {
  getErrorMessage,
  getInitErrorMessage,
  getUnlockErrorMessage,
  isUserRejection,
  isWalletError,
} from "./errorUtils";

describe("errorUtils", () => {
  const createWalletError = (code: string, message: string, name = "ArxError") =>
    deserializeArxError({
      kind: "ArxError",
      name,
      code,
      message,
    });

  it("treats wallet domain errors as the wallet-owned error shape", () => {
    const error = createWalletError("approval.rejected", "Rejected", "ApprovalRejectedError");

    expect(isWalletError(error)).toBe(true);
    expect(isUserRejection(error)).toBe(true);
    expect(getErrorMessage(error)).toBe("Request rejected by user");
  });

  it("keeps invoke infrastructure errors separate from wallet domain errors", () => {
    expect(
      isWalletError(
        new InvokeProtocolError({
          target: "wallet",
          action: "session.getStatus",
          requestId: "request-1",
          reason: "invalid reply envelope",
        }),
      ),
    ).toBe(false);
  });

  it("keeps system approval cancellation separate from user rejection", () => {
    const dismissed = createWalletError(
      "approval.user_dismissed",
      "Approval dismissed by user.",
      "ApprovalUserDismissedError",
    );
    const superseded = createWalletError("approval.superseded", "Approval superseded.", "ApprovalSupersededError");
    const cancelled = createWalletError("approval.cancelled", "Approval cancelled.", "ApprovalCancelledError");

    expect(isUserRejection(dismissed)).toBe(true);
    expect(getErrorMessage(dismissed)).toBe("Request rejected by user");
    expect(isUserRejection(superseded)).toBe(false);
    expect(getErrorMessage(superseded)).toBe("Request was replaced.");
    expect(isUserRejection(cancelled)).toBe(false);
    expect(getErrorMessage(cancelled)).toBe("Request was cancelled.");
  });

  it("maps invoke protocol errors to a generic user-facing message", () => {
    expect(
      getErrorMessage(
        new InvokeProtocolError({
          target: "wallet",
          action: "session.getStatus",
          requestId: "request-1",
          reason: "invalid reply envelope",
        }),
      ),
    ).toBe("Unexpected wallet response. Please try again.");
  });

  it("keeps remote code handling for unlock and init flows", () => {
    expect(
      getUnlockErrorMessage(
        createWalletError("vault.invalid_password", "Invalid password", "VaultInvalidPasswordError"),
      ),
    ).toBe("Incorrect password. Please try again.");

    expect(
      getInitErrorMessage(
        createWalletError("vault.not_initialized", "Vault is not initialized", "VaultNotInitializedError"),
      ),
    ).toBe("Vault is not initialized");
  });
});
