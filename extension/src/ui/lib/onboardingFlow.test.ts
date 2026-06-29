import { describe, expect, it } from "vitest";
import { buildBackupEntryRedirect, buildCreateEntryRedirect, buildWelcomeIntentNavigation } from "./onboardingFlow";

const SETUP_UNINITIALIZED = {
  onboarding: { availability: "uninitialized" as const },
};

const SETUP_READY = {
  onboarding: { availability: "ready" as const },
};

describe("buildWelcomeIntentNavigation", () => {
  it("sends first-time create/import through onboarding password", () => {
    expect(buildWelcomeIntentNavigation({ setupStatus: SETUP_UNINITIALIZED, intent: "create" })).toEqual({
      to: "/onboarding/password",
      search: { intent: "create" },
    });
    expect(buildWelcomeIntentNavigation({ setupStatus: SETUP_UNINITIALIZED, intent: "import" })).toEqual({
      to: "/onboarding/password",
      search: { intent: "import" },
    });
  });
});

describe("buildCreateEntryRedirect", () => {
  it("redirects back to onboarding password when create is missing the first password", () => {
    expect(
      buildCreateEntryRedirect({
        setupStatus: SETUP_UNINITIALIZED,
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

  it("returns completed onboarding sessions to complete when mnemonic state is gone", () => {
    expect(
      buildCreateEntryRedirect({
        setupStatus: SETUP_READY,
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
        setupStatus: SETUP_UNINITIALIZED,
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
        setupStatus: SETUP_READY,
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
        setupStatus: SETUP_READY,
        mnemonicWords: ["one", "two", "three"],
        mnemonicKeyringId: null,
      }),
    ).toBeNull();
  });
});
