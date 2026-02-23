export type TopicKind = "event" | "state";

export type Unsubscribe = () => void;

// Bivariant callback so Topic<SpecificPayload> can be treated as Topic<unknown> when we only need `.name`.
// This keeps scoped topic lists ergonomic while preserving strong typing at call sites.
export type IsEqual<Payload> = {
  bivarianceHack(prev: Payload, next: Payload): boolean;
}["bivarianceHack"];

// Bivariant so Topic<SpecificPayload> can be treated as Topic<unknown> at DI boundaries.
export type Validate<Payload> = {
  bivarianceHack(value: unknown): value is Payload;
}["bivarianceHack"];

export type Topic<Payload, Name extends string = string> = {
  name: Name;
  kind: TopicKind;

  /**
   * Whether to remember the last payload as a snapshot.
   * - state topics: true by default
   * - event topics: false by default
   */
  remember: boolean;

  /**
   * Equality check used for dedupe when remember=true.
   * Defaults to Object.is when not provided.
   */
  isEqual?: IsEqual<Payload>;

  /**
   * Optional runtime payload validator.
   * Useful to fail fast during early-stage development and tests.
   */
  validate?: Validate<Payload>;

  description?: string;
};

export type PayloadOfTopic<T> = T extends Topic<infer P, string> ? P : never;

export const eventTopic = <Payload, const Name extends string = string>(
  name: Name,
  opts: {
    remember?: boolean;
    validate?: Validate<Payload>;
    description?: string;
  } = {},
): Topic<Payload, Name> => ({
  name,
  kind: "event",
  remember: opts.remember ?? false,
  ...(opts.validate ? { validate: opts.validate } : {}),
  ...(opts.description ? { description: opts.description } : {}),
});

export const stateTopic = <Payload, const Name extends string = string>(
  name: Name,
  opts: {
    isEqual?: IsEqual<Payload>;
    validate?: Validate<Payload>;
    description?: string;
  } = {},
): Topic<Payload, Name> => ({
  name,
  kind: "state",
  remember: true,
  ...(opts.isEqual ? { isEqual: opts.isEqual } : {}),
  ...(opts.validate ? { validate: opts.validate } : {}),
  ...(opts.description ? { description: opts.description } : {}),
});
