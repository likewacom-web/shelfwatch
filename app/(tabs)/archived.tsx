import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useInventory } from "@/lib/inventory-context";

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function ArchivedScreen() {
  const colors = useColors();
  const { deletedProducts, restoreArchivedProduct } = useInventory();

  const confirmRestore = (id: string, name: string) => {
    Alert.alert("กู้คืนสินค้า", `ต้องการนำ “${name}” กลับเข้าสินค้าปัจจุบันหรือไม่`, [
      { text: "ยกเลิก", style: "cancel" },
      { text: "กู้คืน", onPress: () => restoreArchivedProduct(id) },
    ]);
  };

  return (
    <ScreenContainer className="px-4">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="ย้อนกลับ" onPress={() => router.back()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>รายการที่ลบแล้ว</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{deletedProducts.length} รายการ · ข้อมูลยังเก็บไว้เพื่อกู้คืน</Text>
        </View>
      </View>

      <FlatList
        data={deletedProducts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={deletedProducts.length === 0 ? styles.emptyContent : styles.listContent}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.cardIcon}><MaterialIcons name="inventory-2" size={23} color={colors.muted} /></View>
            <View style={styles.cardCopy}>
              <Text style={[styles.productName, { color: colors.foreground }]} numberOfLines={2}>{item.name}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>{item.productCode || "ไม่มีบาร์โค้ด"} · จำนวน {item.quantity}</Text>
              <Text style={[styles.meta, { color: colors.muted }]}>ตำแหน่งเดิม: ชั้น {item.shelf} · แถว {item.row}{item.itemNumber ? ` · ลำดับ ${item.itemNumber}` : ""}</Text>
              <Text style={[styles.deletedAt, { color: colors.muted }]}>ลบเมื่อ {formatDate(item.deletedAt)}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => confirmRestore(item.id, item.name)} style={({ pressed }) => [styles.restoreButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
              <MaterialIcons name="restore" size={18} color="#FFFFFF" />
              <Text style={styles.restoreText}>กู้คืน</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<View style={styles.empty}><MaterialIcons name="inventory" size={48} color={colors.muted} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>ยังไม่มีสินค้าที่เก็บถาวร</Text><Text style={[styles.emptyText, { color: colors.muted }]}>เมื่อคุณลบสินค้า ระบบจะเก็บข้อมูลไว้ที่หน้านี้แทนการลบถาวร</Text></View>}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingVertical: 16, gap: 10 },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 },
  title: { fontSize: 22, fontWeight: "800" },
  subtitle: { marginTop: 3, fontSize: 13 },
  listContent: { paddingBottom: 28, gap: 12 },
  emptyContent: { flexGrow: 1, justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  cardIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#F2F4F7", alignItems: "center", justifyContent: "center" },
  cardCopy: { flex: 1, gap: 3 },
  productName: { fontSize: 16, fontWeight: "700", lineHeight: 21 },
  meta: { fontSize: 12, lineHeight: 17 },
  deletedAt: { fontSize: 11, marginTop: 3 },
  restoreButton: { minHeight: 38, borderRadius: 10, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  restoreText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  empty: { alignItems: "center", paddingHorizontal: 28, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyText: { textAlign: "center", fontSize: 13, lineHeight: 20 },
});

