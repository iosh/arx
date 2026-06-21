import { describe, expect, it } from "vitest";
import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { decideRootBeforeLoad, needsOnboarding } from "./rootBeforeLoad";

const SETUP_UNINITIALIZED = {
  onboarding: { availability: "uninitialized" as const },
};

const SETUP_NO_ACCOUNTS = {
  onboarding: { availability: "empty" as const },
};

const SETUP_READY = {
  onboarding: { availability: "ready" as const },
};

const SETUP_EMPTY = {
  onboarding: { availability: "empty" as const },
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
  it("needsOnboarding stays true when vault exists but has no accounts", () => {
    expect(needsOnboarding(SETUP_EMPTY)).toBe(true);
  });

  it("popup + onboarding path => openOnboardingAndClose", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "popup", reason: "manual_open" }),
      pathname: "/onboarding/welcome",
      setupStatus: null,
    });

    expect(decision).toEqual({ type: "openOnboardingAndClose", reason: "onboarding_required" });
  });

  it("notification + onboarding path => close (fail-closed)", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "notification", reason: "approval_created" }),
      pathname: "/onboarding/create",
      setupStatus: null,
    });

    expect(decision).toEqual({ type: "close" });
  });

  it("onboarding environment + onboarding path => allow", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
      pathname: "/onboarding/backup",
      setupStatus: null,
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("onboarding environment + non-onboarding path => redirect based on setup status", () => {
    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/",
        setupStatus: SETUP_UNINITIALIZED,
      }),
    ).toEqual({ type: "redirect", to: "/onboarding/welcome", replace: true });

    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/",
        setupStatus: SETUP_EMPTY,
      }),
    ).toEqual({ type: "redirect", to: "/onboarding/welcome", replace: true });

    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/accounts",
        setupStatus: SETUP_EMPTY,
      }),
    ).toEqual({ type: "redirect", to: "/onboarding/welcome", replace: true });

    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/",
        setupStatus: SETUP_NO_ACCOUNTS,
      }),
    ).toEqual({ type: "redirect", to: "/onboarding/welcome", replace: true });

    expect(
      decideRootBeforeLoad({
        entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
        pathname: "/",
        setupStatus: SETUP_READY,
      }),
    ).toEqual({ type: "redirect", to: "/onboarding/complete", replace: true });
  });

  it("popup + non-onboarding path + no accounts => openOnboardingAndClose", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "popup", reason: "manual_open" }),
      pathname: "/",
      setupStatus: SETUP_NO_ACCOUNTS,
    });

    expect(decision).toEqual({ type: "openOnboardingAndClose", reason: "onboarding_required" });
  });

  it("popup + non-onboarding path + locked no-accounts setup => openOnboardingAndClose", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "popup", reason: "manual_open" }),
      pathname: "/",
      setupStatus: SETUP_EMPTY,
    });

    expect(decision).toEqual({ type: "openOnboardingAndClose", reason: "onboarding_required" });
  });

  it("idle notification entry closes immediately", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "notification", reason: "idle" }),
      pathname: "/",
      setupStatus: null,
    });

    expect(decision).toEqual({ type: "close" });
  });

  it("onboarding environment + non-onboarding path + missing setup status => redirect to /onboarding/welcome", () => {
    const decision = decideRootBeforeLoad({
      entry: createEntry({ environment: "onboarding", reason: "onboarding_required" }),
      pathname: "/",
      setupStatus: null,
    });

    expect(decision).toEqual({ type: "redirect", to: "/onboarding/welcome", replace: true });
  });
});
