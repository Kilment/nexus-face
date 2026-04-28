import React, { useEffect, useState } from "react";
import { Dimensions, Image as RNImage, Modal, Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Spacing } from "@/constants/theme";

const H_PAD = Spacing.lg;

type Props = {
  uri: string | null;
  onClose: () => void;
};

/**
 * Dismiss by tapping dimmed backdrop (outside fitted image bounds). Optional X for explicit close.
 */
export function PhotoLightboxModal({ uri, onClose }: Props) {
  const visible = Boolean(uri);
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = Dimensions.get("window");
  const maxW = Math.min(winW - H_PAD * 2, 560);
  const maxH = Math.min(winH - insets.top - insets.bottom - H_PAD * 2, winH * 0.82);

  const [size, setSize] = useState<{ width: number; height: number }>(() => ({
    width: maxW,
    height: Math.min(maxH, maxW * 1.15),
  }));

  useEffect(() => {
    if (!uri) return;

    RNImage.getSize(
      uri,
      (nw, nh) => {
        if (nw <= 0 || nh <= 0) return;
        const scale = Math.min(maxW / nw, maxH / nh);
        setSize({ width: nw * scale, height: nh * scale });
      },
      () => {
        setSize({ width: maxW, height: Math.min(maxH, maxW * 1.2) });
      }
    );
  }, [uri, maxW, maxH]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.wrapper}>
        <Pressable accessibilityLabel="Dismiss photo" style={styles.backdrop} onPress={onClose} />
        <View pointerEvents="box-none" style={styles.centerLayer}>
          {uri ? (
            <View style={[styles.frame, { width: size.width, height: size.height }]}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
            </View>
          ) : null}
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            style={[styles.close, { top: insets.top + Spacing.sm, right: H_PAD + Spacing.sm }]}
            hitSlop={12}
            onPress={onClose}
          >
            <Feather name="x" color="#FFFFFF" size={26} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.82)",
  },
  centerLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: H_PAD,
  },
  frame: {
    overflow: "hidden",
  },
  close: {
    position: "absolute",
    padding: Spacing.sm,
    zIndex: 3,
  },
});
