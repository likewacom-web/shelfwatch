import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useInventory } from "@/lib/inventory-context";

export function UndoDeleteBanner() {
  const { lastDeletedProduct, undoDelete } = useInventory();
  const insets = useSafeAreaInsets();
  if (!lastDeletedProduct) return null;
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}><View style={[styles.banner, { bottom: Math.max(insets.bottom, 10) + 72 }]}><MaterialIcons name="delete-outline" size={21} color="#FFFFFF" /><View style={styles.copy}><Text style={styles.title}>ลบ “{lastDeletedProduct.name}” แล้ว</Text><Text style={styles.subtitle}>กดเลิกทำเพื่อกู้คืนสินค้า</Text></View><Pressable accessibilityRole="button" onPress={undoDelete} style={({ pressed }) => [styles.undoButton, pressed && styles.pressed]}><Text style={styles.undoText}>เลิกทำ</Text></Pressable></View></View>;
}

const styles = StyleSheet.create({
  banner: { alignItems: "center", backgroundColor: "#101828", borderRadius: 16, elevation: 6, flexDirection: "row", gap: 10, left: 16, padding: 12, position: "absolute", right: 16, shadowColor: "#101828", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 10 },
  copy: { flex: 1 },
  title: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  subtitle: { color: "#D0D5DD", fontSize: 11, marginTop: 2 },
  undoButton: { backgroundColor: "#E8F1FC", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  undoText: { color: "#1D4ED8", fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});
