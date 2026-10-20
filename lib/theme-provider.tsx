import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, View, useColorScheme as useSystemColorScheme } from "react-native";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";

import { Colors, SchemeColors, type ColorScheme, type ThemeColorPalette } from "@/constants/theme";

type ThemeContextValue = {
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  brandColor: string;
  setBrandColor: (color: string) => void;
  backgroundImageUri?: string;
  setBackgroundImageUri: (uri?: string) => void;
  backgroundImageOpacity: number;
  setBackgroundImageOpacity: (opacity: number) => void;
  colors: ThemeColorPalette;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme() ?? "light";
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(systemScheme);
  const [brandColor, setBrandColorState] = useState("#1D4ED8");
  const [backgroundImageUri, setBackgroundImageUriState] = useState<string | undefined>();
  const [backgroundImageOpacity, setBackgroundImageOpacityState] = useState(0.18);

  const colors = useMemo<ThemeColorPalette>(() => ({ ...Colors[colorScheme], primary: brandColor, tint: brandColor, tabIconSelected: brandColor }), [brandColor, colorScheme]);

  const applyScheme = useCallback((scheme: ColorScheme, activeBrandColor: string) => {
    nativewindColorScheme.set(scheme);
    Appearance.setColorScheme?.(scheme);
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dataset.theme = scheme;
      root.classList.toggle("dark", scheme === "dark");
      const palette = { ...SchemeColors[scheme], primary: activeBrandColor };
      Object.entries(palette).forEach(([token, value]) => {
        root.style.setProperty(`--color-${token}`, value);
      });
    }
  }, []);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    setColorSchemeState(scheme);
    applyScheme(scheme, brandColor);
  }, [applyScheme, brandColor]);

  const setBrandColor = useCallback((color: string) => {
    setBrandColorState(color);
    applyScheme(colorScheme, color);
  }, [applyScheme, colorScheme]);

  const setBackgroundImageUri = useCallback((uri?: string) => {
    setBackgroundImageUriState(uri);
  }, []);

  const setBackgroundImageOpacity = useCallback((opacity: number) => {
    setBackgroundImageOpacityState(Math.max(0.05, Math.min(0.6, opacity)));
  }, []);

  useEffect(() => {
    applyScheme(colorScheme, brandColor);
  }, [applyScheme, brandColor, colorScheme]);

  const themeVariables = useMemo(
    () =>
      vars({
        "color-primary": colors.primary,
        "color-background": colors.background,
        "color-surface": colors.surface,
        "color-foreground": colors.foreground,
        "color-muted": colors.muted,
        "color-border": colors.border,
        "color-success": colors.success,
        "color-warning": colors.warning,
        "color-error": colors.error,
      }),
    [colors],
  );

  const value = useMemo(
    () => ({
      colorScheme,
      setColorScheme,
      brandColor,
      setBrandColor,
      backgroundImageUri,
      setBackgroundImageUri,
      backgroundImageOpacity,
      setBackgroundImageOpacity,
      colors,
    }),
    [backgroundImageOpacity, backgroundImageUri, brandColor, colorScheme, colors, setBackgroundImageOpacity, setBackgroundImageUri, setBrandColor, setColorScheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}
