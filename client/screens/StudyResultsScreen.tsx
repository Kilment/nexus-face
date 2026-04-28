import React, { useState } from "react";
import { View, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useQuery } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassCard } from "@/components/GlassCard";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { GlassButton } from "@/components/GlassButton";
import { hapticFeedback } from "@/lib/haptics";
import { downloadCohortJsonFromApi } from "@/lib/download-cohort-json";

interface AggregateRow {
  label: string;
  meanDelta: number;
  medianDelta: number;
  n: number;
  bootstrapCi95Low: number;
  bootstrapCi95High: number;
}

interface RankingRow {
  interventionLabel: string;
  n: number;
  compositeScoreMean: number;
  averageRank: number;
}

function formatMetricLabel(key: string): string {
  const withSpaces = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

export default function StudyResultsScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const route = useRoute<RouteProp<ProfileStackParamList, "StudyResults">>();
  const studyId = route.params.studyId;
  const [exporting, setExporting] = useState(false);

  const { data: cohort, isLoading: cohortLoading } = useQuery<{
    sampleSize: number;
    aggregates: AggregateRow[];
    interventionRankings: RankingRow[];
  }>({
    queryKey: [`/api/studies/${studyId}/cohort-stats`],
  });

  const { data: analysis, isLoading: analysisLoading } = useQuery<{
    analyses: Array<{
      id: string;
      afterPhotoId: string;
      metrics: Record<string, number | string | undefined>;
      landmarkMetrics: unknown;
    }>;
  }>({
    queryKey: [`/api/studies/${studyId}/analysis`],
  });

  const loading = cohortLoading || analysisLoading;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingBottom: tabBarHeight + Spacing["3xl"],
          paddingHorizontal: Spacing.lg,
          gap: Spacing.md,
        }}
      >
        <ThemedText style={[styles.headline, { color: theme.text }]}>Cohort Results</ThemedText>
        <ThemedText style={[styles.disclaimer, { color: theme.textSecondary }]}>
          Model-Estimated Exploratory Metrics (Not Clinical Device Output). Interpret With Your Study Protocol.
        </ThemedText>

        <GlassButton
          title={exporting ? "Preparing Download…" : "Download Results (JSON)"}
          icon="download"
          variant="secondary"
          loading={exporting}
          disabled={exporting || loading}
          onPress={async () => {
            hapticFeedback.medium();
            setExporting(true);
            try {
              await downloadCohortJsonFromApi(
                `/api/studies/${studyId}/export-bundle`,
                `cohort-study-${studyId.slice(0, 8)}.json`,
              );
            } catch (e) {
              Alert.alert(
                "Export Failed",
                e instanceof Error ? e.message.slice(0, 400) : "Could Not Export",
              );
            } finally {
              setExporting(false);
            }
          }}
        />

        {loading ? (
          <ActivityIndicator color={theme.tabIconSelected} />
        ) : (
          <>
            <ThemedText style={[styles.section, { color: theme.text }]}>
              Sample Size: {cohort?.sampleSize ?? 0} After Photos Analyzed
            </ThemedText>

            <ThemedText style={[styles.section, { color: theme.textSecondary }]}>Aggregate Deltas</ThemedText>
            {(cohort?.aggregates ?? []).map((row) => (
              <GlassCard key={row.label} style={styles.card}>
                <ThemedText style={{ color: theme.text, fontWeight: "600" }}>{row.label}</ThemedText>
                <ThemedText style={{ color: theme.textSecondary, marginTop: 4 }}>
                  Mean Δ {row.meanDelta.toFixed(2)} · Median Δ {row.medianDelta.toFixed(2)} · N={row.n}
                </ThemedText>
                <ThemedText style={{ color: theme.textTertiary, marginTop: 4, fontSize: 12 }}>
                  95% Bootstrap CI (Mean): [{row.bootstrapCi95Low.toFixed(2)}, {row.bootstrapCi95High.toFixed(2)}]
                </ThemedText>
              </GlassCard>
            ))}

            <ThemedText style={[styles.section, { color: theme.textSecondary }]}>
              Intervention Ranking (Composite Score)
            </ThemedText>
            {(cohort?.interventionRankings ?? []).map((r) => (
              <GlassCard key={r.interventionLabel + r.averageRank} style={styles.card}>
                <View style={styles.rankRow}>
                  <ThemedText style={{ color: theme.text, fontWeight: "600" }}>{r.interventionLabel}</ThemedText>
                  <ThemedText style={{ color: theme.tabIconSelected }}>#{r.averageRank}</ThemedText>
                </View>
                <ThemedText style={{ color: theme.textSecondary, marginTop: 4, fontSize: 13 }}>
                  N={r.n} · Composite Mean {r.compositeScoreMean.toFixed(2)}
                </ThemedText>
              </GlassCard>
            ))}

            <ThemedText style={[styles.section, { color: theme.textSecondary }]}>Pairwise Metrics</ThemedText>
            {(analysis?.analyses ?? []).map((a) => (
              <GlassCard key={a.id} style={styles.card}>
                <View style={styles.pairHeader}>
                  <ThemedText style={{ color: theme.text, fontWeight: "700" }}>
                    After Photo {a.afterPhotoId.slice(0, 8)}…
                  </ThemedText>
                  <View style={[styles.badge, { backgroundColor: `${theme.tabIconSelected}1A` }]}>
                    <ThemedText style={[styles.badgeText, { color: theme.tabIconSelected }]}>Analyzed</ThemedText>
                  </View>
                </View>
                {Object.entries(a.metrics)
                  .filter(([k]) => k !== "notes")
                  .sort(([aKey], [bKey]) => aKey.localeCompare(bKey))
                  .map(([k, v]) => (
                    <View key={k} style={[styles.metricRow, { borderBottomColor: theme.border }]}>
                      <ThemedText style={[styles.metricLabel, { color: theme.textSecondary }]}>
                        {formatMetricLabel(k)}
                      </ThemedText>
                      <ThemedText style={[styles.metricValue, { color: theme.text }]}>
                        {typeof v === "number" ? v.toFixed(2) : String(v)}
                      </ThemedText>
                    </View>
                  ))}
              </GlassCard>
            ))}

            {(analysis?.analyses?.length ?? 0) === 0 && (
              <ThemedText style={{ color: theme.textSecondary }}>
                Run Cohort Analysis From The Study Detail Screen To Populate Results.
              </ThemedText>
            )}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headline: {
    ...Typography.h3,
  },
  disclaimer: {
    ...Typography.small,
    lineHeight: 18,
  },
  section: {
    ...Typography.body,
    marginTop: Spacing.sm,
  },
  card: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: 4,
  },
  rankRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pairHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metricLabel: {
    flex: 1,
    fontSize: 13,
    marginRight: Spacing.md,
  },
  metricValue: {
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});
