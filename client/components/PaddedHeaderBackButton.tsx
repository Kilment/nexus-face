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

  if (props.canGoBack !== true) {
    return null;
  }

  return (
    <View style={{ paddingLeft: Spacing.xl }}>
      <HeaderBackButton
        tintColor={props.tintColor ?? colors.text}
        label={props.label}
        onPress={() => navigation.goBack()}
      />
    </View>
  );
}
