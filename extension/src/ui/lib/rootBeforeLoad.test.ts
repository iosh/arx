import { describe, expect, it } from "vitest";
import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { decideRootBeforeLoad, needsOnboarding } from "./rootBeforeLoad";

const SNAPSHOT_UNINITIALIZED = {
  vault: { initialized: false },
  accounts: { totalCount: 0 },
  session: { isUnlocked: false },
};

const SNAPSHOT_NO_ACCOUNTS = {
  vault: { initialized: true },
  accounts: { totalCount: 0 },
  session: { isUnlocked: true },
};

const SNAPSHOT_READY = {
  vault: { initialized: true },
  accounts: { totalCount: 1 },
  session: { isUnlocked: true },
};

const SNAPSHOT_LOCKED = {
  vault: { initialized: true },
  accounts: { totalCount: 0 },
  session: { isUnlocked: false },
};

const createEntry = (overrides?: Partial<UiEntryMetadata>): UiEntryMetadata => ({
  environment: overrides?.environment ?? "popup",
  reason: overrides?.reason ?? "manual_open",
  context: overrides?.context ?? {
    approvalId: null,
    origin: null,
    method: null,
    chainRef: null,
    namespace: null,
  },
});

describe("decideRootBeforeLoad", () => {
  it("needsOnboarding is false when locked (unknown account state)", () => {
    expect(needsOnboarding(SNAPSHOT_LOCKED)).toBe(false);
  });

  it("popup + onboarding path => openOnboardingAndClose", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "popup", reason: "manual_open" }),
      pathname: "/welcome",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "openOnboardingAndClose", reason: "onboarding_required" });
  });

  it("notification + onboarding path => close (fail-closed)", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "notification", reason: "approval_created" }),
      pathname: "/onboarding/generate",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "close" });
  });

  it("onboarding environment + onboarding path => allow", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
      pathname: "/onboarding/verify",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("onboarding environment + non-onboarding path => redirect based on snapshot", () => {
    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/",
        snapshot: SNAPSHOT_UNINITIALIZED,
      }),
    ).toEqual({ type: "redirect", to: "/welcome", replace: true });

    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/",
        snapshot: SNAPSHOT_LOCKED,
      }),
    ).toEqual({ type: "allow" });

    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/accounts",
        snapshot: SNAPSHOT_LOCKED,
      }),
    ).toEqual({ type: "redirect", to: "/", replace: true });

    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/",
        snapshot: SNAPSHOT_NO_ACCOUNTS,
      }),
    ).toEqual({ type: "redirect", to: "/onboarding/generate", replace: true });

    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/",
        snapshot: SNAPSHOT_READY,
      }),
    ).toEqual({ type: "redirect", to: "/onboarding/complete", replace: true });
  });

  it("popup + non-onboarding path + no accounts => openOnboardingAndClose", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "popup", reason: "manual_open" }),
      pathname: "/",
      snapshot: SNAPSHOT_NO_ACCOUNTS,
    });

    expect(decision).toEqual({ type: "openOnboardingAndClose", reason: "onboarding_required" });
  });

  it("manual notification entry redirects root to approvals", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "notification", reason: "manual_open" }),
      pathname: "/",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "redirect", to: "/approvals", replace: true });
  });

  it("onboarding environment + non-onboarding path + missing snapshot => redirect to /welcome", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
      pathname: "/",
      snapshot: null,
    });

    expect(decision).toEqual({ type: "redirect", to: "/welcome", replace: true });
  });
});
