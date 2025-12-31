import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Button, Paragraph, Separator, Sheet as TamaguiSheet, XStack, YStack } from "tamagui";

export type SheetSnapPointsMode = "percent" | "constant" | "fit" | "mixed";

export type SheetProps = {
  children: ReactNode;
  title?: ReactNode;

  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;

  snapPoints?: number[];
  snapPointsMode?: SheetSnapPointsMode;
  modal?: boolean;
  dismissOnOverlayPress?: boolean;
  disableDrag?: boolean;

  showCloseButton?: boolean;
};

export function Sheet({
  children,
  title,
  open,
  defaultOpen = false,
  onOpenChange,
  snapPoints,
  snapPointsMode = "percent",
  modal = true,
  dismissOnOverlayPress = true,
  disableDrag = true,
  showCloseButton = true,
}: SheetProps) {
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const resolvedOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  useEffect(() => {
    if (!resolvedOpen) return;
    if (typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resolvedOpen, setOpen]);

  const resolvedSnapPoints = snapPointsMode === "fit" ? snapPoints : (snapPoints ?? [80]);

  const showHeader = title !== undefined || showCloseButton;

  return (
    <TamaguiSheet
      open={resolvedOpen}
      onOpenChange={setOpen}
      modal={modal}
      snapPoints={resolvedSnapPoints}
      snapPointsMode={snapPointsMode}
      forceRemoveScrollEnabled={false}
      dismissOnOverlayPress={dismissOnOverlayPress}
      disableDrag={disableDrag}
    >
      <TamaguiSheet.Overlay backgroundColor="$scrim" zIndex="$sheet" />
      <TamaguiSheet.Frame
        flex={1}
        minHeight={0}
        backgroundColor="$bg"
        borderColor="$border"
        borderTopWidth={1}
        borderTopLeftRadius="$lg"
        borderTopRightRadius="$lg"
        padding="$0"
        zIndex="$sheet"
      >
        {showHeader ? (
          <>
            <XStack alignItems="center" justifyContent="space-between" gap="$3" padding="$4" minWidth={0}>
              <Paragraph color="$text" fontWeight="600" fontSize="$5" numberOfLines={1} flex={1} minWidth={0}>
                {title}
              </Paragraph>
              {showCloseButton ? (
                <Button
                  chromeless
                  circular
                  aria-label="Close"
                  accessibilityLabel="Close"
                  icon={<X size={18} />}
                  onPress={() => setOpen(false)}
                  hoverStyle={{ backgroundColor: "$surface" }}
                  pressStyle={{ backgroundColor: "$surface", opacity: 0.85 }}
                />
              ) : null}
            </XStack>
            <Separator backgroundColor="$border" />
          </>
        ) : null}

        <TamaguiSheet.ScrollView flex={1} minHeight={0} showsVerticalScrollIndicator={false}>
          <YStack padding="$4" gap="$3" minWidth={0}>
            {children}
          </YStack>
        </TamaguiSheet.ScrollView>
      </TamaguiSheet.Frame>
    </TamaguiSheet>
  );
}
