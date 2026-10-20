import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { comparePositionLabels, getProductStatus } from "@/lib/inventory";
import { useInventory } from "@/lib/inventory-context";

type ShelfSummary = {
  shelf: string;
  productCount: number;
  rowCount: number;
  expiredCount: number;
  urgentCount: number;
};

export default function ShelvesScreen() {
  const { products, settings, isLoading } = useInventory();
  const shelves = useMemo(() => {
    const summaries = new Map<string, ShelfSummary & { rows: Set<string> }>();
    products.forEach((product) => {
      const current = summaries.get(product.shelf) ?? { shelf: product.shelf, productCount: 0, rowCount: 0, expiredCount: 0, urgentCount: 0, rows: new Set<string>() };
      const status = getProductStatus(product, settings.nearExpiryDays);
      current.productCount += 1;
      current.rows.add(product.row);
      if (status === "expired") current.expiredCount += 1;
      if (status === "urgent") current.urgentCount += 1;
      summaries.set(product.shelf, current);
    });
    return [...summaries.values()]
      .map(({ rows, ...summary }) => ({ ...summary, rowCount: rows.size }))
      .sort((a, b) => comparePositionLabels(a.shelf, b.shelf));
  }, [products, settings.nearExpiryDays]);

  if (isLoading) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1F6F5B" /></ScreenContainer>;

  return (
    <ScreenContainer className="px-5 pt-3">
      <FlatList
        data={shelves}
        keyExtractor={(item) => item.shelf}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={<View><Text style={styles.title}>ชั้นวางสินค้า</Text><Text style={styles.subtitle}>เลือกชั้นวางเพื่อดูและจัดการสินค้าในแต่ละหน้าจอ</Text><View style={styles.actionRow}><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/scanner", params: { mode: "manage" } })} style={({ pressed }) => [styles.scanAction, pressed && styles.pressed]}><MaterialIcons name="qr-code-scanner" size={21} color="#1F6F5B" /><Text style={styles.scanActionText}>สแกน</Text></Pressable><Pressable accessibilityRole="button" onPress={() => router.push("/storage-map" as never)} style={({ pressed }) => [styles.scanAction, pressed && styles.pressed]}><MaterialIcons name="grid-view" size={21} color="#1F6F5B" /><Text style={styles.scanActionText}>แผนผัง</Text></Pressable><Pressable accessibilityRole="button" onPress={() => router.push("/activity" as never)} style={({ pressed }) => [styles.scanAction, pressed && styles.pressed]}><MaterialIcons name="history" size={21} color="#1F6F5B" /><Text style={styles.scanActionText}>ประวัติ</Text></Pressable><Pressable accessibilityRole="button" onPress={() => router.push("/product-form")} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><MaterialIcons name="add" size={21} color="#FFFFFF" /><Text style={styles.addButtonText}>เพิ่มสินค้า</Text></Pressable></View><Text style={styles.shelfHeading}>ชั้นวางทั้งหมด</Text></View>}
        ListEmptyComponent={<View style={styles.emptyCard}><MaterialIcons name="inventory-2" size={34} color="#98A2B3" /><Text style={styles.emptyTitle}>ยังไม่มีชั้นวางสินค้า</Text><Text style={styles.emptyCopy}>เพิ่มสินค้าเพื่อสร้างชั้นวางและเริ่มติดตามวันหมดอายุ</Text></View>}
        renderItem={({ item }) => <ShelfCard shelf={item} />}
      />
    </ScreenContainer>
  );
}

function ShelfCard({ shelf }: { shelf: ShelfSummary }) {
  const attentionCount = shelf.expiredCount + shelf.urgentCount;
  return <Pressable accessibilityRole="button" onPress={() => router.push(`/shelf/${encodeURIComponent(shelf.shelf)}` as never)} style={({ pressed }) => [styles.shelfCard, pressed && styles.pressed]}><View style={styles.shelfIcon}><MaterialIcons name="view-module" size={25} color="#1F6F5B" /></View><View style={styles.shelfCopy}><Text style={styles.shelfName}>ชั้น {shelf.shelf}</Text><Text style={styles.shelfMeta}>{shelf.productCount} สินค้า · {shelf.rowCount} แถว</Text>{attentionCount > 0 ? <View style={styles.attention}><MaterialIcons name="warning-amber" size={14} color="#B54708" /><Text style={styles.attentionText}>{shelf.expiredCount > 0 ? `หมดอายุ ${shelf.expiredCount}` : ""}{shelf.expiredCount > 0 && shelf.urgentCount > 0 ? " · " : ""}{shelf.urgentCount > 0 ? `ใกล้หมดอายุ ${shelf.urgentCount}` : ""}</Text></View> : <Text style={styles.safeText}>ไม่มีรายการเร่งด่วน</Text>}</View><MaterialIcons name="chevron-right" size={25} color="#98A2B3" /></Pressable>;
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 112 },
  title: { color: "#101828", fontSize: 28, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 4 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 },
  addButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 14, flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  addButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  scanAction: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  scanActionText: { color: "#1F6F5B", fontSize: 15, fontWeight: "700" },
  shelfHeading: { color: "#344054", fontSize: 15, fontWeight: "800", marginBottom: 10, marginTop: 25 },
  shelfCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 13, marginBottom: 10, padding: 15 },
  shelfIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, height: 50, justifyContent: "center", width: 50 },
  shelfCopy: { flex: 1, gap: 3 },
  shelfName: { color: "#101828", fontSize: 17, fontWeight: "800" },
  shelfMeta: { color: "#667085", fontSize: 13 },
  attention: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 4 },
  attentionText: { color: "#B54708", fontSize: 12, fontWeight: "700" },
  safeText: { color: "#2F855A", fontSize: 12, fontWeight: "700", marginTop: 4 },
  emptyCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 20, padding: 28 },
  emptyTitle: { color: "#344054", fontSize: 17, fontWeight: "700", marginTop: 12 },
  emptyCopy: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: "center" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
