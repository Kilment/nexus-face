import React from "react";
import { Platform } from "react-native";
import { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { isLiquidGlassAvailable } from "expo-glass-effect";

import { useTheme } from "@/hooks/useTheme";
import { PaddedHeaderBackButton } from "@/components/PaddedHeaderBackButton";

interface UseScreenOptionsParams {
  transparent?: boolean;
}

export function useScreenOptions({
  transparent = true,
}: UseScreenOptionsParams = {}): NativeStackNavigationOptions {
  const { theme, isDark } = useTheme();

  return {
    headerTitleAlign: "center",
    headerTransparent: transparent,
    // Only apply iOS blur when header is transparent over content.
    headerBlurEffect: transparent ? (isDark ? "dark" : "light") : undefined,
    headerTintColor: "#FFFFFF",
    headerBackVisible: true,
    headerShadowVisible: false,
    headerLargeTitle: false,
    headerLeft: (props) => React.createElement(PaddedHeaderBackButton, props),
    headerStyle: {
      backgroundColor: Platform.select({
        ios: theme.backgroundRoot,
        android: theme.backgroundRoot,
        web: theme.backgroundRoot,
      }),
    },
    gestureEnabled: true,
    gestureDirection: "horizontal",
    fullScreenGestureEnabled: isLiquidGlassAvailable() ? false : true,
    contentStyle: {
      backgroundColor: theme.backgroundRoot,
    },
  };
}
