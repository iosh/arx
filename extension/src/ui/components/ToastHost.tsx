import { useEffect, useState } from "react";
import { AnimatePresence, Paragraph, XStack, YStack } from "tamagui";
import { type ToastKind, useToasts } from "@/ui/lib/toast";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mql) return;

    const update = () => setReduced(Boolean(mql.matches));
    update();

    mql.addEventListener?.("change", update);

    return () => {
      mql.removeEventListener?.("change", update);
    };
  }, []);

  return reduced;
}

function getIndicatorColor(kind: ToastKind) {
  switch (kind) {
    case "success":
      return "$success";
    case "error":
      return "$danger";
    case "warning":
      return "$accent";
    case "info":
    default:
      return "$border";
  }
}

export function ToastHost() {
  const reducedMotion = usePrefersReducedMotion();
  const { visibleToasts } = useToasts();

  if (visibleToasts.length === 0) return null;

  // Use motion tokens from blueprint (toast: 160ms, fast: 120ms for reduced motion)
  // TODO: Consider custom easing (decelerate/accelerate) in future iterations
  const enterStyle = reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 };
  const exitStyle = reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 };

  return (
    <YStack position="absolute" top="$3" left="$3" right="$3" zIndex="$toast" alignItems="center" pointerEvents="none">
      <YStack width="100%" maxWidth={360} gap="$2" pointerEvents="none">
        <AnimatePresence>
          {visibleToasts.map((toast) => (
            <XStack
              key={toast.id}
              animation={reducedMotion ? "fast" : "toast"}
              enterStyle={enterStyle}
              exitStyle={exitStyle}
              opacity={1}
              y={0}
              role={toast.kind === "error" || toast.kind === "warning" ? "alert" : "status"}
              aria-live="polite"
              backgroundColor="$cardBg"
              borderRadius="$lg"
              borderWidth={1}
              borderColor="$border"
              borderLeftWidth={4}
              borderLeftColor={getIndicatorColor(toast.kind)}
              padding="$3"
              gap="$2"
              minWidth={0}
              width="100%"
              pointerEvents="none"
            >
              <Paragraph color="$text" fontSize="$3" lineHeight="$4" flex={1} minWidth={0}>
                {toast.message}
              </Paragraph>
            </XStack>
          ))}
        </AnimatePresence>
      </YStack>
    </YStack>
  );
}
