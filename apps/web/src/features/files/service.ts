/**
 * TAWP's file library, which knowledge sources and the assistant can draw on. Hiwar keeps
 * uploaded knowledge files with each source instead, so there is no held file to read.
 */
export async function readHeld(_kind: "File" | "Artifact", _id: string): Promise<{ name: string; mimeType: string; bytes: Uint8Array } | null> {
  return null;
}

/** No artifacts are produced into a room in Hiwar. */
export async function artifactsProducedSince(_contextType: string, _contextId: string, _since: Date): Promise<string[]> {
  return [];
}
