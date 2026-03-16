import { describe, expect, it } from "vitest";
import { assembleRuntimeNamespaceStages } from "./assembly.js";
import { eip155NamespaceManifest } from "./eip155/manifest.js";

describe("namespace stage assembly", () => {
  it("assembles bootstrap and session facts from the same manifest source", () => {
    const stages = assembleRuntimeNamespaceStages([eip155NamespaceManifest]);

    expect(stages.bootstrap.rpcModules).toEqual([eip155NamespaceManifest.core.rpc]);
    expect(stages.bootstrap.accountCodecs.require("eip155")).toBe(eip155NamespaceManifest.core.accountCodec);
    expect(stages.bootstrap.chainAddressCodecs.getCodec("eip155:1")).toBe(
      eip155NamespaceManifest.core.chainAddressCodec,
    );
    expect(stages.bootstrap.chainSeeds).toEqual(eip155NamespaceManifest.core.chainSeeds);
    expect(stages.bootstrap.chainSeeds).not.toBe(eip155NamespaceManifest.core.chainSeeds);
    expect(stages.bootstrap.chainSeeds[0]).not.toBe(eip155NamespaceManifest.core.chainSeeds?.[0]);

    expect(stages.session.keyringNamespaces).toHaveLength(1);
    expect(stages.session.keyringNamespaces[0]).toEqual(eip155NamespaceManifest.core.keyring);
    expect(stages.session.keyringNamespaces[0]).not.toBe(eip155NamespaceManifest.core.keyring);
    expect(stages.session.keyringNamespaces[0]?.factories).not.toBe(eip155NamespaceManifest.core.keyring.factories);
  });

  it("rejects duplicate namespace manifests before producing stage output", () => {
    expect(() => assembleRuntimeNamespaceStages([eip155NamespaceManifest, eip155NamespaceManifest])).toThrow(
      /Duplicate namespace manifest "eip155"/,
    );
  });
});
