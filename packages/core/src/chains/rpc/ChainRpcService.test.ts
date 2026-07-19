import { describe, expect, it } from "vitest";
import { createMessenger } from "../../messenger/index.js";
import { ChainRpcService } from "./ChainRpcService.js";
import { assertNonEmptyRpcEndpoints } from "./config.js";

const createService = () => {
  const messenger = createMessenger();
  return new ChainRpcService({
    messenger,
    initialAccesses: [
      {
        chainRef: "eip155:1",
        endpoints: assertNonEmptyRpcEndpoints("eip155:1", [
          "https://rpc.primary.example",
          "https://rpc.backup.example",
        ]),
      },
    ],
  });
};

describe("ChainRpcService", () => {
  it("returns cloned effective endpoints and access state", () => {
    const service = createService();

    const endpoints = service.getEndpoints("eip155:1");
    const nextEndpoints = service.getEndpoints("eip155:1");

    expect(service.hasEndpoints("eip155:1")).toBe(true);
    expect(service.listChainRefs()).toEqual(["eip155:1"]);
    expect(nextEndpoints).toEqual(endpoints);
    expect(nextEndpoints).not.toBe(endpoints);
    expect(service.getState()).toMatchObject({
      accesses: [{ chainRef: "eip155:1" }],
    });
  });

  it("publishes endpoint changes when access changes", () => {
    const service = createService();
    const changed: string[] = [];
    service.onEndpointsChanged((event) => changed.push(event.chainRef));

    service.replaceAccesses([
      {
        chainRef: "eip155:1",
        endpoints: assertNonEmptyRpcEndpoints("eip155:1", ["https://rpc.next.example"]),
      },
      {
        chainRef: "eip155:10",
        endpoints: assertNonEmptyRpcEndpoints("eip155:10", ["https://rpc.optimism.example"]),
      },
    ]);

    expect(changed).toEqual(["eip155:1", "eip155:10"]);
    expect(service.listChainRefs()).toEqual(["eip155:1", "eip155:10"]);
    expect(service.getEndpoints("eip155:1")[0]).toBe("https://rpc.next.example");
  });

  it("does not publish when replacement keeps endpoints unchanged", () => {
    const service = createService();
    const changed: string[] = [];
    service.onEndpointsChanged((event) => changed.push(event.chainRef));

    service.replaceAccesses(service.listAccesses());

    expect(changed).toEqual([]);
    expect(service.getState().accesses).toHaveLength(1);
  });

  it("rejects missing and duplicate access", () => {
    const service = createService();

    expect(() => service.getEndpoints("eip155:10")).toThrowError(
      expect.objectContaining({ code: "chain.not_available" }),
    );
    expect(() =>
      service.replaceAccesses([
        {
          chainRef: "eip155:1",
          endpoints: assertNonEmptyRpcEndpoints("eip155:1", ["https://rpc.one.example"]),
        },
        {
          chainRef: "eip155:1",
          endpoints: assertNonEmptyRpcEndpoints("eip155:1", ["https://rpc.two.example"]),
        },
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: "chain.rpc_access_config_invalid",
        details: { chainRef: "eip155:1", reason: "duplicate" },
      }),
    );
  });
});
