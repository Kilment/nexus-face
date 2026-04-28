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
  const isIos = Platform.OS === "ios";

  return {
    headerTitleAlign: "center",
    headerTransparent: transparent,
    headerBlurEffect: transparent ? (isDark ? "dark" : "light") : undefined,
    headerTintColor: "#FFFFFF",
    /**
     * iOS: native UIBarButtonItem in the liquid-glass capsule centers itself.
     * Custom JSX subtrees get wrapped by UIKit and any non-symmetric padding inside
     * shifts the chevron/label off-center, so we let the system render the back button.
     * Android: the JS wrapper handles consistent padding/safe-area for the back affordance.
     */
    headerBackVisible: isIos ? true : false,
    headerShadowVisible: false,
    headerLargeTitle: false,
    headerLeft: isIos
      ? undefined
      : (props) => React.createElement(PaddedHeaderBackButton, props),
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
