import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { GlassCard } from "@/components/GlassCard";
import { GlassButton } from "@/components/GlassButton";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { hapticFeedback } from "@/lib/haptics";
import { apiRequest, queryClient } from "@/lib/query-client";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";

interface Photo {
  id: string;
  processedImageUrl: string;
  initials: string;
  beforeAfter: string;
}

interface StudyMember {
  studyPhoto: {
    role: string;
    weeksAfter: number | null;
    interventionLabel: string | null;
  };
  photo: {
    id: string;
    weeksAfter: number | null;
  };
}

export default function StudyComposeScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const route = useRoute<RouteProp<ProfileStackParamList, "StudyCompose">>();
  const existingStudyId = route.params?.studyId;

  const [title, setTitle] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [weeksById, setWeeksById] = useState<Record<string, string>>({});
  const [interventionById, setInterventionById] = useState<Record<string, string>>({});
  const [lockedMemberIds, setLockedMemberIds] = useState<Set<string>>(new Set());
  const [didInitFromStudy, setDidInitFromStudy] = useState(false);

  const { data: photosData, isLoading } = useQuery<{ photos: Photo[] }>({
    queryKey: ["/api/photos"],
  });

  const { data: studyData } = useQuery<{
    study: { id: string; title: string | null };
    members: StudyMember[];
  }>({
    queryKey: existingStudyId ? [`/api/studies/${existingStudyId}`] : ["/api/studies", "compose-empty"],
    enabled: !!existingStudyId,
  });

  const photos = photosData?.photos ?? [];

  const toggleSelect = (id: string) => {
    if (lockedMemberIds.has(id)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (beforeId === id) setBeforeId(null);
      } else {
        next.add(id);
      }
      return next;
    });
    hapticFeedback.light();
  };

  useEffect(() => {
    if (!existingStudyId || !studyData || didInitFromStudy) return;

    const memberIds = new Set(studyData.members.map((m) => m.photo.id));
    setLockedMemberIds(memberIds);
    setSelectedIds(memberIds);
    setTitle(studyData.study.title ?? "");

    const beforeMember = studyData.members.find((m) => m.studyPhoto.role === "before");
    setBeforeId(beforeMember?.photo.id ?? null);

    const weeksSeed: Record<string, string> = {};
    const interventionSeed: Record<string, string> = {};
    for (const member of studyData.members) {
      if (member.studyPhoto.role === "after") {
        const resolvedWeeksAfter = member.studyPhoto.weeksAfter ?? member.photo.weeksAfter;
        if (resolvedWeeksAfter !== null && resolvedWeeksAfter !== undefined) {
          weeksSeed[member.photo.id] = String(resolvedWeeksAfter);
        }
        if (member.studyPhoto.interventionLabel) {
          interventionSeed[member.photo.id] = member.studyPhoto.interventionLabel;
        }
      }
    }
    setWeeksById(weeksSeed);
    setInterventionById(interventionSeed);
    setDidInitFromStudy(true);
  }, [existingStudyId, studyData, didInitFromStudy]);

  const selectedList = useMemo(
    () => photos.filter((p) => selectedIds.has(p.id)),
    [photos, selectedIds],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (selectedList.length < 2) {
        throw new Error("Select at least two photos");
      }
      if (!beforeId || !selectedIds.has(beforeId)) {
        throw new Error("Choose exactly one before photo from your selection");
      }

      let studyId = existingStudyId ?? "";
      if (!studyId) {
        const createRes = await apiRequest("POST", "/api/studies", { title: title.trim() || null });
        const created = (await createRes.json()) as { study: { id: string } };
        studyId = created.study.id;
      }

      const entries = selectedList.map((p, index) => {
        const isBefore = p.id === beforeId;
        const weeksRaw = weeksById[p.id]?.trim();
        const weeksAfter =
          !isBefore && weeksRaw !== undefined && weeksRaw !== ""
            ? parseInt(weeksRaw, 10)
            : null;
        return {
          photoId: p.id,
          role: isBefore ? "before" : "after",
          weeksAfter: isBefore ? null : Number.isFinite(weeksAfter as number) ? weeksAfter : null,
          interventionLabel: isBefore ? null : interventionById[p.id]?.trim() || null,
          sortOrder: index,
        };
      });

      await apiRequest("PUT", `/api/studies/${studyId}/members`, { entries });
      return studyId;
    },
    onSuccess: (studyId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      queryClient.invalidateQueries({ queryKey: [`/api/studies/${studyId}`] });
      hapticFeedback.success();
      navigation.replace("StudyDetail", { studyId, entryPoint: "cohorts" });
    },
    onError: (e: Error) => {
      hapticFeedback.error();
      Alert.alert("Cannot Create Study", e.message);
    },
  });

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingBottom: tabBarHeight + Spacing["2xl"],
          paddingHorizontal: Spacing.lg,
          gap: Spacing.md,
        }}
      >
        <ThemedText style={[styles.help, { color: theme.textSecondary }]}>
          {existingStudyId
            ? "Add More Photos To This Cohort Study. Existing Study Members Are Locked. New Photos Will Be Added To The Current Cohort."
            : "Select Photos From Your Gallery, Designate One As The Shared &quot;Before&quot; Image, Then Add Intervention Labels And Follow-Up Weeks For Each After Photo."}
        </ThemedText>

        <GlassCard style={styles.card}>
          <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
            {existingStudyId ? "Study Title" : "Study Title (Optional)"}
          </ThemedText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="E.g. Q1 Filler Comparison"
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />
        </GlassCard>

        {isLoading ? (
          <ActivityIndicator color={theme.tabIconSelected} />
        ) : (
          photos.map((p) => {
            const selected = selectedIds.has(p.id);
            const isBefore = beforeId === p.id;
            return (
              <GlassCard key={p.id} style={styles.photoCard}>
                <Pressable style={styles.photoRow} onPress={() => toggleSelect(p.id)}>
                  <Image source={{ uri: p.processedImageUrl }} style={styles.thumb} contentFit="cover" />
                  <View style={styles.photoInfo}>
                    <ThemedText style={{ color: theme.text }}>{p.initials}</ThemedText>
                    <ThemedText style={{ color: theme.textSecondary, fontSize: 12 }}>
                      {p.beforeAfter === "before" ? "Before" : "After"}
                    </ThemedText>
                  </View>
                  <Feather
                    name={selected ? "check-circle" : "circle"}
                    size={24}
                    color={selected ? theme.tabIconSelected : theme.textTertiary}
                  />
                </Pressable>

                {selected && (
                  <View style={styles.inlineMeta}>
                    <Pressable
                      style={[
                        styles.beforeChip,
                        {
                          borderColor: isBefore ? theme.tabIconSelected : theme.border,
                          backgroundColor: isBefore ? `${theme.tabIconSelected}22` : "transparent",
                        },
                      ]}
                      onPress={() => {
                        if (lockedMemberIds.has(p.id)) return;
                        setBeforeId(p.id);
                        hapticFeedback.selection();
                      }}
                    >
                      <ThemedText style={{ color: theme.text, fontSize: 13 }}>
                        {lockedMemberIds.has(p.id) && isBefore
                          ? "Before Photo (Locked)"
                          : isBefore
                            ? "Before Photo"
                            : "Set As Before"}
                      </ThemedText>
                    </Pressable>

                    {!isBefore && (
                      <>
                        <TextInput
                          placeholder="Weeks After Intervention"
                          placeholderTextColor={theme.textTertiary}
                          keyboardType="number-pad"
                          value={weeksById[p.id] ?? ""}
                          onChangeText={(t) => setWeeksById((prev) => ({ ...prev, [p.id]: t }))}
                          style={[styles.smallInput, { color: theme.text, borderColor: theme.border }]}
                        />
                        <TextInput
                          placeholder="Intervention Label"
                          placeholderTextColor={theme.textTertiary}
                          value={interventionById[p.id] ?? ""}
                          onChangeText={(t) => setInterventionById((prev) => ({ ...prev, [p.id]: t }))}
                          style={[styles.smallInput, { color: theme.text, borderColor: theme.border }]}
                        />
                      </>
                    )}
                  </View>
                )}
              </GlassCard>
            );
          })
        )}

        <GlassButton
          title={
            createMutation.isPending
              ? "Saving…"
              : existingStudyId
                ? "Save Added Photos"
                : "Save Cohort"
          }
          icon="save"
          disabled={createMutation.isPending}
          onPress={() => createMutation.mutate()}
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  help: {
    ...Typography.small,
    lineHeight: 20,
  },
  card: {
    padding: Spacing.md,
    gap: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  label: {
    ...Typography.small,
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
  },
  photoCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.sm,
  },
  photoInfo: {
    flex: 1,
    gap: 4,
  },
  inlineMeta: {
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  beforeChip: {
    alignSelf: "flex-start",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  smallInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
  },
});
