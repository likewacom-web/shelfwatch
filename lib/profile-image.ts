import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

function getImageExtension(uri: string): string {
  const match = uri.split("?")[0].match(/\.([a-zA-Z0-9]{2,5})$/);
  return match?.[1]?.toLowerCase() ?? "jpg";
}

export async function persistProfileImage(sourceUri: string): Promise<string> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return sourceUri;
  const directory = `${FileSystem.documentDirectory}profile-images/`;
  const directoryInfo = await FileSystem.getInfoAsync(directory);
  if (!directoryInfo.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${getImageExtension(sourceUri)}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}

export async function persistBackgroundImage(sourceUri: string): Promise<string> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return sourceUri;
  const directory = `${FileSystem.documentDirectory}background-images/`;
  const directoryInfo = await FileSystem.getInfoAsync(directory);
  if (!directoryInfo.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}background-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${getImageExtension(sourceUri)}`;
  await FileSystem.copyAsync({ from: sourceUri, to: destination });
  return destination;
}
