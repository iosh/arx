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
      kind: "ArxError",
      name: "ApprovalRejectedError",
      code: "approval.rejected",
      message: "Rejected",
    });

    expect(isWalletError(error)).toBe(true);
    expect(isUserRejection(error)).toBe(true);
    expect(getErrorMessage(error)).toBe("Request rejected by user");
  });

  it("keeps system approval cancellation separate from user rejection", () => {
    const dismissed = new UiRemoteError({
      kind: "ArxError",
      name: "ApprovalUserDismissedError",
      code: "approval.user_dismissed",
      message: "Approval dismissed by user.",
    });
    const superseded = new UiRemoteError({
      kind: "ArxError",
      name: "ApprovalSupersededError",
      code: "approval.superseded",
      message: "Approval superseded.",
    });
    const cancelled = new UiRemoteError({
      kind: "ArxError",
      name: "ApprovalCancelledError",
      code: "approval.cancelled",
      message: "Approval cancelled.",
    });

    expect(isUserRejection(dismissed)).toBe(true);
    expect(getErrorMessage(dismissed)).toBe("Request rejected by user");
    expect(isUserRejection(superseded)).toBe(false);
    expect(getErrorMessage(superseded)).toBe("Request was replaced.");
    expect(isUserRejection(cancelled)).toBe(false);
    expect(getErrorMessage(cancelled)).toBe("Request was cancelled.");
  });

  it("maps UiProtocolError to a generic user-facing message", () => {
    expect(getErrorMessage(new UiProtocolError("UI protocol error: Invalid reply envelope"))).toBe(
      "Unexpected wallet response. Please try again.",
    );
  });

  it("keeps remote code handling for unlock and init flows", () => {
    expect(
      getUnlockErrorMessage(
        new UiRemoteError({
          kind: "ArxError",
          name: "VaultInvalidPasswordError",
          code: "vault.invalid_password",
          message: "Invalid password",
        }),
      ),
    ).toBe("Incorrect password. Please try again.");

    expect(
      getInitErrorMessage(
        new UiRemoteError({
          kind: "ArxError",
          name: "VaultNotInitializedError",
          code: "vault.not_initialized",
          message: "Vault is not initialized",
        }),
      ),
    ).toBe("Vault is not initialized");
  });
});
