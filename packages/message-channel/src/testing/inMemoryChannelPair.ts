import type { DisconnectListener, DuplexChannel, MessageListener } from "../channel.js";

type EndpointState = {
  connected: boolean;
  messageListeners: Set<MessageListener>;
  disconnectListeners: Set<DisconnectListener>;
  peer: EndpointState | null;
};

export type InMemoryChannelPair = Readonly<{
  left: DuplexChannel;
  right: DuplexChannel;
  disconnect(): void;
}>;

const createEndpoint = (state: EndpointState): DuplexChannel => ({
  send(message) {
    if (!state.connected || !state.peer?.connected) {
      throw new Error("Cannot send through a disconnected channel.");
    }

    for (const listener of [...state.peer.messageListeners]) {
      listener(message);
    }
  },
  onMessage(listener) {
    state.messageListeners.add(listener);
    return () => {
      state.messageListeners.delete(listener);
    };
  },
  onDisconnect(listener) {
    state.disconnectListeners.add(listener);
    return () => {
      state.disconnectListeners.delete(listener);
    };
  },
});

const disconnectEndpoint = (state: EndpointState): void => {
  const listeners = [...state.disconnectListeners];
  state.messageListeners.clear();
  state.disconnectListeners.clear();

  for (const listener of listeners) {
    listener();
  }
};

export const createInMemoryChannelPair = (): InMemoryChannelPair => {
  const leftState: EndpointState = {
    connected: true,
    messageListeners: new Set(),
    disconnectListeners: new Set(),
    peer: null,
  };
  const rightState: EndpointState = {
    connected: true,
    messageListeners: new Set(),
    disconnectListeners: new Set(),
    peer: leftState,
  };
  leftState.peer = rightState;

  return {
    left: createEndpoint(leftState),
    right: createEndpoint(rightState),
    disconnect: () => {
      if (!leftState.connected && !rightState.connected) {
        return;
      }

      leftState.connected = false;
      rightState.connected = false;
      disconnectEndpoint(leftState);
      disconnectEndpoint(rightState);
    },
  };
};
