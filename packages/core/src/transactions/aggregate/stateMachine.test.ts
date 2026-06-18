import { describe, expect, it } from "vitest";
import {
  assertTransactionStatusTransition,
  assertTransactionSubmissionStatusTransition,
  canTransitionTransactionStatus,
  canTransitionTransactionSubmissionStatus,
  isTransactionStatusTerminal,
  isTransactionSubmissionStatusTerminal,
  TransactionStatusTransitionError,
} from "./stateMachine.js";

describe("transaction aggregate state machine", () => {
  it("allows durable transaction transitions after approval", () => {
    expect(canTransitionTransactionStatus("submitting", "submitted")).toBe(true);
    expect(canTransitionTransactionStatus("submitting", "failed")).toBe(true);
    expect(canTransitionTransactionStatus("submitting", "cancelled")).toBe(true);
    expect(canTransitionTransactionStatus("submitting", "expired")).toBe(true);
    expect(canTransitionTransactionStatus("submitted", "confirmed")).toBe(true);
    expect(canTransitionTransactionStatus("submitted", "failed")).toBe(true);
    expect(canTransitionTransactionStatus("submitted", "replaced")).toBe(true);
    expect(canTransitionTransactionStatus("submitted", "dropped")).toBe(true);
    expect(canTransitionTransactionStatus("submitted", "expired")).toBe(true);
  });

  it("rejects transaction transitions that skip required lifecycle facts", () => {
    expect(() => assertTransactionStatusTransition("submitting", "confirmed")).toThrow(
      TransactionStatusTransitionError,
    );
    expect(() => assertTransactionStatusTransition("submitted", "cancelled")).toThrow(TransactionStatusTransitionError);
    expect(() => assertTransactionStatusTransition("confirmed", "failed")).toThrow(TransactionStatusTransitionError);
  });

  it("treats all local and chain outcomes as terminal except submitting/submitted", () => {
    expect(isTransactionStatusTerminal("submitting")).toBe(false);
    expect(isTransactionStatusTerminal("submitted")).toBe(false);
    expect(isTransactionStatusTerminal("cancelled")).toBe(true);
    expect(isTransactionStatusTerminal("expired")).toBe(true);
    expect(isTransactionStatusTerminal("confirmed")).toBe(true);
    expect(isTransactionStatusTerminal("failed")).toBe(true);
    expect(isTransactionStatusTerminal("replaced")).toBe(true);
    expect(isTransactionStatusTerminal("dropped")).toBe(true);
  });

  it("allows submission execution transitions defined by the redesign blueprint", () => {
    expect(canTransitionTransactionSubmissionStatus("queued", "signing")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("queued", "cancelled")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("queued", "expired")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("queued", "failed")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("signing", "broadcasting")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("signing", "cancelled")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("signing", "expired")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("signing", "failed")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("broadcasting", "accepted")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("broadcasting", "expired")).toBe(true);
    expect(canTransitionTransactionSubmissionStatus("broadcasting", "failed")).toBe(true);
  });

  it("rejects submission transitions that skip signing or broadcast acceptance", () => {
    expect(() => assertTransactionSubmissionStatusTransition("queued", "accepted")).toThrow(
      TransactionStatusTransitionError,
    );
    expect(() => assertTransactionSubmissionStatusTransition("queued", "broadcasting")).toThrow(
      TransactionStatusTransitionError,
    );
    expect(() => assertTransactionSubmissionStatusTransition("accepted", "failed")).toThrow(
      TransactionStatusTransitionError,
    );
  });

  it("treats accepted and all failed local submission outcomes as terminal", () => {
    expect(isTransactionSubmissionStatusTerminal("queued")).toBe(false);
    expect(isTransactionSubmissionStatusTerminal("signing")).toBe(false);
    expect(isTransactionSubmissionStatusTerminal("broadcasting")).toBe(false);
    expect(isTransactionSubmissionStatusTerminal("accepted")).toBe(true);
    expect(isTransactionSubmissionStatusTerminal("failed")).toBe(true);
    expect(isTransactionSubmissionStatusTerminal("cancelled")).toBe(true);
    expect(isTransactionSubmissionStatusTerminal("expired")).toBe(true);
  });
});
