import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Slider from "@react-native-community/slider";

import { ScreenContainer } from "@/components/screen-container";
import { ProductFlowStepper } from "@/components/product-flow-stepper";
import { getBarcodeScanDestination, PRODUCT_BARCODE_TYPES, type ScannerMode } from "@/lib/barcode-scanner";
import { findProductByCode } from "@/lib/inventory";
import { useInventory } from "@/lib/inventory-context";

// ไฟล์เสียงขนาดเล็กในเครื่อง ไม่พึ่งพาเครือข่ายระหว่างสแกน
const scanSuccessSound = require("@/assets/audio/scan-success.wav");

export default function ScannerScreen() {
  const { mode = "manage", shelf, row, category, quantity, imageUri } = useLocalSearchParams<{ mode?: ScannerMode; shelf?: string; row?: string; category?: string; quantity?: string; imageUri?: string }>();
  const { products } = useInventory();
  const [permission, requestPermission] = useCameraPermissions();
  const [hasScanned, setHasScanned] = useState(false);
  const [isEmbeddedCameraOpen, setIsEmbeddedCameraOpen] = useState(Platform.OS !== "web");
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(0);
  const [manualCode, setManualCode] = useState("");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [showScanSuccess, setShowScanSuccess] = useState(false);
  const scanSuccessAnimation = useRef(new Animated.Value(0)).current;
  const scanLineAnimation = useRef(new Animated.Value(0)).current;
  const hasHandledCode = useRef(false);
  const scanCooldownUntil = useRef(0);
  const scanSuccessPlayer = useAudioPlayer(scanSuccessSound);

  useEffect(() => {
    if (Platform.OS !== "web" && permission?.granted) setIsEmbeddedCameraOpen(true);
  }, [permission?.granted]);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const isScanning = !hasScanned && !showScanSuccess && (Platform.OS === "web" || isEmbeddedCameraOpen);
    if (!isScanning) {
      scanLineAnimation.stopAnimation();
      scanLineAnimation.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnimation, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(scanLineAnimation, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasScanned, isEmbeddedCameraOpen, scanLineAnimation, showScanSuccess]);

  const playScanSuccessSound = useCallback(() => {
    void scanSuccessPlayer.seekTo(0)
      .catch(() => undefined)
      .then(() => scanSuccessPlayer.play())
      .catch(() => undefined);
  }, [scanSuccessPlayer]);

  const handleScannedCode = useCallback((rawCode: string) => {
    const trimmedCode = rawCode.trim();
    if (hasHandledCode.current || Date.now() < scanCooldownUntil.current) return;
    if (!trimmedCode) return;
    const matchingProduct = findProductByCode(products, trimmedCode);
    const destination = getBarcodeScanDestination({ mode, scannedCode: trimmedCode, matchingProductId: matchingProduct?.id, shelf, row, category, quantity, imageUri });
    if (!destination) {
      setScanMessage("ยังไม่พบรหัสสินค้า โปรดลองสแกนใหม่หรือกรอกรหัสด้วยตนเอง");
      return;
    }

    hasHandledCode.current = true;
    if (Platform.OS !== "web") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    playScanSuccessSound();
    setManualCode(destination.kind === "form" ? destination.scannedCode : trimmedCode);
    setHasScanned(true);
    setIsEmbeddedCameraOpen(false);
    setShowScanSuccess(true);
    scanSuccessAnimation.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(scanSuccessAnimation, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scanSuccessAnimation, { toValue: 1, friction: 7, tension: 95, useNativeDriver: true }),
      ]),
      Animated.delay(520),
    ]).start(() => {
      setShowScanSuccess(false);
      if (destination.kind === "product") {
        router.replace({ pathname: "/product/[id]", params: { id: destination.productId } });
        return;
      }
      router.push({ pathname: "/product-form", params: { ...destination } });
    });
  }, [category, imageUri, mode, playScanSuccessSound, products, quantity, row, scanSuccessAnimation, shelf]);

  const handleBarcodeScanned = useCallback(({ data }: BarcodeScanningResult) => handleScannedCode(data), [handleScannedCode]);

  const resetScanner = useCallback(() => {
    hasHandledCode.current = false;
    scanCooldownUntil.current = 0;
    setHasScanned(false);
    setScanMessage(null);
    setShowScanSuccess(false);
    scanSuccessAnimation.setValue(0);
  }, [scanSuccessAnimation]);

  const openEmbeddedScanner = useCallback(() => {
    if (Platform.OS === "web") return;
    resetScanner();
    setCameraZoom(0);
    setIsEmbeddedCameraOpen(true);
  }, [resetScanner]);

  const adjustCameraZoom = useCallback((delta: number) => {
    setCameraZoom((current) => Math.min(0.75, Math.max(0, Number((current + delta).toFixed(2)))));
  }, []);

  const resetCameraZoom = useCallback(() => setCameraZoom(0), []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = CameraView.onModernBarcodeScanned((event) => handleScannedCode(event.data));
    return () => subscription.remove();
  }, [handleScannedCode]);

  const submitManualCode = () => {
    if (!manualCode.trim()) {
      Alert.alert("กรอกรหัสสินค้า", "พิมพ์หรือวางรหัสบาร์โค้ดก่อนกดค้นหา");
      return;
    }
    handleScannedCode(manualCode);
  };

  if (!permission) {
    return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1F6F5B" /></ScreenContainer>;
  }

  if (!permission.granted) {
    return <PermissionFallback mode={mode} manualCode={manualCode} onChangeManualCode={setManualCode} onSubmitManualCode={submitManualCode} onRequestCamera={requestPermission} />;
  }

  if (Platform.OS !== "web") {
    return <NativeScannerScreen mode={mode} showEmbeddedCamera={isEmbeddedCameraOpen} showScanSuccess={showScanSuccess} scanSuccessAnimation={scanSuccessAnimation} scanLineAnimation={scanLineAnimation} zoom={cameraZoom} hasScanned={hasScanned} manualCode={manualCode} scanMessage={scanMessage} onChangeManualCode={setManualCode} onOpenScanner={openEmbeddedScanner} onZoomIn={() => adjustCameraZoom(0.25)} onZoomOut={() => adjustCameraZoom(-0.25)} onZoomChange={setCameraZoom} onResetZoom={resetCameraZoom} onCloseEmbeddedCamera={() => setIsEmbeddedCameraOpen(false)} onBarcodeScanned={handleBarcodeScanned} onSubmitManualCode={submitManualCode} />;
  }

  return (
    <View style={styles.fullScreen}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={isTorchOn} barcodeScannerSettings={{ barcodeTypes: PRODUCT_BARCODE_TYPES }} onBarcodeScanned={hasScanned ? undefined : handleBarcodeScanned} />
      <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-transparent" safeAreaClassName="bg-transparent" showAppBackground={false}>
        <View style={styles.overlay}>
          <View style={styles.topBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="ปิดกล้อง" onPress={() => router.back()} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}><MaterialIcons name="close" size={24} color="#FFFFFF" /></Pressable>
            <View style={styles.modeBadge}><Text style={styles.modeBadgeText}>{mode === "name" ? "ชื่อสินค้า" : mode === "form" ? "เพิ่มสินค้า" : "ค้นหาสินค้า"}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={isTorchOn ? "ปิดไฟฉาย" : "เปิดไฟฉาย"} onPress={() => setIsTorchOn((current) => !current)} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}><MaterialIcons name={isTorchOn ? "flash-on" : "flash-off"} size={22} color="#FFFFFF" /></Pressable>
          </View>
          <ProductFlowStepper activeStep="scan" dark />
          <View style={styles.scannerContent}>
            <Text style={styles.scannerTitle}>สแกนบาร์โค้ด</Text>
            <Text style={styles.scannerCopy}>วางเส้นบาร์โค้ดในกรอบให้เต็มและถือโทรศัพท์นิ่ง 1–2 วินาที</Text>
            <View style={styles.scanFrame}><View style={[styles.corner, styles.cornerTopLeft]} /><View style={[styles.corner, styles.cornerTopRight]} /><View style={[styles.corner, styles.cornerBottomLeft]} /><View style={[styles.corner, styles.cornerBottomRight]} />{!showScanSuccess ? <ScanningLine animation={scanLineAnimation} /> : null}</View>
          </View>
          {showScanSuccess ? <ScanSuccessOverlay animation={scanSuccessAnimation} /> : null}
          <ManualCodeEntry value={manualCode} onChangeText={setManualCode} onSubmit={submitManualCode} dark />
        </View>
      </ScreenContainer>
    </View>
  );
}

function NativeScannerScreen({ mode, showEmbeddedCamera, showScanSuccess, scanSuccessAnimation, scanLineAnimation, zoom, hasScanned, manualCode, scanMessage, onChangeManualCode, onOpenScanner, onZoomIn, onZoomOut, onZoomChange, onResetZoom, onCloseEmbeddedCamera, onBarcodeScanned, onSubmitManualCode }: { mode: ScannerMode; showEmbeddedCamera: boolean; showScanSuccess: boolean; scanSuccessAnimation: Animated.Value; scanLineAnimation: Animated.Value; zoom: number; hasScanned: boolean; manualCode: string; scanMessage: string | null; onChangeManualCode: (value: string) => void; onOpenScanner: () => void; onZoomIn: () => void; onZoomOut: () => void; onZoomChange: (value: number) => void; onResetZoom: () => void; onCloseEmbeddedCamera: () => void; onBarcodeScanned: (result: BarcodeScanningResult) => void; onSubmitManualCode: () => void }) {
  return <ScreenContainer edges={["top", "bottom", "left", "right"]}><View style={styles.nativeContent}><View style={styles.nativeHeader}><Pressable accessibilityRole="button" accessibilityLabel="กลับ" onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={22} color="#1F6F5B" /></Pressable><View style={styles.nativeHeaderCopy}><Text style={styles.nativeEyebrow}>{mode === "name" ? "เติมชื่อสินค้า" : mode === "form" ? "เพิ่มรหัสสินค้า" : "ค้นหาสินค้า"}</Text><Text style={styles.nativeTitle}>สแกนบาร์โค้ด</Text></View></View><ProductFlowStepper activeStep="scan" />{showEmbeddedCamera ? <View style={styles.embeddedCameraCard}><CameraView style={styles.embeddedCamera} facing="back" zoom={zoom} barcodeScannerSettings={{ barcodeTypes: PRODUCT_BARCODE_TYPES }} onBarcodeScanned={hasScanned ? undefined : onBarcodeScanned} /><View style={styles.embeddedScanFrame}><View style={[styles.corner, styles.cornerTopLeft]} /><View style={[styles.corner, styles.cornerTopRight]} /><View style={[styles.corner, styles.cornerBottomLeft]} /><View style={[styles.corner, styles.cornerBottomRight]} />{!showScanSuccess ? <ScanningLine animation={scanLineAnimation} /> : null}</View><View style={styles.zoomControls}><Pressable accessibilityRole="button" accessibilityLabel="ลดซูม" onPress={onZoomOut} style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]}><MaterialIcons name="remove" size={20} color="#FFFFFF" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="รีเซ็ตซูม" onPress={onResetZoom} style={({ pressed }) => [styles.zoomValue, pressed && styles.pressed]}><Text style={styles.zoomValueText}>{`${(1 + zoom * 2).toFixed(1)}x`}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="เพิ่มซูม" onPress={onZoomIn} style={({ pressed }) => [styles.zoomButton, pressed && styles.pressed]}><MaterialIcons name="add" size={20} color="#FFFFFF" /></Pressable></View><View style={styles.zoomSliderRow}><Text style={styles.zoomSliderLabel}>1.0x</Text><Slider accessibilityLabel="แถบเลื่อนปรับซูมกล้อง" minimumValue={0} maximumValue={0.75} step={0.01} value={zoom} onValueChange={onZoomChange} minimumTrackTintColor="#34D399" maximumTrackTintColor="rgba(255,255,255,0.42)" thumbTintColor="#FFFFFF" style={styles.zoomSlider} /><Text style={styles.zoomSliderLabel}>2.5x</Text></View><View style={styles.embeddedCameraOverlay}><Text style={styles.embeddedCameraHint}>ปรับซูมให้ชื่อสินค้าเต็มกรอบ แล้วถือให้นิ่ง</Text><Pressable accessibilityRole="button" onPress={onCloseEmbeddedCamera} style={({ pressed }) => [styles.embeddedCloseButton, pressed && styles.pressed]}><Text style={styles.embeddedCloseText}>ปิดกล้อง</Text></Pressable></View></View> : null}<View style={styles.scannerHero}><View style={styles.scannerHeroIcon}><MaterialIcons name="qr-code-scanner" size={42} color="#1F6F5B" /></View><Text style={styles.scannerHeroTitle}>{showEmbeddedCamera ? "ใช้กล้องในหน้านี้" : "สแกนได้ง่ายขึ้น"}</Text><Text style={styles.scannerHeroCopy}>{showEmbeddedCamera ? "วางบาร์โค้ดในกรอบด้านบน กล้องจะอ่านให้อัตโนมัติ" : "เปิดกล้องในหน้านี้ได้ทันที รองรับ EAN, UPC และ Code 128"}</Text><Pressable accessibilityRole="button" onPress={onOpenScanner} style={({ pressed }) => [styles.primaryScanButton, pressed && styles.pressed]}><MaterialIcons name="center-focus-strong" size={22} color="#FFFFFF" /><Text style={styles.primaryScanButtonText}>{showEmbeddedCamera ? "เริ่มสแกนใหม่" : "เปิดกล้องสแกน"}</Text></Pressable></View>{scanMessage ? <View style={styles.scanMessage}><MaterialIcons name="info-outline" size={19} color="#9A3412" /><Text style={styles.scanMessageText}>{scanMessage}</Text></View> : null}<View style={styles.tipsCard}><Text style={styles.tipsTitle}>สแกนให้ติดเร็ว</Text><Text style={styles.tipLine}>1. ใช้แสงสว่าง และหลีกเลี่ยงแสงสะท้อนบนฉลาก</Text><Text style={styles.tipLine}>2. ให้เส้นบาร์โค้ดเต็มกรอบ ไม่เอียง และถือให้นิ่ง</Text><Text style={styles.tipLine}>3. ถ้าอ่านไม่ติด ให้กดเปิดกล้องใหม่หรือกรอกรหัสด้านล่าง</Text></View>{showScanSuccess ? <ScanSuccessOverlay animation={scanSuccessAnimation} /> : null}<ManualCodeEntry value={manualCode} onChangeText={onChangeManualCode} onSubmit={onSubmitManualCode} /></View></ScreenContainer>;
}

function ScanningLine({ animation }: { animation: Animated.Value }) {
  const translateY = animation.interpolate({ inputRange: [0, 1], outputRange: [4, 246] });
  return <Animated.View pointerEvents="none" style={[styles.scanningLine, { transform: [{ translateY }] }]}><View style={styles.scanningLineGlow} /></Animated.View>;
}

function ScanSuccessOverlay({ animation }: { animation: Animated.Value }) {
  const scale = animation.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] });
  return <Animated.View style={[styles.scanSuccessOverlay, { opacity: animation, transform: [{ scale }] }]} accessibilityLiveRegion="polite"><View style={styles.scanSuccessCircle}><MaterialIcons name="check" size={42} color="#FFFFFF" /></View><Text style={styles.scanSuccessTitle}>สแกนสำเร็จ</Text><Text style={styles.scanSuccessCopy}>กำลังเปิดข้อมูลสินค้า</Text></Animated.View>;
}

function PermissionFallback({ mode, manualCode, onChangeManualCode, onSubmitManualCode, onRequestCamera }: { mode: ScannerMode; manualCode: string; onChangeManualCode: (value: string) => void; onSubmitManualCode: () => void; onRequestCamera: () => void }) {
  return <ScreenContainer edges={["top", "bottom", "left", "right"]} className="px-6"><View style={styles.permissionContent}><View style={styles.permissionIcon}><MaterialIcons name="photo-camera" size={34} color="#1F6F5B" /></View><Text style={styles.permissionTitle}>อนุญาตให้ใช้กล้อง</Text><Text style={styles.permissionCopy}>อนุญาตเพียงครั้งเดียวเพื่อใช้ตัวสแกนแบบเร็ว หรือกรอกรหัสสินค้าแทนได้ทันที</Text><Pressable accessibilityRole="button" onPress={onRequestCamera} style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}><Text style={styles.permissionButtonText}>อนุญาตการใช้กล้อง</Text></Pressable><View style={styles.manualFallback}><Text style={styles.fallbackLabel}>{mode === "form" ? "ไม่มีสิทธิ์กล้อง? กรอกรหัสเพื่อนำไปใส่ในฟอร์ม" : "ไม่มีสิทธิ์กล้อง? กรอกรหัสเพื่อค้นหาสินค้า"}</Text><ManualCodeEntry value={manualCode} onChangeText={onChangeManualCode} onSubmit={onSubmitManualCode} /></View><Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [styles.cancelLink, pressed && styles.pressed]}><Text style={styles.cancelLinkText}>กลับ</Text></Pressable></View></ScreenContainer>;
}

function ManualCodeEntry({ value, onChangeText, onSubmit, dark = false }: { value: string; onChangeText: (value: string) => void; onSubmit: () => void; dark?: boolean }) {
  return <View style={[styles.manualEntry, dark && styles.manualEntryDark]}><Text style={[styles.manualLabel, dark && styles.manualLabelDark]}>กรอกหรือวางรหัสแทนการสแกน</Text><View style={styles.manualRow}><TextInput accessibilityLabel="รหัสบาร์โค้ดสินค้า" value={value} onChangeText={onChangeText} onSubmitEditing={onSubmit} placeholder="เช่น 8851234567890" placeholderTextColor={dark ? "#D0D5DD" : "#98A2B3"} style={[styles.manualInput, dark && styles.manualInputDark]} returnKeyType="search" autoCapitalize="characters" /><Pressable accessibilityRole="button" accessibilityLabel="ค้นหาจากรหัสสินค้า" onPress={onSubmit} style={({ pressed }) => [styles.manualSubmit, pressed && styles.pressed]}><MaterialIcons name="arrow-forward" size={21} color="#FFFFFF" /></Pressable></View></View>;
}

const styles = StyleSheet.create({
  fullScreen: { backgroundColor: "#101828", flex: 1 },
  overlay: { backgroundColor: "rgba(16,24,40,0.44)", flex: 1, padding: 20 },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  closeButton: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.68)", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  modeBadge: { backgroundColor: "rgba(16,24,40,0.68)", borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  modeBadgeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  scannerContent: { alignItems: "center", flex: 1, justifyContent: "center", marginTop: -24 },
  scanStepIndicator: { alignItems: "center", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 18, paddingHorizontal: 12, paddingVertical: 10, width: "92%" },
  scanStepIndicatorPrimary: { backgroundColor: "#ECFDF3", borderColor: "#A7F3D0" },
  scanStepIndicatorSecondary: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  scanStepIcon: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  scanStepCopy: { flex: 1 },
  scanStepKicker: { color: "#667085", fontSize: 10, fontWeight: "700" },
  scanStepTitle: { fontSize: 15, fontWeight: "800", marginTop: 1 },
  scanStepTitlePrimary: { color: "#166534" },
  scanStepTitleSecondary: { color: "#1D4ED8" },
  scanStepDot: { borderRadius: 5, height: 10, width: 10 },
  scanStepDotPrimary: { backgroundColor: "#16A34A" },
  scanStepDotSecondary: { backgroundColor: "#2563EB" },
  scannerTitle: { color: "#FFFFFF", fontSize: 25, fontWeight: "800" },
  scannerCopy: { color: "#EAECF0", fontSize: 14, lineHeight: 20, marginTop: 8, maxWidth: 275, textAlign: "center" },
  scanFrame: { borderColor: "#FFFFFF", borderRadius: 26, borderWidth: 2, height: 270, marginTop: 24, maxWidth: 430, overflow: "hidden", width: "94%" },
  corner: { borderColor: "#FDD25D", height: 36, position: "absolute", width: 36 },
  cornerTopLeft: { borderLeftWidth: 4, borderTopWidth: 4, left: -1, top: -1 },
  cornerTopRight: { borderRightWidth: 4, borderTopWidth: 4, right: -1, top: -1 },
  cornerBottomLeft: { borderBottomWidth: 4, borderLeftWidth: 4, bottom: -1, left: -1 },
  cornerBottomRight: { borderBottomWidth: 4, borderRightWidth: 4, bottom: -1, right: -1 },
  nativeContent: { flex: 1, padding: 20 },
  nativeHeader: { alignItems: "center", flexDirection: "row", gap: 12 },
  backButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  nativeHeaderCopy: { flex: 1 },
  nativeEyebrow: { color: "#667085", fontSize: 12, fontWeight: "700" },
  nativeTitle: { color: "#101828", fontSize: 24, fontWeight: "800", marginTop: 2 },
  scannerHero: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#D5E8E1", borderRadius: 22, borderWidth: 1, marginTop: 22, padding: 22 },
  scannerHeroIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 24, height: 76, justifyContent: "center", width: 76 },
  scannerHeroTitle: { color: "#101828", fontSize: 21, fontWeight: "800", marginTop: 15 },
  scannerHeroCopy: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: 7, maxWidth: 295, textAlign: "center" },
  primaryScanButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 19, minHeight: 52, paddingHorizontal: 20, width: "100%" },
  primaryScanButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  scanSuccessOverlay: { alignItems: "center", alignSelf: "center", backgroundColor: "rgba(255,255,255,0.97)", borderColor: "#A7F3D0", borderRadius: 22, borderWidth: 1, elevation: 10, gap: 4, justifyContent: "center", left: 24, paddingHorizontal: 24, paddingVertical: 22, position: "absolute", right: 24, shadowColor: "#065F46", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.18, shadowRadius: 14, top: "35%", zIndex: 20 },
  scanSuccessCircle: { alignItems: "center", backgroundColor: "#16A34A", borderRadius: 34, height: 68, justifyContent: "center", marginBottom: 5, width: 68 },
  scanSuccessTitle: { color: "#166534", fontSize: 20, fontWeight: "800" },
  scanSuccessCopy: { color: "#667085", fontSize: 12, textAlign: "center" },
  skipSecondaryButton: { alignItems: "center", minHeight: 38, justifyContent: "center", marginTop: 8, paddingHorizontal: 12 },
  skipSecondaryText: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  embeddedCameraCard: { backgroundColor: "#101828", borderColor: "#D0D5DD", borderRadius: 22, borderWidth: 2, height: 330, marginTop: 15, overflow: "hidden" },
  embeddedCamera: { flex: 1 },
  embeddedScanFrame: { borderColor: "rgba(255,255,255,0.92)", borderRadius: 24, borderWidth: 2, bottom: 32, height: 250, left: "7%", overflow: "hidden", position: "absolute", right: "7%", top: 32 },
  scanningLine: { backgroundColor: "#34D399", height: 3, left: 12, position: "absolute", right: 12, shadowColor: "#6EE7B7", shadowOpacity: 0.95, shadowRadius: 8, top: 0 },
  scanningLineGlow: { backgroundColor: "rgba(167,243,208,0.85)", height: 14, left: 0, opacity: 0.35, position: "absolute", right: 0, top: -5 },
  embeddedCameraOverlay: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.68)", bottom: 0, flexDirection: "row", justifyContent: "space-between", left: 0, paddingHorizontal: 13, paddingVertical: 10, position: "absolute", right: 0 },
  zoomControls: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.72)", borderRadius: 12, flexDirection: "row", gap: 4, padding: 5, position: "absolute", right: 10, top: 10 },
  zoomButton: { alignItems: "center", borderRadius: 8, height: 32, justifyContent: "center", width: 32 },
  zoomValue: { alignItems: "center", borderColor: "rgba(255,255,255,0.5)", borderRadius: 8, borderWidth: 1, height: 32, justifyContent: "center", minWidth: 48, paddingHorizontal: 6 },
  zoomValueText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  zoomSliderRow: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.72)", borderRadius: 10, bottom: 47, flexDirection: "row", gap: 5, left: 10, paddingHorizontal: 8, paddingVertical: 3, position: "absolute", right: 10 },
  zoomSliderLabel: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", minWidth: 27, textAlign: "center" },
  zoomSlider: { flex: 1, height: 30 },
  embeddedCameraHint: { color: "#FFFFFF", flex: 1, fontSize: 12, lineHeight: 17 },
  embeddedCloseButton: { borderColor: "#FFFFFF", borderRadius: 9, borderWidth: 1, marginLeft: 10, paddingHorizontal: 10, paddingVertical: 6 },
  embeddedCloseText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  scanMessage: { alignItems: "flex-start", backgroundColor: "#FFF4E5", borderRadius: 14, flexDirection: "row", gap: 9, marginTop: 13, padding: 12 },
  scanMessageText: { color: "#7C2D12", flex: 1, fontSize: 12, lineHeight: 18 },
  tipsCard: { backgroundColor: "#F8FAFC", borderColor: "#E4E7EC", borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 15 },
  tipsTitle: { color: "#344054", fontSize: 14, fontWeight: "800", marginBottom: 7 },
  tipLine: { color: "#475467", fontSize: 12, lineHeight: 19 },
  manualEntry: { marginTop: 17 },
  manualEntryDark: { backgroundColor: "rgba(16,24,40,0.72)", borderRadius: 16, marginTop: 0, padding: 13 },
  manualLabel: { color: "#475467", fontSize: 12, fontWeight: "800", marginBottom: 7 },
  manualLabelDark: { color: "#F2F4F7" },
  manualRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  manualInput: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, color: "#101828", flex: 1, fontSize: 15, minHeight: 48, paddingHorizontal: 12 },
  manualInputDark: { backgroundColor: "rgba(255,255,255,0.96)", borderColor: "#FFFFFF" },
  manualSubmit: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 12, height: 48, justifyContent: "center", width: 48 },
  permissionContent: { alignItems: "center", flex: 1, justifyContent: "center" },
  permissionIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 32, height: 64, justifyContent: "center", width: 64 },
  permissionTitle: { color: "#101828", fontSize: 22, fontWeight: "800", marginTop: 16 },
  permissionCopy: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 7, textAlign: "center" },
  permissionButton: { backgroundColor: "#1F6F5B", borderRadius: 14, marginTop: 22, paddingHorizontal: 17, paddingVertical: 13 },
  permissionButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  manualFallback: { alignSelf: "stretch", marginTop: 18 },
  fallbackLabel: { color: "#667085", fontSize: 12, lineHeight: 18 },
  cancelLink: { marginTop: 16, padding: 10 },
  cancelLinkText: { color: "#475467", fontSize: 14, fontWeight: "700" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
