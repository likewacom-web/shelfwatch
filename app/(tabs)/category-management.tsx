import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { getProductCategoryLabel, normalizeProductCategory } from "@/lib/inventory";
import { useInventory } from "@/lib/inventory-context";

type CategoryRow = { name: string; count: number; archivedCount: number };

export default function CategoryManagementScreen() {
  const { products, deletedProducts, settings, renameCategory, deleteUnusedCategory } = useInventory();
  const [query, setQuery] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const categories = useMemo<CategoryRow[]>(() => {
    const counts = new Map<string, CategoryRow>();
    for (const category of settings.categoryCatalog ?? []) {
      const name = normalizeProductCategory(category);
      if (name) counts.set(name.toLocaleLowerCase("th-TH"), { name, count: 0, archivedCount: 0 });
    }
    for (const product of products) {
      const name = getProductCategoryLabel(product);
      if (name === "ยังไม่จัดหมวดหมู่") continue;
      const key = name.toLocaleLowerCase("th-TH");
      const current = counts.get(key) ?? { name, count: 0, archivedCount: 0 };
      counts.set(key, { ...current, count: current.count + 1 });
    }
    for (const product of deletedProducts) {
      const name = getProductCategoryLabel(product);
      if (name === "ยังไม่จัดหมวดหมู่") continue;
      const key = name.toLocaleLowerCase("th-TH");
      const current = counts.get(key) ?? { name, count: 0, archivedCount: 0 };
      counts.set(key, { ...current, archivedCount: current.archivedCount + 1 });
    }
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [deletedProducts, products, settings.categoryCatalog]);

  const filteredCategories = useMemo(() => {
    const normalizedQuery = normalizeProductCategory(query).toLocaleLowerCase("th-TH");
    return categories.filter((category) => !normalizedQuery || category.name.toLocaleLowerCase("th-TH").includes(normalizedQuery));
  }, [categories, query]);

  const startEditing = (category: CategoryRow) => {
    setEditingCategory(category.name);
    setEditingValue(category.name);
  };

  const cancelEditing = () => {
    setEditingCategory(null);
    setEditingValue("");
  };

  const saveCategory = async (category: CategoryRow) => {
    const nextName = normalizeProductCategory(editingValue);
    if (!nextName) {
      Alert.alert("ชื่อหมวดหมู่ว่าง", "กรุณาระบุชื่อหมวดหมู่ก่อนบันทึก");
      return;
    }
    if (categories.some((item) => item.name.toLocaleLowerCase("th-TH") === nextName.toLocaleLowerCase("th-TH") && item.name.toLocaleLowerCase("th-TH") !== category.name.toLocaleLowerCase("th-TH"))) {
      Alert.alert("มีหมวดหมู่นี้แล้ว", "กรุณาใช้ชื่อหมวดหมู่อื่น");
      return;
    }
    setIsSaving(true);
    try {
      const changed = await renameCategory(category.name, nextName);
      if (changed) Alert.alert("บันทึกแล้ว", `เปลี่ยนชื่อเป็น “${nextName}” ในสินค้าที่เกี่ยวข้องแล้ว`);
      cancelEditing();
    } finally {
      setIsSaving(false);
    }
  };

  const removeCategory = (category: CategoryRow) => {
    if (category.count > 0 || category.archivedCount > 0) {
      Alert.alert("ยังลบไม่ได้", "หมวดหมู่นี้ยังถูกใช้งานอยู่ ให้ย้ายหรือแก้หมวดหมู่ของสินค้าก่อน");
      return;
    }
    Alert.alert("ลบหมวดหมู่?", `ต้องการลบ “${category.name}” หรือไม่`, [
      { text: "ยกเลิก", style: "cancel" },
      { text: "ลบ", style: "destructive", onPress: () => void deleteUnusedCategory(category.name) },
    ]);
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="ย้อนกลับ" onPress={() => router.back()} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialIcons name="arrow-back" size={23} color="#1F6F5B" />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>จัดการหมวดหมู่</Text>
            <Text style={styles.subtitle}>แก้ชื่อหมวดหมู่ที่ใช้กับสินค้าหลายรายการได้จากที่เดียว</Text>
          </View>
        </View>
        <View style={styles.summaryCard}>
          <MaterialIcons name="category" size={23} color="#1D4ED8" />
          <View><Text style={styles.summaryNumber}>{categories.length}</Text><Text style={styles.summaryLabel}>หมวดหมู่ที่บันทึกไว้</Text></View>
        </View>
        <View style={styles.searchBox}>
          <MaterialIcons name="search" size={21} color="#667085" />
          <TextInput value={query} onChangeText={setQuery} placeholder="ค้นหาหมวดหมู่" placeholderTextColor="#98A2B3" style={styles.searchInput} returnKeyType="search" />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="ล้างคำค้นหา" onPress={() => setQuery("")} hitSlop={8}><MaterialIcons name="close" size={19} color="#667085" /></Pressable> : null}
        </View>
        <FlatList
          data={filteredCategories}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<View style={styles.empty}><MaterialIcons name="category" size={38} color="#98A2B3" /><Text style={styles.emptyTitle}>{query ? "ไม่พบหมวดหมู่" : "ยังไม่มีหมวดหมู่"}</Text><Text style={styles.emptyText}>{query ? "ลองค้นหาด้วยคำอื่น" : "หมวดหมู่จะแสดงเมื่อบันทึกสินค้า"}</Text></View>}
          renderItem={({ item }) => {
            const isEditing = editingCategory === item.name;
            return <View style={styles.categoryCard}>
              <View style={styles.categoryIcon}><MaterialIcons name="label" size={21} color="#1F6F5B" /></View>
              <View style={styles.categoryMain}>
                {isEditing ? <TextInput autoFocus value={editingValue} onChangeText={setEditingValue} style={styles.editInput} returnKeyType="done" onSubmitEditing={() => void saveCategory(item)} /> : <Text style={styles.categoryName}>{item.name}</Text>}
                <Text style={styles.categoryMeta}>{item.count} สินค้าที่ใช้งานอยู่{item.archivedCount ? ` · ${item.archivedCount} รายการใน Archive` : ""}</Text>
              </View>
              <View style={styles.actions}>
                {isEditing ? <><Pressable accessibilityRole="button" accessibilityLabel="ยกเลิกแก้ไขหมวดหมู่" onPress={cancelEditing} disabled={isSaving} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}><MaterialIcons name="close" size={19} color="#667085" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="บันทึกชื่อหมวดหมู่" onPress={() => void saveCategory(item)} disabled={isSaving} style={({ pressed }) => [styles.actionButton, styles.actionSuccess, pressed && styles.pressed]}><MaterialIcons name="check" size={19} color="#1F6F5B" /></Pressable></> : <><Pressable accessibilityRole="button" accessibilityLabel={`แก้ไขหมวดหมู่ ${item.name}`} onPress={() => startEditing(item)} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}><MaterialIcons name="edit" size={18} color="#1D4ED8" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`ลบหมวดหมู่ ${item.name}`} onPress={() => removeCategory(item)} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}><MaterialIcons name="delete-outline" size={19} color="#B42318" /></Pressable></>}
              </View>
            </View>;
          }}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 18 },
  header: { alignItems: "center", flexDirection: "row", gap: 11, paddingBottom: 12, paddingTop: 10 },
  iconButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  headerCopy: { flex: 1 },
  title: { color: "#101828", fontSize: 24, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 12, lineHeight: 17, marginTop: 2 },
  summaryCard: { alignItems: "center", backgroundColor: "#EEF4FF", borderColor: "#C7D7FE", borderRadius: 15, flexDirection: "row", gap: 11, marginBottom: 11, padding: 13 },
  summaryNumber: { color: "#1D4ED8", fontSize: 19, fontWeight: "900" },
  summaryLabel: { color: "#475467", fontSize: 12, marginTop: 1 },
  searchBox: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: 46, paddingHorizontal: 12 },
  searchInput: { color: "#101828", flex: 1, fontSize: 15, minHeight: 44 },
  listContent: { gap: 9, paddingBottom: 28, paddingTop: 13 },
  categoryCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 67, paddingHorizontal: 12, paddingVertical: 9 },
  categoryIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 11, height: 38, justifyContent: "center", width: 38 },
  categoryMain: { flex: 1, minWidth: 0 },
  categoryName: { color: "#344054", fontSize: 15, fontWeight: "800" },
  categoryMeta: { color: "#667085", fontSize: 11, marginTop: 4 },
  editInput: { borderColor: "#1D4ED8", borderRadius: 8, borderWidth: 1, color: "#101828", fontSize: 14, minHeight: 38, paddingHorizontal: 9 },
  actions: { alignItems: "center", flexDirection: "row", gap: 3 },
  actionButton: { alignItems: "center", borderRadius: 9, height: 36, justifyContent: "center", width: 36 },
  actionSuccess: { backgroundColor: "#E8F3EF" },
  empty: { alignItems: "center", paddingHorizontal: 24, paddingTop: 62 },
  emptyTitle: { color: "#344054", fontSize: 16, fontWeight: "800", marginTop: 10 },
  emptyText: { color: "#667085", fontSize: 13, marginTop: 5, textAlign: "center" },
  pressed: { opacity: 0.7 },
});
