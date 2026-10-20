import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { summarizeRows, type RowSummary } from "@/lib/inventory";
import { useInventory } from "@/lib/inventory-context";

export default function ShelfDetailScreen() {
  const { shelf } = useLocalSearchParams<{ shelf: string }>();
  const shelfKey = typeof shelf === "string" ? shelf : "";
  const { products, settings, isLoading } = useInventory();
  const shelfProducts = useMemo(() => products.filter((product) => product.shelf === shelfKey), [products, shelfKey]);
  const rows = useMemo(() => summarizeRows(shelfProducts, settings.nearExpiryDays), [settings.nearExpiryDays, shelfProducts]);
  const expiredCount = rows.reduce((total, row) => total + row.expiredCount, 0);
  const urgentCount = rows.reduce((total, row) => total + row.urgentCount, 0);

  if (isLoading) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1F6F5B" /></ScreenContainer>;

  return <ScreenContainer className="px-5 pt-3"><FlatList data={rows} keyExtractor={(item) => item.row} contentContainerStyle={styles.listContent} ListHeaderComponent={<View><View style={styles.header}><Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={23} color="#1F6F5B" /></Pressable><View style={styles.headerCopy}><Text style={styles.overline}>ชั้นวางสินค้า</Text><Text style={styles.title}>ชั้น {shelfKey}</Text></View><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/product-form", params: { shelf: shelfKey } })} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><MaterialIcons name="add" size={22} color="#FFFFFF" /></Pressable></View><View style={styles.statsRow}><Stat count={shelfProducts.length} label="สินค้าทั้งหมด" color="#1F6F5B" /><Stat count={expiredCount} label="หมดอายุ" color="#B42318" /><Stat count={urgentCount} label="ใกล้หมดอายุ" color="#B54708" /></View><Text style={styles.sectionTitle}>เลือกแถวสินค้า</Text><Text style={styles.sectionCopy}>แตะแถวเพื่อดู ค้นหา และจัดการสินค้าเฉพาะแถวนั้น</Text></View>} ListEmptyComponent={<View style={styles.emptyCard}><MaterialIcons name="view-module" size={33} color="#98A2B3" /><Text style={styles.emptyTitle}>ยังไม่มีสินค้าในชั้นนี้</Text><Text style={styles.emptyCopy}>เพิ่มสินค้าเข้าชั้นนี้ได้จากปุ่ม + ด้านบน</Text></View>} renderItem={({ item }) => <RowCard row={item} shelfKey={shelfKey} />} /></ScreenContainer>;
}

function Stat({ count, label, color }: { count: number; label: string; color: string }) { return <View style={styles.stat}><Text style={[styles.statCount, { color }]}>{count}</Text><Text style={styles.statLabel}>{label}</Text></View>; }

function RowCard({ row, shelfKey }: { row: RowSummary; shelfKey: string }) {
  const attention = row.expiredCount + row.urgentCount;
  return <Pressable accessibilityRole="button" onPress={() => router.push(`/shelf/${encodeURIComponent(shelfKey)}/row/${encodeURIComponent(row.row)}` as never)} style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}><View style={styles.rowIcon}><MaterialIcons name="format-list-numbered" size={24} color="#1F6F5B" /></View><View style={styles.rowCopy}><Text style={styles.rowName}>แถว {row.row}</Text><Text style={styles.rowMeta}>{row.productCount} สินค้า</Text>{attention > 0 ? <View style={styles.attention}><MaterialIcons name="warning-amber" size={14} color="#B54708" /><Text style={styles.attentionText}>{row.expiredCount > 0 ? `หมดอายุ ${row.expiredCount}` : ""}{row.expiredCount > 0 && row.urgentCount > 0 ? " · " : ""}{row.urgentCount > 0 ? `ใกล้หมดอายุ ${row.urgentCount}` : ""}</Text></View> : <Text style={styles.safeText}>ไม่มีรายการเร่งด่วน</Text>}</View><MaterialIcons name="chevron-right" size={25} color="#98A2B3" /></Pressable>;
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 112 }, header: { alignItems: "center", flexDirection: "row", gap: 11 }, backButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, height: 44, justifyContent: "center", width: 44 }, headerCopy: { flex: 1 }, overline: { color: "#1F6F5B", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }, title: { color: "#101828", fontSize: 26, fontWeight: "800", marginTop: 1 }, addButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 14, height: 44, justifyContent: "center", width: 44 }, statsRow: { flexDirection: "row", gap: 9, marginTop: 18 }, stat: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 14, borderWidth: 1, flex: 1, padding: 11 }, statCount: { fontSize: 21, fontWeight: "800" }, statLabel: { color: "#667085", fontSize: 11, fontWeight: "600", marginTop: 2 }, sectionTitle: { color: "#344054", fontSize: 16, fontWeight: "800", marginTop: 24 }, sectionCopy: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: 4 }, rowCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 13, marginTop: 12, padding: 15 }, rowIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, height: 50, justifyContent: "center", width: 50 }, rowCopy: { flex: 1, gap: 3 }, rowName: { color: "#101828", fontSize: 17, fontWeight: "800" }, rowMeta: { color: "#667085", fontSize: 13 }, attention: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 4 }, attentionText: { color: "#B54708", fontSize: 12, fontWeight: "700" }, safeText: { color: "#2F855A", fontSize: 12, fontWeight: "700", marginTop: 4 }, emptyCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 22, padding: 28 }, emptyTitle: { color: "#344054", fontSize: 17, fontWeight: "700", marginTop: 12 }, emptyCopy: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: "center" }, pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
