import { describe, expect, it } from "vitest";
import { decideRootBeforeLoad } from "./rootBeforeLoad";

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

describe("decideRootBeforeLoad", () => {
  it("manual_open + onboarding path => openOnboardingAndClose", () => {
    const decision = decideRootBeforeLoad({
      entryIntent: "manual_open",
      pathname: "/welcome",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "openOnboardingAndClose", reason: "manual_open" });
  });

  it("attention_open + onboarding path => close (fail-closed)", () => {
    const decision = decideRootBeforeLoad({
      entryIntent: "attention_open",
      pathname: "/setup/generate",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "close" });
  });

  it("onboarding_tab + onboarding path => allow", () => {
    const decision = decideRootBeforeLoad({
      entryIntent: "onboarding_tab",
      pathname: "/setup/verify",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("onboarding_tab + non-onboarding path => redirect based on snapshot", () => {
    expect(
      decideRootBeforeLoad({
        entryIntent: "onboarding_tab",
        pathname: "/",
        snapshot: SNAPSHOT_UNINITIALIZED,
      }),
    ).toEqual({ type: "redirect", to: "/welcome", replace: true });

    expect(
      decideRootBeforeLoad({
        entryIntent: "onboarding_tab",
        pathname: "/",
        snapshot: SNAPSHOT_NO_ACCOUNTS,
      }),
    ).toEqual({ type: "redirect", to: "/setup/generate", replace: true });

    expect(
      decideRootBeforeLoad({
        entryIntent: "onboarding_tab",
        pathname: "/",
        snapshot: SNAPSHOT_READY,
      }),
    ).toEqual({ type: "redirect", to: "/setup/complete", replace: true });
  });

  it("manual_open + non-onboarding path + no accounts => openOnboardingAndClose (best practice)", () => {
    const decision = decideRootBeforeLoad({
      entryIntent: "manual_open",
      pathname: "/",
      snapshot: SNAPSHOT_NO_ACCOUNTS,
    });

    expect(decision).toEqual({ type: "openOnboardingAndClose", reason: "manual_open" });
  });

  it("onboarding_tab + non-onboarding path + missing snapshot => redirect to /welcome (fail-safe)", () => {
    const decision = decideRootBeforeLoad({
      entryIntent: "onboarding_tab",
      pathname: "/",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "redirect", to: "/welcome", replace: true });
  });
});
