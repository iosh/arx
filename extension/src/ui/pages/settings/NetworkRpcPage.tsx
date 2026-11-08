import { type ChainRef, type Network, NetworkNotFoundError, type NetworkRpcConfiguration } from "@arx/core/networks";
import { isWalletApiError } from "@arx/wallet-api/client";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Check, Plus, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/components/ui/input-group";
import { Spinner } from "@/ui/components/ui/spinner";
import { isHttpUrl } from "@/ui/utils/url";
import { useWallet } from "@/ui/wallet/connection/WalletContext";
import { useNetworkRpcConfiguration } from "@/ui/wallet/networks/useNetworkRpcConfiguration";
import { useNetwork } from "@/ui/wallet/networks/useNetworks";
import { useWalletError } from "@/ui/wallet/useWalletError";
import { useWalletMutation } from "@/ui/wallet/useWalletMutation";
import { getNetworkRpcError } from "./networkRpcError";

type RpcNode = { url: string };

type RpcFields = {
  source: NetworkRpcConfiguration["source"];
  nodes: [RpcNode, ...RpcNode[]];
};

const toRpcFormValues = (rpc: NetworkRpcConfiguration): RpcFields => {
  if (rpc.source === "default") return { source: "default", nodes: [{ url: "" }] };
  const [first, ...rest] = rpc.endpoints;
  return { source: "override", nodes: [{ url: first }, ...rest.map((url) => ({ url }))] };
};

export function NetworkRpcPage({ chainRef }: { chainRef: ChainRef }) {
  const { t } = useTranslation("wallet");
  const { data: network, isPending } = useNetwork(chainRef);
  const { data: rpc, isPending: rpcPending } = useNetworkRpcConfiguration(chainRef, network != null);

  if (network && rpc) return <NetworkRpcForm network={network} rpc={rpc} />;

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("rpcNodes")} · ARX`}</title>
      <PageHeader
        title={t("rpcNodes")}
        subtitle={network?.name}
        backTo="/wallet/settings/networks/$chainRef"
        backLabel={t("backToNetworkDetails")}
      />
      <div className="flex min-h-14 items-center px-7.5 text-sm text-muted-foreground">
        {network === null ? (
          t("networkUnavailable")
        ) : isPending || (network && rpcPending) ? (
          <Spinner aria-label={t("loadingRpcConfiguration")} />
        ) : null}
      </div>
    </main>
  );
}

function NetworkRpcForm({ network, rpc }: { network: Network; rpc: NetworkRpcConfiguration }) {
  const { t } = useTranslation("wallet");
  const { client: wallet } = useWallet();
  const navigate = useNavigate();
  const reportError = useWalletError();
  const id = useId();
  const appliedRpc = useRef(rpc);
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setError,
    clearErrors,
    trigger,
    reset,
    formState: { errors, isDirty },
  } = useForm<RpcFields>({ defaultValues: toRpcFormValues(rpc), mode: "onChange" });
  const { fields, append, remove } = useFieldArray({ control, name: "nodes" });
  const source = useWatch({ control, name: "source" });
  const defaults = rpc.source === "override" ? rpc.defaultEndpoints : rpc.endpoints;
  const saving = useWalletMutation({
    mutationFn: (values: RpcFields) => {
      if (values.source === "default") return wallet.networks.clearRpcOverride(network.chainRef);
      const [first, ...rest] = values.nodes;
      return wallet.networks.setRpcOverride({
        chainRef: network.chainRef,
        endpoints: [first.url.trim(), ...rest.map(({ url }) => url.trim())],
      });
    },
  });
  const pending = saving.isPending;

  useBlocker({ shouldBlockFn: () => pending, enableBeforeUnload: false });
  useEffect(() => {
    // Field array resets recreate inputs and discard focus.
    if (!isDirty && !pending && appliedRpc.current !== rpc) {
      reset(toRpcFormValues(rpc));
      appliedRpc.current = rpc;
    }
  }, [rpc, isDirty, pending, reset]);

  function submit(values: RpcFields) {
    saving.mutate(values, {
      onSuccess: () => {
        void navigate({
          to: "/wallet/settings/networks/$chainRef",
          params: { chainRef: network.chainRef },
          replace: true,
          ignoreBlocker: true,
        });
      },
      onError: (error) => {
        if (isWalletApiError(error, NetworkNotFoundError)) return;
        const rpcError = getNetworkRpcError(error, network.name, t);
        if (rpcError) {
          const index = values.nodes.findIndex(({ url }) => url.trim() === rpcError.endpoint);
          // Read-only fields remain focusable before the settled mutation renders.
          setError(`nodes.${index}.url`, { type: "rpc", message: rpcError.message }, { shouldFocus: true });
          return;
        }
        reportError(error);
      },
    });
  }

  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("rpcNodes")} · ${network.name} · ARX`}</title>
      <PageHeader
        title={t("rpcNodes")}
        subtitle={network.name}
        backTo="/wallet/settings/networks/$chainRef"
        backLabel={t("backToNetworkDetails")}
        backDisabled={pending}
      />
      <form onSubmit={handleSubmit(submit)} noValidate aria-busy={pending} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pt-1 pb-3.5">
          <Controller
            control={control}
            name="source"
            render={({ field }) => (
              <RadioGroup.Root
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  clearErrors("nodes");
                  void trigger("nodes");
                }}
                disabled={pending}
                aria-label={t("rpcSource")}
                className="shrink-0 overflow-hidden rounded-2xl bg-card py-1 text-card-foreground"
              >
                <RadioGroup.Item
                  value="default"
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-45"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t("defaultRpc")}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t(network.source === "builtin" ? "rpcProvidedByArx" : "rpcFromNetworkConfiguration")}
                    </span>
                  </span>
                  <RadioGroup.Indicator>
                    <Check aria-hidden="true" className="size-4 text-primary" />
                  </RadioGroup.Indicator>
                </RadioGroup.Item>
                <RadioGroup.Item
                  value="override"
                  className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-45"
                >
                  <span className="min-w-0 flex-1">{t("customRpc")}</span>
                  <RadioGroup.Indicator>
                    <Check aria-hidden="true" className="size-4 text-primary" />
                  </RadioGroup.Indicator>
                </RadioGroup.Item>
              </RadioGroup.Root>
            )}
          />
          {source === "default" ? (
            <ul className="space-y-1 px-1 text-xs leading-relaxed text-muted-foreground">
              {defaults.map((endpoint, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Duplicate endpoints are allowed; these rows contain only text.
                <li key={`${index}-${endpoint}`} className="wrap-anywhere">
                  {endpoint}
                </li>
              ))}
            </ul>
          ) : (
            <fieldset className="flex min-w-0 flex-col gap-3">
              <legend className="sr-only">{t("rpcNodes")}</legend>
              {fields.map((field, index) => {
                const inputId = `${id}-${field.id}`;
                const error = errors.nodes?.[index]?.url;
                return (
                  <Field key={field.id} className="gap-2">
                    <FieldLabel htmlFor={inputId} className="px-1 text-xs text-muted-foreground">
                      {t("rpcUrlLabel", { number: index + 1 })}
                    </FieldLabel>
                    <InputGroup className="bg-card">
                      <InputGroupInput
                        {...register(`nodes.${index}.url`, {
                          validate: (value) => {
                            if (getValues("source") === "default") return true;
                            const url = value.trim();
                            if (!url) return t("rpcUrlRequired");
                            return isHttpUrl(url) || t("rpcUrlInvalid");
                          },
                        })}
                        id={inputId}
                        type="url"
                        dir="ltr"
                        placeholder="https://"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        readOnly={pending}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${inputId}-error` : undefined}
                        className="px-3.5"
                      />
                      <InputGroupAddon align="inline-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={pending || fields.length === 1}
                          aria-label={t("removeRpcNode", { number: index + 1 })}
                          onClick={() => remove(index)}
                          className="size-7 rounded-md text-muted-foreground"
                        >
                          <X aria-hidden="true" className="size-4" />
                        </Button>
                      </InputGroupAddon>
                    </InputGroup>
                    {error && (
                      <FieldDescription id={`${inputId}-error`} aria-live="polite" className="px-1">
                        <span className="text-destructive-foreground">{error.message}</span>
                      </FieldDescription>
                    )}
                  </Field>
                );
              })}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start text-xs"
                disabled={pending}
                onClick={() => append({ url: "" })}
              >
                <Plus aria-hidden="true" className="size-4" />
                {t("addRpcNode")}
              </Button>
              <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("rpcNodeOrder")}</p>
            </fieldset>
          )}
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("rpcPrivacyNotice")}</p>
        </div>
        <footer className="shrink-0 px-3.5 pt-2 pb-3.5">
          <Button type="submit" disabled={pending} aria-busy={pending} className="w-full aria-busy:opacity-70">
            {pending && <Spinner aria-label={t("savingRpc")} />}
            {t("saveName")}
          </Button>
        </footer>
      </form>
    </main>
  );
}
