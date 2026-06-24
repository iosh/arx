import type { UiClient } from "./client/index.js";
import type { UiMethodName, UiMethodParams, UiMethodResult } from "./protocol/index.js";

type UiActionArgs<M extends UiMethodName> =
  undefined extends UiMethodParams<M> ? [params?: UiMethodParams<M>] : [params: UiMethodParams<M>];

export const uiActions = (client: UiClient) => {
  const call =
    <M extends UiMethodName>(method: M) =>
    (...args: UiActionArgs<M>): Promise<UiMethodResult<M>> => {
      const [params] = args;
      return params === undefined ? client.call(method) : client.call(method, params);
    };

  return {
    entry: {
      getLaunchContext: call("ui.entry.getLaunchContext"),
      getBootstrap: call("ui.entry.getBootstrap"),
    },

    onboarding: {
      openTab: call("ui.onboarding.openTab"),
    },
  };
};
