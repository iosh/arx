import { Slot, Slottable } from "@radix-ui/react-slot";
import type { ReactNode } from "react";

export function OnboardingCard({
  title,
  description,
  children,
  asChild = false,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
  asChild?: boolean;
}>) {
  const Component = asChild ? Slot : "section";

  return (
    <Component className="flex w-full max-w-onboarding flex-col gap-6 rounded-xl bg-card p-8 text-card-foreground shadow-onboarding">
      <title>{title} · ARX</title>
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-[1.35] font-semibold">{title}</h1>
        <p className="text-sm leading-[1.6] text-muted-foreground">{description}</p>
      </div>
      <Slottable>{children}</Slottable>
    </Component>
  );
}
