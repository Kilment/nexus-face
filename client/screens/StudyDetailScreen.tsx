import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Alert, ActivityIndicator, Pressable } from "react-native";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassCard } from "@/components/GlassCard";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { hapticFeedback } from "@/lib/haptics";
import { apiRequest, queryClient } from "@/lib/query-client";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { PhotoLightboxModal } from "@/components/PhotoLightboxModal";

interface StudyMember {
  studyPhoto: {
    role: string;
    weeksAfter: number | null;
    interventionLabel: string | null;
    sortOrder: number;
  };
  photo: {
    id: string;
    processedImageUrl: string;
    initials: string;
    weeksAfter: number | null;
  };
}

export default function StudyDetailScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const route = useRoute<RouteProp<ProfileStackParamList, "StudyDetail">>();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const studyId = route.params.studyId;
  const entryPoint = route.params.entryPoint;

  const handleHeaderBack = React.useCallback(() => {
    hapticFeedback.light();
    if (entryPoint === "pairs") {
      navigation.navigate("StudiesList");
      return;
    }
    if (entryPoint === "cohorts") {
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate("StudiesList");
      }
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("StudiesList");
    }
  }, [entryPoint, navigation]);

  const [activePhotoUri, setActivePhotoUri] = useState<string | null>(null);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <View style={{ paddingLeft: Spacing.xl }}>
          <Pressable
            onPress={handleHeaderBack}
            hitSlop={12}
            style={styles.headerBackButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="arrow-left" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      ),
    });
  }, [handleHeaderBack, navigation]);

  const { data, isLoading, refetch } = useQuery<{
    study: { id: string; title: string | null; createdAt: string };
    members: StudyMember[];
  }>({
    queryKey: [`/api/studies/${studyId}`],
  });
  const { data: analysis } = useQuery<{
    analyses: Array<{
      afterPhotoId: string;
    }>;
  }>({
    queryKey: [`/api/studies/${studyId}/analysis`],
  });
  const { data: analysisStatusData } = useQuery<{
    studyId: string;
    analysisStatus: {
      state: "idle" | "running" | "complete" | "failed";
      startedAt: string | null;
      finishedAt: string | null;
      error: string | null;
      analysisCount: number;
    };
  }>({
    queryKey: [`/api/studies/${studyId}/analysis-status`],
    refetchInterval: (query) =>
      query.state.data?.analysisStatus?.state === "running" ? 3000 : false,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/studies/${studyId}/analyze`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/studies/${studyId}/cohort-stats`] });
      queryClient.invalidateQueries({ queryKey: [`/api/studies/${studyId}/analysis-status`] });
      hapticFeedback.success();
      Alert.alert("Analysis Started", "Cohort Analysis Is Running In The Background.");
    },
    onError: (e: Error) => {
      hapticFeedback.error();
      Alert.alert("Analysis Failed", e.message.replace(/^(\d+:\s*)?/, "").slice(0, 220));
    },
  });

  const members = data?.members ?? [];
  const study = data?.study;
  const beforeCount = members.filter((m) => m.studyPhoto.role === "before").length;
  const afterPhotoIds = members
    .filter((m) => m.studyPhoto.role === "after")
    .map((m) => m.photo.id);
  const analyzedAfterIds = new Set((analysis?.analyses ?? []).map((a) => a.afterPhotoId));
  const unanalyzedAfterCount = afterPhotoIds.filter((id) => !analyzedAfterIds.has(id)).length;
  const canRunAnalysis = beforeCount > 0 && unanalyzedAfterCount > 0;
  const analysisState = analysisStatusData?.analysisStatus?.state ?? "idle";
  const isRunning = analysisState === "running";
  const runButtonSubtitle = canRunAnalysis
    ? `${unanalyzedAfterCount} new after photo${unanalyzedAfterCount === 1 ? "" : "s"} ready`
    : "Add new after photos to run again.";
  const statusText =
    analysisState === "running"
      ? "Analysis Running In Background"
      : analysisState === "failed"
        ? "Analysis Failed. Retry When Ready."
        : analysisState === "complete"
          ? "Analysis Complete"
          : "Analysis Not Started";

  return (
    <>
      <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingBottom: tabBarHeight + Spacing["3xl"],
          paddingHorizontal: Spacing.lg,
          gap: Spacing.md,
        }}
      >
        {isLoading || !study ? (
          <ActivityIndicator color={theme.tabIconSelected} />
        ) : (
          <>
            <ThemedText style={[styles.title, { color: theme.text }]}>
              {study.title?.trim() || "Untitled Study"}
            </ThemedText>
            <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>
              Created {new Date(study.createdAt).toLocaleString()}
            </ThemedText>

            <ThemedText style={[styles.section, { color: theme.textSecondary }]}>Members</ThemedText>
            {members.map((m) => (
              <GlassCard key={m.photo.id} style={styles.memberCard}>
                <View style={styles.memberRow}>
                  <Pressable
                    onPress={() => {
                      hapticFeedback.light();
                      setActivePhotoUri(m.photo.processedImageUrl);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`View full photo for ${m.photo.initials}`}
                    hitSlop={8}
                  >
                    <Image source={{ uri: m.photo.processedImageUrl }} style={styles.thumb} contentFit="cover" />
                  </Pressable>
                  <View style={{ flex: 1, gap: 4 }}>
                    <ThemedText style={{ color: theme.text }}>
                      {m.studyPhoto.role === "before" ? "Before" : "After"} · {m.photo.initials}
                    </ThemedText>
                    {m.studyPhoto.role === "after" && (
                      <>
                        <ThemedText style={{ color: theme.textSecondary, fontSize: 12 }}>
                          Intervention: {m.studyPhoto.interventionLabel?.trim() || "—"}
                        </ThemedText>
                        <ThemedText style={{ color: theme.textSecondary, fontSize: 12 }}>
                          Weeks After:{" "}
                          {m.studyPhoto.weeksAfter ?? m.photo.weeksAfter ?? "—"}
                        </ThemedText>
                      </>
                    )}
                  </View>
                </View>
              </GlassCard>
            ))}

            <GlassButton
              title={analyzeMutation.isPending || isRunning ? "Analyzing…" : "Run Cohort Analysis"}
              icon="cpu"
              loading={analyzeMutation.isPending || isRunning}
              disabled={analyzeMutation.isPending || isRunning || !canRunAnalysis}
              onPress={() => {
                hapticFeedback.medium();
                analyzeMutation.mutate();
              }}
            />
            <ThemedText style={[styles.analysisHint, { color: theme.textSecondary }]}>{runButtonSubtitle}</ThemedText>
            <ThemedText style={[styles.analysisStatus, { color: theme.textSecondary }]}>{statusText}</ThemedText>

            <GlassButton
              title="Add More Photos"
              icon="plus"
              variant="secondary"
              onPress={() => {
                hapticFeedback.light();
                navigation.navigate("StudyCompose", { studyId });
              }}
            />

            <GlassButton
              title="View Results"
              icon="bar-chart-2"
              variant="secondary"
              onPress={() => {
                hapticFeedback.light();
                navigation.navigate("StudyResults", { studyId });
              }}
            />

            <GlassButton
              title="Refresh"
              icon="refresh-cw"
              variant="secondary"
              onPress={() => {
                refetch();
                hapticFeedback.light();
              }}
            />
          </>
        )}
      </ScrollView>
      </ThemedView>
      <PhotoLightboxModal uri={activePhotoUri} onClose={() => setActivePhotoUri(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBackButton: {
    marginLeft: 4,
    paddingVertical: 8,
    paddingRight: Spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    ...Typography.h3,
  },
  meta: {
    ...Typography.small,
  },
  section: {
    ...Typography.small,
    fontWeight: "600",
    marginTop: Spacing.sm,
  },
  memberCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  memberRow: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "center",
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.sm,
  },
  analysisHint: {
    ...Typography.small,
    marginTop: -Spacing.xs,
  },
  analysisStatus: {
    ...Typography.small,
    marginTop: -Spacing.xs,
    fontWeight: "600",
  },
});
