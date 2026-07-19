import { describe, expect, it, vi } from "vitest";
import { createEip155NetworksAdapter } from "./networks.js";

const createAdapter = () => {
  const transport = { request: vi.fn() };
  return { adapter: createEip155NetworksAdapter({ transport }), transport };
};

describe("EIP-155 Networks adapter", () => {
  it("queries the endpoint chain identity", async () => {
    const { adapter, transport } = createAdapter();
    transport.request.mockResolvedValue("0X02105");

    await expect(adapter.queryChainRef("https://rpc.example")).resolves.toBe("eip155:8453");
    expect(transport.request).toHaveBeenCalledWith({
      endpoint: "https://rpc.example",
      method: "eth_chainId",
    });
  });

  it("preserves transport failures", async () => {
    const { adapter, transport } = createAdapter();
    const failure = new Error("offline");
    transport.request.mockRejectedValue(failure);

    await expect(adapter.queryChainRef("https://rpc.example")).rejects.toBe(failure);
  });
});
