import type { AccountMessengerTopics } from "../../controllers/account/types.js";
import type { ApprovalMessengerTopics } from "../../controllers/approval/types.js";
import type { ChainRegistryMessengerTopics } from "../../controllers/chainRegistry/types.js";
import type { NetworkMessengerTopic } from "../../controllers/network/types.js";
import type { PermissionMessengerTopics } from "../../controllers/permission/types.js";
import type { TransactionMessengerTopics } from "../../controllers/transaction/types.js";
import type { UnlockMessengerTopics } from "../../controllers/unlock/types.js";
import type { ControllerMessenger } from "../../messenger/ControllerMessenger.js";

export type MessengerTopics = AccountMessengerTopics &
  ApprovalMessengerTopics &
  NetworkMessengerTopic &
  PermissionMessengerTopics &
  TransactionMessengerTopics &
  UnlockMessengerTopics &
  ChainRegistryMessengerTopics;

export type BackgroundMessenger = ControllerMessenger<MessengerTopics>;

export const castMessenger = <Topics extends Record<string, unknown>>(messenger: BackgroundMessenger) =>
  messenger as unknown as ControllerMessenger<Topics>;
