import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "./ui/button";

export function PageHeader({
  title,
  backTo,
  backLabel,
}: Readonly<{
  title: string;
  backTo: NonNullable<LinkProps["to"]>;
  backLabel: string;
}>) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 px-1.5">
      <Button asChild variant="ghost" size="icon-sm" className="size-7.5 rounded-md text-muted-foreground">
        <Link to={backTo} aria-label={backLabel}>
          <ArrowLeft aria-hidden="true" className="size-4.5" />
        </Link>
      </Button>
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
    </header>
  );
}
