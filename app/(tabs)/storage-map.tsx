import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { buildStorageMap, getProductStatus, type StorageMapShelf } from "@/lib/inventory";
import { useInventory } from "@/lib/inventory-context";

export default function StorageMapScreen() {
  const { products, settings, isLoading } = useInventory();
  const storageMap = useMemo(() => buildStorageMap(products), [products]);
  if (isLoading) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1F6F5B" /></ScreenContainer>;
  return <ScreenContainer className="px-5 pt-3"><FlatList data={storageMap} keyExtractor={(item) => item.shelf} contentContainerStyle={styles.content} ListHeaderComponent={<View><View style={styles.header}><Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={23} color="#1F6F5B" /></Pressable><View style={styles.headerCopy}><Text style={styles.title}>แผนผังตำแหน่ง</Text><Text style={styles.subtitle}>ดูพื้นที่ว่างและสินค้าตามชั้นวางกับแถว</Text></View></View><View style={styles.legend}><Legend color="#E8F3EF" border="#1F6F5B" label="มีสินค้า" /><Legend color="#F9FAFB" border="#D0D5DD" label="ตำแหน่งว่าง" /></View></View>} ListEmptyComponent={<View style={styles.emptyCard}><MaterialIcons name="grid-view" size={36} color="#98A2B3" /><Text style={styles.emptyTitle}>ยังไม่มีแผนผังตำแหน่ง</Text><Text style={styles.emptyCopy}>เพิ่มสินค้าพร้อมชั้นวางและแถวเพื่อสร้างแผนผังพื้นที่จัดเก็บ</Text></View>} renderItem={({ item }) => <ShelfMap shelf={item} nearExpiryDays={settings.nearExpiryDays} />} /></ScreenContainer>;
}

function Legend({ color, border, label }: { color: string; border: string; label: string }) { return <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: color, borderColor: border }]} /><Text style={styles.legendText}>{label}</Text></View>; }

function ShelfMap({ shelf, nearExpiryDays }: { shelf: StorageMapShelf; nearExpiryDays: number }) { return <View style={styles.shelfCard}><View style={styles.shelfHeader}><View style={styles.shelfIcon}><MaterialIcons name="view-module" size={22} color="#1F6F5B" /></View><View><Text style={styles.shelfTitle}>ชั้นวางที่ {shelf.shelf}</Text><Text style={styles.shelfSubtitle}>{shelf.rows.length} แถว · แสดงช่องว่างถัดไปในทุกแถว</Text></View></View>{shelf.rows.map((row) => <View key={row.row} style={styles.rowGroup}><Text style={styles.rowLabel}>แถวที่ {row.row}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slots}>{row.slots.map((slot) => { const status = slot.product ? getProductStatus(slot.product, nearExpiryDays) : "safe"; const color = status === "expired" ? "#B42318" : status === "urgent" ? "#D97706" : "#1F6F5B"; return slot.product ? <Pressable key={slot.itemNumber} accessibilityRole="button" accessibilityLabel={`สินค้า ${slot.product.name} ตัวที่ ${slot.itemNumber}`} onPress={() => router.push({ pathname: "/product/[id]", params: { id: slot.product!.id } })} style={({ pressed }) => [styles.slot, styles.filledSlot, { borderColor: color }, pressed && styles.pressed]}><Text style={[styles.slotNumber, { color }]}>#{slot.itemNumber}</Text><Text numberOfLines={2} style={styles.slotName}>{slot.product.name}</Text></Pressable> : <View key={slot.itemNumber} style={[styles.slot, styles.emptySlot]}><MaterialIcons name="add-circle-outline" size={20} color="#98A2B3" /><Text style={styles.emptySlotText}>ว่าง #{slot.itemNumber}</Text></View>; })}</ScrollView></View>)}</View>; }

const styles = StyleSheet.create({
  content: { paddingBottom: 110 },
  header: { alignItems: "center", flexDirection: "row", gap: 12, marginBottom: 18 },
  backButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  headerCopy: { flex: 1 },
  title: { color: "#101828", fontSize: 26, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 13, marginTop: 3 },
  legend: { alignItems: "center", flexDirection: "row", gap: 14, marginBottom: 17 },
  legendItem: { alignItems: "center", flexDirection: "row", gap: 6 },
  legendSwatch: { borderRadius: 4, borderWidth: 1, height: 12, width: 12 },
  legendText: { color: "#667085", fontSize: 12, fontWeight: "700" },
  shelfCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 19, borderWidth: 1, marginBottom: 13, padding: 15 },
  shelfHeader: { alignItems: "center", flexDirection: "row", gap: 10 },
  shelfIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 12, height: 42, justifyContent: "center", width: 42 },
  shelfTitle: { color: "#344054", fontSize: 16, fontWeight: "800" },
  shelfSubtitle: { color: "#667085", fontSize: 12, marginTop: 2 },
  rowGroup: { borderTopColor: "#EAECF0", borderTopWidth: 1, marginTop: 14, paddingTop: 13 },
  rowLabel: { color: "#475467", fontSize: 13, fontWeight: "800" },
  slots: { gap: 9, paddingTop: 10 },
  slot: { borderRadius: 12, borderWidth: 1, height: 82, justifyContent: "center", padding: 9, width: 92 },
  filledSlot: { backgroundColor: "#F8FFFC" },
  emptySlot: { alignItems: "center", backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderStyle: "dashed" },
  slotNumber: { fontSize: 11, fontWeight: "800" },
  slotName: { color: "#344054", fontSize: 12, fontWeight: "700", lineHeight: 16, marginTop: 4 },
  emptySlotText: { color: "#98A2B3", fontSize: 11, fontWeight: "700", marginTop: 3 },
  emptyCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 16, padding: 28 },
  emptyTitle: { color: "#344054", fontSize: 17, fontWeight: "700", marginTop: 12 },
  emptyCopy: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: "center" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
