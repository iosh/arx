import { Hex, Signature } from "ox";
import type { Accounts } from "../../accounts/Accounts.js";
import type { Approvals } from "../../approvals/Approvals.js";
import { isApprovalDecisionError } from "../../approvals/errors.js";
import { type DappRequestMethod, defineDappMethod } from "../../dappConnections/routeDappRequest.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { PermissionsReader } from "../../permissions/Permissions.js";
import {
  RpcInternalError,
  RpcInvalidParamsError,
  RpcUnauthorizedError,
  RpcUserRejectedRequestError,
} from "../../rpc/errors.js";
import { type Eip155AccountSigning, isAccountSigningUnavailableError } from "./accountSigning.js";
import { chainIdFromChainRef } from "./chainId.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { getAuthorizedAccount } from "./dappAccount.js";
import { decodePersonalSignParams, personalMessageDigest } from "./personalSign.js";
import type { Eip155PersonalMessage, Eip155SignRequest, Eip155TypedData } from "./signingRequest.js";
import { decodeSignTypedDataV4Params } from "./typedData.js";

type Eip155SignPayload =
  | Readonly<{
      type: "personalMessage";
      message: Eip155PersonalMessage;
    }>
  | Readonly<{
      type: "typedData";
      typedData: Eip155TypedData;
    }>;

type CreateEip155DappSigningHandlersOptions = Readonly<{
  accounts: Pick<Accounts, "accountIdFromAddress" | "getAccount" | "getAddress">;
  permissions: Pick<PermissionsReader, "get">;
  approvals: Pick<Approvals, "request">;
  accountSigning: Eip155AccountSigning;
}>;

export const createEip155DappSigningHandlers = (
  options: CreateEip155DappSigningHandlersOptions,
): Readonly<{
  personalSign: DappRequestMethod;
  signTypedDataV4: DappRequestMethod;
}> => {
  const approveAndSign = async (input: {
    origin: string;
    chainRef: ChainRef;
    address: string;
    payload: Eip155SignPayload;
    digest: Hex.Hex;
  }): Promise<Hex.Hex> => {
    const account = getAuthorizedAccount(options, input);
    const request: Eip155SignRequest = { account, ...input.payload };
    const approval = options.approvals.request<"sign">({
      type: "sign",
      namespace: EIP155_NAMESPACE,
      origin: input.origin,
      request,
    });

    try {
      await approval.decision;
    } catch (error) {
      if (isApprovalDecisionError(error)) throw new RpcUserRejectedRequestError({ message: error.message });
      throw error;
    }

    try {
      const signature = await options.accountSigning.signDigest({
        accountId: account.accountId,
        digest: Hex.toBytes(input.digest),
      });
      return Signature.toHex(signature);
    } catch (error) {
      if (isAccountSigningUnavailableError(error)) throw new RpcUnauthorizedError();
      throw new RpcInternalError({ message: "Unable to sign the EIP-155 request.", cause: error });
    }
  };

  return {
    personalSign: defineDappMethod({
      decode: decodePersonalSignParams,
      execute: ({ origin, chainRef, params }) =>
        approveAndSign({
          origin,
          chainRef,
          address: params.address,
          payload: { type: "personalMessage", message: params.message },
          digest: personalMessageDigest(params.message),
        }),
    }),
    signTypedDataV4: defineDappMethod({
      decode: decodeSignTypedDataV4Params,
      execute: ({ origin, chainRef, params }) => {
        if (params.domainChainId !== undefined && params.domainChainId !== chainIdFromChainRef(chainRef)) {
          throw new RpcInvalidParamsError({
            message: "eth_signTypedData_v4: domain.chainId must match the active chain.",
          });
        }

        return approveAndSign({
          origin,
          chainRef,
          address: params.address,
          payload: { type: "typedData", typedData: params.typedData },
          digest: params.digest,
        });
      },
    }),
  };
};
