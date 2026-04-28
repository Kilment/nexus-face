import React from "react";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PHOTO_META_NUMERIC_ACCESSORY_NATIVE_ID } from "@/lib/photo-meta-text-input";

type Props = {
  tintColor: string;
};

/** iOS `number-pad` has no return row — pinned Done closes the keyboard. */
export function IosNumericInputAccessory({ tintColor }: Props) {
  if (Platform.OS !== "ios") return null;

  return (
    <InputAccessoryView nativeID={PHOTO_META_NUMERIC_ACCESSORY_NATIVE_ID}>
      <View style={styles.toolbar}>
        <Pressable
          onPress={() => Keyboard.dismiss()}
          hitSlop={12}
          style={styles.donePressable}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={[styles.doneText, { color: tintColor }]}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(84,84,88,0.65)",
    backgroundColor: "rgba(72,72,74,0.96)",
  },
  donePressable: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  doneText: {
    fontSize: 17,
    fontWeight: "600",
  },
});
