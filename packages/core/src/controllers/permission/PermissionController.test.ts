import { describe, expect, it, vi } from "vitest";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { InMemoryPermissionController } from "./PermissionController.js";
import {
  type PermissionMessengerTopics,
  type PermissionScopeResolver,
  PermissionScopes,
  type PermissionsState,
} from "./types.js";

const ORIGIN = "https://dapp.example";

const createController = (options?: { initialState?: PermissionsState; scopeResolver?: PermissionScopeResolver }) => {
  const messenger = new ControllerMessenger<PermissionMessengerTopics>({});
  const controller = new InMemoryPermissionController({
    messenger,
    scopeResolver: options?.scopeResolver ?? (() => undefined),
    ...(options?.initialState ? { initialState: options.initialState } : {}),
  });
  return { controller, messenger };
};

describe("InMemoryPermissionController", () => {
  it("tracks scopes and chains per namespace without duplicates", async () => {
    const { controller } = createController();

    await controller.grant(ORIGIN, PermissionScopes.Basic);
    await controller.grant(ORIGIN, PermissionScopes.Basic); // duplicate scope ignored
    await controller.grant(ORIGIN, PermissionScopes.Basic, { chainRef: "eip155:1" });
    await controller.grant(ORIGIN, PermissionScopes.Basic, { chainRef: "eip155:1" }); // duplicate chain ignored
    await controller.grant(ORIGIN, PermissionScopes.Accounts, { chainRef: "eip155:137" });

    expect(controller.getState()).toEqual({
      origins: {
        [ORIGIN]: {
          eip155: {
            scopes: [PermissionScopes.Basic, PermissionScopes.Accounts],
            chains: ["eip155:1", "eip155:137"],
          },
        },
      },
    });
  });

  it("emits origin updates with namespace payloads", async () => {
    const { controller } = createController();
    const events: PermissionsState["origins"][string][] = [];

    controller.onOriginPermissionsChanged((payload) => {
      events.push(payload.namespaces);
    });

    await controller.grant(ORIGIN, PermissionScopes.Basic, { chainRef: "eip155:1" });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      eip155: {
        scopes: [PermissionScopes.Basic],
        chains: ["eip155:1"],
      },
    });
  });

  it("uses invocation context namespace when ensuring permissions", async () => {
    const scopeResolver: PermissionScopeResolver = vi.fn((method) =>
      method === "eth_accounts" ? PermissionScopes.Accounts : undefined,
    );

    const { controller } = createController({ scopeResolver });

    await controller.grant(ORIGIN, PermissionScopes.Accounts, { chainRef: "eip155:137" });

    await expect(
      controller.ensurePermission(ORIGIN, "eth_accounts", { chainRef: "eip155:137" }),
    ).resolves.toBeUndefined();

    await expect(controller.ensurePermission(ORIGIN, "eth_accounts", { chainRef: "eip155:1" })).rejects.toThrow(
      /lacks chain permission for "eip155:1"/,
    );

    await expect(controller.ensurePermission(ORIGIN, "eth_accounts", { chainRef: "conflux:cfx" })).rejects.toThrow(
      /lacks scope/,
    );
  });

  it("falls back to default namespace when chainRef is malformed", async () => {
    const scopeResolver: PermissionScopeResolver = vi.fn(() => PermissionScopes.Basic);
    const { controller } = createController({ scopeResolver });

    await controller.grant(ORIGIN, PermissionScopes.Basic);

    await expect(
      controller.ensurePermission(ORIGIN, "wallet_switchEthereumChain", { chainRef: "malformed" }),
    ).resolves.toBeUndefined();
  });

  describe("authorization matrix", () => {
    it("tracks multiple chains within the same namespace", async () => {
      const { controller } = createController();

      await controller.grant(ORIGIN, PermissionScopes.Basic, { chainRef: "eip155:1" });
      await controller.grant(ORIGIN, PermissionScopes.Sign, { chainRef: "eip155:137" });

      const state = controller.getState().origins[ORIGIN]?.eip155;
      expect(state?.scopes).toEqual([PermissionScopes.Basic, PermissionScopes.Sign]);
      expect(state?.chains).toEqual(["eip155:1", "eip155:137"]);
    });

    it("keeps namespace scopes isolated", async () => {
      const { controller } = createController();

      await controller.grant(ORIGIN, PermissionScopes.Basic, { chainRef: "eip155:1" });
      await controller.grant(ORIGIN, PermissionScopes.Sign, { namespace: "conflux", chainRef: "conflux:cfx" });

      const eip155State = controller.getState().origins[ORIGIN]?.eip155;
      const confluxState = controller.getState().origins[ORIGIN]?.conflux;

      expect(eip155State?.scopes).toEqual([PermissionScopes.Basic]);
      expect(eip155State?.chains).toEqual(["eip155:1"]);
      expect(confluxState?.scopes).toEqual([PermissionScopes.Sign]);
      expect(confluxState?.chains).toEqual(["conflux:cfx"]);
    });

    it("adds scopes without duplicating chains", async () => {
      const { controller } = createController();

      await controller.grant(ORIGIN, PermissionScopes.Basic, { chainRef: "eip155:1" });
      await controller.grant(ORIGIN, PermissionScopes.Sign, { chainRef: "eip155:1" });

      const state = controller.getState().origins[ORIGIN]?.eip155;

      expect(state?.scopes).toEqual([PermissionScopes.Basic, PermissionScopes.Sign]);
      expect(state?.chains).toEqual(["eip155:1"]);
    });

    it("allows granting scopes without specifying chains", async () => {
      const { controller } = createController();

      await controller.grant(ORIGIN, PermissionScopes.Basic);

      const state = controller.getState().origins[ORIGIN]?.eip155;

      expect(state?.scopes).toEqual([PermissionScopes.Basic]);
      expect(state?.chains).toEqual([]);
    });
  });

  describe("unauthorized chain blocking", () => {
    it("blocks when the origin has no permissions", async () => {
      const scopeResolver: PermissionScopeResolver = vi.fn(() => PermissionScopes.Basic);
      const { controller } = createController({ scopeResolver });

      await expect(
        controller.ensurePermission(ORIGIN, "wallet_switchEthereumChain", { chainRef: "eip155:1" }),
      ).rejects.toThrow(/lacks scope/);
    });

    it("blocks when namespace exists but chain is missing", async () => {
      const scopeResolver: PermissionScopeResolver = vi.fn(() => PermissionScopes.Basic);
      const { controller } = createController({ scopeResolver });

      await controller.grant(ORIGIN, PermissionScopes.Basic, { chainRef: "eip155:1" });

      await expect(
        controller.ensurePermission(ORIGIN, "wallet_switchEthereumChain", { chainRef: "eip155:10" }),
      ).rejects.toThrow(/lacks chain permission for "eip155:10"/);
    });

    it("allows methods without scope requirements", async () => {
      const scopeResolver: PermissionScopeResolver = vi.fn(() => undefined);
      const { controller } = createController({ scopeResolver });

      await expect(
        controller.ensurePermission(ORIGIN, "wallet_switchEthereumChain", { chainRef: "eip155:1" }),
      ).resolves.toBeUndefined();
    });
  });

  it("clears all namespaces for an origin", async () => {
    const initial: PermissionsState = {
      origins: {
        [ORIGIN]: {
          eip155: {
            scopes: [PermissionScopes.Basic],
            chains: ["eip155:1"],
          },
          conflux: {
            scopes: [PermissionScopes.Sign],
            chains: ["conflux:cfx"],
          },
        },
      },
    };

    const { controller } = createController({ initialState: initial });

    await controller.clear(ORIGIN);

    expect(controller.getState().origins[ORIGIN]).toBeUndefined();
  });
});
