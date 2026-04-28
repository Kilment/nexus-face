import React from "react";
import { View } from "react-native";
import { useNavigation, useTheme } from "@react-navigation/native";
import { HeaderBackButton } from "@react-navigation/elements";
import type { NativeStackHeaderBackProps } from "@react-navigation/native-stack";

import { Spacing } from "@/constants/theme";

/**
 * Native stack does not support `headerLeftContainerStyle`; use padded wrapper instead.
 */
export function PaddedHeaderBackButton(props: NativeStackHeaderBackProps) {
  const navigation = useNavigation();
  const { colors } = useTheme();

  // Prefer live navigation state: header `canGoBack` can lag or disagree with the stack at the root screen.
  if (!navigation.canGoBack()) {
    return null;
  }

  return (
    <View style={{ paddingLeft: Spacing.md, justifyContent: "center", minHeight: 44 }}>
      <HeaderBackButton
        tintColor={props.tintColor ?? colors.text}
        label={props.label}
        onPress={() => navigation.goBack()}
      />
    </View>
  );
}
