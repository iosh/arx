import { ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "@arx/core/chain-json-rpc";
import {
  BuiltinNetworkConflictError,
  CustomNetworkAlreadyExistsError,
  type CustomNetworkInput,
} from "@arx/core/networks";
import { isWalletApiError } from "@arx/wallet-api/client";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type Eip155NetworkMetadata, getEip155NetworkMetadata } from "@/ui/namespaces/eip155/networkMetadata";
import { isHttpUrl } from "@/ui/utils/url";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useNetworks } from "@/ui/wallet/networks/useNetworks";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { getNetworkRpcError } from "./networkRpcError";

type EvmNetworkFormFields = {
  nodes: [{ url: string }, ...{ url: string }[]];
  chainId: string;
  name: string;
  symbol: string;
  decimals: string;
  explorer: string;
  isTestnet: boolean;
};

type LoadSource = { rpcUrl: string; index: number } | { chainId: string };

type LoadedNetwork = {
  chainId: string;
  metadata?: Eip155NetworkMetadata | null;
  metadataError?: unknown;
};

const metadataFields = ["name", "symbol", "decimals", "explorer"] as const;
export const chainIdPattern = /^[1-9][0-9]{0,31}$/;

export function useAddEvmNetworkForm() {
  const { t } = useTranslation("wallet");
  const { client: wallet } = useWallet();
  const { data: networks } = useNetworks();
  const navigate = useNavigate();
  const reportError = useWalletError();
  const [confirmedChainId, setConfirmedChainId] = useState("");
  const form = useForm<EvmNetworkFormFields>({
    defaultValues: {
      nodes: [{ url: "" }],
      chainId: "",
      name: "",
      symbol: "",
      decimals: "18",
      explorer: "",
      isTestnet: false,
    },
    mode: "onBlur",
  });
  const chainId = useWatch({ control: form.control, name: "chainId" });
  const existingNetwork = networks?.find((network) => network.chainRef === `eip155:${chainId}`);
  const saving = useWalletMutation({ mutationFn: wallet.networks.addCustom });
  const loading = useWalletMutation({ mutationFn: loadNetwork });
  const pending = loading.isPending || saving.isPending;
  const metadataReadOnly = pending || !confirmedChainId || chainId !== confirmedChainId;
  useBlocker({ shouldBlockFn: () => saving.isPending, enableBeforeUnload: false });

  let metadataMessage: string | undefined;
  if (loading.isPending) metadataMessage = t("loadingNetworkMetadata");
  else if (loading.data && loading.data.chainId === chainId) {
    if (loading.data.metadataError !== undefined) metadataMessage = t("networkMetadataUnavailable");
    else if (loading.data.metadata === null) metadataMessage = t("networkMetadataNotFound");
  }

  async function loadNetwork(source: LoadSource): Promise<LoadedNetwork> {
    let loadedChainId: string;
    if ("rpcUrl" in source) {
      const result = await wallet.eip155.eth_chainId([], { endpoint: source.rpcUrl });
      loadedChainId = BigInt(result).toString(10);
    } else {
      loadedChainId = source.chainId;
    }
    const installed = networks?.some((network) => network.chainRef === `eip155:${loadedChainId}`);
    if (!chainIdPattern.test(loadedChainId) || loadedChainId === confirmedChainId || installed) {
      return { chainId: loadedChainId };
    }

    try {
      const metadata = await getEip155NetworkMetadata(BigInt(loadedChainId));
      return { chainId: loadedChainId, metadata };
    } catch (metadataError) {
      return { chainId: loadedChainId, metadata: null, metadataError };
    }
  }

  function applyLoadedNetwork(result: LoadedNetwork) {
    form.setValue("chainId", result.chainId, { shouldValidate: true });
    if (!chainIdPattern.test(result.chainId) || result.chainId === confirmedChainId) return;
    for (const name of [...metadataFields, "isTestnet"] as const) form.resetField(name);
    form.clearErrors("nodes");
    if (result.metadata) {
      form.setValue("name", result.metadata.name);
      form.setValue("symbol", result.metadata.symbol);
      form.setValue("decimals", String(result.metadata.decimals));
      form.setValue("explorer", result.metadata.explorer);
    }
    setConfirmedChainId(result.chainId);
  }

  function handleLoadError(error: Error, source: LoadSource) {
    if (
      "rpcUrl" in source &&
      (isWalletApiError(error, ChainJsonRpcResponseError) || isWalletApiError(error, ChainJsonRpcUnavailableError))
    ) {
      form.setError(`nodes.${source.index}.url`, { type: "rpc", message: t("rpcReadFailed") });
    } else {
      reportError(error);
    }
  }

  function startLoading(source: LoadSource) {
    if (pending) return;
    if ("rpcUrl" in source) form.clearErrors(`nodes.${source.index}.url`);
    loading.mutate(source, {
      onSuccess: applyLoadedNetwork,
      onError: (error) => handleLoadError(error, source),
    });
  }

  function confirmChainId() {
    const value = form.getValues("chainId");
    if (chainIdPattern.test(value) && value !== confirmedChainId) startLoading({ chainId: value });
  }

  function readFromFirstRpc() {
    for (const [index, { url }] of form.getValues("nodes").entries()) {
      const endpoint = url.trim();
      if (isHttpUrl(endpoint)) {
        startLoading({ rpcUrl: endpoint, index });
        return;
      }
    }
    void form.trigger("nodes.0.url", { shouldFocus: true });
  }

  function saveNetwork(values: EvmNetworkFormFields) {
    const symbol = values.symbol.trim();
    const explorer = values.explorer.trim();
    const [first, ...rest] = values.nodes;
    const input: CustomNetworkInput = {
      definition: {
        chainRef: `eip155:${values.chainId}`,
        name: values.name.trim(),
        nativeCurrency: { name: symbol, symbol, decimals: Number(values.decimals) },
        isTestnet: values.isTestnet,
        ...(explorer ? { blockExplorers: [{ url: explorer }] } : {}),
      },
      defaultRpcEndpoints: [first.url.trim(), ...rest.map(({ url }) => url.trim())],
    };
    saving.mutate(input, {
      onSuccess: () => {
        toast.success(t("networkAdded", { networkName: input.definition.name }));
        void navigate({ to: "/wallet/settings/networks", replace: true, ignoreBlocker: true });
      },
      onError: (error) => {
        if (
          isWalletApiError(error, CustomNetworkAlreadyExistsError) ||
          isWalletApiError(error, BuiltinNetworkConflictError)
        ) {
          form.setError(
            "chainId",
            { type: "duplicate", message: t("chainIdAlreadyUsed", { chainId: values.chainId }) },
            { shouldFocus: true },
          );
          return;
        }
        const rpcError = getNetworkRpcError(error, input.definition.name, t);
        if (rpcError) {
          const index = input.defaultRpcEndpoints.indexOf(rpcError.endpoint);
          form.setError(`nodes.${index}.url`, { type: "rpc", message: rpcError.message }, { shouldFocus: true });
          return;
        }
        reportError(error);
      },
    });
  }

  return {
    form,
    pending,
    loading: loading.isPending,
    saving: saving.isPending,
    metadataReadOnly,
    loadingMessage: loading.isPending ? t("loadingNetworkMetadata") : undefined,
    existingNetwork,
    metadataMessage,
    startLoading,
    confirmChainId,
    readFromFirstRpc,
    validateChainId: (value: string) => {
      const network = networks?.find((candidate) => candidate.chainRef === `eip155:${value}`);
      return network ? t("chainIdUsedByNetwork", { chainId: value, networkName: network.name }) : true;
    },
    submit: (event: FormEvent<HTMLFormElement>) => {
      if (metadataReadOnly) {
        event.preventDefault();
        return;
      }
      void form.handleSubmit(saveNetwork)(event);
    },
  };
}
