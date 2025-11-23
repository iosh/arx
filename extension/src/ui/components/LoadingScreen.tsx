import { Spinner, YStack } from "tamagui";

export const LoadingScreen = () => (
  <YStack flex={1} alignItems="center" justifyContent="center">
    <Spinner size="large" />
  </YStack>
);
