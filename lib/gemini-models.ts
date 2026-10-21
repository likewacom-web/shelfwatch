/** Picks text-capable Flash models: stable before preview, newest first, Lite (fastest) before regular Flash. */
export function rankFlashModels(names: string[]): string[] {
  const usable = names
    .map((name) => name.replace(/^models\//, ""))
    .filter((name) => /^gemini-[\d.]+-flash/.test(name) && !/(image|tts|audio|live|embedding|native|robotics|computer|thinking|exp)/i.test(name));
  const version = (name: string) => Number(name.match(/^gemini-([\d.]+)/)?.[1] ?? 0);
  const isLite = (name: string) => name.includes("flash-lite");
  const isPreview = (name: string) => name.includes("preview");
  return [...new Set(usable)].sort((a, b) =>
    Number(isPreview(a)) - Number(isPreview(b)) || version(b) - version(a) || Number(isLite(b)) - Number(isLite(a)) || a.length - b.length,
  );
}

