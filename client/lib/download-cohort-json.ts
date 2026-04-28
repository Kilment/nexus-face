import { Alert, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { authenticatedFetch } from "@/lib/query-client";

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Fetches export JSON from the API and saves/shares it as a file (native) or triggers browser download (web).
 */
export async function downloadCohortJsonFromApi(route: string, filename: string) {
  const res = await authenticatedFetch(route);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const data = await res.json();
  const pretty = JSON.stringify(data, null, 2);
  const safe = sanitizeFilename(filename);

  if (Platform.OS === "web" && typeof document !== "undefined") {
    const blob = new Blob([pretty], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safe;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  const base = FileSystem.documentDirectory;
  if (!base) {
    Alert.alert("Export", "Unable To Save File On This Device.");
    return;
  }
  const fileUri = `${base}${safe}`;
  await FileSystem.writeAsStringAsync(fileUri, pretty, { encoding: FileSystem.EncodingType.UTF8 });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, {
      mimeType: "application/json",
      dialogTitle: "Export Cohort Data",
    });
  } else {
    Alert.alert("Export Saved", fileUri);
  }
}
