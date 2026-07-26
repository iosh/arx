export type Unsubscribe = () => void;

export type MessageListener = (message: unknown) => void;

export type DisconnectListener = () => void;

export type DuplexChannel = Readonly<{
  send(message: unknown): void;
  onMessage(listener: MessageListener): Unsubscribe;
  onDisconnect(listener: DisconnectListener): Unsubscribe;
}>;
