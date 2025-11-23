import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { createContext, useContext, useState } from "react";
import { Theme, YStack } from "tamagui";

// Define context type for type safety
interface ThemeContextType {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark" | ((prev: "light" | "dark") => "light" | "dark")) => void;
}

// Create React Context for theme
const ThemeContext = createContext<ThemeContextType | null>(null);
const queryClient = new QueryClient();

// Custom hook to use theme context
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeContext.Provider");
  }
  return context;
}

// Root layout component that wraps all routes
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeContext.Provider value={{ theme, setTheme }}>
        <Theme name={theme}>
          <YStack backgroundColor="$background" minHeight="100vh" data-theme={theme}>
            {/* Outlet renders the matched child route */}
            <Outlet />
          </YStack>
        </Theme>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}
