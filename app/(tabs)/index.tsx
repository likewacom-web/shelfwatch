import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { NativeModulesProxy } from "expo-modules-core";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, ActivityIndicator, Animated, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { BatchBadge } from "@/components/batch-badge";
import { useInventory } from "@/lib/inventory-context";
import { formatProductPosition, formatThaiDate, getDaysRemainingForProduct, getExpiryDateForProduct, getProductCategories, getProductCategoryLabel, getProductGradeLabel, getProductGradeTheme, getProductImageUris, getProductStatus, getStatusLabel, matchesProductSearch, normalizeProductCategory, sortByExpiry, summarizeProductStatuses, type ProductGrade, type ProductStatus } from "@/lib/inventory";
import { normalizeVoiceSearchQuery } from "@/lib/voice-search";

type ExpiryItem = { id: string; name: string; category?: string; grade?: ProductGrade; productCode: string; batchNumber?: string; shelf: string; row: string; itemNumber?: number; dateType: "manufactured" | "expiry"; date: string; shelfLifeDays?: number; imageUri?: string; imageUris?: string[]; days: number | null; expiryDate: string | null; status: ProductStatus };
const hasSpeechRecognitionModule = Boolean(NativeModulesProxy.ExpoSpeechRecognition);

function statusColor(status: ProductStatus) {
  return status === "expired" ? "#B42318" : status === "urgent" ? "#D97706" : "#2F855A";
}

export default function HomeScreen() {
  const { products, settings, isLoading } = useInventory();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const clearSearchOpacity = useRef(new Animated.Value(0)).current;
  const [selectedGrade, setSelectedGrade] = useState<ProductGrade | null>(null);
  const decorated = sortByExpiry(products).map((product) => ({ ...product, days: getDaysRemainingForProduct(product), expiryDate: getExpiryDateForProduct(product), status: getProductStatus(product, settings.nearExpiryDays) }));
  const categories = [...new Set([...getProductCategories(products), ...(settings.categoryCatalog ?? [])])].sort((first, second) => first.localeCompare(second, "th"));
  const categoryProducts = selectedCategory ? decorated.filter((product) => normalizeProductCategory(product.category) === selectedCategory) : decorated;
  const gradeProducts = selectedGrade ? categoryProducts.filter((product) => product.grade === selectedGrade) : categoryProducts;
  const urgentItems = gradeProducts.filter((product) => product.status !== "safe");
  const visibleItems = searchQuery.trim() ? gradeProducts.filter((product) => matchesProductSearch(product, searchQuery)) : urgentItems;
  const statusSummary = summarizeProductStatuses(gradeProducts, settings.nearExpiryDays);
  const { expired, urgent, safe } = statusSummary;
  const categoryLabel = selectedCategory ?? "ทั้งหมด";
  const gradeLabel = selectedGrade ? getProductGradeLabel(selectedGrade) : "ทุกเกรด";
  const hasSearchQuery = Boolean(searchQuery);

  useEffect(() => {
    if (!hasSearchQuery) {
      clearSearchOpacity.setValue(0);
      return;
    }
    clearSearchOpacity.setValue(0);
    Animated.timing(clearSearchOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [clearSearchOpacity, hasSearchQuery]);

  if (isLoading) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1D4ED8" /></ScreenContainer>;

  return (
    <ScreenContainer className="px-5 pt-3">
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <View style={styles.header}><View><Text style={styles.overline}>SHELFWATCH</Text><Text style={styles.title}>ภาพรวมสต็อก</Text></View><View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel="สแกนบาร์โค้ด" onPress={() => router.push({ pathname: "/scanner", params: { mode: "manage" } })} style={({ pressed }) => [styles.scanHeaderButton, pressed && styles.pressed]}><MaterialIcons name="qr-code-scanner" size={22} color="#1D4ED8" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="เพิ่มสินค้า" onPress={() => router.push("/product-form")} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><MaterialIcons name="add" size={25} color="#FFFFFF" /></Pressable></View></View>
            <Text style={styles.subtitle}>ติดตามวันหมดอายุตามชั้นวางและแถว</Text>
            <View style={styles.globalSearch}><MaterialIcons name="search" size={21} color="#667085" /><TextInput accessibilityLabel="ค้นหาสินค้าด้วยชื่อหรือรหัส" value={searchQuery} onChangeText={setSearchQuery} placeholder="ค้นหาด้วยชื่อหรือรหัสสินค้า" placeholderTextColor="#98A2B3" style={styles.searchInput} returnKeyType="search" />{hasSearchQuery ? <Animated.View style={{ opacity: clearSearchOpacity }}><Pressable accessibilityRole="button" accessibilityLabel="ล้างคำค้นหา" onPress={() => setSearchQuery("")} style={({ pressed }) => [styles.clearSearchButton, pressed && styles.pressed]} hitSlop={6}><MaterialIcons name="close" size={18} color="#667085" /></Pressable></Animated.View> : null}<VoiceSearchControl onTranscript={setSearchQuery} contextualStrings={products.slice(0, 80).flatMap((product) => [product.name, product.productCode]).filter(Boolean)} /><Pressable accessibilityRole="button" accessibilityLabel="สแกนบาร์โค้ดเพื่อค้นหาสินค้า" onPress={() => router.push({ pathname: "/scanner", params: { mode: "manage" } })} style={({ pressed }) => [styles.searchScanButton, pressed && styles.pressed]}><MaterialIcons name="qr-code-scanner" size={20} color="#1D4ED8" /></Pressable></View>
            <Text style={styles.searchHint}>{hasSpeechRecognitionModule ? "พิมพ์ชื่อหรือรหัสสินค้า พูดคำค้นหา หรือกดสแกนเพื่อค้นหารายการ" : "พิมพ์ชื่อหรือรหัสสินค้า หรือกดสแกนเพื่อค้นหารายการ"}</Text>
            <CategoryFilter categories={categories} products={decorated} selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />
            <GradeFilter products={categoryProducts} selectedGrade={selectedGrade} onSelectGrade={setSelectedGrade} />
            <GradeSummaryCards products={categoryProducts} selectedGrade={selectedGrade} onSelectGrade={setSelectedGrade} />
            <Text style={styles.filterSummary}>กำลังแสดง: {categoryLabel} · {gradeLabel} · {gradeProducts.length} รายการ</Text>
            <View style={styles.statGrid}><StatCard count={gradeProducts.length} label={selectedCategory || selectedGrade ? "สินค้าที่กรอง" : "สินค้าทั้งหมด"} icon="inventory-2" color="#1D4ED8" surface="#E8F1FC" onPress={() => router.push("/shelves")} /><StatCard count={expired} label="หมดอายุแล้ว" icon="error-outline" color="#B42318" surface="#FEE4E2" onPress={() => router.push({ pathname: "/alerts", params: { filter: "expired" } })} /><StatCard count={urgent} label="ใกล้หมดอายุ" icon="warning-amber" color="#B54708" surface="#FEF0C7" onPress={() => router.push({ pathname: "/alerts", params: { filter: "urgent" } })} /></View>
            <StatusChart safe={safe} urgent={urgent} expired={expired} total={gradeProducts.length} />
            <View style={styles.listHeading}><View><Text style={styles.heading}>{searchQuery.trim() ? `ผลการค้นหา ${visibleItems.length} รายการ` : selectedCategory ? `ต้องจัดการก่อน · ${selectedCategory}` : "ต้องจัดการก่อน"}</Text><Text style={styles.headingCopy}>{searchQuery.trim() ? `ค้นหาภายในหมวด ${categoryLabel}` : "เรียงตามวันที่หมดอายุ"}</Text></View>{!searchQuery.trim() && urgentItems.length > 0 ? <Pressable onPress={() => router.push("/alerts")}><Text style={styles.allLink}>ดูทั้งหมด</Text></Pressable> : null}</View>
          </View>
        }
        ListEmptyComponent={<EmptyState hasProducts={products.length > 0} isSearching={Boolean(searchQuery.trim())} onScan={() => router.push({ pathname: "/scanner", params: { mode: "manage" } })} />}
        renderItem={({ item }) => <UrgentItem item={item} />}
      />
    </ScreenContainer>
  );
}

function CategoryFilter({ categories, products, selectedCategory, onSelectCategory }: { categories: string[]; products: { category?: string }[]; selectedCategory: string | null; onSelectCategory: (category: string | null) => void }) {
  const categoryCount = (category: string) => products.filter((product) => normalizeProductCategory(product.category) === category).length;
  return <View style={styles.categorySection}><View style={styles.categoryHeading}><View><Text style={styles.categoryTitle}>จัดหมวดหมู่สินค้า</Text><Text style={styles.categorySubtitle}>{categories.length ? "เลือกหมวดเพื่อดูภาพรวมเฉพาะกลุ่ม" : "เพิ่มหมวดหมู่จากฟอร์มสินค้าเพื่อเริ่มจัดกลุ่ม"}</Text></View>{selectedCategory ? <Pressable accessibilityRole="button" onPress={() => onSelectCategory(null)} style={({ pressed }) => [styles.clearCategoryButton, pressed && styles.pressed]}><Text style={styles.clearCategoryText}>ล้างตัวกรอง</Text></Pressable> : null}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChipList}><CategoryChip label="ทั้งหมด" count={products.length} selected={!selectedCategory} onPress={() => onSelectCategory(null)} />{categories.map((category) => <CategoryChip key={category} label={category} count={categoryCount(category)} selected={selectedCategory === category} onPress={() => onSelectCategory(category)} />)}</ScrollView></View>;
}

function GradeFilter({ products, selectedGrade, onSelectGrade }: { products: { grade?: ProductGrade }[]; selectedGrade: ProductGrade | null; onSelectGrade: (grade: ProductGrade | null) => void }) {
  const grades: ProductGrade[] = ["A", "B", "C"];
  return <View style={styles.gradeFilterSection}><View style={styles.categoryHeading}><View><Text style={styles.categoryTitle}>จัดเกรดสินค้า</Text><Text style={styles.categorySubtitle}>กรองรายการตามระดับ A, B หรือ C</Text></View>{selectedGrade ? <Pressable accessibilityRole="button" onPress={() => onSelectGrade(null)} style={({ pressed }) => [styles.clearCategoryButton, pressed && styles.pressed]}><Text style={styles.clearCategoryText}>ล้างตัวกรอง</Text></Pressable> : null}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChipList}><CategoryChip label="ทุกเกรด" count={products.length} selected={!selectedGrade} onPress={() => onSelectGrade(null)} />{grades.map((grade) => <CategoryChip key={grade} label={`เกรด ${grade}`} count={products.filter((product) => product.grade === grade).length} selected={selectedGrade === grade} onPress={() => onSelectGrade(grade)} />)}</ScrollView></View>;
}

function GradeSummaryCards({ products, selectedGrade, onSelectGrade }: { products: { grade?: ProductGrade }[]; selectedGrade: ProductGrade | null; onSelectGrade: (grade: ProductGrade | null) => void }) {
  const grades: ProductGrade[] = ["A", "B", "C"];
  return <View style={styles.gradeSummarySection}><View style={styles.gradeSummaryHeader}><View><Text style={styles.gradeSummaryTitle}>สรุปตามเกรด</Text><Text style={styles.gradeSummarySubtitle}>แตะการ์ดเพื่อกรองรายการบนแดชบอร์ด</Text></View><MaterialIcons name="insights" size={20} color="#667085" /></View><View style={styles.gradeSummaryGrid}>{grades.map((grade) => { const theme = getProductGradeTheme(grade); const count = products.filter((product) => product.grade === grade).length; const selected = selectedGrade === grade; return <Pressable key={grade} accessibilityRole="button" accessibilityLabel={`เกรด ${grade} มี ${count} รายการ`} accessibilityState={{ selected }} onPress={() => onSelectGrade(selected ? null : grade)} style={({ pressed }) => [styles.gradeSummaryCard, { backgroundColor: selected ? theme.backgroundColor : "#FFFFFF", borderColor: selected ? theme.textColor : `${theme.textColor}45` }, pressed && styles.pressed]}><View style={[styles.gradeSummaryBadge, { backgroundColor: theme.textColor }]}><Text style={styles.gradeSummaryBadgeText}>{grade}</Text></View><Text style={[styles.gradeSummaryCount, { color: theme.textColor }]}>{count}</Text><Text style={styles.gradeSummaryLabel}>สินค้า</Text>{selected ? <MaterialIcons name="check-circle" size={17} color={theme.textColor} style={styles.gradeSummaryCheck} /> : null}</Pressable>; })}</View></View>;
}

function CategoryChip({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`กรองหมวดหมู่ ${label} ${count} รายการ`} onPress={onPress} style={({ pressed }) => [styles.categoryChip, selected && styles.categoryChipSelected, pressed && styles.pressed]}><Text style={[styles.categoryChipText, selected && styles.categoryChipTextSelected]}>{label}</Text><View style={[styles.categoryCount, selected && styles.categoryCountSelected]}><Text style={[styles.categoryCountText, selected && styles.categoryCountTextSelected]}>{count}</Text></View></Pressable>;
}

function VoiceSearchControl({ onTranscript, contextualStrings }: { onTranscript: (value: string) => void; contextualStrings: string[] }) {
  if (hasSpeechRecognitionModule) return <AvailableVoiceSearchControl onTranscript={onTranscript} contextualStrings={contextualStrings} />;
  return <Pressable accessibilityRole="button" accessibilityLabel="ค้นหาด้วยเสียงยังไม่พร้อม" onPress={() => Alert.alert("ค้นหาด้วยเสียงยังไม่พร้อม", "เปิดแอปผ่าน development build เพื่อใช้ค้นหาด้วยเสียง หรือใช้การพิมพ์และสแกนบาร์โค้ดแทน")} style={({ pressed }) => [styles.voiceSearchButton, styles.voiceSearchButtonUnavailable, pressed && styles.pressed]}><MaterialIcons name="mic-off" size={20} color="#98A2B3" /></Pressable>;
}

function AvailableVoiceSearchControl({ onTranscript, contextualStrings }: { onTranscript: (value: string) => void; contextualStrings: string[] }) {
  const speechRecognition = require("expo-speech-recognition") as typeof import("expo-speech-recognition");
  const { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } = speechRecognition;
  const [isListening, setIsListening] = useState(false);
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = normalizeVoiceSearchQuery(event.results[0]?.transcript ?? "");
    if (transcript) onTranscript(transcript);
    if (event.isFinal) setIsListening(false);
  });
  useSpeechRecognitionEvent("end", () => setIsListening(false));
  useSpeechRecognitionEvent("error", (event) => {
    setIsListening(false);
    if (event.error !== "aborted" && event.error !== "no-speech" && event.error !== "speech-timeout") Alert.alert("ค้นหาด้วยเสียงไม่สำเร็จ", "ไม่สามารถแปลงคำพูดเป็นข้อความได้ โปรดลองอีกครั้ง");
  });
  const handleVoiceSearch = async () => {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert("ไม่รองรับการค้นหาด้วยเสียง", "อุปกรณ์นี้ไม่มีบริการรู้จำเสียงที่พร้อมใช้งาน");
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("ต้องอนุญาตไมโครโฟน", "โปรดอนุญาตไมโครโฟนและการรู้จำเสียงจากการตั้งค่าอุปกรณ์เพื่อใช้ค้นหาด้วยเสียง");
        return;
      }
      setIsListening(true);
      ExpoSpeechRecognitionModule.start({ lang: "th-TH", interimResults: true, continuous: false, maxAlternatives: 1, contextualStrings });
    } catch {
      setIsListening(false);
      Alert.alert("ค้นหาด้วยเสียงไม่สำเร็จ", "ไม่สามารถเริ่มระบบรู้จำเสียงได้ โปรดลองอีกครั้ง");
    }
  };
  return <Pressable accessibilityRole="button" accessibilityLabel={isListening ? "หยุดค้นหาด้วยเสียง" : "ค้นหาสินค้าด้วยเสียง"} onPress={handleVoiceSearch} style={({ pressed }) => [styles.voiceSearchButton, isListening && styles.voiceSearchButtonActive, pressed && styles.pressed]}><MaterialIcons name={isListening ? "mic" : "mic-none"} size={20} color={isListening ? "#FFFFFF" : "#1D4ED8"} /></Pressable>;
}

function StatCard({ count, label, icon, color, surface, onPress }: { count: number; label: string; icon: "inventory-2" | "error-outline" | "warning-amber"; color: string; surface: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`เปิดรายการ ${label}`} onPress={onPress} style={({ pressed }) => [styles.statCard, pressed && styles.pressed]}><View style={[styles.statIcon, { backgroundColor: surface }]}><MaterialIcons name={icon} size={19} color={color} /></View><Text style={styles.statCount}>{count}</Text><Text style={styles.statLabel}>{label}</Text><MaterialIcons name="chevron-right" size={16} color="#98A2B3" style={styles.statChevron} /></Pressable>;
}

function StatusChart({ safe, urgent, expired, total }: { safe: number; urgent: number; expired: number; total: number }) {
  const segments = [{ key: "safe", label: "ปกติ", count: safe, color: "#2F855A" }, { key: "urgent", label: "ใกล้หมดอายุ", count: urgent, color: "#D97706" }, { key: "expired", label: "หมดอายุแล้ว", count: expired, color: "#B42318" }];
  return <View accessibilityLabel={`กราฟสถานะสินค้า ปกติ ${safe} รายการ ใกล้หมดอายุ ${urgent} รายการ หมดอายุแล้ว ${expired} รายการ`} style={styles.chartCard}><View style={styles.chartHeader}><View><Text style={styles.chartTitle}>สถานะสินค้า</Text><Text style={styles.chartSubtitle}>สัดส่วนสินค้าตามวันหมดอายุ</Text></View><Text style={styles.chartTotal}>{total} รายการ</Text></View><View style={styles.chartTrack}>{total === 0 ? <View style={styles.chartEmptySegment} /> : segments.filter((segment) => segment.count > 0).map((segment) => <View key={segment.key} style={[styles.chartSegment, { backgroundColor: segment.color, flex: segment.count }]} />)}</View><View style={styles.legendList}>{segments.map((segment) => <View key={segment.key} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: segment.color }]} /><Text style={styles.legendLabel}>{segment.label}</Text><Text style={styles.legendValue}>{segment.count} <Text style={styles.legendPercent}>({total ? Math.round((segment.count / total) * 100) : 0}%)</Text></Text></View>)}</View></View>;
}

function UrgentItem({ item }: { item: ExpiryItem }) {
  const color = statusColor(item.status);
  const previewUri = getProductImageUris(item)[0];
  return <Pressable onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.id } })} style={({ pressed }) => [styles.itemCard, pressed && styles.pressed]}><View style={[styles.itemIcon, { backgroundColor: `${color}16` }]}>{previewUri ? <Image source={{ uri: previewUri }} style={styles.itemImage} /> : <MaterialIcons name={item.status === "expired" ? "error-outline" : "warning-amber"} size={22} color={color} />}</View><View style={styles.itemCopy}><View style={styles.itemTitleRow}><Text style={styles.itemName} numberOfLines={1}>{item.name}</Text><BatchBadge batchNumber={item.batchNumber} />{item.grade ? <GradeBadge grade={item.grade} /> : null}</View><Text style={styles.itemCategory}>{getProductCategoryLabel(item)}</Text><Text style={styles.itemMeta}>รหัส {item.productCode || "—"} · {formatProductPosition(item)} · หมดอายุ {item.expiryDate ? formatThaiDate(item.expiryDate) : "ไม่ระบุ"}</Text></View><Text style={[styles.itemStatus, { color }]}>{getStatusLabel(item.status, item.days, Boolean(item.expiryDate))}</Text></Pressable>;
}

function GradeBadge({ grade }: { grade: ProductGrade }) {
  const theme = getProductGradeTheme(grade);
  return <View accessibilityLabel={getProductGradeLabel(grade)} style={[styles.gradeBadge, { backgroundColor: theme.backgroundColor }]}><Text style={[styles.gradeBadgeText, { color: theme.textColor }]}>{grade}</Text></View>;
}

function EmptyState({ hasProducts, isSearching, onScan }: { hasProducts: boolean; isSearching: boolean; onScan: () => void }) {
  return <View style={styles.emptyCard}><View style={styles.emptyIcon}><MaterialIcons name={isSearching ? "search-off" : hasProducts ? "verified" : "inventory-2"} size={31} color="#2F855A" /></View><Text style={styles.emptyTitle}>{isSearching ? "ไม่พบสินค้าที่ค้นหา" : hasProducts ? "สต็อกยังไม่มีรายการเร่งด่วน" : "เริ่มบันทึกสินค้าในสต็อก"}</Text><Text style={styles.emptyCopy}>{isSearching ? "ลองตรวจสอบชื่อหรือรหัสสินค้า หรือสแกนบาร์โค้ดอีกครั้ง" : hasProducts ? "สินค้าทั้งหมดเหลือเวลามากกว่าเกณฑ์ใกล้หมดอายุ" : "เพิ่มชื่อสินค้า วันหมดอายุ และตำแหน่งชั้นวางเพื่อเริ่มติดตาม"}</Text>{isSearching ? <Pressable onPress={onScan} style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}><MaterialIcons name="qr-code-scanner" size={18} color="#FFFFFF" /><Text style={styles.emptyButtonText}>สแกนบาร์โค้ด</Text></Pressable> : !hasProducts ? <Pressable onPress={() => router.push("/product-form")} style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}><Text style={styles.emptyButtonText}>เพิ่มสินค้าชิ้นแรก</Text></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 110 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  overline: { color: "#1D4ED8", fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: "#101828", fontSize: 28, fontWeight: "800", marginTop: 2 },
  subtitle: { color: "#667085", fontSize: 14, marginTop: 5 },
  addButton: { alignItems: "center", backgroundColor: "#1D4ED8", borderRadius: 16, height: 48, justifyContent: "center", width: 48 },
  headerActions: { flexDirection: "row", gap: 9 },
  scanHeaderButton: { alignItems: "center", backgroundColor: "#E8F1FC", borderRadius: 16, height: 48, justifyContent: "center", width: 48 },
  globalSearch: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#D0D5DD", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 18, minHeight: 52, paddingLeft: 13, paddingRight: 5 },
  searchInput: { color: "#101828", flex: 1, fontSize: 15, minHeight: 50 },
  clearSearchButton: { alignItems: "center", backgroundColor: "#F2F4F7", borderRadius: 14, height: 28, justifyContent: "center", width: 28 },
  voiceSearchButton: { alignItems: "center", backgroundColor: "#E8F1FC", borderRadius: 11, height: 40, justifyContent: "center", width: 40 },
  voiceSearchButtonActive: { backgroundColor: "#B42318" },
  voiceSearchButtonUnavailable: { backgroundColor: "#F2F4F7" },
  searchScanButton: { alignItems: "center", backgroundColor: "#E8F1FC", borderRadius: 11, height: 40, justifyContent: "center", width: 40 },
  searchHint: { color: "#667085", fontSize: 11, lineHeight: 16, marginTop: 6 },
  gradeFilterSection: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 18, borderWidth: 1, marginTop: 10, padding: 14 },
  gradeSummarySection: { backgroundColor: "#F8FAFC", borderColor: "#E4E7EC", borderRadius: 18, borderWidth: 1, marginTop: 10, padding: 14 },
  gradeSummaryHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  gradeSummaryTitle: { color: "#344054", fontSize: 15, fontWeight: "800" },
  gradeSummarySubtitle: { color: "#667085", fontSize: 11, lineHeight: 16, marginTop: 3 },
  gradeSummaryGrid: { flexDirection: "row", gap: 8, marginTop: 12 },
  gradeSummaryCard: { alignItems: "center", borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 94, justifyContent: "center", paddingHorizontal: 6, position: "relative" },
  gradeSummaryBadge: { alignItems: "center", borderRadius: 999, height: 27, justifyContent: "center", width: 27 },
  gradeSummaryBadgeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  gradeSummaryCount: { fontSize: 24, fontWeight: "900", lineHeight: 28, marginTop: 4 },
  gradeSummaryLabel: { color: "#667085", fontSize: 10, fontWeight: "700" },
  gradeSummaryCheck: { position: "absolute", right: 7, top: 7 },
  gradeBadge: { borderRadius: 999, marginLeft: 5, paddingHorizontal: 7, paddingVertical: 3 },
  gradeBadgeText: { fontSize: 10, fontWeight: "900" },
  categorySection: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 18, borderWidth: 1, marginTop: 16, padding: 14 },
  categoryHeading: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  categoryTitle: { color: "#344054", fontSize: 15, fontWeight: "800" },
  categorySubtitle: { color: "#667085", fontSize: 11, lineHeight: 16, marginTop: 3, maxWidth: 240 },
  clearCategoryButton: { backgroundColor: "#E8F1FC", borderRadius: 10, minHeight: 31, justifyContent: "center", paddingHorizontal: 10 },
  clearCategoryText: { color: "#1D4ED8", fontSize: 11, fontWeight: "800" },
  categoryChipList: { gap: 8, paddingTop: 13 },
  categoryChip: { alignItems: "center", backgroundColor: "#F2F4F7", borderColor: "#D0D5DD", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 7, minHeight: 38, paddingLeft: 12, paddingRight: 7 },
  categoryChipSelected: { backgroundColor: "#1D4ED8", borderColor: "#1D4ED8" },
  categoryChipText: { color: "#475467", fontSize: 12, fontWeight: "800" },
  categoryChipTextSelected: { color: "#FFFFFF" },
  categoryCount: { alignItems: "center", backgroundColor: "#E4E7EC", borderRadius: 10, height: 22, justifyContent: "center", minWidth: 22, paddingHorizontal: 5 },
  categoryCountSelected: { backgroundColor: "rgba(255,255,255,0.22)" },
  categoryCountText: { color: "#475467", fontSize: 11, fontWeight: "800" },
  categoryCountTextSelected: { color: "#FFFFFF" },
  filterSummary: { color: "#475467", fontSize: 12, fontWeight: "700", marginTop: 10 },
  listeningHint: { color: "#B42318", fontWeight: "700" },
  statGrid: { flexDirection: "row", gap: 9, marginTop: 20 },
  statCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 16, borderWidth: 1, flex: 1, minHeight: 114, padding: 12 },
  statIcon: { alignItems: "center", borderRadius: 9, height: 30, justifyContent: "center", width: 30 },
  statCount: { color: "#101828", fontSize: 25, fontWeight: "800", marginTop: 8 },
  statLabel: { color: "#667085", fontSize: 11, fontWeight: "600", marginTop: 2 },
  statChevron: { alignSelf: "flex-end", marginTop: "auto" },
  chartCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 18, borderWidth: 1, marginTop: 15, padding: 16 },
  chartHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  chartTitle: { color: "#344054", fontSize: 16, fontWeight: "800" },
  chartSubtitle: { color: "#667085", fontSize: 12, marginTop: 3 },
  chartTotal: { color: "#1D4ED8", fontSize: 13, fontWeight: "800" },
  chartTrack: { backgroundColor: "#EAECF0", borderRadius: 999, flexDirection: "row", height: 16, marginTop: 18, overflow: "hidden" },
  chartSegment: { height: "100%" },
  chartEmptySegment: { backgroundColor: "#EAECF0", flex: 1 },
  legendList: { gap: 9, marginTop: 16 },
  legendItem: { alignItems: "center", flexDirection: "row" },
  legendDot: { borderRadius: 5, height: 10, marginRight: 8, width: 10 },
  legendLabel: { color: "#475467", flex: 1, fontSize: 13, fontWeight: "700" },
  legendValue: { color: "#344054", fontSize: 13, fontWeight: "800" },
  legendPercent: { color: "#667085", fontWeight: "600" },
  listHeading: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginBottom: 11, marginTop: 25 },
  heading: { color: "#101828", fontSize: 18, fontWeight: "800" },
  headingCopy: { color: "#667085", fontSize: 12, marginTop: 3 },
  allLink: { color: "#1D4ED8", fontSize: 13, fontWeight: "800" },
  itemCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 11, marginBottom: 9, padding: 13 },
  itemIcon: { alignItems: "center", borderRadius: 12, height: 43, justifyContent: "center", overflow: "hidden", width: 43 },
  itemImage: { height: "100%", width: "100%" },
  itemCopy: { flex: 1, gap: 4 },
  itemTitleRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  itemName: { color: "#101828", flexShrink: 1, fontSize: 16, fontWeight: "700" },
  itemCategory: { color: "#1D4ED8", fontSize: 11, fontWeight: "800" },
  itemMeta: { color: "#667085", fontSize: 12 },
  itemStatus: { fontSize: 12, fontWeight: "800", maxWidth: 82, textAlign: "right" },
  emptyCard: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, padding: 28 },
  emptyIcon: { alignItems: "center", backgroundColor: "#DCFCE7", borderRadius: 30, height: 56, justifyContent: "center", width: 56 },
  emptyTitle: { color: "#344054", fontSize: 17, fontWeight: "800", marginTop: 13, textAlign: "center" },
  emptyCopy: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: "center" },
  emptyButton: { alignItems: "center", backgroundColor: "#1D4ED8", borderRadius: 12, flexDirection: "row", gap: 7, marginTop: 17, paddingHorizontal: 15, paddingVertical: 11 },
  emptyButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
