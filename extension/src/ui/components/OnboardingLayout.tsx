import type { ReactNode } from "react";

export function OnboardingLayout({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col font-sans">
      <header className="flex h-16 shrink-0 items-center px-10">
        <span className="text-xl leading-tight font-semibold text-brand">ARX</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-10 pt-9 pb-16">
        <div className="flex w-full max-w-onboarding flex-col items-center gap-6">{children}</div>
      </main>
    </div>
  );
}
