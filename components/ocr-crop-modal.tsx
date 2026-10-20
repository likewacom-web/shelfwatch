import * as ImageManipulator from "expo-image-manipulator";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

const CANVAS_SIZE = 320;
const MIN_CROP_SIZE = 72;

type CropRect = { left: number; top: number; width: number; height: number };
type CropBounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

type OcrCropModalProps = {
  visible: boolean;
  asset: { uri: string; width?: number; height?: number; exif?: Record<string, unknown> | null } | null;
  onCancel: () => void;
  onConfirm: (asset: { uri: string; base64?: string }) => Promise<void>;
  onAutoCrop?: (asset: WorkingAsset) => Promise<{ x: number; y: number; width: number; height: number; confidence: number }>;
  onBoxDecision?: (event: { eventType: "selection" | "finalize"; userChoice: "auto" | "manual"; confidence: number | null; suggestedBox: CropBox | null; finalBox: CropBox | null; note: string }) => void;
};

type WorkingAsset = { uri: string; width?: number; height?: number; exif?: Record<string, unknown> | null };
type CropBox = { x: number; y: number; width: number; height: number };

const MAX_WORKING_SIDE = 2400;
const OCR_TARGET_WIDTH = 1600;

/**
 * Re-encode the photo so its pixels are upright and not oversized.
 * expo-image-manipulator already applies EXIF orientation when it loads an image
 * (Glide on Android, fixOrientation on iOS). The old code rotated again by hand,
 * so labels shot in portrait came out sideways and OCR could not read them.
 */
async function prepareWorkingImage(asset: WorkingAsset): Promise<WorkingAsset> {
  const upright = await ImageManipulator.manipulateAsync(asset.uri, [], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG });
  const longSide = Math.max(upright.width, upright.height);
  if (longSide <= MAX_WORKING_SIDE) return { uri: upright.uri, width: upright.width, height: upright.height };
  const resize = upright.width >= upright.height ? { width: MAX_WORKING_SIDE } : { height: MAX_WORKING_SIDE };
  const scaled = await ImageManipulator.manipulateAsync(upright.uri, [{ resize }], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: scaled.uri, width: scaled.width, height: scaled.height };
}

function clampCrop(rect: CropRect, bounds: CropBounds): CropRect {
  const width = Math.max(MIN_CROP_SIZE, Math.min(rect.width, bounds.right - bounds.left));
  const height = Math.max(MIN_CROP_SIZE, Math.min(rect.height, bounds.bottom - bounds.top));
  return {
    width,
    height,
    left: Math.max(bounds.left, Math.min(rect.left, bounds.right - width)),
    top: Math.max(bounds.top, Math.min(rect.top, bounds.bottom - height)),
  };
}

function confidenceFrameStyle(confidence: number) {
  if (confidence >= 0.75) return { borderColor: "#22C55E" };
  if (confidence >= 0.45) return { borderColor: "#F59E0B" };
  return { borderColor: "#EF4444" };
}

export function OcrCropModal({ visible, asset, onCancel, onConfirm, onAutoCrop, onBoxDecision }: OcrCropModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoCropping, setIsAutoCropping] = useState(false);
  const [autoCropDetected, setAutoCropDetected] = useState(false);
  const [autoCropConfidence, setAutoCropConfidence] = useState<number | null>(null);
  const [suggestedBox, setSuggestedBox] = useState<CropBox | null>(null);
  const [manualNote, setManualNote] = useState("");
  const [originalAsset, setOriginalAsset] = useState<WorkingAsset | null>(asset);
  const [workingAsset, setWorkingAsset] = useState<WorkingAsset | null>(asset);
  const [hasRotation, setHasRotation] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const cropRef = useRef<CropRect | null>(null);
  const dragStart = useRef<CropRect | null>(null);
  const resizeStart = useRef<CropRect | null>(null);

  const imageSize = useMemo(() => {
    const width = workingAsset?.width || 1;
    const height = workingAsset?.height || 1;
    const scale = Math.min(CANVAS_SIZE / width, CANVAS_SIZE / height);
    const renderedWidth = width * scale;
    const renderedHeight = height * scale;
    return {
      scale,
      width: renderedWidth,
      height: renderedHeight,
      left: (CANVAS_SIZE - renderedWidth) / 2,
      top: (CANVAS_SIZE - renderedHeight) / 2,
    };
  }, [workingAsset?.height, workingAsset?.width]);

  const bounds = useMemo<CropBounds>(() => ({
    left: imageSize.left,
    top: imageSize.top,
    right: imageSize.left + imageSize.width,
    bottom: imageSize.top + imageSize.height,
    width: imageSize.width,
    height: imageSize.height,
  }), [imageSize.height, imageSize.left, imageSize.top, imageSize.width]);

  useEffect(() => {
    if (!visible || !asset) return;
    setOriginalAsset(asset);
    setWorkingAsset(asset);
    setAutoCropDetected(false);
    setAutoCropConfidence(null);
    setSuggestedBox(null);
    setManualNote("");
    setHasRotation(false);
    setIsProcessing(true);
    void prepareWorkingImage(asset).then((prepared) => {
      setOriginalAsset(prepared);
      setWorkingAsset(prepared);
      setIsProcessing(false);
    }).catch(() => setIsProcessing(false));
  }, [asset, visible]);

  useEffect(() => {
    if (!visible || !workingAsset) return;
    const initial = clampCrop({
      left: bounds.left + bounds.width * 0.1,
      top: bounds.top + bounds.height * 0.25,
      width: bounds.width * 0.8,
      height: Math.max(MIN_CROP_SIZE, bounds.height * 0.35),
    }, bounds);
    cropRef.current = initial;
    setCrop(initial);
  }, [bounds, visible, workingAsset]);

  const rotateImage = async () => {
    if (!workingAsset || isProcessing) return;
    setIsProcessing(true);
    try {
      const rotated = await ImageManipulator.manipulateAsync(
        workingAsset.uri,
        [{ rotate: 90 }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      const rotatedAsset = {
        uri: rotated.uri,
        width: workingAsset.height || rotated.width,
        height: workingAsset.width || rotated.height,
      };
      setWorkingAsset(rotatedAsset);
      setHasRotation(true);
      setAutoCropDetected(false);
      setAutoCropConfidence(null);
      setSuggestedBox(null);
      setManualNote("");
      cropRef.current = null;
      setCrop(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetRotation = () => {
    if (!originalAsset || isProcessing) return;
      setWorkingAsset(originalAsset);
      setHasRotation(false);
      setAutoCropDetected(false);
      setAutoCropConfidence(null);
      setSuggestedBox(null);
      setManualNote("");
    cropRef.current = null;
    setCrop(null);
  };

  const moveResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStart.current = cropRef.current; },
    onPanResponderMove: (_, gesture) => {
      const start = dragStart.current;
      if (!start) return;
      const next = clampCrop({ ...start, left: start.left + gesture.dx, top: start.top + gesture.dy }, bounds);
      cropRef.current = next;
      setCrop(next);
    },
    onPanResponderRelease: () => { dragStart.current = null; },
  }), [bounds]);

  const resizeResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { resizeStart.current = cropRef.current; },
    onPanResponderMove: (_, gesture) => {
      const start = resizeStart.current;
      if (!start) return;
      const next = clampCrop({ ...start, width: start.width + gesture.dx, height: start.height + gesture.dy }, bounds);
      cropRef.current = next;
      setCrop(next);
    },
    onPanResponderRelease: () => { resizeStart.current = null; },
  }), [bounds]);

  const getNormalizedCrop = (): CropBox | null => {
    if (!crop || !bounds.width || !bounds.height) return null;
    return {
      x: Math.max(0, Math.min(1, (crop.left - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (crop.top - bounds.top) / bounds.height)),
      width: Math.max(0, Math.min(1, crop.width / bounds.width)),
      height: Math.max(0, Math.min(1, crop.height / bounds.height)),
    };
  };

  const handleConfirm = async (choice: "auto" | "manual" = "manual") => {
    if (!workingAsset || !crop || isProcessing) return;
    const finalBox = getNormalizedCrop();
    onBoxDecision?.({ eventType: "selection", userChoice: choice, confidence: autoCropConfidence, suggestedBox, finalBox: choice === "auto" ? null : finalBox, note: choice === "manual" ? manualNote : "" });
    setIsProcessing(true);
    try {
      const originX = Math.max(0, Math.round((crop.left - imageSize.left) / imageSize.scale));
      const originY = Math.max(0, Math.round((crop.top - imageSize.top) / imageSize.scale));
      const width = Math.max(1, Math.min((workingAsset.width || 1) - originX, Math.round(crop.width / imageSize.scale)));
      const height = Math.max(1, Math.min((workingAsset.height || 1) - originY, Math.round(crop.height / imageSize.scale)));
      // Crop and scale to a fixed width in one pass: small labels are enlarged so Thai
      // vowels and tone marks stay legible, large crops are reduced so the upload stays small and fast.
      const enhanced = await ImageManipulator.manipulateAsync(
        workingAsset.uri,
        [{ crop: { originX, originY, width, height } }, { resize: { width: OCR_TARGET_WIDTH } }],
        { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      onBoxDecision?.({ eventType: "finalize", userChoice: choice, confidence: autoCropConfidence, suggestedBox, finalBox, note: choice === "manual" ? manualNote : "" });
      await onConfirm({ uri: enhanced.uri, base64: enhanced.base64 });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAutoCrop = async () => {
    if (!workingAsset || !onAutoCrop || isProcessing || isAutoCropping) return;
    setIsAutoCropping(true);
    try {
      const detected = await onAutoCrop(workingAsset);
      const next = clampCrop({
        left: bounds.left + detected.x * bounds.width,
        top: bounds.top + detected.y * bounds.height,
        width: detected.width * bounds.width,
        height: detected.height * bounds.height,
      }, bounds);
      cropRef.current = next;
      setCrop(next);
      setAutoCropDetected(true);
      setAutoCropConfidence(Math.max(0, Math.min(1, detected.confidence)));
      setSuggestedBox({ x: detected.x, y: detected.y, width: detected.width, height: detected.height });
    } catch {
      // Detection failed (network/timeout); the user can still drag the box manually.
    } finally {
      setIsAutoCropping(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>ครอบเฉพาะชื่อสินค้า</Text>
            <Text style={styles.subtitle}>ลากกรอบเพื่อเลื่อน และลากมุมขวาล่างเพื่อปรับขนาด</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="รีเซ็ตการหมุนภาพ" onPress={resetRotation} disabled={isProcessing || !hasRotation} style={({ pressed }) => [styles.rotateButton, hasRotation ? styles.rotateButtonActive : styles.rotateButtonDisabled, pressed && styles.pressed, (isProcessing || !hasRotation) && styles.disabled]}>
              <Text style={[styles.rotateText, !hasRotation && styles.rotateTextDisabled]}>รีเซ็ต</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="หมุนภาพ 90 องศา" onPress={() => void rotateImage()} disabled={isProcessing} style={({ pressed }) => [styles.rotateButton, pressed && styles.pressed, isProcessing && styles.disabled]}>
              <Text style={styles.rotateText}>หมุน 90°</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="ยกเลิกการครอบภาพ" onPress={onCancel} disabled={isProcessing} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
              <Text style={styles.closeText}>ยกเลิก</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.canvas}>
          {workingAsset ? <Image source={{ uri: workingAsset.uri }} style={[styles.image, { width: imageSize.width, height: imageSize.height, left: imageSize.left, top: imageSize.top }]} resizeMode="contain" /> : null}
          {crop ? <>
            <View style={[styles.cropFrame, autoCropDetected && styles.autoCropFrame, autoCropDetected && confidenceFrameStyle(autoCropConfidence ?? 0), { left: crop.left, top: crop.top, width: crop.width, height: crop.height }]} {...moveResponder.panHandlers}>
              <View style={styles.gridVertical} />
              <View style={styles.gridHorizontal} />
              <View style={styles.cornerTopLeft} />
              <View style={styles.cornerTopRight} />
              <View style={styles.cornerBottomLeft} />
              <View {...resizeResponder.panHandlers} style={styles.resizeHandle}><View style={styles.resizeGrip} /></View>
            </View>
          </> : null}
        </View>
        <View style={styles.footer}>
          <Text style={styles.tip}>{autoCropDetected ? `กรอบอัตโนมัติ · ความมั่นใจ ${Math.round((autoCropConfidence ?? 0) * 100)}% · ตรวจสอบกรอบก่อนส่ง OCR` : "แนะนำ: ให้ตัวอักษรชื่อสินค้าอยู่ภายในกรอบและมีขนาดใหญ่ที่สุด"}</Text>
          {onAutoCrop ? <Pressable accessibilityRole="button" accessibilityLabel="ตรวจจับกรอบชื่อสินค้าอัตโนมัติ" onPress={() => void handleAutoCrop()} disabled={!workingAsset || isProcessing || isAutoCropping} style={({ pressed }) => [styles.autoCropButton, pressed && styles.pressed, (!workingAsset || isProcessing || isAutoCropping) && styles.disabled]}>
            {isAutoCropping ? <ActivityIndicator color="#1F6F5B" /> : <Text style={styles.autoCropText}>หากรอบชื่อสินค้าอัตโนมัติ</Text>}
          </Pressable> : null}
          {suggestedBox && !autoCropDetected ? <View style={styles.notePanel}><Text style={styles.noteLabel}>หมายเหตุสาเหตุที่ต้องปรับกรอบเอง (ไม่บังคับ)</Text><TextInput value={manualNote} onChangeText={(value) => setManualNote(value.slice(0, 240))} maxLength={240} multiline numberOfLines={2} placeholder="เช่น กรอบไม่ครอบชื่อสินค้า หรือเลือกป้ายผิด" placeholderTextColor="#98A2B3" style={styles.noteInput} accessibilityLabel="หมายเหตุสาเหตุที่ปรับกรอบเอง" /><Text style={styles.noteCount}>{manualNote.length}/240</Text></View> : null}
          {autoCropDetected ? <View style={styles.autoChoiceRow}><Pressable accessibilityRole="button" accessibilityLabel="ใช้กรอบอัตโนมัติส่งเข้า OCR" onPress={() => void handleConfirm("auto")} disabled={!crop || isProcessing || isAutoCropping} style={({ pressed }) => [styles.confirmButton, styles.choiceButton, pressed && styles.pressed, (!crop || isProcessing || isAutoCropping) && styles.disabled]}><Text style={styles.confirmText}>ใช้กรอบอัตโนมัติ</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="ปรับกรอบเองก่อนส่ง OCR" onPress={() => { onBoxDecision?.({ eventType: "selection", userChoice: "manual", confidence: autoCropConfidence, suggestedBox, finalBox: null, note: "" }); setAutoCropDetected(false); }} disabled={isProcessing || isAutoCropping} style={({ pressed }) => [styles.adjustButton, pressed && styles.pressed, (isProcessing || isAutoCropping) && styles.disabled]}><Text style={styles.adjustText}>ปรับกรอบเอง</Text></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel="ยืนยันการครอบภาพเพื่ออ่าน OCR" onPress={() => void handleConfirm("manual")} disabled={!crop || isProcessing} style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed, (!crop || isProcessing) && styles.disabled]}>
            {isProcessing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.confirmText}>ใช้ภาพนี้อ่าน OCR</Text>}
          </Pressable>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC", padding: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 },
  headerActions: { alignItems: "flex-end", flexDirection: "row", gap: 10 },
  title: { color: "#101828", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 270 },
  closeButton: { paddingVertical: 7, paddingHorizontal: 4 },
  closeText: { color: "#1F6F5B", fontSize: 15, fontWeight: "700" },
  rotateButton: { backgroundColor: "#E8F3EF", borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 },
  rotateButtonActive: { backgroundColor: "#E8F3EF" },
  rotateButtonDisabled: { backgroundColor: "#EAECF0" },
  rotateText: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  rotateTextDisabled: { color: "#98A2B3" },
  canvas: { width: CANVAS_SIZE, height: CANVAS_SIZE, maxWidth: "100%", alignSelf: "center", backgroundColor: "#111827", overflow: "hidden", borderRadius: 16, position: "relative" },
  image: { position: "absolute" },
  cropFrame: { position: "absolute", borderWidth: 2, borderColor: "#FFFFFF", backgroundColor: "rgba(255,255,255,0.06)" },
  autoCropFrame: { borderWidth: 4 },
  gridVertical: { position: "absolute", left: "33.33%", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(255,255,255,0.45)" },
  gridHorizontal: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, backgroundColor: "rgba(255,255,255,0.45)" },
  cornerTopLeft: { position: "absolute", left: -2, top: -2, width: 22, height: 22, borderLeftWidth: 5, borderTopWidth: 5, borderColor: "#34D399" },
  cornerTopRight: { position: "absolute", right: -2, top: -2, width: 22, height: 22, borderRightWidth: 5, borderTopWidth: 5, borderColor: "#34D399" },
  cornerBottomLeft: { position: "absolute", left: -2, bottom: -2, width: 22, height: 22, borderLeftWidth: 5, borderBottomWidth: 5, borderColor: "#34D399" },
  resizeHandle: { position: "absolute", right: -12, bottom: -12, width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  resizeGrip: { width: 16, height: 16, borderRightWidth: 4, borderBottomWidth: 4, borderColor: "#34D399" },
  footer: { marginTop: 18, gap: 14 },
  tip: { color: "#667085", fontSize: 13, lineHeight: 19, textAlign: "center" },
  autoCropButton: { minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#E8F3EF", borderWidth: 1, borderColor: "#9AD5C2" },
  autoCropText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  notePanel: { gap: 6 },
  noteLabel: { color: "#344054", fontSize: 13, fontWeight: "700" },
  noteInput: { minHeight: 58, borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 10, backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 9, color: "#101828", textAlignVertical: "top" },
  noteCount: { color: "#98A2B3", fontSize: 11, textAlign: "right" },
  autoChoiceRow: { flexDirection: "row", gap: 10 },
  choiceButton: { flex: 1 },
  adjustButton: { flex: 1, minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#1F6F5B" },
  adjustText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  confirmButton: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#1F6F5B" },
  confirmText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
});
