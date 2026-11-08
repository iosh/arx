import { Link } from "@tanstack/react-router";
import { Plus, RefreshCw, X } from "lucide-react";
import { type ComponentProps, useId, useRef } from "react";
import { Controller, useFieldArray } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/ui/components/PageHeader";
import { Button } from "@/ui/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/ui/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/components/ui/input-group";
import { Spinner } from "@/ui/components/ui/spinner";
import { isHttpUrl } from "@/ui/utils/url";
import { chainIdPattern, useAddEvmNetworkForm } from "./useAddEvmNetworkForm";

function MetadataInput({
  label,
  description,
  error,
  ...props
}: ComponentProps<typeof InputGroupInput> & {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
}) {
  const id = useId();
  const message = error ?? description;
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id} className="px-1 text-sm text-muted-foreground">
        {label}
      </FieldLabel>
      <InputGroup className="bg-card">
        <InputGroupInput
          autoComplete="off"
          {...props}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={message ? `${id}-help` : undefined}
        />
      </InputGroup>
      {message && (
        <FieldDescription
          id={`${id}-help`}
          aria-live="polite"
          className={`px-1 ${error ? "text-destructive-foreground" : ""}`}
        >
          {message}
        </FieldDescription>
      )}
    </Field>
  );
}

export function AddEvmNetworkPage() {
  const { t } = useTranslation("wallet");
  const id = useId();
  const rpcUrlOnFocus = useRef("");
  const network = useAddEvmNetworkForm();
  const { form, pending } = network;
  const saveLabel = network.loadingMessage ?? (network.saving ? t("savingNetwork") : t("addNetwork"));
  const { fields: rpcFields, append, remove } = useFieldArray({ control: form.control, name: "nodes" });
  const { errors } = form.formState;
  return (
    <main className="flex h-full flex-col font-sans">
      <title>{`${t("addNetwork")} · ARX`}</title>
      <PageHeader
        title={t("addNetwork")}
        backTo="/wallet/settings/networks"
        backLabel={t("backToNetworks")}
        backDisabled={network.saving}
      />
      <form noValidate aria-busy={pending} className="flex min-h-0 flex-1 flex-col" onSubmit={network.submit}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 pt-1 pb-3.5">
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="sr-only">{t("rpcNodes")}</legend>
            {rpcFields.map((field, index) => {
              const inputId = `${id}-${field.id}`;
              const name = `nodes.${index}.url` as const;
              const input = form.register(name, {
                validate: (value) =>
                  !value.trim() ? t("rpcUrlRequired") : isHttpUrl(value.trim()) || t("rpcUrlInvalid"),
                onChange: () => form.clearErrors(name),
              });
              const error = errors.nodes?.[index]?.url;
              return (
                <Field key={field.id} className="gap-2">
                  <FieldLabel htmlFor={inputId} className="px-1 text-sm text-muted-foreground">
                    {t("rpcUrlLabel", { number: index + 1 })}
                  </FieldLabel>
                  <InputGroup className="bg-card">
                    <InputGroupInput
                      {...input}
                      onFocus={(event) => {
                        rpcUrlOnFocus.current = event.currentTarget.value.trim();
                      }}
                      onBlur={(event) => {
                        const endpoint = event.currentTarget.value.trim();
                        void input.onBlur(event);
                        if (isHttpUrl(endpoint) && endpoint !== rpcUrlOnFocus.current) {
                          network.startLoading({ rpcUrl: endpoint, index });
                        }
                      }}
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
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 rounded-md text-muted-foreground"
                        disabled={pending || rpcFields.length === 1}
                        aria-label={t("removeRpcNode", { number: index + 1 })}
                        onClick={() => remove(index)}
                      >
                        <X aria-hidden="true" className="size-4" />
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                  {error && (
                    <FieldDescription
                      id={`${inputId}-error`}
                      aria-live="polite"
                      className="px-1 text-destructive-foreground"
                    >
                      {error.message}
                    </FieldDescription>
                  )}
                </Field>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={pending}
              onClick={() => append({ url: "" })}
            >
              <Plus aria-hidden="true" className="size-4" />
              {t("addRpcNode")}
            </Button>
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("rpcNodeOrder")}</p>
          </fieldset>
          <Field className="gap-2">
            <FieldLabel htmlFor={`${id}-chainId`} className="px-1 text-sm text-muted-foreground">
              Chain ID
            </FieldLabel>
            <InputGroup
              className="bg-card"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) network.confirmChainId();
              }}
            >
              <Controller
                control={form.control}
                name="chainId"
                rules={{
                  required: t("chainIdInvalid"),
                  pattern: { value: chainIdPattern, message: t("chainIdInvalid") },
                  validate: network.validateChainId,
                }}
                render={({ field }) => (
                  <InputGroupInput
                    {...field}
                    onChange={(event) => {
                      form.clearErrors("chainId");
                      field.onChange(event.currentTarget.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""));
                    }}
                    id={`${id}-chainId`}
                    inputMode="numeric"
                    autoComplete="off"
                    dir="ltr"
                    readOnly={pending}
                    aria-invalid={Boolean(errors.chainId)}
                    aria-describedby={`${id}-chainId-help`}
                  />
                )}
              />
              <InputGroupAddon align="inline-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 rounded-md text-muted-foreground"
                  title={t("readChainIdFromRpc")}
                  aria-label={t("readChainIdFromRpc")}
                  disabled={pending}
                  onClick={network.readFromFirstRpc}
                >
                  {network.loading ? (
                    <Spinner aria-label={t("loadingNetworkMetadata")} />
                  ) : (
                    <RefreshCw aria-hidden="true" className="size-4" />
                  )}
                </Button>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription
              id={`${id}-chainId-help`}
              aria-live="polite"
              className={`px-1 ${errors.chainId ? "text-destructive-foreground" : ""}`}
            >
              {errors.chainId?.message ?? t("chainIdHint")}
            </FieldDescription>
            {network.existingNetwork && !pending && (
              <Link
                to="/wallet/settings/networks/$chainRef"
                params={{ chainRef: network.existingNetwork.chainRef }}
                className="px-1 text-xs text-primary underline-offset-4 hover:underline"
              >
                {t("manageExistingNetwork", { networkName: network.existingNetwork.name })}
              </Link>
            )}
          </Field>
          <MetadataInput
            {...form.register("name", {
              validate: (value) => value.trim().length > 0 || t("networkNameRequired"),
            })}
            label={t("networkName")}
            error={errors.name?.message}
            readOnly={network.metadataReadOnly}
            description={network.metadataMessage}
          />
          <div className="grid grid-cols-2 gap-3">
            <MetadataInput
              {...form.register("symbol", {
                validate: (value) => value.trim().length > 0 || t("currencySymbolRequired"),
              })}
              label={t("nativeCurrencySymbol")}
              error={errors.symbol?.message}
              dir="ltr"
              readOnly={network.metadataReadOnly}
              spellCheck={false}
            />
            <MetadataInput
              {...form.register("decimals", {
                validate: (value) =>
                  (value.trim() !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0) ||
                  t("currencyDecimalsInvalid"),
              })}
              label={t("currencyDecimals")}
              error={errors.decimals?.message}
              type="number"
              min={0}
              step={1}
              dir="ltr"
              readOnly={network.metadataReadOnly}
            />
          </div>
          <MetadataInput
            {...form.register("explorer", {
              validate: (value) => !value.trim() || isHttpUrl(value.trim()) || t("rpcUrlInvalid"),
            })}
            label={t("optionalBlockExplorer")}
            error={errors.explorer?.message}
            type="url"
            dir="ltr"
            placeholder="https://"
            readOnly={network.metadataReadOnly}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <label className="flex min-h-10 items-center gap-3 px-1 text-sm font-medium">
            <input
              {...form.register("isTestnet")}
              type="checkbox"
              disabled={network.metadataReadOnly}
              className="size-4 accent-primary"
            />
            {t("testNetwork")}
          </label>
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">{t("rpcPrivacyNotice")}</p>
        </div>
        <footer className="shrink-0 px-3.5 pt-2 pb-3.5">
          <Button
            type="submit"
            disabled={network.metadataReadOnly}
            aria-busy={pending}
            className="w-full aria-busy:opacity-70"
          >
            {pending && <Spinner aria-label={saveLabel} />}
            {saveLabel}
          </Button>
        </footer>
      </form>
    </main>
  );
}
