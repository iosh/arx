import { describe, expect, it } from "vitest";
import { buildBackupEntryRedirect, buildCreateEntryRedirect, buildWelcomeIntentNavigation } from "./onboardingFlow";

const SNAPSHOT_UNINITIALIZED = {
  vault: { initialized: false },
  accounts: { totalCount: 0 },
};

const SNAPSHOT_NO_ACCOUNTS = {
  vault: { initialized: true },
  accounts: { totalCount: 0 },
};

const SNAPSHOT_READY = {
  vault: { initialized: true },
  accounts: { totalCount: 1 },
};

describe("buildWelcomeIntentNavigation", () => {
  it("sends first-time create/import through onboarding password", () => {
    expect(buildWelcomeIntentNavigation({ snapshot: SNAPSHOT_UNINITIALIZED, intent: "create" })).toEqual({
      to: "/onboarding/password",
      search: { intent: "create" },
    });
    expect(buildWelcomeIntentNavigation({ snapshot: SNAPSHOT_UNINITIALIZED, intent: "import" })).toEqual({
      to: "/onboarding/password",
      search: { intent: "import" },
    });
  });

  it("skips password on the vault-initialized no-accounts compatibility boundary", () => {
    expect(buildWelcomeIntentNavigation({ snapshot: SNAPSHOT_NO_ACCOUNTS, intent: "create" })).toEqual({
      to: "/onboarding/create",
    });
    expect(buildWelcomeIntentNavigation({ snapshot: SNAPSHOT_NO_ACCOUNTS, intent: "import" })).toEqual({
      to: "/onboarding/import",
    });
  });
});

describe("buildCreateEntryRedirect", () => {
  it("redirects back to onboarding password when create is missing the first password", () => {
    expect(
      buildCreateEntryRedirect({
        snapshot: SNAPSHOT_UNINITIALIZED,
        password: null,
        mnemonicWords: null,
        mnemonicKeyringId: null,
      }),
    ).toEqual({
      to: "/onboarding/password",
      search: { intent: "create" },
      replace: true,
    });
  });

  it("allows create to continue without a password on the compatibility boundary", () => {
    expect(
      buildCreateEntryRedirect({
        snapshot: SNAPSHOT_NO_ACCOUNTS,
        password: null,
        mnemonicWords: null,
        mnemonicKeyringId: null,
      }),
    ).toBeNull();
  });

  it("returns completed onboarding sessions to complete when mnemonic state is gone", () => {
    expect(
      buildCreateEntryRedirect({
        snapshot: SNAPSHOT_READY,
        password: null,
        mnemonicWords: null,
        mnemonicKeyringId: null,
      }),
    ).toEqual({
      to: "/onboarding/complete",
      replace: true,
    });
  });
});

describe("buildBackupEntryRedirect", () => {
  it("returns to create when backup is opened before the wallet exists", () => {
    expect(
      buildBackupEntryRedirect({
        snapshot: SNAPSHOT_UNINITIALIZED,
        mnemonicWords: null,
        mnemonicKeyringId: null,
      }),
    ).toEqual({
      to: "/onboarding/create",
      replace: true,
    });
  });

  it("returns to complete when the wallet exists but the generated mnemonic was lost", () => {
    expect(
      buildBackupEntryRedirect({
        snapshot: SNAPSHOT_READY,
        mnemonicWords: null,
        mnemonicKeyringId: null,
      }),
    ).toEqual({
      to: "/onboarding/complete",
      replace: true,
    });
  });

  it("allows backup when the wallet exists and mnemonic state is still present", () => {
    expect(
      buildBackupEntryRedirect({
        snapshot: SNAPSHOT_READY,
        mnemonicWords: ["one", "two", "three"],
        mnemonicKeyringId: null,
      }),
    ).toBeNull();
  });
});
