/**
 * Build a data URI for raw base64 image bytes. JPEG and PNG are detected from magic bytes;
 * otherwise defaults to JPEG (Expo camera / picker output).
 */
export function base64ToDataUri(base64: string): string {
  const trimmed = base64.replace(/\s/g, "");
  if (trimmed.startsWith("iVBOR")) {
    return `data:image/png;base64,${trimmed}`;
  }
  if (trimmed.startsWith("/9j")) {
    return `data:image/jpeg;base64,${trimmed}`;
  }
  return `data:image/jpeg;base64,${trimmed}`;
}
