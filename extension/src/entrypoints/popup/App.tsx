import { useState } from "react";
import { Button, Card, H2, Input, Paragraph, Theme, XStack, YStack } from "tamagui";

function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <Theme name={theme}>
      <YStack padding="$4" gap="$3" backgroundColor="$background" minHeight="100vh">
        <XStack justifyContent="space-between" alignItems="center">
          {/* Theme toggle button */}
          <Button size="$3" chromeless onPress={toggleTheme}>
            {theme === "light" ? "🌙" : "☀️"}
          </Button>
        </XStack>

        {/* Card component test */}
        <Card elevate bordered padding="$3">
          <YStack gap="$2">
            <Paragraph fontWeight="600">Account</Paragraph>
            <Paragraph color="$colorHover" fontSize="$3">
              0x1234...5678
            </Paragraph>
          </YStack>
        </Card>

        {/* Input component test */}
        <Input placeholder="Enter password" secureTextEntry />

        {/* Button variants test */}
        <YStack gap="$2">
          <Button>Primary Button</Button>
          <Button variant="outlined">Outlined Button</Button>
          <Button chromeless>Chromeless Button</Button>
        </YStack>

        {/* Horizontal layout with colored buttons */}
        <XStack gap="$2" justifyContent="center">
          <Button> Confirm</Button>
          <Button>Reject</Button>
        </XStack>

        {/* Display current theme */}
        <Paragraph textAlign="center" color="$colorHover">
          Current theme: {theme}
        </Paragraph>
      </YStack>
    </Theme>
  );
}
export default App;
