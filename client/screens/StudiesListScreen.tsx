import React, { useCallback, useState } from "react";
import { View, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassCard } from "@/components/GlassCard";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { downloadCohortJsonFromApi } from "@/lib/download-cohort-json";
import { hapticFeedback } from "@/lib/haptics";

interface StudyRow {
  id: string;
  title: string | null;
  createdAt: string;
}

export default function StudiesListScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  /** Tab bar measured height excludes its bottom margin; match CameraScreen footer clearance above the floating pill. */
  const footerBottomInset = tabBarHeight + insets.bottom + Spacing.lg + Spacing.sm;
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();

  const [exportingAll, setExportingAll] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery<{ studies: StudyRow[] }>({
    queryKey: ["/api/studies"],
  });

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const studies = data?.studies ?? [];

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={studies}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={theme.tabIconSelected} />
        }
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingBottom: footerBottomInset + Spacing.xl + 140,
          paddingHorizontal: Spacing.lg,
          gap: Spacing.xs,
          flexGrow: 1,
        }}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={theme.tabIconSelected} style={{ marginTop: Spacing.xl }} />
          ) : (
            <ThemedText style={[styles.empty, { color: theme.textSecondary }]}>
              No Cohort Studies Yet. Create One From Your Existing Photos.
            </ThemedText>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              hapticFeedback.light();
              navigation.navigate("StudyDetail", { studyId: item.id, entryPoint: "cohorts" });
            }}
          >
            <GlassCard style={styles.card}>
              <View style={styles.row}>
                <View style={styles.cardText}>
                  <ThemedText style={[styles.title, { color: theme.text }]}>
                    {item.title?.trim() || "Untitled Study"}
                  </ThemedText>
                  <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>
                    {new Date(item.createdAt).toLocaleString()}
                  </ThemedText>
                </View>
                <Feather name="chevron-right" size={22} color={theme.textSecondary} />
              </View>
            </GlassCard>
          </Pressable>
        )}
      />

      <View
        style={[
          styles.footer,
          {
            paddingBottom: footerBottomInset,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <GlassButton
          title={exportingAll ? "Preparing Download…" : "Download All Studies (JSON)"}
          icon="download"
          variant="secondary"
          loading={exportingAll}
          disabled={exportingAll}
          onPress={async () => {
            hapticFeedback.medium();
            setExportingAll(true);
            try {
              await downloadCohortJsonFromApi(
                "/api/export/cohort-studies-bundle",
                `cohort-studies-all-${new Date().toISOString().slice(0, 10)}.json`,
              );
            } catch (e) {
              Alert.alert(
                "Export Failed",
                e instanceof Error ? e.message.slice(0, 400) : "Could Not Export",
              );
            } finally {
              setExportingAll(false);
            }
          }}
        />
        <GlassButton
          title="New Cohort Study"
          icon="plus"
          onPress={() => {
            hapticFeedback.medium();
            navigation.navigate("StudyCompose");
          }}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardText: {
    flex: 1,
    gap: 4,
  },
  title: {
    ...Typography.body,
    fontWeight: "600",
  },
  meta: {
    ...Typography.small,
  },
  empty: {
    textAlign: "center",
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
});
