export type TopicKind = "event" | "state";

export type Unsubscribe = () => void;

declare const topicPayload: unique symbol;

export type Topic<Payload, Name extends string = string> = {
  name: Name;
  kind: TopicKind;
  readonly [topicPayload]?: Payload;
};

export const eventTopic = <Payload, const Name extends string = string>(name: Name): Topic<Payload, Name> => ({
  name,
  kind: "event",
});

export const stateTopic = <Payload, const Name extends string = string>(name: Name): Topic<Payload, Name> => ({
  name,
  kind: "state",
});
