export function EvmNamespaceIcon() {
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 grid-cols-2 gap-0.5">
      <span className="rounded-full bg-[#627eea]" />
      <span className="rounded-full bg-[#0052ff]" />
      <span className="rounded-full bg-[#12aaff]" />
      <span className="rounded-full bg-[#8247e5]" />
    </span>
  );
}

const addressGroupOffsets = Array.from({ length: 10 }, (_, index) => 2 + index * 4);

function EvmGroupedAddress({ address }: { address: string }) {
  return (
    <p>
      <span className="sr-only">{address}</span>
      <span
        aria-hidden="true"
        className="grid w-fit grid-cols-5 gap-x-1.5 gap-y-px font-mono text-sm leading-normal text-muted-foreground"
      >
        {addressGroupOffsets.map((offset) => (
          <span key={offset} className={offset === 2 || offset === 38 ? "font-semibold text-foreground" : ""}>
            {address.slice(offset === 2 ? 0 : offset, offset + 4)}
          </span>
        ))}
      </span>
    </p>
  );
}

export const eip155Ui = {
  labelKey: "common:evmNetworks",
  Icon: EvmNamespaceIcon,
  privateKeyImport: {
    descriptionKey: "onboarding:importPrivateKeyDescription",
    formatHintKey: "onboarding:privateKeyFormat",
    GroupedAddress: EvmGroupedAddress,
  },
} as const;
