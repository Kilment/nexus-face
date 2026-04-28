import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

function dataUrlToRawBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

/** Read a browser File via FileReader (best for large zips; avoids fetch(blob) quirks). */
async function webFileToRawBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("Could not read file as base64"));
        return;
      }
      resolve(dataUrlToRawBase64(r));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Read a local `file://` or web blob URI as raw base64 (no data: prefix).
 * `expo-file-system.readAsStringAsync` is not implemented on web.
 */
export async function readFileUriAsBase64(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== "string") {
          reject(new Error("Could not read file as base64"));
          return;
        }
        resolve(dataUrlToRawBase64(dataUrl));
      };
      reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
      reader.readAsDataURL(blob);
    });
  }

  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

type PickerAssetLike = {
  uri: string;
  file?: File;
  base64?: string;
};

/**
 * Preferred for `DocumentPicker` on web: uses native `File` when present so large ZIPs
 * are read reliably (blob `fetch` can yield empty data for some URIs).
 */
export async function readDocumentPickerAssetAsBase64(asset: PickerAssetLike): Promise<string> {
  if (typeof asset.base64 === "string" && asset.base64.length > 0) {
    return dataUrlToRawBase64(asset.base64);
  }
  if (Platform.OS === "web" && asset.file) {
    return webFileToRawBase64(asset.file);
  }
  return readFileUriAsBase64(asset.uri);
}
