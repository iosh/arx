import { describe, expect, it } from "vitest";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { InMemoryMultiNamespaceAccountsController } from "./MultiNamespaceAccountsController.js";
import type {
  AccountMessengerTopics,
  ActivePointer,
  MultiNamespaceAccountsState,
  NamespaceStateChange,
} from "./types.js";

const createController = (initialState?: MultiNamespaceAccountsState<string>) => {
  const messenger = new ControllerMessenger<AccountMessengerTopics<string>>({});
  const controller = new InMemoryMultiNamespaceAccountsController({
    messenger,
    ...(initialState ? { initialState } : {}),
  });
  return { controller, messenger };
};

describe("InMemoryMultiNamespaceAccountsController", () => {
  it("normalizes addresses and sets primary on first add", async () => {
    const { controller } = createController();

    await controller.addAccount({
      chainRef: "eip155:1",
      address: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
    });

    await controller.addAccount({
      chainRef: "eip155:1",
      address: "0xaabbccddeeff00112233445566778899aabbccdd",
    });

    const state = controller.getState();
    expect(state.namespaces.eip155?.all).toEqual(["0xaabbccddeeff00112233445566778899aabbccdd"]);
    expect(state.namespaces.eip155?.primary).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("switchActive updates pointer and rejects unknown address", async () => {
    const { controller } = createController();

    await controller.addAccount({
      chainRef: "eip155:1",
      address: "0x1111111111111111111111111111111111111111",
    });

    const pointer = await controller.switchActive({
      chainRef: "eip155:1",
      address: "0x1111111111111111111111111111111111111111",
    });

    expect(pointer).toEqual({
      namespace: "eip155",
      chainRef: "eip155:1",
      address: "0x1111111111111111111111111111111111111111",
    });

    await expect(
      controller.switchActive({
        chainRef: "eip155:1",
        address: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow(/is not registered/);
  });

  it("requestAccounts assigns primary when missing", async () => {
    const initial: MultiNamespaceAccountsState<string> = {
      namespaces: {
        eip155: {
          all: ["0xabc0000000000000000000000000000000000000", "0xdef0000000000000000000000000000000000000"],
          primary: null,
        },
      },
      active: {
        namespace: "eip155",
        chainRef: "eip155:1",
        address: null,
      },
    };

    const { controller } = createController(initial);

    const accounts = await controller.requestAccounts({
      origin: "https://dapp.example",
      chainRef: "eip155:1",
    });

    expect(accounts).toEqual(initial.namespaces?.eip155?.all);
    expect(controller.getState().namespaces.eip155?.primary).toBe("0xabc0000000000000000000000000000000000000");
  });

  it("emits state, namespace, and active events", async () => {
    const { controller } = createController();

    const stateEvents: MultiNamespaceAccountsState<string>[] = [];
    const namespaceEvents: NamespaceStateChange<string>[] = [];
    const activeEvents: Array<ActivePointer<string> | null> = [];

    controller.onStateChanged((state) => {
      stateEvents.push(state);
    });

    controller.onNamespaceChanged((event) => {
      namespaceEvents.push(event);
    });

    controller.onActiveChanged((pointer) => {
      activeEvents.push(pointer);
    });

    await controller.addAccount({
      chainRef: "eip155:1",
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    await controller.switchActive({
      chainRef: "eip155:1",
    });

    expect(stateEvents).toHaveLength(2);
    expect(namespaceEvents).toHaveLength(1);
    expect(namespaceEvents[0]?.namespace).toBe("eip155");
    expect(namespaceEvents[0]?.state.all).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);

    expect(activeEvents).toHaveLength(1);
    expect(activeEvents[0]).toEqual({
      namespace: "eip155",
      chainRef: "eip155:1",
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });
});
