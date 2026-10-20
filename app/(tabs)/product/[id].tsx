import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { BatchBadge } from "@/components/batch-badge";
import { useInventory } from "@/lib/inventory-context";
import { formatProductPosition, formatThaiDate, getDateTypeLabel, getDaysRemainingForProduct, getExpiryDateForProduct, getProductCategoryLabel, getProductGradeLabel, getProductGradeTheme, getProductImageUris, getProductLots, getProductStatus, getStatusLabel, type PositionHistoryEntry, type ProductLot } from "@/lib/inventory";
import { createProductBarcode } from "@/lib/product-barcode";

export default function ProductDetailScreen() {
  const { id, openMove } = useLocalSearchParams<{ id: string; openMove?: string }>();
  const { products, settings, deleteLot, deleteProduct, isLoading, relocateProduct, positionHistory, updateLotQuantity } = useInventory();
  const product = products.find((item) => item.id === id);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [hasHandledOpenMove, setHasHandledOpenMove] = useState(false);
  const [destination, setDestination] = useState({ shelf: "", row: "", itemNumber: "" });
  const [editingLot, setEditingLot] = useState<ProductLot | null>(null);
  const [lotQuantityDraft, setLotQuantityDraft] = useState("");
  const productHistory = useMemo(() => positionHistory.filter((entry) => entry.productId === id), [id, positionHistory]);

  const confirmDelete = () => {
    if (!product) return;
    Alert.alert("ลบสินค้า?", `ต้องการลบ “${product.name}” ออกจากรายการใช่หรือไม่`, [
      { text: "ยกเลิก", style: "cancel" },
      {
        text: "ลบสินค้า",
        style: "destructive",
        onPress: async () => {
          await deleteProduct(product.id);
          router.replace("/shelves");
        },
      },
    ]);
  };

  const openMoveDialog = () => {
    if (!product) return;
    setDestination({ shelf: product.shelf, row: product.row, itemNumber: String(product.itemNumber ?? 1) });
    setIsMoveOpen(true);
  };

  const confirmMove = async () => {
    const itemNumber = Number(destination.itemNumber);
    if (!destination.shelf.trim() || !destination.row.trim() || !Number.isInteger(itemNumber) || itemNumber < 1) {
      Alert.alert("ตำแหน่งไม่ถูกต้อง", "โปรดระบุชั้นวางที่ แถวที่ และสินค้าตัวที่เป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
      return;
    }
    if (!product) return;
    await relocateProduct(product.id, { shelf: destination.shelf.trim(), row: destination.row.trim(), itemNumber });
    setIsMoveOpen(false);
  };

  const openLotQuantityEditor = (lot: ProductLot) => {
    setEditingLot(lot);
    setLotQuantityDraft(String(lot.quantity));
  };

  const saveLotQuantity = async () => {
    if (!product || !editingLot) return;
    const quantity = Number(lotQuantityDraft);
    if (!Number.isInteger(quantity) || quantity < 0) {
      Alert.alert("จำนวนไม่ถูกต้อง", "โปรดระบุจำนวนเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
      return;
    }
    await updateLotQuantity(product.id, editingLot.id, quantity);
    setEditingLot(null);
  };

  const confirmDeleteLot = (lot: ProductLot) => {
    if (!product) return;
    Alert.alert(`ลบล็อตที่ ${lot.batchNumber}?`, `ล็อตนี้มีสินค้า ${lot.quantity} หน่วย ข้อมูลล็อตจะถูกลบออกจากสินค้า`, [{ text: "ยกเลิก", style: "cancel" }, { text: "ลบล็อต", style: "destructive", onPress: async () => { const removedProduct = await deleteLot(product.id, lot.id); if (removedProduct) router.replace("/shelves"); } }]);
  };

  useEffect(() => {
    if (openMove === "1" && product && !hasHandledOpenMove) {
      setDestination({ shelf: product.shelf, row: product.row, itemNumber: String(product.itemNumber ?? 1) });
      setIsMoveOpen(true);
      setHasHandledOpenMove(true);
    }
  }, [hasHandledOpenMove, openMove, product]);

  if (isLoading) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1F6F5B" /></ScreenContainer>;
  if (!product) {
    return (
      <ScreenContainer className="items-center justify-center px-6">
        <Text style={styles.notFound}>ไม่พบข้อมูลสินค้านี้</Text>
        <Pressable onPress={() => router.replace("/shelves")} style={styles.returnButton}><Text style={styles.returnButtonText}>กลับไปชั้นวาง</Text></Pressable>
      </ScreenContainer>
    );
  }

  const expiryDate = getExpiryDateForProduct(product);
  const remaining = getDaysRemainingForProduct(product);
  const status = getProductStatus(product, settings.nearExpiryDays);
  const statusColor = status === "expired" ? "#B42318" : status === "urgent" ? "#D97706" : "#2F855A";
  const imageUris = getProductImageUris(product);
  const lots = getProductLots(product);

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="ย้อนกลับ" onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={23} color="#1F6F5B" /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="ลบสินค้า" onPress={confirmDelete} style={({ pressed }) => [styles.deleteIcon, pressed && styles.pressed]}><MaterialIcons name="delete-outline" size={22} color="#B42318" /></Pressable>
        </View>

        <View style={styles.hero}>
          <Pressable disabled={imageUris.length === 0} accessibilityRole="button" accessibilityLabel="เปิดดูรูปสินค้าขนาดใหญ่" onPress={() => setActiveImageIndex(0)} style={({ pressed }) => [styles.heroIcon, pressed && imageUris.length > 0 && styles.pressed]}>{imageUris[0] ? <Image source={{ uri: imageUris[0] }} style={styles.heroProductImage} /> : <MaterialIcons name="inventory-2" size={34} color="#1F6F5B" />}</Pressable>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.quantity}>รวม {product.quantity} หน่วย · {lots.length} ล็อต</Text>
          <View style={[styles.statusPill, { backgroundColor: `${statusColor}18` }]}><Text style={[styles.statusText, { color: statusColor }]}>{getStatusLabel(status, remaining, Boolean(expiryDate))}</Text></View>
          <View style={[styles.gradePill, { backgroundColor: getProductGradeTheme(product.grade).backgroundColor }]}><Text style={[styles.gradePillText, { color: getProductGradeTheme(product.grade).textColor }]}>{getProductGradeLabel(product.grade)}</Text></View>
        </View>

        {imageUris.length > 0 ? <View style={styles.galleryCard}><View style={styles.galleryHeader}><View><Text style={styles.galleryTitle}>รูปสินค้า</Text><Text style={styles.gallerySubtitle}>แตะรูปเพื่อดูขนาดใหญ่</Text></View><Text style={styles.galleryCount}>{imageUris.length} รูป</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryList}>{imageUris.map((uri, index) => <Pressable key={`${uri}-${index}`} accessibilityRole="button" accessibilityLabel={`เปิดดูรูปที่ ${index + 1}`} onPress={() => setActiveImageIndex(index)} style={({ pressed }) => [styles.galleryImageButton, pressed && styles.pressed]}><Image source={{ uri }} style={styles.galleryImage} /><View style={styles.galleryBadge}><Text style={styles.galleryBadgeText}>{index + 1}</Text></View></Pressable>)}</ScrollView></View> : null}

        <View style={styles.infoCard}>
          <InfoRow icon="sell" label="รหัสสินค้า" value={product.productCode || "ไม่ระบุ"} />
          <View style={styles.divider} />
          <InfoRow icon="category" label="หมวดหมู่" value={getProductCategoryLabel(product)} />
          <View style={styles.divider} />
          <InfoRow icon="sell" label="เกรดสินค้า" value={getProductGradeLabel(product.grade)} valueColor={getProductGradeTheme(product.grade).textColor} />
          <View style={styles.divider} />
          <InfoRow icon="layers" label="จำนวนล็อต" value={`${lots.length} ล็อต`} />
          <View style={styles.divider} />
          <InfoRow icon="place" label="ตำแหน่ง" value={formatProductPosition(product)} />
          <View style={styles.divider} />
          <InfoRow icon="event" label={getDateTypeLabel(product.dateType)} value={formatThaiDate(product.date)} />
          <View style={styles.divider} />
          {product.shelfLifeDays ? <><InfoRow icon="timer" label="อายุสินค้า" value={`${product.shelfLifeDays} วัน`} /><View style={styles.divider} /></> : null}
          {product.dateType === "manufactured" && expiryDate ? <><InfoRow icon="event" label="วันหมดอายุ (คำนวณ)" value={formatThaiDate(expiryDate)} /><View style={styles.divider} /></> : null}
          <InfoRow icon="schedule" label={expiryDate ? "จำนวนวันคงเหลือ" : "สถานะวันที่"} value={getStatusLabel(status, remaining, Boolean(expiryDate))} valueColor={statusColor} />
        </View>

        <View style={styles.lotsCard}><View style={styles.lotsHeader}><View><Text style={styles.lotsTitle}>ล็อตภายในสินค้า</Text><Text style={styles.lotsSubtitle}>จำนวนและวันหมดอายุแยกตามล็อต</Text></View><Text style={styles.lotsCount}>{lots.length} ล็อต</Text></View>{lots.map((lot, index) => <LotSummaryRow key={lot.id} lot={lot} nearExpiryDays={settings.nearExpiryDays} showDivider={index > 0} onEditQuantity={() => openLotQuantityEditor(lot)} onDelete={() => confirmDeleteLot(lot)} />)}</View>

        <ProductBarcodeCard productCode={product.productCode} />

        <View style={styles.secondaryActions}>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/product-form", params: { id: product.id, focusLot: "1" } })} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><MaterialIcons name="library-add" size={20} color="#1F6F5B" /><Text style={styles.secondaryButtonText}>เพิ่มล็อตใหม่</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={openMoveDialog} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><MaterialIcons name="drive-file-move" size={20} color="#1F6F5B" /><Text style={styles.secondaryButtonText}>ย้ายตำแหน่ง</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setIsHistoryOpen(true)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><MaterialIcons name="history" size={20} color="#1F6F5B" /><Text style={styles.secondaryButtonText}>ประวัติ</Text></Pressable>
        </View>

        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/product-form", params: { id: product.id } })} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
          <MaterialIcons name="edit" size={20} color="#FFFFFF" />
          <Text style={styles.editText}>แก้ไขสินค้า</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={isMoveOpen} transparent animationType="slide" onRequestClose={() => setIsMoveOpen(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalSheet}>
          <View style={styles.modalHeader}><View><Text style={styles.modalTitle}>ย้ายสินค้า</Text><Text style={styles.modalSubtitle}>กำหนดตำแหน่งใหม่สำหรับ {product.name}</Text></View><Pressable accessibilityRole="button" onPress={() => setIsMoveOpen(false)} style={styles.closeButton}><MaterialIcons name="close" size={22} color="#475467" /></Pressable></View>
          <Text style={styles.modalLabel}>ชั้นวางที่</Text><TextInput value={destination.shelf} onChangeText={(value) => setDestination((current) => ({ ...current, shelf: value }))} style={styles.modalInput} placeholder="เช่น 1" placeholderTextColor="#98A2B3" />
          <Text style={styles.modalLabel}>แถวที่</Text><TextInput value={destination.row} onChangeText={(value) => setDestination((current) => ({ ...current, row: value }))} style={styles.modalInput} placeholder="เช่น 2" placeholderTextColor="#98A2B3" />
          <Text style={styles.modalLabel}>สินค้าตัวที่</Text><TextInput value={destination.itemNumber} onChangeText={(value) => setDestination((current) => ({ ...current, itemNumber: value }))} style={styles.modalInput} keyboardType="number-pad" placeholder="เช่น 1" placeholderTextColor="#98A2B3" />
          <Text style={styles.modalHint}>เมื่อย้าย ระบบจะจัดลำดับสินค้าตัวที่ในแถวปลายทางให้อัตโนมัติ</Text>
          <Pressable accessibilityRole="button" onPress={confirmMove} style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}><MaterialIcons name="drive-file-move" size={20} color="#FFFFFF" /><Text style={styles.confirmButtonText}>ย้ายสินค้า</Text></Pressable>
        </View></View>
      </Modal>

      <Modal visible={isHistoryOpen} transparent animationType="slide" onRequestClose={() => setIsHistoryOpen(false)}>
        <View style={styles.modalOverlay}><View style={styles.modalSheet}>
          <View style={styles.modalHeader}><View><Text style={styles.modalTitle}>ประวัติตำแหน่ง</Text><Text style={styles.modalSubtitle}>การเปลี่ยนตำแหน่งของ {product.name}</Text></View><Pressable accessibilityRole="button" onPress={() => setIsHistoryOpen(false)} style={styles.closeButton}><MaterialIcons name="close" size={22} color="#475467" /></Pressable></View>
          <ScrollView style={styles.historyList} contentContainerStyle={styles.historyContent}>{productHistory.length === 0 ? <View style={styles.emptyHistory}><MaterialIcons name="history" size={28} color="#98A2B3" /><Text style={styles.emptyHistoryText}>ยังไม่มีประวัติการเปลี่ยนแปลง</Text></View> : productHistory.map((entry) => <View key={entry.id} style={styles.historyItem}><View style={styles.historyIcon}><MaterialIcons name={getHistoryIcon(entry.action)} size={19} color="#1F6F5B" /></View><View style={styles.historyCopy}><Text style={styles.historyTitle}>{getHistoryTitle(entry.action)}</Text><Text style={styles.historyText}>{formatHistoryText(entry)}</Text><Text style={styles.historyTime}>{formatHistoryTime(entry.changedAt)}</Text></View></View>)}</ScrollView>
        </View></View>
      </Modal>

      <Modal visible={editingLot !== null} transparent animationType="slide" onRequestClose={() => setEditingLot(null)}>
        <View style={styles.modalOverlay}><View style={styles.modalSheet}><View style={styles.modalHeader}><View><Text style={styles.modalTitle}>แก้ไขจำนวนล็อต</Text><Text style={styles.modalSubtitle}>{editingLot ? `ล็อตที่ ${editingLot.batchNumber}` : ""}</Text></View><Pressable accessibilityRole="button" onPress={() => setEditingLot(null)} style={styles.closeButton}><MaterialIcons name="close" size={22} color="#475467" /></Pressable></View><Text style={styles.modalLabel}>จำนวนสินค้าในล็อต</Text><TextInput autoFocus value={lotQuantityDraft} onChangeText={setLotQuantityDraft} style={styles.modalInput} keyboardType="number-pad" placeholder="เช่น 0" placeholderTextColor="#98A2B3" /><Text style={styles.modalHint}>แก้ไขจำนวนได้ทุกเวลา หรือใช้ปุ่มลบล็อตเพื่อลบล็อตนี้ทันที</Text><Pressable accessibilityRole="button" onPress={saveLotQuantity} style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}><MaterialIcons name="check" size={20} color="#FFFFFF" /><Text style={styles.confirmButtonText}>บันทึกจำนวน</Text></Pressable></View></View>
      </Modal>

      <Modal visible={activeImageIndex !== null} animationType="fade" onRequestClose={() => setActiveImageIndex(null)}>
        <View style={styles.imageViewer}><View style={styles.imageViewerTop}><Pressable accessibilityRole="button" accessibilityLabel="ปิดรูปขนาดใหญ่" onPress={() => setActiveImageIndex(null)} style={({ pressed }) => [styles.viewerCloseButton, pressed && styles.pressed]}><MaterialIcons name="close" size={25} color="#FFFFFF" /></Pressable><Text style={styles.viewerCounter}>{activeImageIndex === null ? "" : `${activeImageIndex + 1} / ${imageUris.length}`}</Text><View style={styles.viewerSpacer} /></View><View style={styles.viewerBody}>{activeImageIndex !== null && activeImageIndex > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="ดูรูปก่อนหน้า" onPress={() => setActiveImageIndex((current) => current === null ? null : current - 1)} style={({ pressed }) => [styles.viewerNav, pressed && styles.pressed]}><MaterialIcons name="chevron-left" size={30} color="#FFFFFF" /></Pressable> : <View style={styles.viewerNavSpacer} />}{activeImageIndex !== null ? <Image source={{ uri: imageUris[activeImageIndex] }} resizeMode="contain" style={styles.fullSizeImage} /> : null}{activeImageIndex !== null && activeImageIndex < imageUris.length - 1 ? <Pressable accessibilityRole="button" accessibilityLabel="ดูรูปถัดไป" onPress={() => setActiveImageIndex((current) => current === null ? null : current + 1)} style={({ pressed }) => [styles.viewerNav, pressed && styles.pressed]}><MaterialIcons name="chevron-right" size={30} color="#FFFFFF" /></Pressable> : <View style={styles.viewerNavSpacer} />}</View></View>
      </Modal>
    </ScreenContainer>
  );
}

function formatPosition(position?: { shelf: string; row: string; itemNumber?: number }) { return position ? `ชั้น ${position.shelf} · แถว ${position.row} · ตัวที่ ${position.itemNumber ?? "—"}` : "—"; }
function formatHistoryTime(value: string) { return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function getHistoryTitle(action: PositionHistoryEntry["action"]) { return action === "insert" ? "แทรกสินค้าในแถว" : action === "move" ? "ย้ายตำแหน่งสินค้า" : action === "reorder" ? "สลับลำดับในแถว" : action === "delete" ? "ลบสินค้า" : "กู้คืนสินค้า"; }
function getHistoryIcon(action: PositionHistoryEntry["action"]) { return action === "insert" ? "playlist-add" : action === "move" ? "drive-file-move" : action === "reorder" ? "swap-vert" : action === "delete" ? "delete-outline" : "settings-backup-restore"; }
function formatHistoryText(entry: PositionHistoryEntry) { return entry.action === "insert" ? `แทรกที่ ${formatPosition(entry.to)} · เลื่อนสินค้าถัดไปในแถว` : entry.action === "delete" ? `ลบจาก ${formatPosition(entry.from)}` : entry.action === "restore" ? `กู้คืนที่ ${formatPosition(entry.to)}` : `${formatPosition(entry.from)} → ${formatPosition(entry.to)}`; }

function InfoRow({ icon, label, value, valueColor = "#101828" }: { icon: "sell" | "category" | "layers" | "place" | "event" | "schedule" | "timer"; label: string; value: string; valueColor?: string }) {
  return <View style={styles.infoRow}><MaterialIcons name={icon} size={21} color="#667085" /><View style={styles.infoCopy}><Text style={styles.infoLabel}>{label}</Text><Text style={[styles.infoValue, { color: valueColor }]}>{value}</Text></View></View>;
}

function LotSummaryRow({ lot, nearExpiryDays, showDivider, onEditQuantity, onDelete }: { lot: ProductLot; nearExpiryDays: number; showDivider: boolean; onEditQuantity: () => void; onDelete: () => void }) { const expiryDate = getExpiryDateForProduct(lot); const remaining = getDaysRemainingForProduct(lot); const status = getProductStatus(lot, nearExpiryDays); const color = status === "expired" ? "#B42318" : status === "urgent" ? "#D97706" : "#2F855A"; return <View style={[styles.lotRow, showDivider && styles.lotRowDivider]}><View style={styles.lotTop}><BatchBadge batchNumber={lot.batchNumber} /><Text style={styles.lotQuantity}>จำนวน {lot.quantity}</Text></View><Text style={styles.lotDate}>{getDateTypeLabel(lot.dateType)} {formatThaiDate(lot.date)}</Text>{lot.dateType === "manufactured" && expiryDate ? <Text style={styles.lotDate}>หมดอายุ {formatThaiDate(expiryDate)}</Text> : null}<Text style={[styles.lotStatus, { color }]}>{getStatusLabel(status, remaining, Boolean(expiryDate))}</Text><View style={styles.lotActions}><Pressable accessibilityRole="button" onPress={onEditQuantity} style={({ pressed }) => [styles.lotActionButton, pressed && styles.pressed]}><MaterialIcons name="edit" size={16} color="#1F6F5B" /><Text style={styles.lotActionText}>แก้จำนวน</Text></Pressable><Pressable accessibilityRole="button" onPress={onDelete} style={({ pressed }) => [styles.lotDeleteButton, pressed && styles.pressed]}><MaterialIcons name="delete-outline" size={16} color="#B42318" /><Text style={styles.lotDeleteText}>ลบล็อต</Text></Pressable></View></View>; }

function ProductBarcodeCard({ productCode }: { productCode: string }) {
  const barcode = createProductBarcode(productCode);
  if (!productCode.trim()) return <View style={styles.noCodeCard}><MaterialIcons name="barcode-reader" size={22} color="#667085" /><Text style={styles.noCodeText}>เพิ่มรหัสสินค้าเพื่อสร้างบาร์โค้ด</Text></View>;
  if (!barcode) return <View style={styles.noCodeCard}><MaterialIcons name="error-outline" size={22} color="#B42318" /><Text style={styles.noCodeText}>รหัสนี้ใช้สร้างบาร์โค้ด Code 128 ไม่ได้</Text></View>;
  return <View style={styles.scanCard}><View style={styles.scanHeader}><View><Text style={styles.scanTitle}>บาร์โค้ดสินค้า</Text><Text style={styles.scanSubtitle}>Code 128 · สแกนเพื่อตรวจสอบสินค้ารายการนี้</Text></View><View style={styles.scanIcon}><MaterialIcons name="barcode-reader" size={22} color="#1F6F5B" /></View></View><View style={styles.barcodeSurface}><View style={styles.barcodeLines}>{barcode.pattern.split("").map((bit, index) => <View key={index} style={[styles.barcodeLine, { width: `${100 / barcode.pattern.length}%`, backgroundColor: bit === "1" ? "#101828" : "#FFFFFF" }]} />)}</View></View><Text style={styles.codeText}>{productCode}</Text></View>;
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 36, paddingHorizontal: 20, paddingTop: 16 },
  topBar: { flexDirection: "row", justifyContent: "space-between" },
  backButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  deleteIcon: { alignItems: "center", backgroundColor: "#FEE4E2", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  hero: { alignItems: "center", paddingVertical: 28 },
  heroIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 26, height: 70, justifyContent: "center", overflow: "hidden", width: 70 },
  heroProductImage: { height: "100%", width: "100%" },
  galleryCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginBottom: 17, padding: 16 },
  galleryHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  galleryTitle: { color: "#344054", fontSize: 16, fontWeight: "800" },
  gallerySubtitle: { color: "#667085", fontSize: 12, marginTop: 3 },
  galleryCount: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  galleryList: { gap: 10, paddingTop: 14 },
  galleryImageButton: { borderRadius: 14, height: 96, overflow: "hidden", position: "relative", width: 96 },
  galleryImage: { height: "100%", width: "100%" },
  galleryBadge: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.65)", borderRadius: 10, bottom: 5, height: 20, justifyContent: "center", position: "absolute", right: 5, width: 20 },
  galleryBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  productName: { color: "#101828", fontSize: 25, fontWeight: "800", marginTop: 14, textAlign: "center" },
  quantity: { color: "#667085", fontSize: 15, marginTop: 5 },
  statusPill: { borderRadius: 999, marginTop: 14, paddingHorizontal: 13, paddingVertical: 7 },
  statusText: { fontSize: 13, fontWeight: "800" },
  gradePill: { borderRadius: 999, marginTop: 8, paddingHorizontal: 13, paddingVertical: 7 },
  gradePillText: { fontSize: 13, fontWeight: "900" },
  infoCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, padding: 18 },
  infoRow: { alignItems: "center", flexDirection: "row", gap: 13, paddingVertical: 3 },
  infoCopy: { flex: 1, gap: 3 },
  infoLabel: { color: "#667085", fontSize: 13 },
  infoValue: { fontSize: 16, fontWeight: "700" },
  divider: { backgroundColor: "#EAECF0", height: 1, marginVertical: 16 },
  lotsCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 17, padding: 17 },
  lotsHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  lotsTitle: { color: "#344054", fontSize: 16, fontWeight: "800" },
  lotsSubtitle: { color: "#667085", fontSize: 12, marginTop: 3 },
  lotsCount: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  lotRow: { gap: 5, paddingVertical: 14 },
  lotRowDivider: { borderTopColor: "#EAECF0", borderTopWidth: 1 },
  lotTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  lotQuantity: { color: "#344054", fontSize: 13, fontWeight: "800" },
  lotDate: { color: "#667085", fontSize: 12 },
  lotStatus: { fontSize: 13, fontWeight: "800", marginTop: 2 },
  lotActions: { flexDirection: "row", gap: 8, marginTop: 6 },
  lotActionButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 9, flexDirection: "row", gap: 5, justifyContent: "center", minHeight: 31, paddingHorizontal: 10 },
  lotActionText: { color: "#1F6F5B", fontSize: 12, fontWeight: "800" },
  lotDeleteButton: { alignItems: "center", backgroundColor: "#FEE4E2", borderRadius: 9, flexDirection: "row", gap: 5, justifyContent: "center", minHeight: 31, paddingHorizontal: 10 },
  lotDeleteText: { color: "#B42318", fontSize: 12, fontWeight: "800" },
  scanCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 17, padding: 17 },
  scanHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  scanTitle: { color: "#344054", fontSize: 16, fontWeight: "800" },
  scanSubtitle: { color: "#667085", fontSize: 12, marginTop: 3 },
  scanIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  barcodeSurface: { alignSelf: "stretch", backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 13, borderWidth: 1, marginTop: 16, overflow: "hidden", paddingHorizontal: 12, paddingVertical: 14 },
  barcodeLines: { flexDirection: "row", height: 82, width: "100%" },
  barcodeLine: { height: "100%" },
  codeText: { color: "#475467", fontSize: 12, fontWeight: "700", marginTop: 11, textAlign: "center" },
  noCodeCard: { alignItems: "center", backgroundColor: "#F2F4F7", borderRadius: 15, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 17, padding: 14 },
  noCodeText: { color: "#667085", fontSize: 13, fontWeight: "700" },
  editButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 15, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 23, minHeight: 54 },
  editText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondaryActions: { flexDirection: "row", gap: 10, marginTop: 17 },
  secondaryButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 47 },
  secondaryButtonText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  modalOverlay: { backgroundColor: "rgba(16,24,40,0.48)", flex: 1, justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 25, borderTopRightRadius: 25, maxHeight: "84%", padding: 22 },
  modalHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  modalTitle: { color: "#101828", fontSize: 21, fontWeight: "800" },
  modalSubtitle: { color: "#667085", fontSize: 13, marginTop: 3 },
  closeButton: { alignItems: "center", backgroundColor: "#F2F4F7", borderRadius: 14, height: 36, justifyContent: "center", width: 36 },
  modalLabel: { color: "#344054", fontSize: 14, fontWeight: "700", marginBottom: 7, marginTop: 12 },
  modalInput: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, color: "#101828", fontSize: 16, minHeight: 48, paddingHorizontal: 13 },
  modalHint: { color: "#667085", fontSize: 12, lineHeight: 17, marginTop: 12 },
  confirmButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 20, minHeight: 52 },
  confirmButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  historyList: { maxHeight: 440 },
  historyContent: { gap: 12, paddingBottom: 8 },
  historyItem: { alignItems: "flex-start", backgroundColor: "#F9FAFB", borderRadius: 14, flexDirection: "row", gap: 10, padding: 12 },
  historyIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 11, height: 38, justifyContent: "center", width: 38 },
  historyCopy: { flex: 1, gap: 3 },
  historyTitle: { color: "#344054", fontSize: 14, fontWeight: "800" },
  historyText: { color: "#475467", fontSize: 12, lineHeight: 17 },
  historyTime: { color: "#98A2B3", fontSize: 11, marginTop: 2 },
  emptyHistory: { alignItems: "center", paddingVertical: 34 },
  emptyHistoryText: { color: "#667085", fontSize: 14, marginTop: 10 },
  imageViewer: { backgroundColor: "#101828", flex: 1 },
  imageViewerTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 18 },
  viewerCloseButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 18, height: 44, justifyContent: "center", width: 44 },
  viewerCounter: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  viewerSpacer: { width: 44 },
  viewerBody: { alignItems: "center", flex: 1, flexDirection: "row", justifyContent: "center", paddingVertical: 24 },
  fullSizeImage: { flex: 1, height: "100%" },
  viewerNav: { alignItems: "center", height: 60, justifyContent: "center", width: 42 },
  viewerNavSpacer: { width: 42 },
  returnButton: { backgroundColor: "#1F6F5B", borderRadius: 14, marginTop: 14, paddingHorizontal: 16, paddingVertical: 11 },
  returnButtonText: { color: "#FFFFFF", fontWeight: "700" },
  notFound: { color: "#344054", fontSize: 17, fontWeight: "700" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
