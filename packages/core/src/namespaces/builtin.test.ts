import { describe, expect, it } from "vitest";
import { builtinNamespaces } from "./builtin.js";

describe("builtin namespaces", () => {
  it("exposes one complete eip155 definition", () => {
    expect(builtinNamespaces.map((definition) => definition.namespace)).toEqual(["eip155"]);

    const [definition] = builtinNamespaces;
    expect(definition?.chainAddressing.namespace).toBe("eip155");
    expect(definition?.accounts.namespace).toBe("eip155");
    expect(definition?.keyring.namespace).toBe("eip155");
  });

  it("does not contain duplicate namespace identifiers", () => {
    expect(new Set(builtinNamespaces.map(({ namespace }) => namespace)).size).toBe(builtinNamespaces.length);
  });
});
