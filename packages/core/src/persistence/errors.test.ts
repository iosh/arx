import { describe, expect, it } from "vitest";
import { ArxBaseError } from "../errors.js";
import { PersistenceCommitError, PersistenceReadError } from "./errors.js";

describe("persistence errors", () => {
  it("provides a stable read error code and retains its cause in memory", () => {
    const cause = new Error("database read failed");
    const error = new PersistenceReadError(cause);

    expect(error).toBeInstanceOf(ArxBaseError);
    expect(error.code).toBe(PersistenceReadError.code);
    expect(error.cause).toBe(cause);
  });

  it("provides a stable commit error code and retains its cause in memory", () => {
    const cause = new Error("database commit failed");
    const error = new PersistenceCommitError(cause);

    expect(error).toBeInstanceOf(ArxBaseError);
    expect(error.code).toBe(PersistenceCommitError.code);
    expect(error.cause).toBe(cause);
  });
});
