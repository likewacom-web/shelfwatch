import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { BatchBadge } from "@/components/batch-badge";
import { useInventory } from "@/lib/inventory-context";
import { formatProductPosition, formatThaiDate, getLotAlerts, getProductImageUris, getStatusLabel, type LotAlert } from "@/lib/inventory";

type AlertItem = LotAlert;

function getTone(type: AlertItem["type"]) {
  return type === "expired" ? { color: "#B42318", surface: "#FEE4E2", icon: "error-outline" as const } : type === "low-stock" ? { color: "#175CD3", surface: "#E8F1FC", icon: "inventory-2" as const } : { color: "#D97706", surface: "#FEF0C7", icon: "warning-amber" as const };
}

export default function AlertsScreen() {
  const { products, settings, isLoading } = useInventory();
  const { filter } = useLocalSearchParams<{ filter?: "expired" | "urgent" }>();
  const alerts: AlertItem[] = getLotAlerts(products, settings);
  const visibleAlerts = filter === "expired" ? alerts.filter((item) => item.type === "expired") : filter === "urgent" ? alerts.filter((item) => item.type === "near-expiry" || item.type === "low-stock") : alerts;
  const title = filter === "expired" ? "ล็อตสินค้าหมดอายุ" : filter === "urgent" ? "ล็อตที่ต้องจัดการ" : "แจ้งเตือนสินค้า";
  const subtitle = filter === "expired" ? "รายการล็อตสินค้าที่หมดอายุแล้ว" : filter === "urgent" ? `ล็อตใกล้หมดอายุภายใน ${settings.nearExpiryDays} วัน หรือเหลือไม่เกิน ${settings.lowStockThreshold} หน่วย` : "ตรวจสอบล็อตใกล้หมดอายุและจำนวนใกล้หมด";

  if (isLoading) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1F6F5B" /></ScreenContainer>;

  const expiredCount = alerts.filter((item) => item.type === "expired").length;
  const expiryCount = alerts.filter((item) => item.type === "near-expiry").length;
  const lowStockCount = alerts.filter((item) => item.type === "low-stock").length;

  return (
    <ScreenContainer className="px-5 pt-3">
      <FlatList
        data={visibleAlerts}
        keyExtractor={(item) => `${item.product.id}-${item.lot.id}-${item.type}`}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            <View style={styles.summaryRow}>
              <SummaryChip count={expiredCount} label="หมดอายุแล้ว" tone="expired" />
              <SummaryChip count={expiryCount} label="ใกล้หมดอายุ" tone="urgent" />
              <SummaryChip count={lowStockCount} label="จำนวนใกล้หมด" tone="low" />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><MaterialIcons name="verified" size={31} color="#2F855A" /></View>
            <Text style={styles.emptyTitle}>ยังไม่มีรายการเร่งด่วน</Text>
            <Text style={styles.emptyCopy}>สินค้าทุกรายการยังเหลือเวลามากกว่าเกณฑ์ที่ตั้งไว้</Text>
          </View>
        }
        renderItem={({ item }) => {
          const tone = getTone(item.type);
          return (
            <Pressable onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.product.id } })} style={({ pressed }) => [styles.alertCard, pressed && styles.pressed]}>
              <View style={[styles.alertIcon, { backgroundColor: tone.surface }]}>{getProductImageUris(item.product)[0] ? <Image source={{ uri: getProductImageUris(item.product)[0] }} style={styles.alertImage} /> : <MaterialIcons name={tone.icon} size={23} color={tone.color} />}</View>
              <View style={styles.cardCopy}>
                <View style={styles.productTitleRow}><Text style={styles.productName} numberOfLines={1}>{item.product.name}</Text><BatchBadge batchNumber={item.lot.batchNumber} /></View>
                <Text style={styles.location}>รหัส {item.product.productCode || "—"} · {formatProductPosition(item.product)} · {item.type === "low-stock" ? `เหลือ ${item.lot.quantity} หน่วย` : `หมดอายุ ${item.expiryDate ? formatThaiDate(item.expiryDate) : "ไม่ระบุ"}`}</Text>
              </View>
              <Text style={[styles.daysText, { color: tone.color }]}>{item.type === "low-stock" ? "จำนวนใกล้หมด" : item.type === "expired" ? "หมดอายุแล้ว" : getStatusLabel("urgent", item.daysRemaining, Boolean(item.expiryDate))}</Text>
            </Pressable>
          );
        }}
      />
    </ScreenContainer>
  );
}

function SummaryChip({ count, label, tone }: { count: number; label: string; tone: "expired" | "urgent" | "low" }) {
  const colors = tone === "expired" ? { color: "#B42318", surface: "#FEE4E2" } : tone === "low" ? { color: "#175CD3", surface: "#E8F1FC" } : { color: "#B54708", surface: "#FEF0C7" };
  return <View style={[styles.summaryChip, { backgroundColor: colors.surface }]}><Text style={[styles.summaryCount, { color: colors.color }]}>{count}</Text><Text style={[styles.summaryLabel, { color: colors.color }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 108 },
  title: { color: "#101828", fontSize: 28, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 14, marginTop: 4 },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 19, marginTop: 18 },
  summaryChip: { borderRadius: 15, flex: 1, padding: 13 },
  summaryCount: { fontSize: 24, fontWeight: "800" },
  summaryLabel: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  alertCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 10, padding: 13 },
  alertIcon: { alignItems: "center", borderRadius: 12, height: 43, justifyContent: "center", overflow: "hidden", width: 43 },
  alertImage: { height: "100%", width: "100%" },
  cardCopy: { flex: 1, gap: 4 },
  productTitleRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  productName: { color: "#101828", flexShrink: 1, fontSize: 16, fontWeight: "700" },
  location: { color: "#667085", fontSize: 12, lineHeight: 17 },
  daysText: { fontSize: 12, fontWeight: "800", maxWidth: 80, textAlign: "right" },
  emptyCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 18, padding: 28 },
  emptyIcon: { alignItems: "center", backgroundColor: "#DCFCE7", borderRadius: 30, height: 56, justifyContent: "center", width: 56 },
  emptyTitle: { color: "#344054", fontSize: 17, fontWeight: "800", marginTop: 14 },
  emptyCopy: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: "center" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
