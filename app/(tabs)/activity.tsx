import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { type PositionHistoryEntry } from "@/lib/inventory";
import { useInventory } from "@/lib/inventory-context";

export default function ActivityScreen() {
  const { positionHistory, isLoading } = useInventory();
  if (isLoading) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1F6F5B" /></ScreenContainer>;
  return <ScreenContainer className="px-5 pt-3"><FlatList data={positionHistory} keyExtractor={(item) => item.id} contentContainerStyle={styles.content} ListHeaderComponent={<View style={styles.header}><Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={23} color="#1F6F5B" /></Pressable><View><Text style={styles.title}>ประวัติคลัง</Text><Text style={styles.subtitle}>ตรวจสอบการแทรก ย้าย ลบ และกู้คืนสินค้า</Text></View></View>} ListEmptyComponent={<View style={styles.emptyCard}><MaterialIcons name="history" size={36} color="#98A2B3" /><Text style={styles.emptyTitle}>ยังไม่มีประวัติ</Text><Text style={styles.emptyCopy}>เมื่อแทรก ย้าย ลบ หรือกู้คืนสินค้า ระบบจะแสดงรายการที่นี่</Text></View>} renderItem={({ item }) => <ActivityItem entry={item} />} /></ScreenContainer>;
}

function ActivityItem({ entry }: { entry: PositionHistoryEntry }) { const presentation = getPresentation(entry); const canOpenProduct = entry.action !== "delete"; return <Pressable disabled={!canOpenProduct} accessibilityRole={canOpenProduct ? "button" : undefined} onPress={() => canOpenProduct && router.push({ pathname: "/product/[id]", params: { id: entry.productId } })} style={({ pressed }) => [styles.item, pressed && canOpenProduct && styles.pressed]}><View style={[styles.itemIcon, { backgroundColor: presentation.surface }]}><MaterialIcons name={presentation.icon} size={21} color={presentation.color} /></View><View style={styles.itemCopy}><Text style={styles.itemTitle}>{presentation.title}</Text><Text style={styles.itemName}>{entry.productName}</Text><Text style={styles.itemPosition}>{presentation.description}</Text><Text style={styles.itemTime}>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.changedAt))}</Text></View>{canOpenProduct ? <MaterialIcons name="chevron-right" size={22} color="#98A2B3" /> : null}</Pressable>; }

function getPresentation(entry: PositionHistoryEntry) { const from = formatPosition(entry.from); const to = formatPosition(entry.to); if (entry.action === "insert") return { title: "แทรกสินค้าในแถว", description: `แทรกที่ ${to} · เลื่อนลำดับรายการถัดไป`, icon: "playlist-add" as const, color: "#175CD3", surface: "#E8F1FC" }; if (entry.action === "delete") return { title: "ลบสินค้า", description: `ลบจาก ${from}`, icon: "delete-outline" as const, color: "#B42318", surface: "#FEE4E2" }; if (entry.action === "restore") return { title: "กู้คืนสินค้า", description: `กู้คืนที่ ${to}`, icon: "settings-backup-restore" as const, color: "#1F6F5B", surface: "#E8F3EF" }; if (entry.action === "move") return { title: "ย้ายตำแหน่งสินค้า", description: `${from} → ${to}`, icon: "drive-file-move" as const, color: "#1F6F5B", surface: "#E8F3EF" }; return { title: "สลับลำดับสินค้า", description: `${from} → ${to}`, icon: "swap-vert" as const, color: "#667085", surface: "#F2F4F7" }; }
function formatPosition(position?: { shelf: string; row: string; itemNumber?: number }) { return position ? `ชั้น ${position.shelf} · แถว ${position.row} · ตัวที่ ${position.itemNumber ?? "—"}` : "—"; }

const styles = StyleSheet.create({
  content: { paddingBottom: 110 },
  header: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 20 },
  backButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  title: { color: "#101828", fontSize: 26, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 13, marginTop: 3 },
  item: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 11, marginBottom: 10, padding: 13 },
  itemIcon: { alignItems: "center", borderRadius: 12, height: 43, justifyContent: "center", width: 43 },
  itemCopy: { flex: 1 },
  itemTitle: { color: "#344054", fontSize: 14, fontWeight: "800" },
  itemName: { color: "#101828", fontSize: 15, fontWeight: "700", marginTop: 2 },
  itemPosition: { color: "#667085", fontSize: 12, lineHeight: 17, marginTop: 3 },
  itemTime: { color: "#98A2B3", fontSize: 11, marginTop: 4 },
  emptyCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 16, padding: 28 },
  emptyTitle: { color: "#344054", fontSize: 17, fontWeight: "700", marginTop: 12 },
  emptyCopy: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: "center" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
