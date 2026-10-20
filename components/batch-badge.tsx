import { StyleSheet, Text, View } from "react-native";

import { getBatchBadgeTheme } from "@/lib/inventory";

export function BatchBadge({ batchNumber }: { batchNumber?: string }) {
  if (!batchNumber?.trim()) return null;
  const theme = getBatchBadgeTheme(batchNumber);
  return <View accessibilityLabel={`ล็อตที่ ${batchNumber}`} style={[styles.badge, { backgroundColor: theme.backgroundColor }]}><Text style={[styles.text, { color: theme.textColor }]}>ล็อตที่ {batchNumber}</Text></View>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  text: { fontSize: 11, fontWeight: "800" },
});
