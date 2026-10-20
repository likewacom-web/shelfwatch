export function normalizeVoiceSearchQuery(transcript: string): string {
  return transcript.replace(/\s+/g, " ").trim();
}
