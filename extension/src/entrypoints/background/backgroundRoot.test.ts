import type { CoreRuntime } from "@arx/core/runtime";
import { describe, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { type BackgroundRootDependencies, createBackgroundRoot } from "./backgroundRoot";
import type { BrowserChannelHosts, PendingBrowserPort } from "./browserChannels";

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      id: "test",
      getURL: () => "chrome-extension://test/",
      onConnect: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  },
}));

type Deferred<Value> = Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}>;

const createDeferred = <Value>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

type OnConnectListener = (port: Runtime.Port) => void;

const createHarness = () => {
  let onConnectListener: OnConnectListener | null = null;
  const persistence = { kind: "persistence" };
  const walletUiInput = {
    subscribe: vi.fn(() => vi.fn()),
    publish: vi.fn(),
  };
  const runtime = {
    wallet: { kind: "wallet-api" },
    dappConnections: { kind: "dapp-connections-api" },
  } as unknown as CoreRuntime;
  const walletHost = { attach: vi.fn() };
  const dappHost = { attach: vi.fn() };
  const createPersistence = vi.fn(() => persistence);
  const createWalletUiInputSource = vi.fn(() => walletUiInput);
  const createRuntime = vi.fn(async () => runtime);
  const createWalletHost = vi.fn(() => walletHost);
  const createDappTransportHost = vi.fn(() => dappHost);
  const acceptBrowserPort = vi.fn<() => PendingBrowserPort | null>(() => null);
  const onConnectAddListener = vi.fn((listener: OnConnectListener) => {
    onConnectListener = listener;
  });
  const dependencies = {
    browser: {
      runtime: {
        id: "arx",
        getURL: vi.fn(() => "chrome-extension://arx/"),
        onConnect: {
          addListener: onConnectAddListener,
          removeListener: vi.fn(),
        },
      },
    },
    createPersistence,
    createRuntime,
    createWalletHost,
    createDappTransportHost,
    createWalletUiInputSource,
    acceptBrowserPort,
  } as unknown as BackgroundRootDependencies;

  return {
    dependencies,
    persistence,
    walletUiInput,
    runtime,
    walletHost,
    dappHost,
    createPersistence,
    createWalletUiInputSource,
    createRuntime,
    createWalletHost,
    createDappTransportHost,
    acceptBrowserPort,
    onConnectAddListener,
    getOnConnectListener: () => {
      if (!onConnectListener) {
        throw new Error("The background onConnect listener was not attached.");
      }
      return onConnectListener;
    },
  };
};

describe("backgroundRoot", () => {
  it("creates one persistence, runtime, and pair of process hosts", async () => {
    const harness = createHarness();
    const root = createBackgroundRoot(harness.dependencies);

    await Promise.all([root.initialize(), root.initialize()]);

    expect(harness.createPersistence).toHaveBeenCalledOnce();
    expect(harness.createWalletUiInputSource).toHaveBeenCalledOnce();
    expect(harness.createRuntime.mock.calls).toEqual([
      [{ persistence: harness.persistence, userActivity: harness.walletUiInput }],
    ]);
    expect(harness.createWalletHost.mock.calls).toEqual([[{ api: harness.runtime.wallet }]]);
    expect(harness.createDappTransportHost.mock.calls).toEqual([
      [{ dappConnections: harness.runtime.dappConnections }],
    ]);
    expect(harness.onConnectAddListener).toHaveBeenCalledOnce();
  });

  it("accepts browser ports synchronously and attaches them after runtime bootstrap", async () => {
    const harness = createHarness();
    const runtimeReady = createDeferred<CoreRuntime>();
    const pendingPort = {
      attach: vi.fn<(hosts: BrowserChannelHosts) => void>(),
      reject: vi.fn(),
    };
    harness.createRuntime.mockImplementation(async () => await runtimeReady.promise);
    harness.acceptBrowserPort.mockReturnValue(pendingPort);
    const root = createBackgroundRoot(harness.dependencies);

    const initialization = root.initialize();
    const port = { name: "test" } as Runtime.Port;
    harness.getOnConnectListener()(port);

    expect(harness.acceptBrowserPort.mock.calls).toEqual([
      [
        {
          port,
          extensionUrl: "chrome-extension://arx/",
          runtimeId: "arx",
          onWalletUiInput: harness.walletUiInput.publish,
        },
      ],
    ]);
    expect(pendingPort.attach).not.toHaveBeenCalled();

    runtimeReady.resolve(harness.runtime);
    await initialization;

    expect(pendingPort.attach.mock.calls).toEqual([[{ wallet: harness.walletHost, dapp: harness.dappHost }]]);
    expect(pendingPort.reject).not.toHaveBeenCalled();
  });

  it("treats failed runtime bootstrap as terminal for the current background process", async () => {
    const harness = createHarness();
    const runtimeReady = createDeferred<CoreRuntime>();
    const firstPort = { attach: vi.fn(), reject: vi.fn() };
    const laterPort = { attach: vi.fn(), reject: vi.fn() };
    const bootError = new Error("boot failed");
    harness.createRuntime.mockImplementation(async () => await runtimeReady.promise);
    harness.acceptBrowserPort.mockReturnValueOnce(firstPort).mockReturnValueOnce(laterPort);
    const root = createBackgroundRoot(harness.dependencies);

    const initialization = root.initialize();
    const onConnect = harness.getOnConnectListener();
    onConnect({ name: "first" } as Runtime.Port);
    runtimeReady.reject(bootError);

    await expect(initialization).rejects.toBe(bootError);
    expect(firstPort.reject).toHaveBeenCalledOnce();
    expect(firstPort.attach).not.toHaveBeenCalled();
    expect(harness.createWalletHost).not.toHaveBeenCalled();
    expect(harness.createDappTransportHost).not.toHaveBeenCalled();

    await expect(root.initialize()).rejects.toBe(bootError);
    onConnect({ name: "later" } as Runtime.Port);
    await Promise.resolve();

    expect(harness.createRuntime).toHaveBeenCalledOnce();
    expect(harness.onConnectAddListener).toHaveBeenCalledOnce();
    expect(laterPort.reject).toHaveBeenCalledOnce();
    expect(laterPort.attach).not.toHaveBeenCalled();
  });
});
