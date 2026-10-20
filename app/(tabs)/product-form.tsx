import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { CameraView, useCameraPermissions } from "expo-camera";
import Slider from "@react-native-community/slider";
import { useAudioPlayer } from "expo-audio";
import { ActivityIndicator, Alert, Animated, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { OcrCropModal } from "@/components/ocr-crop-modal";
import { ProductFlowStepper } from "@/components/product-flow-stepper";
import { useInventory } from "@/lib/inventory-context";
import { persistProductImage } from "@/lib/product-image";
import { GeminiError, describeGeminiError, detectProductNameBox, getGeminiApiKey, readProductLabelImage, saveOcrReport } from "@/lib/gemini-ocr";
import { calculateExpiryDate, createISODateFromParts, findProductAtPosition, findProductByCode, formatDateParts, getDatePartsForInput, findDuplicateBarcode, getNextAvailableItemNumber, getNextBatchNumber, getProductCategories, getProductGradeLabel, getProductGradeTheme, getProductLots, normalizeProductCategory, type DateInputParts, type Product, type ProductDateType, type ProductGrade } from "@/lib/inventory";

type FormValues = {
  name: string;
  category: string;
  grade: ProductGrade;
  productCode: string;
  batchNumber: string;
  quantity: string;
  shelf: string;
  row: string;
  itemNumber: string;
  dateType: ProductDateType;
  date: string;
  shelfLifeDays: string;
  imageUris: string[];
};

type OcrAsset = { uri: string; width?: number; height?: number; base64?: string | null; mimeType?: string };
type OcrReadStatus = "idle" | "reading" | "failed" | "success";
type ToastKind = "ocr" | "saved" | "info" | "warning";
type ToastData = { message: string; kind: ToastKind };
type SaveAction = "save" | "saveAndAdd" | "newLot";

const OCR_REQUEST_TIMEOUT_MS = 60_000;

/** Stop waiting for the server after a while so the screen never spins forever. */
function withOcrTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ocr-timeout")), OCR_REQUEST_TIMEOUT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function normalizeReportedOcrText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const INITIAL_FORM: FormValues = { name: "", category: "", grade: "C", productCode: "", batchNumber: "", quantity: "1", shelf: "", row: "", itemNumber: "", dateType: "expiry", date: "", shelfLifeDays: "", imageUris: [] };
const LABEL_ZOOM_PRESETS = [
  { label: "ปกติ", value: 0 },
  { label: "ฉลากเล็ก", value: 0.5 },
  { label: "ใกล้มาก", value: 1 },
] as const;

export default function ProductFormScreen() {
  const { id, scannedCode, shelf, row, focusField, focusLot, category: categoryParam, quantity: quantityParam, imageUri: imageUriParam } = useLocalSearchParams<{ id?: string; scannedCode?: string; shelf?: string; row?: string; focusField?: "name"; focusLot?: string; category?: string; quantity?: string; imageUri?: string }>();
  const statusSoundPlayer = useAudioPlayer(require("@/assets/audio/scan-success.wav"));
  const { addLotToProduct, addProduct, insertProduct, products, settings, updateProduct, updateSettings, isLoading } = useInventory();
  const editingProduct = useMemo(() => products.find((product) => product.id === id), [id, products]);
  const [form, setForm] = useState<FormValues>(INITIAL_FORM);
  const [dateParts, setDateParts] = useState<DateInputParts>({ day: "", month: "", year: "" });
  const [insertAtPosition, setInsertAtPosition] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReadingLabel, setIsReadingLabel] = useState(false);
  const [ocrDraft, setOcrDraft] = useState("");
  const [isOcrReviewVisible, setIsOcrReviewVisible] = useState(false);
  const [ocrCropAsset, setOcrCropAsset] = useState<OcrAsset | null>(null);
  const [lastOcrAsset, setLastOcrAsset] = useState<OcrAsset | null>(null);
  const [ocrReadAttempt, setOcrReadAttempt] = useState(0);
  const [ocrReadStatus, setOcrReadStatus] = useState<OcrReadStatus>("idle");
  const [ocrSuggestions, setOcrSuggestions] = useState<string[]>([]);
  const [correctedOcrName, setCorrectedOcrName] = useState("");
  const [ocrReportResolved, setOcrReportResolved] = useState(false);
  const [isCheckingOcr, setIsCheckingOcr] = useState(false);
  const [toastMessage, setToastMessage] = useState<ToastData | null>(null);
  const [shouldFocusPrimaryBarcode, setShouldFocusPrimaryBarcode] = useState(false);
  const [isNameFocused, setIsNameFocused] = useState(!editingProduct);
  const [isClearConfirmVisible, setIsClearConfirmVisible] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<SaveAction | null>(null);
  const [isTemplatePickerVisible, setIsTemplatePickerVisible] = useState(false);
  const [templateShelfFilter, setTemplateShelfFilter] = useState("");
  const [templateRowFilter, setTemplateRowFilter] = useState("");
  const [activeTemplateFilterTooltip, setActiveTemplateFilterTooltip] = useState<"shelf" | "row" | null>(null);
  const [isLabelCameraVisible, setIsLabelCameraVisible] = useState(false);
  const [isProductCameraVisible, setIsProductCameraVisible] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [labelCameraZoom, setLabelCameraZoom] = useState(0);
  const [isLabelTorchOn, setIsLabelTorchOn] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastAnimation = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const nameInputRef = useRef<TextInput>(null);
  const primaryBarcodeInputRef = useRef<TextInput>(null);
  const categoryInputRef = useRef<TextInput>(null);
  const lastAppliedScanKey = useRef("");
  const ignoredScannedCode = useRef<string | null>(null);
  const clearNameOpacity = useRef(new Animated.Value(0)).current;
  const templateShelfClearOpacity = useRef(new Animated.Value(0)).current;
  const templateRowClearOpacity = useRef(new Animated.Value(0)).current;
  const autoCopiedName = useRef("");
  const nameReadyHighlight = useRef(new Animated.Value(0)).current;
  const ocrReportTransition = useRef(new Animated.Value(1)).current;
  const previousCorrectedOcrName = useRef("");
  const labelCameraRef = useRef<CameraView>(null);
  const productCameraRef = useRef<CameraView>(null);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (toastDismissTimer.current) clearTimeout(toastDismissTimer.current);
  }, []);

  useEffect(() => {
    Animated.timing(templateShelfClearOpacity, { toValue: templateShelfFilter ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [templateShelfClearOpacity, templateShelfFilter]);

  useEffect(() => {
    Animated.timing(templateRowClearOpacity, { toValue: templateRowFilter ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [templateRowClearOpacity, templateRowFilter]);

  useEffect(() => {
    if (!form.name) {
      clearNameOpacity.setValue(0);
      return;
    }
    clearNameOpacity.setValue(0);
    Animated.timing(clearNameOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [clearNameOpacity, form.name]);

  useEffect(() => {
    Animated.timing(ocrReportTransition, { toValue: ocrReportResolved ? 0 : 1, duration: 220, useNativeDriver: true }).start();
  }, [ocrReportResolved, ocrReportTransition]);

  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (toastDismissTimer.current) clearTimeout(toastDismissTimer.current);
    toastAnimation.stopAnimation();
    toastAnimation.setValue(0);
    setToastMessage({ message, kind });
    Animated.timing(toastAnimation, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastAnimation, { toValue: 0, duration: 280, useNativeDriver: true }).start();
      toastDismissTimer.current = setTimeout(() => setToastMessage(null), 300);
    }, 2200);
  }, [toastAnimation]);

  const playStatusSound = () => {
    void statusSoundPlayer.seekTo(0).then(() => statusSoundPlayer.play()).catch(() => statusSoundPlayer.play());
  };
  const [isReportingOcr, setIsReportingOcr] = useState(false);
  const normalizedOcrText = normalizeReportedOcrText(ocrDraft);
  const normalizedCorrectedOcrName = normalizeReportedOcrText(correctedOcrName);
  const correctedNameMatchesOcr = Boolean(normalizedOcrText && normalizedCorrectedOcrName && normalizedOcrText === normalizedCorrectedOcrName);

  const clearForm = () => setIsClearConfirmVisible(true);

  const requestSaveConfirmation = (action: SaveAction) => setPendingSaveAction(action);

  const confirmPendingSave = () => {
    const action = pendingSaveAction;
    setPendingSaveAction(null);
    if (action === "saveAndAdd") void handleSave(false, true);
    else if (action === "newLot") void handleSave(true);
    else if (action === "save") void handleSave(false);
  };

  const clearScanParams = () => {
    router.setParams({ scannedCode: undefined, focusField: undefined, focusLot: undefined });
  };

  const confirmClearForm = () => {
    ignoredScannedCode.current = scannedCode ?? (form.productCode.trim() || null);
    clearScanParams();
    setIsClearConfirmVisible(false);
    setForm(INITIAL_FORM);
    setDateParts({ day: "", month: "", year: "" });
    setInsertAtPosition(false);
    setOcrDraft("");
    setOcrSuggestions([]);
    setIsOcrReviewVisible(false);
    setOcrCropAsset(null);
    setShouldFocusPrimaryBarcode(true);
    showToast("ล้างฟอร์มแล้ว · พร้อมเริ่มสแกนสินค้าใหม่");
    playStatusSound();
  };

  const focusNameAfterSave = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      nameInputRef.current?.focus();
      if (settings.nameFieldHighlightEnabled) {
        nameReadyHighlight.stopAnimation();
        nameReadyHighlight.setValue(0);
        Animated.sequence([
          Animated.timing(nameReadyHighlight, { toValue: 1, duration: 220, useNativeDriver: false }),
          Animated.delay(550),
          Animated.timing(nameReadyHighlight, { toValue: 0, duration: 650, useNativeDriver: false }),
        ]).start();
      }
    }, 100);
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isClearConfirmVisible) {
        event.preventDefault();
        setIsClearConfirmVisible(false);
      } else if (event.key === "Escape" && pendingSaveAction) {
        event.preventDefault();
        setPendingSaveAction(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isClearConfirmVisible, pendingSaveAction]);

  useEffect(() => {
    if (!shouldFocusPrimaryBarcode) return;
    const focusTimer = setTimeout(() => {
      primaryBarcodeInputRef.current?.focus();
      setShouldFocusPrimaryBarcode(false);
    }, 80);
    return () => clearTimeout(focusTimer);
  }, [shouldFocusPrimaryBarcode]);

  useEffect(() => {
    if (editingProduct) {
      setForm({
        name: editingProduct.name,
          category: editingProduct.category ?? "",
          grade: editingProduct.grade ?? "C",
          productCode: editingProduct.productCode,
        batchNumber: editingProduct.batchNumber ?? "",
        quantity: String(editingProduct.quantity),
        shelf: editingProduct.shelf,
        row: editingProduct.row,
        itemNumber: editingProduct.itemNumber ? String(editingProduct.itemNumber) : "",
        dateType: editingProduct.dateType,
        date: editingProduct.date,
        shelfLifeDays: editingProduct.shelfLifeDays ? String(editingProduct.shelfLifeDays) : "",
        imageUris: editingProduct.imageUris?.length ? editingProduct.imageUris : editingProduct.imageUri ? [editingProduct.imageUri] : [],
      });
      setDateParts(getDatePartsForInput(editingProduct.date));
      setInsertAtPosition(false);
    }
  }, [editingProduct]);

  useEffect(() => {
    if (!scannedCode) return;
    if (ignoredScannedCode.current === scannedCode && !editingProduct) return;
    const matchedProduct = findProductByCode(products, scannedCode);
    const scanKey = `${focusField ?? "code"}:${scannedCode}:${matchedProduct?.id ?? ""}`;
    if (lastAppliedScanKey.current === scanKey) return;
    lastAppliedScanKey.current = scanKey;
    setForm((current) => ({
      ...current,
      productCode: scannedCode,
      ...(focusField === "name" ? { name: matchedProduct?.name ?? scannedCode } : {}),
    }));
  }, [editingProduct, focusField, products, scannedCode]);

  useEffect(() => {
    if (shelf && !editingProduct) setForm((current) => ({ ...current, shelf }));
  }, [editingProduct, shelf]);

  useEffect(() => {
    if (row && !editingProduct) setForm((current) => ({ ...current, row }));
  }, [editingProduct, row]);

  useEffect(() => {
    if (editingProduct) return;
    const latestCategory = normalizeProductCategory(categoryParam ?? settings.latestCategory);
    const nextQuantity = quantityParam && /^\d+$/.test(quantityParam) ? quantityParam : undefined;
    if (!latestCategory && !nextQuantity && !imageUriParam) return;
    setForm((current) => ({
      ...current,
      category: current.category || latestCategory,
      quantity: nextQuantity ?? current.quantity,
      imageUris: imageUriParam && !current.imageUris.includes(imageUriParam) ? [...current.imageUris, imageUriParam].slice(0, 6) : current.imageUris,
    }));
  }, [categoryParam, editingProduct, imageUriParam, quantityParam, settings.latestCategory]);

  const updateField = (field: Exclude<keyof FormValues, "imageUris">, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const updateDatePart = (part: keyof DateInputParts, value: string) => setDateParts((current) => ({ ...current, [part]: value }));
  const dateValue = createISODateFromParts(dateParts);
  const shelfLifeDays = form.shelfLifeDays ? Number(form.shelfLifeDays) : undefined;
  const itemNumber = form.itemNumber ? Number(form.itemNumber) : undefined;
  const calculatedExpiryDate = form.dateType === "manufactured" && dateValue ? calculateExpiryDate(dateValue, shelfLifeDays) : null;
  const suggestedItemNumber = useMemo(() => form.shelf.trim() && form.row.trim() ? getNextAvailableItemNumber(products, form.shelf, form.row, editingProduct?.id) : null, [editingProduct?.id, form.row, form.shelf, products]);
  const suggestedBatchNumber = useMemo(() => getNextBatchNumber(products, form.name, form.productCode, editingProduct?.id), [editingProduct?.id, form.name, form.productCode, products]);
  const productCategories = useMemo(() => [...new Set([...getProductCategories(products), ...(settings.categoryCatalog ?? [])])].sort((first, second) => first.localeCompare(second, "th")), [products, settings.categoryCatalog]);
  const visibleProductCategories = useMemo(() => {
    const query = normalizeProductCategory(form.category).toLocaleLowerCase("th-TH");
    return productCategories.filter((category) => !query || category.toLocaleLowerCase("th-TH").includes(query)).slice(0, 40);
  }, [form.category, productCategories]);
  const nameSuggestions = useMemo(() => {
    const query = form.name.trim().toLocaleLowerCase("th-TH");
    const names = [...new Set(products.map((product) => product.name.trim()).filter(Boolean))];
    return names
      .map((name, index) => ({ name, index, lowerName: name.toLocaleLowerCase("th-TH") }))
      .filter(({ lowerName }) => !query || lowerName.includes(query))
      .sort((first, second) => {
        if (!query) return first.index - second.index;
        const firstStarts = first.lowerName.startsWith(query) ? 0 : 1;
        const secondStarts = second.lowerName.startsWith(query) ? 0 : 1;
        return firstStarts - secondStarts || first.index - second.index;
      })
      .map(({ name }) => name)
      .slice(0, 6);
  }, [form.name, products]);
  const nameAutocompleteSuggestion = useMemo(() => {
    const query = form.name.trim();
    if (!query) return null;
    const lowerQuery = query.toLocaleLowerCase("th-TH");
    return nameSuggestions.find((name) => name.toLocaleLowerCase("th-TH").startsWith(lowerQuery) && name.length > query.length) ?? null;
  }, [form.name, nameSuggestions]);
  const sameNameProducts = useMemo(() => {
    const name = form.name.trim().toLocaleLowerCase("th-TH");
    if (editingProduct || !name || !form.shelf.trim()) return [];
    return products.filter((product) => product.name.trim().toLocaleLowerCase("th-TH") === name && product.shelf.trim() !== form.shelf.trim());
  }, [editingProduct, form.name, form.shelf, products]);
  const sameNameProduct = sameNameProducts.length === 1 ? sameNameProducts[0] : null;
  const filteredTemplateProducts = useMemo(() => {
    const shelfQuery = templateShelfFilter.trim().toLocaleLowerCase("th-TH");
    const rowQuery = templateRowFilter.trim().toLocaleLowerCase("th-TH");
    return sameNameProducts.filter((product) => {
      const shelfMatches = !shelfQuery || product.shelf.trim().toLocaleLowerCase("th-TH").includes(shelfQuery);
      const rowMatches = !rowQuery || product.row.trim().toLocaleLowerCase("th-TH").includes(rowQuery);
      return shelfMatches && rowMatches;
    });
  }, [sameNameProducts, templateRowFilter, templateShelfFilter]);
  const latestProduct = useMemo(() => products.reduce<Product | null>((latest, product) => {
    if (!latest) return product;
    return new Date(product.createdAt).getTime() > new Date(latest.createdAt).getTime() ? product : latest;
  }, null), [products]);

  useEffect(() => {
    if (!editingProduct && suggestedItemNumber && !form.itemNumber) setForm((current) => ({ ...current, itemNumber: String(suggestedItemNumber) }));
  }, [editingProduct, form.itemNumber, suggestedItemNumber]);

  useEffect(() => {
    if (!editingProduct && suggestedBatchNumber && !form.batchNumber) setForm((current) => ({ ...current, batchNumber: String(suggestedBatchNumber) }));
  }, [editingProduct, form.batchNumber, suggestedBatchNumber]);

  useEffect(() => {
    const normalizedName = form.name.trim().toLocaleLowerCase("th-TH");
    if (autoCopiedName.current && autoCopiedName.current !== normalizedName) autoCopiedName.current = "";
    if (!sameNameProduct || autoCopiedName.current === normalizedName) return;
    const sourceImages = sameNameProduct.imageUris?.length ? sameNameProduct.imageUris : sameNameProduct.imageUri ? [sameNameProduct.imageUri] : [];
    const shouldCopyBarcode = !form.productCode.trim() && Boolean(sameNameProduct.productCode.trim());
    const shouldCopyImages = form.imageUris.length === 0 && sourceImages.length > 0;
    if (!shouldCopyBarcode && !shouldCopyImages) {
      autoCopiedName.current = normalizedName;
      return;
    }
    setForm((current) => ({ ...current, productCode: shouldCopyBarcode ? sameNameProduct.productCode : current.productCode, imageUris: shouldCopyImages ? sourceImages.slice(0, 6) : current.imageUris }));
    autoCopiedName.current = normalizedName;
    showToast(`พบชื่อสินค้าเดิมต่างชั้นวาง · เติม${shouldCopyBarcode ? "บาร์โค้ด" : "ข้อมูล"}${shouldCopyImages ? "และรูปภาพ" : ""}แล้ว`);
  }, [form.imageUris.length, form.name, form.productCode, sameNameProduct, showToast]);

  useEffect(() => {
    if (!isTemplatePickerVisible) {
      setTemplateShelfFilter("");
      setTemplateRowFilter("");
    }
  }, [isTemplatePickerVisible]);

  const updateLocationField = (field: "shelf" | "row", value: string) => setForm((current) => ({ ...current, [field]: value, itemNumber: editingProduct ? current.itemNumber : "" }));

  const copyLatestLocation = () => {
    if (!latestProduct?.shelf.trim() || !latestProduct.row.trim()) {
      showToast("ยังไม่มีตำแหน่งจากสินค้าชิ้นล่าสุด");
      return;
    }
    setForm((current) => ({ ...current, shelf: latestProduct.shelf, row: latestProduct.row, itemNumber: editingProduct ? current.itemNumber : "" }));
    showToast(`คัดลอกตำแหน่ง ชั้น ${latestProduct.shelf} · แถว ${latestProduct.row} แล้ว`);
  };

  const applyProductTemplate = (template: Product) => {
    const sourceImages = template.imageUris?.length ? template.imageUris : template.imageUri ? [template.imageUri] : [];
    const shouldCopyBarcode = !form.productCode.trim() && Boolean(template.productCode.trim());
    const shouldCopyImages = form.imageUris.length === 0 && sourceImages.length > 0;
    setForm((current) => ({ ...current, productCode: shouldCopyBarcode ? template.productCode : current.productCode, imageUris: shouldCopyImages ? sourceImages.slice(0, 6) : current.imageUris }));
    autoCopiedName.current = form.name.trim().toLocaleLowerCase("th-TH");
    setIsTemplatePickerVisible(false);
    showToast(`เลือกต้นแบบจากชั้น ${template.shelf} แล้ว · เติมข้อมูลที่ยังว่างให้`);
  };

  const appendSelectedImages = async (uris: string[]) => {
    try {
      const storedUris = await Promise.all(uris.map((uri) => persistProductImage(uri)));
      setForm((current) => ({ ...current, imageUris: [...current.imageUris, ...storedUris].slice(0, 6) }));
      return storedUris;
    } catch {
      Alert.alert("บันทึกรูปไม่สำเร็จ", "ไม่สามารถเก็บรูปสินค้าในอุปกรณ์ได้ โปรดลองอีกครั้ง");
      return [];
    }
  };

  const chooseImage = async () => {
    const remaining = 6 - form.imageUris.length;
    if (remaining <= 0) {
      Alert.alert("เพิ่มรูปครบแล้ว", "สินค้า 1 รายการเก็บรูปได้สูงสุด 6 รูป");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.7 });
    if (!result.canceled) await appendSelectedImages(result.assets.map((asset) => asset.uri));
  };

  const finishProductPhoto = async (uri: string) => {
    const storedUris = await appendSelectedImages([uri]);
    const category = normalizeProductCategory(form.category) || normalizeProductCategory(settings.latestCategory);
    const nextImageUri = storedUris[0] ?? uri;
    setForm((current) => ({ ...current, quantity: "12", ...(category ? { category } : {}) }));
    setIsProductCameraVisible(false);
    router.replace({ pathname: "/scanner", params: { mode: "form", shelf: form.shelf, row: form.row, category: category || undefined, quantity: "12", imageUri: nextImageUri } });
  };

  const reviewOcrName = async (productName: string, lensCandidates: string[] = []) => {
    setOcrDraft(productName);
    setOcrSuggestions([...new Set(lensCandidates.filter(Boolean).filter((candidate) => candidate !== productName))].slice(0, 5));
    setIsOcrReviewVisible(true);
    // The OCR call already returns alternative names, so no second AI request is made here
    // (saves the free Gemini quota).
    setIsCheckingOcr(false);
  };

  const detectYellowLabel = async (asset: OcrAsset) => {
    try {
      // Box detection only needs a preview-sized image; the box is returned in 0-1 coordinates.
      const preview = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: (asset.width ?? 0) >= (asset.height ?? 0) ? { width: 1280 } : { height: 1280 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (!preview.base64) throw new Error("missing-image-data");
      const result = await withOcrTimeout(detectProductNameBox(preview.base64));
      if (result.confidence < 0.25) showToast("ระบบไม่มั่นใจกรอบชื่อสินค้า ลองปรับกรอบด้วยตนเองได้");
      return result;
    } catch (error) {
      showToast(error instanceof GeminiError ? describeGeminiError(error) : "หากรอบอัตโนมัติไม่สำเร็จ ลากกรอบเองได้เลย", "warning");
      throw error;
    }
  };

  const recordBoxDecision = (event: { eventType: "selection" | "finalize"; userChoice: "auto" | "manual"; confidence: number | null; suggestedBox: { x: number; y: number; width: number; height: number } | null; finalBox: { x: number; y: number; width: number; height: number } | null; note: string }) => {
    // Box feedback used to be sent to the Manus server; the standalone app keeps no analytics.
    void event;
  };

  const processProductLabelAsset = async (asset: OcrAsset) => {
    const base64 = asset.base64 ?? await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
    if (!base64) throw new Error("missing-image-data");
    const mimeType = asset.mimeType?.startsWith("image/") ? asset.mimeType : asset.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const response = await withOcrTimeout(readProductLabelImage(base64, mimeType));
    if (response.productName) {
      showToast("ส่งภาพเข้า OCR สำเร็จ · ได้ผลการอ่านแล้ว", "ocr");
      await reviewOcrName(response.productName, response.productCandidates ?? []);
      return true;
    }
    return false;
  };

  const handleOcrFailure = (asset: OcrAsset, error: unknown) => {
    if (error instanceof GeminiError && (error.code === "no-key" || error.code === "bad-key")) {
      setLastOcrAsset(asset);
      setOcrReadStatus("failed");
      Alert.alert("ต้องตั้งค่า Gemini API key", describeGeminiError(error), [
        { text: "ปิด", style: "cancel" },
        { text: "ไปที่ตั้งค่า", onPress: () => router.push("/(tabs)/settings") },
      ]);
      return;
    }
    showOcrRetryAlert(asset, error instanceof GeminiError ? describeGeminiError(error) : undefined);
  };

  const showOcrRetryAlert = (asset: OcrAsset, reason?: string) => {
    setLastOcrAsset(asset);
    setOcrReportResolved(false);
    setOcrReadStatus("failed");
    Alert.alert(reason ? "อ่านชื่อสินค้าไม่สำเร็จ" : "อ่านชื่อสินค้าไม่ชัด", reason ?? "ระบบยังอ่านข้อความจากภาพเดิมไม่ได้ ลองอ่านซ้ำได้ทันที หรือครอบภาพใหม่ให้เห็นชื่อสินค้าใหญ่ขึ้น", [
      { text: "กรอกชื่อเอง", style: "cancel" },
      { text: "ถ่าย/เลือกภาพใหม่", onPress: () => void readProductLabel() },
      { text: "ครอบภาพก่อนอ่านซ้ำ", onPress: () => setOcrCropAsset(asset) },
      { text: "ลองอ่านซ้ำ", onPress: () => void retryLastOcrRead() },
    ]);
  };

  const retryLastOcrRead = async () => {
    const asset = lastOcrAsset;
    if (!asset || isReadingLabel) return;
    const nextAttempt = ocrReadAttempt + 1;
    setOcrReadAttempt(nextAttempt);
    setOcrReportResolved(false);
    setOcrReadStatus("reading");
    setIsReadingLabel(true);
    try {
      const succeeded = await processProductLabelAsset(asset);
      if (succeeded) {
        setLastOcrAsset(null);
        setOcrReadStatus("success");
      } else showOcrRetryAlert(asset);
    } catch (error) {
      handleOcrFailure(asset, error);
    } finally {
      setIsReadingLabel(false);
    }
  };

  const reportOcrError = async () => {
    const asset = lastOcrAsset;
    if (!asset || isReportingOcr) return;
    const correctedName = correctedOcrName.trim();
    if (!correctedName) {
      Alert.alert("กรุณาระบุชื่อสินค้าที่ถูกต้อง", "ชื่อที่กรอกจะถูกแนบไปกับภาพเพื่อใช้เป็นข้อมูลอ้างอิงในการปรับปรุง OCR");
      return;
    }
    if (correctedNameMatchesOcr) {
      Alert.alert("ชื่อซ้ำกับผล OCR เดิม", "ชื่อที่กรอกเหมือนกับข้อความที่ระบบอ่านได้ โปรดตรวจสอบและแก้ไขชื่อให้ถูกต้องก่อนส่งรายงาน");
      return;
    }
    try {
      setIsReportingOcr(true);
      await saveOcrReport({ ocrText: ocrDraft.trim(), correctedText: correctedName });
      setCorrectedOcrName("");
      previousCorrectedOcrName.current = "";
      showToast("บันทึกชื่อที่ถูกต้องไว้ในเครื่องแล้ว");
    } catch {
      Alert.alert("บันทึกรายงานไม่สำเร็จ", "ลองใหม่อีกครั้ง");
    } finally {
      setIsReportingOcr(false);
    }
  };

  const confirmOcrWasCorrect = () => {
    previousCorrectedOcrName.current = correctedOcrName;
    setOcrReportResolved(true);
    setCorrectedOcrName("");
    showToast("ยืนยันผล OCR แล้ว ระบบจะไม่ส่งรายงานข้อผิดพลาด");
  };

  const undoOcrConfirmation = () => {
    setOcrReportResolved(false);
    setCorrectedOcrName(previousCorrectedOcrName.current);
    showToast("เปิดแบบฟอร์มรายงาน OCR กลับมาแล้ว");
  };

  const readProductLabel = async () => {
    if (!(await getGeminiApiKey())) {
      Alert.alert("ตั้งค่าก่อนใช้งานครั้งแรก", "การอ่านชื่อสินค้าจากรูปใช้ Google Gemini ใส่ API key (ฟรี) ในหน้าตั้งค่าก่อนนะ", [
        { text: "ปิด", style: "cancel" },
        { text: "ไปที่ตั้งค่า", onPress: () => router.push("/(tabs)/settings") },
      ]);
      return;
    }
    if (Platform.OS === "web") {
      Alert.alert("ถ่ายรูปบนเว็บ", "เวอร์ชันเว็บไม่สามารถเปิดกล้องของอุปกรณ์ผ่านปุ่มนี้ได้ กรุณาเลือกรูปฉลากจากเครื่องแทน", [
        { text: "ยกเลิก", style: "cancel" },
        { text: "เลือกรูปภาพ", onPress: () => void chooseLabelImage() },
      ]);
      return;
    }

    setIsReadingLabel(true);
    try {
      const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
      if (!permission.granted) {
        const openSettings = permission.canAskAgain === false ? [{ text: "เปิดการตั้งค่า", onPress: () => void Linking.openSettings() }] : [];
        Alert.alert("ต้องอนุญาตการใช้กล้อง", permission.canAskAgain === false ? "สิทธิ์กล้องถูกปิดไว้ โปรดเปิดสิทธิ์กล้องสำหรับ ShelfWatch ในการตั้งค่าอุปกรณ์" : "โปรดอนุญาตการใช้กล้องเพื่ออ่านข้อความบนฉลากสินค้า", [
          { text: "ยกเลิก", style: "cancel" },
          ...openSettings,
        ]);
        return;
      }
      setIsReadingLabel(false);
      setIsLabelCameraVisible(true);
    } catch {
      Alert.alert("เปิดกล้องไม่สำเร็จ", "ลองตรวจสอบว่ากล้องไม่ได้ถูกใช้งานโดยแอปอื่น แล้วกดลองใหม่ หรือเลือกรูปฉลากจากคลังภาพ", [
        { text: "กรอกชื่อเอง", style: "cancel" },
        { text: "เลือกรูปภาพ", onPress: () => void chooseLabelImage() },
        { text: "ลองใหม่", onPress: () => void readProductLabel() },
      ]);
    } finally {
      setIsReadingLabel(false);
    }
  };

  const adjustLabelCameraZoom = (delta: number) => setLabelCameraZoom((current) => Math.max(0, Math.min(1, Number((current + delta).toFixed(2)))));

  const closeLabelCamera = () => {
    setIsLabelCameraVisible(false);
    setLabelCameraZoom(0);
    setIsLabelTorchOn(false);
  };

  const captureLabelPhoto = async () => {
    if (!labelCameraRef.current || isReadingLabel) return;
    setIsReadingLabel(true);
    try {
      // exif: false makes expo-camera rotate the pixels upright itself and skip the EXIF tag.
      // With exif: true the photo stayed unrotated, then got rotated twice in the crop screen (sideways text).
      const result = await labelCameraRef.current.takePictureAsync({ quality: 0.9, base64: false, exif: false });
      if (result) {
        closeLabelCamera();
        previousCorrectedOcrName.current = "";
        setCorrectedOcrName("");
        setOcrCropAsset(result);
      }
    } catch {
      Alert.alert("ถ่ายภาพไม่สำเร็จ", "ลองจัดฉลากให้อยู่ในกรอบอีกครั้ง แล้วกดถ่ายใหม่");
    } finally {
      setIsReadingLabel(false);
    }
  };

  const chooseLabelImage = async () => {
    setIsReadingLabel(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, quality: 0.9, base64: false, mediaTypes: ["images"] });
      if (!result.canceled && result.assets[0]) {
        previousCorrectedOcrName.current = "";
        setCorrectedOcrName("");
        setOcrCropAsset(result.assets[0]);
      }
    } catch {
      Alert.alert("อ่านฉลากไม่สำเร็จ", "กรุณาเลือกรูปฉลากใหม่ หรือนำชื่อสินค้ามาพิมพ์เอง", [
        { text: "กรอกชื่อเอง", style: "cancel" },
        { text: "เลือกจากคลังอีกครั้ง", onPress: () => void chooseLabelImage() },
      ]);
    } finally {
      setIsReadingLabel(false);
    }
  };

  const confirmCroppedLabel = async (asset: { uri: string; base64?: string }) => {
    setOcrCropAsset(null);
    previousCorrectedOcrName.current = "";
    setCorrectedOcrName("");
    setLastOcrAsset(asset);
    setOcrReadAttempt((current) => current > 0 ? current + 1 : 1);
    setOcrReadStatus("reading");
    setIsReadingLabel(true);
    try {
      const succeeded = await processProductLabelAsset(asset);
      if (succeeded) {
        setLastOcrAsset(null);
        setOcrReadStatus("success");
      } else showOcrRetryAlert(asset);
    } catch (error) {
      handleOcrFailure(asset, error);
    } finally {
      setIsReadingLabel(false);
    }
  };

  const confirmOcrName = () => {
    const confirmedName = ocrDraft.trim();
    if (!confirmedName) {
      Alert.alert("ยังไม่มีชื่อสินค้า", "กรุณาแก้ไขหรือกรอกชื่อสินค้าก่อนยืนยัน");
      return;
    }
    updateField("name", confirmedName);
    setIsOcrReviewVisible(false);
  };

  const takeImage = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("ต้องอนุญาตการใช้กล้อง", "โปรดอนุญาตการใช้กล้องจากการตั้งค่าอุปกรณ์เพื่อถ่ายรูปสินค้า");
      return;
    }
    if (Platform.OS === "web") {
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.7 });
      if (!result.canceled) await finishProductPhoto(result.assets[0].uri);
      return;
    }
    setIsProductCameraVisible(true);
  };

  const captureProductImage = async () => {
    if (!productCameraRef.current) return;
    const result = await productCameraRef.current.takePictureAsync({ quality: 0.7 });
    if (!result?.uri) return;
    await finishProductPhoto(result.uri);
  };

  const skipProductPhoto = () => {
    setIsProductCameraVisible(false);
    showToast("ข้ามการถ่ายรูปแล้ว · สามารถเพิ่มรูปภายหลังได้");
  };

  const selectCategoryAndCaptureImage = (category: string) => {
    updateField("category", category);
    void updateSettings({ latestCategory: normalizeProductCategory(category) });
    // หน่วงเล็กน้อยให้การเลือกหมวดหมู่เสร็จก่อนเปิดหน้ากล้องของอุปกรณ์
    setTimeout(() => void takeImage(), 120);
  };

  const handleSave = async (saveAsNewLot = false, addAnother = false) => {
    const quantity = Number(form.quantity);
    if (!form.name.trim() || !form.shelf.trim() || !form.row.trim() || !form.itemNumber.trim() || !dateParts.day || !dateParts.month || !dateParts.year) {
      Alert.alert("กรอกข้อมูลให้ครบ", `โปรดระบุชื่อสินค้า ชั้นวาง แถว สินค้าตัวที่ และ${form.dateType === "manufactured" ? "วันผลิต" : "วันหมดอายุ"}`);
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      Alert.alert("จำนวนไม่ถูกต้อง", "โปรดระบุจำนวนสินค้าเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
      return;
    }
    if (!Number.isInteger(itemNumber) || !itemNumber || itemNumber < 1) {
      Alert.alert("ลำดับสินค้าไม่ถูกต้อง", "โปรดระบุสินค้าตัวที่เป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
      return;
    }
    const barcodeCode = form.productCode.trim();
    const duplicateBarcode = findDuplicateBarcode(products, barcodeCode, { shelf: form.shelf, row: form.row }, editingProduct?.id);
    if (duplicateBarcode) {
      Alert.alert("พบบาร์โค้ดซ้ำ", `รหัส ${duplicateBarcode.barcode} ถูกใช้กับสินค้า “${duplicateBarcode.product.name}” แล้ว\nชั้นวาง ${duplicateBarcode.product.shelf} · แถว ${duplicateBarcode.product.row} · สินค้าตัวที่ ${duplicateBarcode.product.itemNumber ?? "ไม่ระบุ"}`);
      return;
    }
    const productAtPosition = findProductAtPosition(products, { shelf: form.shelf, row: form.row, itemNumber }, editingProduct?.id);
    const isInsertingAtPosition = !editingProduct && insertAtPosition;
    if (productAtPosition && !isInsertingAtPosition) {
      Alert.alert("ตำแหน่งสินค้าซ้ำ", `มีสินค้า “${productAtPosition.name}” อยู่ที่ชั้นวาง ${form.shelf.trim()} แถว ${form.row.trim()} สินค้าตัวที่ ${itemNumber} แล้ว`, [
        { text: "แก้ไขตำแหน่งใหม่", style: "cancel" },
        { text: "ย้ายสินค้าเดิม", onPress: () => router.replace({ pathname: "/product/[id]", params: { id: productAtPosition.id, openMove: "1" } }) },
      ]);
      return;
    }
    if (form.shelfLifeDays && (!Number.isInteger(shelfLifeDays) || !shelfLifeDays || shelfLifeDays < 1)) {
      Alert.alert("อายุสินค้าไม่ถูกต้อง", "โปรดระบุอายุสินค้าเป็นจำนวนวันตั้งแต่ 1 วันขึ้นไป");
      return;
    }
    if (!dateValue) {
      Alert.alert("รูปแบบวันไม่ถูกต้อง", "โปรดตรวจสอบวัน เดือน และปี เช่น 31 / 12 / 2569");
      return;
    }
    setIsSaving(true);
    const normalizedCategory = normalizeProductCategory(form.category);
    if (normalizedCategory) await updateSettings({ latestCategory: normalizedCategory });
    const payload = {
      name: form.name.trim(),
      category: normalizedCategory || undefined,
      grade: form.grade,
      productCode: form.productCode.trim(),
      batchNumber: form.batchNumber.trim() || undefined,
      quantity,
      shelf: form.shelf.trim(),
      row: form.row.trim(),
      itemNumber,
      dateType: form.dateType,
      date: dateValue,
      shelfLifeDays,
      imageUris: form.imageUris,
    };
    try {
      if (editingProduct && saveAsNewLot) {
        const updatedProduct = await addLotToProduct(editingProduct.id, { batchNumber: payload.batchNumber ?? "", quantity: payload.quantity, dateType: payload.dateType, date: payload.date, shelfLifeDays: payload.shelfLifeDays });
        const savedLot = updatedProduct ? getProductLots(updatedProduct).at(-1) : null;
        if (!savedLot) return;
        Alert.alert("บันทึกล็อตใหม่แล้ว", `เพิ่มล็อตที่ ${savedLot.batchNumber} จำนวน ${savedLot.quantity} โดยสินค้ายังอยู่ที่ตำแหน่งเดิม`);
        router.replace({ pathname: "/product/[id]", params: { id: editingProduct.id } });
      } else if (editingProduct) {
        await updateProduct(editingProduct.id, payload);
      } else if (isInsertingAtPosition) {
        await insertProduct(payload);
      } else {
        await addProduct(payload);
      }
      if (editingProduct && saveAsNewLot) {
        return;
      } else if (editingProduct) {
        showToast("บันทึกการแก้ไขสินค้าเรียบร้อยแล้ว", "saved");
        setTimeout(() => router.replace({ pathname: "/product/[id]", params: { id: editingProduct.id } }), 900);
      } else {
        ignoredScannedCode.current = scannedCode ?? (form.productCode.trim() || null);
        clearScanParams();
        const nextForm = addAnother
          ? { ...INITIAL_FORM, shelf: form.shelf.trim(), row: form.row.trim(), itemNumber: String(itemNumber + 1), dateType: form.dateType }
          : INITIAL_FORM;
        setForm(nextForm);
        setDateParts({ day: "", month: "", year: "" });
        setShouldFocusPrimaryBarcode(false);
        focusNameAfterSave();
        setInsertAtPosition(false);
        showToast(addAnother ? `บันทึกแล้ว · พร้อมเพิ่มสินค้าตัวที่ ${itemNumber + 1}` : isInsertingAtPosition ? "แทรกสินค้าแล้ว · ฟอร์มพร้อมสำหรับรายการถัดไป" : "บันทึกสินค้าแล้ว · ฟอร์มถูกล้างพร้อมสำหรับรายการถัดไป", "saved");
        playStatusSound();
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <ScreenContainer className="items-center justify-center"><ActivityIndicator color="#1F6F5B" /></ScreenContainer>;
  }

  const flowStep = editingProduct || scannedCode ? "save" : imageUriParam ? "scan" : "photo";

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scrollViewRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="ย้อนกลับ" onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <MaterialIcons name="arrow-back" size={23} color="#1F6F5B" />
            </Pressable>
            <View style={styles.headerText}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{editingProduct ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</Text>
              <Text numberOfLines={2} ellipsizeMode="tail" style={styles.subtitle}>{editingProduct ? "แก้ไขข้อมูลสินค้าและเลขล็อตได้ทันที" : "ระบุตำแหน่งและเลือกชนิดวันที่ของสินค้า"}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={editingProduct ? "บันทึกการแก้ไขสินค้า" : "บันทึกสินค้า"} disabled={isSaving} onPress={() => requestSaveConfirmation("save")} style={({ pressed }) => [styles.headerSaveButton, isSaving && styles.disabledButton, pressed && styles.pressed]}>
              {isSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialIcons name="save" size={17} color="#FFFFFF" />}
              <Text style={styles.headerSaveText}>{isSaving ? "กำลังบันทึก" : "บันทึก"}</Text>
            </Pressable>
            {!editingProduct ? <Pressable accessibilityRole="button" accessibilityLabel="ล้างข้อมูลในฟอร์มทั้งหมด" onPress={clearForm} style={({ pressed }) => [styles.clearFormButton, pressed && styles.pressed]}>
              <MaterialIcons name="restart-alt" size={19} color="#B42318" />
              <Text style={styles.clearFormText}>ล้างฟอร์ม</Text>
            </Pressable> : null}
          </View>
          <ProductFlowStepper activeStep={flowStep} />
          {scannedCode ? <View style={styles.scanSummaryCard} accessibilityLabel="สรุปข้อมูลก่อนบันทึก">
            <View style={styles.scanSummaryHeader}><View style={styles.scanSummaryTitleRow}><View style={styles.scanSummaryIcon}><MaterialIcons name="fact-check" size={19} color="#1F6F5B" /></View><View><Text style={styles.scanSummaryTitle}>ตรวจสอบข้อมูลก่อนบันทึก</Text><Text style={styles.scanSummarySubtitle}>สแกนบาร์โค้ดสำเร็จแล้ว · โปรดตรวจสอบรูปและรหัส</Text></View></View><View style={styles.scanSummarySuccess}><MaterialIcons name="check-circle" size={17} color="#039855" /><Text style={styles.scanSummarySuccessText}>พร้อมบันทึก</Text></View></View>
            <View style={styles.scanSummaryBody}>
              <View style={styles.scanSummaryImages}>{form.imageUris.length > 0 ? form.imageUris.slice(0, 4).map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} style={styles.scanSummaryImage} accessibilityLabel={`รูปสินค้าที่ถ่าย ${index + 1}`} />) : <View style={styles.scanSummaryNoImage}><MaterialIcons name="image-not-supported" size={22} color="#98A2B3" /><Text style={styles.scanSummaryNoImageText}>ไม่มีรูปภาพ</Text></View>}</View>
              <View style={styles.scanSummaryDetails}><Text style={styles.scanSummaryDetailLabel}>บาร์โค้ดที่สแกน</Text><View style={styles.barcodeValueRow}><MaterialIcons name="qr-code-2" size={20} color="#1F6F5B" /><Text selectable style={styles.barcodeValue}>{scannedCode}</Text></View><View style={styles.scanSummaryMeta}><Text style={styles.scanSummaryMetaText}>รูปภาพ {form.imageUris.length} รูป</Text><Text style={styles.scanSummaryMetaText}>จำนวน {form.quantity} ชิ้น</Text></View></View>
            </View>
          </View> : null}

          <View style={styles.formCard}>
            <View style={styles.field}>
              <Text style={styles.label}>ชื่อสินค้า</Text>
              <Animated.View style={[styles.codeInputRow, styles.nameReadyHighlight, { backgroundColor: nameReadyHighlight.interpolate({ inputRange: [0, 1], outputRange: ["rgba(232,243,239,0)", "#DDF4E9"] }), borderColor: nameReadyHighlight.interpolate({ inputRange: [0, 1], outputRange: ["rgba(31,111,91,0)", "#1F6F5B"] }) }]}>
                <TextInput ref={nameInputRef} value={form.name} onChangeText={(value) => updateField("name", value)} placeholder="เช่น นมสดพาสเจอร์ไรส์" placeholderTextColor="#98A2B3" style={[styles.input, styles.codeInput, styles.productNameInput]} autoFocus={!editingProduct} returnKeyType="next" autoCorrect={false} textContentType="name" onFocus={() => setIsNameFocused(true)} onBlur={() => setTimeout(() => setIsNameFocused(false), 120)} onSubmitEditing={() => categoryInputRef.current?.focus()} />
                {form.name ? <Animated.View style={{ opacity: clearNameOpacity }}><Pressable accessibilityRole="button" accessibilityLabel="ล้างชื่อสินค้า" onPress={() => updateField("name", "")} style={({ pressed }) => [styles.clearNameButton, pressed && styles.pressed]} hitSlop={6}><MaterialIcons name="close" size={16} color="#667085" /></Pressable></Animated.View> : null}
                <Pressable accessibilityRole="button" accessibilityLabel="สแกนบาร์โค้ดชื่อสินค้า" onPress={() => router.push({ pathname: "/scanner", params: { mode: "name", shelf: form.shelf, row: form.row } })} style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}><MaterialIcons name="qr-code-scanner" size={23} color="#1F6F5B" /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="อ่านข้อความบนฉลาก" disabled={isReadingLabel} onPress={readProductLabel} style={({ pressed }) => [styles.scanButton, pressed && styles.pressed, isReadingLabel && styles.disabledButton]}><MaterialIcons name={isReadingLabel ? "hourglass-top" : "text-fields"} size={23} color="#1F6F5B" /></Pressable>
              </Animated.View>
              {isNameFocused && nameSuggestions.length > 0 ? <View style={styles.nameSuggestionSection}>
                {nameAutocompleteSuggestion ? <Pressable accessibilityRole="button" accessibilityLabel={`เติมชื่อสินค้าเป็น ${nameAutocompleteSuggestion}`} onPress={() => updateField("name", nameAutocompleteSuggestion)} style={({ pressed }) => [styles.autocompleteRow, pressed && styles.pressed]}><MaterialIcons name="auto-fix-high" size={18} color="#1F6F5B" /><View style={styles.autocompleteCopy}><Text style={styles.autocompleteLabel}>เติมคำอัตโนมัติ</Text><Text style={styles.autocompleteValue} numberOfLines={1}>{nameAutocompleteSuggestion}</Text></View><MaterialIcons name="arrow-upward" size={17} color="#1F6F5B" /></Pressable> : null}
                <Text style={styles.nameSuggestionLabel}>{nameAutocompleteSuggestion ? "หรือเลือกชื่อที่ใกล้เคียง" : "ชื่อที่เคยใช้ · แตะเพื่อเลือก"}</Text><View style={styles.nameSuggestionList}>{nameSuggestions.map((name) => <Pressable key={name} accessibilityRole="button" accessibilityLabel={`ใช้ชื่อสินค้า ${name}`} onPress={() => updateField("name", name)} style={({ pressed }) => [styles.nameSuggestionChip, pressed && styles.pressed]}><MaterialIcons name="history" size={16} color="#1F6F5B" /><Text style={styles.nameSuggestionText} numberOfLines={1}>{name}</Text></Pressable>)}</View></View> : null}
              <Text style={styles.codeHint}>พิมพ์ชื่อสินค้าได้ทันที หรือแตะชื่อที่เคยใช้เพื่อกรอกซ้ำ · กดถัดไปบนคีย์บอร์ดเพื่อไปหมวดหมู่</Text>
              {sameNameProducts.length > 1 ? <View style={styles.sameNameNotice}><MaterialIcons name="content-copy" size={16} color="#1D4ED8" /><View style={styles.sameNameNoticeCopy}><Text style={styles.sameNameNoticeText}>พบสินค้าชื่อเดียวกัน {sameNameProducts.length} รายการต่างชั้นวาง</Text><Pressable accessibilityRole="button" accessibilityLabel="เลือกสินค้าต้นแบบ" onPress={() => setIsTemplatePickerVisible(true)} style={({ pressed }) => [styles.templatePickerButton, pressed && styles.pressed]}><Text style={styles.templatePickerButtonText}>เลือกสินค้าต้นแบบ</Text><MaterialIcons name="chevron-right" size={17} color="#1D4ED8" /></Pressable></View></View> : sameNameProduct ? <View style={styles.sameNameNotice}><MaterialIcons name="content-copy" size={16} color="#1D4ED8" /><Text style={styles.sameNameNoticeText}>พบสินค้าชื่อเดียวกันที่ชั้น {sameNameProduct.shelf} ระบบจะเติมบาร์โค้ดและรูปภาพเดิมให้อัตโนมัติ หากช่องยังว่าง</Text></View> : null}
              <View style={styles.imageActionsRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="ถ่ายภาพฉลากเพื่ออ่านข้อความ" disabled={isReadingLabel} onPress={readProductLabel} style={({ pressed }) => [styles.imageActionButton, styles.imageActionButtonWide, pressed && styles.pressed, isReadingLabel && styles.disabledButton]}>
                  <MaterialIcons name="photo-camera" size={19} color="#1F6F5B" />
                  <Text style={styles.imageActionText}>ถ่ายภาพฉลาก</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="เลือกรูปฉลากจากคลังภาพเพื่ออ่านข้อความ" disabled={isReadingLabel} onPress={chooseLabelImage} style={({ pressed }) => [styles.imageActionButton, styles.imageActionButtonWide, pressed && styles.pressed, isReadingLabel && styles.disabledButton]}>
                  <MaterialIcons name="photo-library" size={19} color="#1F6F5B" />
                  <Text style={styles.imageActionText}>เลือกจากคลัง</Text>
                </Pressable>
              </View>
              {ocrReadStatus !== "idle" && ocrReadAttempt > 0 ? <View style={[styles.ocrProgressCard, ocrReadStatus === "failed" && !ocrReportResolved && styles.ocrProgressCardFailed, (ocrReadStatus === "success" || ocrReportResolved) && styles.ocrProgressCardSuccess]}>
                {ocrReadStatus === "reading" ? <ActivityIndicator size="small" color="#1F6F5B" /> : <MaterialIcons name={ocrReadStatus === "success" || ocrReportResolved ? "check-circle" : "error-outline"} size={20} color={ocrReadStatus === "success" || ocrReportResolved ? "#1F6F5B" : "#B42318"} />}
                <View style={styles.ocrProgressCopy}><Text style={styles.ocrProgressTitle}>{ocrReadStatus === "reading" ? `กำลังอ่านภาพ · ครั้งที่ ${ocrReadAttempt}` : ocrReadStatus === "success" ? "อ่านชื่อสินค้าสำเร็จ" : ocrReportResolved ? "ยืนยันผล OCR ถูกต้องแล้ว" : `อ่านไม่สำเร็จ · ลองแล้ว ${ocrReadAttempt} ครั้ง`}</Text><Text style={styles.ocrProgressText}>{ocrReadStatus === "reading" ? "กำลังส่งภาพเดิมให้ระบบวิเคราะห์ โปรดรอสักครู่…" : ocrReadStatus === "success" ? "กำลังเปิดหน้าตรวจสอบชื่อสินค้า" : ocrReportResolved ? "ยกเลิกการรายงานแล้ว และจะไม่นำภาพนี้ส่งเป็นข้อผิดพลาด" : "กด “ลองอ่านซ้ำ” ในหน้าต่างแจ้งเตือนเพื่อใช้ภาพเดิมอีกครั้ง"}</Text>{ocrReadStatus === "failed" ? <Animated.View pointerEvents={ocrReportResolved ? "none" : "auto"} style={[styles.ocrReportPanel, { opacity: ocrReportTransition, transform: [{ translateY: ocrReportTransition.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] }]}><Text style={styles.ocrCorrectedLabel}>ชื่อสินค้าที่ถูกต้องสำหรับอ้างอิง</Text><TextInput accessibilityLabel="ชื่อสินค้าที่ถูกต้องสำหรับรายงาน OCR" value={correctedOcrName} onChangeText={setCorrectedOcrName} placeholder="พิมพ์ชื่อที่ถูกต้องบนฉลาก" placeholderTextColor="#98A2B3" style={[styles.ocrCorrectedInput, correctedNameMatchesOcr && styles.ocrCorrectedInputWarning]} returnKeyType="done" />{correctedNameMatchesOcr ? <View style={styles.ocrDuplicateWarning}><MaterialIcons name="warning-amber" size={16} color="#B42318" /><Text style={styles.ocrDuplicateWarningText}>ชื่อนี้เหมือนกับผล OCR เดิม โปรดตรวจสอบและแก้ไขก่อนรายงาน</Text></View> : null}<Pressable accessibilityRole="button" accessibilityLabel="รายงานผลการอ่าน OCR ผิดพลาด" disabled={isReportingOcr || correctedNameMatchesOcr} onPress={() => void reportOcrError()} style={({ pressed }) => [styles.ocrReportButton, pressed && styles.pressed, (isReportingOcr || correctedNameMatchesOcr) && styles.disabledButton]}><MaterialIcons name="flag" size={15} color="#B42318" /><Text style={styles.ocrReportText}>{isReportingOcr ? "กำลังบันทึก…" : correctedNameMatchesOcr ? "แก้ชื่อก่อนส่งรายงาน" : "รายงานผลการอ่านผิดพลาด"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="ยืนยันว่าผล OCR ถูกต้องแล้ว" onPress={confirmOcrWasCorrect} style={({ pressed }) => [styles.ocrConfirmButton, pressed && styles.pressed]}><MaterialIcons name="verified" size={15} color="#1F6F5B" /><Text style={styles.ocrConfirmText}>ยืนยันว่าผล OCR ถูกต้องแล้ว</Text></Pressable></Animated.View> : null}{ocrReadStatus === "failed" && ocrReportResolved ? <Animated.View style={[styles.ocrResolvedRow, { opacity: ocrReportTransition.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}><MaterialIcons name="check-circle" size={16} color="#1F6F5B" /><Text style={styles.ocrResolvedText}>ยกเลิกการรายงานข้อผิดพลาดแล้ว</Text><Pressable accessibilityRole="button" accessibilityLabel="ยกเลิกการยืนยันผล OCR" onPress={undoOcrConfirmation} style={({ pressed }) => [styles.ocrUndoButton, pressed && styles.pressed]}><MaterialIcons name="undo" size={15} color="#667085" /><Text style={styles.ocrUndoText}>ยกเลิกการยืนยัน</Text></Pressable></Animated.View> : null}</View>
              </View> : null}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>หมวดหมู่สินค้า <Text style={styles.optionalLabel}>(ไม่บังคับ)</Text></Text>
              <TextInput ref={categoryInputRef} value={form.category} onChangeText={(value) => updateField("category", value)} placeholder="เช่น เครื่องดื่ม หรือของใช้" placeholderTextColor="#98A2B3" style={styles.input} returnKeyType="done" />
              {productCategories.length > 0 ? <><Text style={styles.categoryHint}>{visibleProductCategories.length < productCategories.length ? `พบ ${visibleProductCategories.length} จาก ${productCategories.length} หมวดหมู่ที่บันทึกไว้` : `เลือกจาก ${productCategories.length} หมวดหมู่ที่บันทึกไว้ หรือพิมพ์หมวดหมู่ใหม่`}</Text><View style={styles.categorySuggestionList}>{visibleProductCategories.map((category) => <Pressable key={category} accessibilityRole="button" accessibilityLabel={`เลือกหมวดหมู่ ${category} แล้วเปิดกล้องถ่ายรูปสินค้า`} onPress={() => selectCategoryAndCaptureImage(category)} style={({ pressed }) => [styles.categorySuggestion, normalizeProductCategory(form.category) === category && styles.categorySuggestionActive, pressed && styles.pressed]}><Text style={[styles.categorySuggestionText, normalizeProductCategory(form.category) === category && styles.categorySuggestionTextActive]}>{category}</Text></Pressable>)}</View></> : <Text style={styles.categoryHint}>พิมพ์หมวดหมู่เพื่อช่วยจัดกลุ่มและกรองสินค้าในหน้าภาพรวม</Text>}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>เกรดสินค้า</Text>
              <Text style={styles.categoryHint}>เลือกเกรดเพื่อช่วยแยกคุณภาพและจัดลำดับการดูสินค้า</Text>
              <View style={styles.gradeOptionList}>{(["A", "B", "C"] as ProductGrade[]).map((grade) => { const theme = getProductGradeTheme(grade); const selected = form.grade === grade; return <Pressable key={grade} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`เกรดสินค้า ${grade}`} onPress={() => setForm((current) => ({ ...current, grade }))} style={({ pressed }) => [styles.gradeOption, { backgroundColor: selected ? theme.backgroundColor : "#F9FAFB", borderColor: selected ? theme.textColor : "#D0D5DD" }, pressed && styles.pressed]}><View style={[styles.gradeBadge, { backgroundColor: theme.textColor }]}><Text style={styles.gradeBadgeText}>{grade}</Text></View><Text style={[styles.gradeOptionText, { color: selected ? theme.textColor : "#475467" }]}>{getProductGradeLabel(grade)}</Text>{selected ? <MaterialIcons name="check-circle" size={20} color={theme.textColor} /> : null}</Pressable>; })}</View>
            </View>
            <View style={styles.imageField}>
              <View style={styles.imageLabelRow}><Text style={styles.label}>รูปสินค้า</Text><Text style={styles.imageCount}>{form.imageUris.length}/6 รูป</Text></View>
              <View style={styles.imageActionsRow}><Pressable accessibilityRole="button" onPress={chooseImage} style={({ pressed }) => [styles.imageActionButton, styles.imageActionButtonWide, pressed && styles.pressed]}><MaterialIcons name="photo-library" size={19} color="#1F6F5B" /><Text style={styles.imageActionText}>เลือกรูป</Text></Pressable><Pressable accessibilityRole="button" onPress={takeImage} style={({ pressed }) => [styles.imageActionButton, styles.imageActionButtonWide, pressed && styles.pressed]}><MaterialIcons name="photo-camera" size={19} color="#1F6F5B" /><Text style={styles.imageActionText}>ถ่ายรูป</Text></Pressable></View>
              {form.imageUris.length > 0 ? <View style={styles.imageGrid}>{form.imageUris.map((uri, index) => <View key={`${uri}-${index}`} style={styles.imageTile}><Image source={{ uri }} style={styles.productImage} /><Pressable accessibilityRole="button" accessibilityLabel={`ลบรูปที่ ${index + 1}`} onPress={() => setForm((current) => ({ ...current, imageUris: current.imageUris.filter((_, itemIndex) => itemIndex !== index) }))} style={({ pressed }) => [styles.removeImageCircle, pressed && styles.pressed]}><MaterialIcons name="close" size={16} color="#FFFFFF" /></Pressable></View>)}</View> : <View style={styles.imageEmpty}><MaterialIcons name="image" size={28} color="#98A2B3" /><Text style={styles.imageEmptyText}>ยังไม่มีรูปสินค้า</Text></View>}
              <Text style={styles.imageHint}>เพิ่มได้สูงสุด 6 รูป รูปจะจัดเก็บไว้ในอุปกรณ์และแยกตามผู้ใช้</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>รหัสสินค้า</Text>
              <View style={styles.codeInputRow}>
                <TextInput ref={primaryBarcodeInputRef} accessibilityLabel="ช่องบาร์โค้ดหลัก" value={form.productCode} onChangeText={(value) => updateField("productCode", value)} placeholder="บาร์โค้ดหลัก เช่น 8851234567890" placeholderTextColor="#98A2B3" style={[styles.input, styles.codeInput]} returnKeyType="done" autoCapitalize="none" />
                <Pressable accessibilityRole="button" accessibilityLabel="สแกนบาร์โค้ดหลัก" onPress={() => router.push({ pathname: "/scanner", params: { mode: "form" } })} style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}><MaterialIcons name="qr-code-scanner" size={23} color="#1F6F5B" /></Pressable>
              </View>
              <Text style={styles.codeHint}>ใช้บาร์โค้ดหลักเพียง 1 รหัสต่อสินค้า</Text>
            </View>
            <Field label={editingProduct ? "ล็อตที่ (เพิ่มหรือแก้ไข)" : "ล็อตที่"} value={form.batchNumber} onChangeText={(value) => updateField("batchNumber", value.replace(/[^0-9]/g, ""))} placeholder="1" keyboardType="number-pad" autoFocus={focusLot === "1"} />
            {suggestedBatchNumber ? <Pressable accessibilityRole="button" onPress={() => updateField("batchNumber", String(suggestedBatchNumber))} style={({ pressed }) => [styles.lotHint, pressed && styles.pressed]}><MaterialIcons name="layers" size={17} color="#1F6F5B" /><Text style={styles.lotHintText}>สินค้าเดียวกันที่มีวันหมดอายุต่างกัน ให้แยกเป็นล็อต · แนะนำล็อตที่ {suggestedBatchNumber}</Text><Text style={styles.lotUseText}>ใช้</Text></Pressable> : <View style={styles.lotHint}><MaterialIcons name="layers" size={17} color="#1F6F5B" /><Text style={styles.lotHintText}>สินค้าเดียวกันที่มีวันหมดอายุต่างกัน ให้แยกเป็นล็อตและระบุจำนวนของล็อตนั้น</Text></View>}
            <Field label="จำนวน" value={form.quantity} onChangeText={(value) => updateField("quantity", value)} placeholder="1" keyboardType="number-pad" />
            <View style={styles.locationHeaderRow}>
              <Text style={styles.label}>ตำแหน่งจัดเก็บ</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="คัดลอกชั้นวางและแถวจากสินค้าชิ้นล่าสุด" onPress={copyLatestLocation} style={({ pressed }) => [styles.copyLocationButton, pressed && styles.pressed]}>
                <MaterialIcons name="content-copy" size={16} color="#1F6F5B" />
                <Text style={styles.copyLocationText}>คัดลอกตำแหน่งล่าสุด</Text>
              </Pressable>
            </View>
            <View style={styles.rowFields}>
              <View style={styles.locationField}><Field label="ชั้นวางที่" value={form.shelf} onChangeText={(value) => updateLocationField("shelf", value)} placeholder="1" /></View>
              <View style={styles.locationField}><Field label="แถวที่" value={form.row} onChangeText={(value) => updateLocationField("row", value)} placeholder="1" /></View>
              <View style={styles.locationField}><Field label="สินค้าตัวที่" value={form.itemNumber} onChangeText={(value) => updateField("itemNumber", value)} placeholder="1" keyboardType="number-pad" /></View>
            </View>
            {!editingProduct && form.shelf.trim() && form.row.trim() && itemNumber ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: insertAtPosition }} onPress={() => setInsertAtPosition((current) => !current)} style={({ pressed }) => [styles.insertPositionOption, insertAtPosition && styles.insertPositionOptionActive, pressed && styles.pressed]}><View style={[styles.insertPositionIcon, insertAtPosition && styles.insertPositionIconActive]}><MaterialIcons name={insertAtPosition ? "check" : "add"} size={18} color={insertAtPosition ? "#FFFFFF" : "#1F6F5B"} /></View><View style={styles.insertPositionCopy}><Text style={[styles.insertPositionTitle, insertAtPosition && styles.insertPositionTitleActive]}>แทรกสินค้าในตำแหน่งนี้</Text><Text style={styles.insertPositionText}>เลื่อนสินค้าตั้งแต่ตัวที่ {itemNumber} ในชั้น {form.shelf.trim()} · แถว {form.row.trim()} ไปด้านหลังอัตโนมัติ</Text></View></Pressable> : null}
            {!editingProduct && suggestedItemNumber ? <Pressable accessibilityRole="button" onPress={() => updateField("itemNumber", String(suggestedItemNumber))} style={({ pressed }) => [styles.positionSuggestion, pressed && styles.pressed]}><View style={styles.positionSuggestionIcon}><MaterialIcons name="auto-awesome" size={18} color="#1F6F5B" /></View><View style={styles.positionSuggestionCopy}><Text style={styles.positionSuggestionLabel}>แนะนำตำแหน่งว่าง</Text><Text style={styles.positionSuggestionValue}>ชั้น {form.shelf.trim()} · แถว {form.row.trim()} · สินค้าตัวที่ {suggestedItemNumber}</Text></View><Text style={styles.positionSuggestionAction}>ใช้</Text></Pressable> : null}
            <Text style={styles.label}>ชนิดวันที่</Text>
            <View style={styles.dateTypeSwitch}>
              <Pressable onPress={() => setForm((current) => ({ ...current, dateType: "manufactured" }))} style={({ pressed }) => [styles.dateTypeButton, form.dateType === "manufactured" && styles.dateTypeButtonActive, pressed && styles.pressed]}><Text style={[styles.dateTypeText, form.dateType === "manufactured" && styles.dateTypeTextActive]}>วันผลิต</Text></Pressable>
              <Pressable onPress={() => setForm((current) => ({ ...current, dateType: "expiry" }))} style={({ pressed }) => [styles.dateTypeButton, form.dateType === "expiry" && styles.dateTypeButtonActive, pressed && styles.pressed]}><Text style={[styles.dateTypeText, form.dateType === "expiry" && styles.dateTypeTextActive]}>วันหมดอายุ</Text></Pressable>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{form.dateType === "manufactured" ? "วันผลิต" : "วันหมดอายุ"}</Text>
              <View style={styles.datePartsRow}>
                <DatePartField label="วัน" value={dateParts.day} onChangeText={(value) => updateDatePart("day", value)} placeholder="31" />
                <DatePartField label="เดือน" value={dateParts.month} onChangeText={(value) => updateDatePart("month", value)} placeholder="12" />
                <DatePartField label="ปี" value={dateParts.year} onChangeText={(value) => updateDatePart("year", value)} placeholder="2569" year />
              </View>
            </View>
            <Field label="อายุสินค้า (วัน)" value={form.shelfLifeDays} onChangeText={(value) => updateField("shelfLifeDays", value)} placeholder="เช่น 30" keyboardType="number-pad" />
            {calculatedExpiryDate ? <View style={styles.calculatedCard}><MaterialIcons name="auto-awesome" size={18} color="#1F6F5B" /><View style={styles.calculatedCopy}><Text style={styles.calculatedLabel}>วันหมดอายุที่คำนวณได้</Text><Text style={styles.calculatedValue}>{formatDateParts(getDatePartsForInput(calculatedExpiryDate))}</Text></View></View> : null}
            <View style={styles.hint}>
              <MaterialIcons name="info-outline" size={17} color="#667085" />
              <Text style={styles.hintText}>{form.dateType === "manufactured" ? "ระบุอายุสินค้าเพื่อคำนวณวันหมดอายุอัตโนมัติ" : "ระบุวัน เดือน ปี เช่น 31 / 12 / 2569"}</Text>
            </View>
          </View>

          <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => requestSaveConfirmation("save")} style={({ pressed }) => [styles.saveButton, (pressed || isSaving) && styles.pressed]}>
            {isSaving ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="check" size={21} color="#FFFFFF" />}
            <Text style={styles.saveButtonText}>{isSaving ? "กำลังบันทึก" : editingProduct ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}</Text>
          </Pressable>
          {!editingProduct ? <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => requestSaveConfirmation("saveAndAdd")} style={({ pressed }) => [styles.saveAndAddButton, (pressed || isSaving) && styles.pressed]}>{isSaving ? <ActivityIndicator size="small" color="#1F6F5B" /> : <MaterialIcons name="playlist-add" size={20} color="#1F6F5B" />}<Text style={styles.saveAndAddText}>{isSaving ? "กำลังบันทึก" : "บันทึกและเพิ่มสินค้าใหม่"}</Text></Pressable> : null}
          {editingProduct ? <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => requestSaveConfirmation("newLot")} style={({ pressed }) => [styles.newLotButton, (pressed || isSaving) && styles.pressed]}><MaterialIcons name="library-add" size={20} color="#1F6F5B" /><View style={styles.newLotCopy}><Text style={styles.newLotTitle}>บันทึกเป็นล็อตใหม่</Text><Text style={styles.newLotSubtitle}>คงล็อตเดิมไว้และสร้างรายการใหม่</Text></View></Pressable> : null}
        </ScrollView>
      <Modal visible={isLabelCameraVisible} animationType="slide" onRequestClose={closeLabelCamera}>
        <View style={styles.labelCameraModal}>
          <CameraView ref={labelCameraRef} style={StyleSheet.absoluteFill} facing="back" zoom={labelCameraZoom} enableTorch={isLabelTorchOn} />
          <View style={styles.labelCameraOverlay}>
            <View style={styles.labelCameraTopBar}><Pressable accessibilityRole="button" accessibilityLabel="ปิดกล้องถ่ายชื่อสินค้า" onPress={closeLabelCamera} style={({ pressed }) => [styles.cameraCloseButton, pressed && styles.pressed]}><MaterialIcons name="close" size={24} color="#FFFFFF" /></Pressable><Text style={styles.labelCameraTitle}>ถ่ายชื่อสินค้า</Text><Pressable accessibilityRole="button" accessibilityLabel={isLabelTorchOn ? "ปิดไฟฉาย" : "เปิดไฟฉาย"} onPress={() => setIsLabelTorchOn((current) => !current)} style={({ pressed }) => [styles.cameraCloseButton, isLabelTorchOn && styles.cameraTorchButtonActive, pressed && styles.pressed]}><MaterialIcons name={isLabelTorchOn ? "flash-on" : "flash-off"} size={22} color="#FFFFFF" /></Pressable></View>
            <View style={styles.labelTargetArea}><View style={styles.labelTargetFrame}><View style={[styles.targetCorner, styles.targetCornerTopLeft]} /><View style={[styles.targetCorner, styles.targetCornerTopRight]} /><View style={[styles.targetCorner, styles.targetCornerBottomLeft]} /><View style={[styles.targetCorner, styles.targetCornerBottomRight]} /></View><Text style={styles.labelTargetHint}>วางชื่อสินค้าให้อยู่ในกรอบ</Text><Text style={styles.labelTargetSubhint}>เข้าใกล้ฉลากและหลีกเลี่ยงแสงสะท้อน</Text></View>
            <View style={styles.labelCameraBottomBar}><View style={styles.cameraPresetRow}>{LABEL_ZOOM_PRESETS.map((preset) => { const isActive = Math.abs(labelCameraZoom - preset.value) < 0.01; return <Pressable key={preset.label} accessibilityRole="button" accessibilityLabel={`ตั้งซูม ${preset.label} ${(1 + preset.value * 2).toFixed(1)} เท่า`} onPress={() => setLabelCameraZoom(preset.value)} style={({ pressed }) => [styles.cameraPresetButton, isActive && styles.cameraPresetButtonActive, pressed && styles.pressed]}><MaterialIcons name={preset.value === 0 ? "center-focus-strong" : "zoom-in"} size={15} color={isActive ? "#0F5132" : "#FFFFFF"} /><Text style={[styles.cameraPresetText, isActive && styles.cameraPresetTextActive]}>{preset.label}</Text></Pressable>; })}</View><View style={styles.cameraZoomControls}><Pressable accessibilityRole="button" accessibilityLabel="ลดซูม" onPress={() => adjustLabelCameraZoom(-0.2)} disabled={labelCameraZoom <= 0} style={({ pressed }) => [styles.cameraControlButton, pressed && styles.pressed, labelCameraZoom <= 0 && styles.disabledButton]}><MaterialIcons name="remove" size={22} color="#FFFFFF" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="รีเซ็ตซูม" onPress={() => setLabelCameraZoom(0)} style={({ pressed }) => [styles.cameraZoomValue, pressed && styles.pressed]}><Text style={styles.cameraZoomValueText}>{`${(1 + labelCameraZoom * 2).toFixed(1)}x`}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="เพิ่มซูม" onPress={() => adjustLabelCameraZoom(0.2)} disabled={labelCameraZoom >= 1} style={({ pressed }) => [styles.cameraControlButton, pressed && styles.pressed, labelCameraZoom >= 1 && styles.disabledButton]}><MaterialIcons name="add" size={22} color="#FFFFFF" /></Pressable></View><View style={styles.cameraSliderRow}><Text style={styles.cameraSliderLabel}>1.0x</Text><Slider accessibilityLabel="ปรับระดับซูม" minimumValue={0} maximumValue={1} step={0.01} value={labelCameraZoom} onValueChange={setLabelCameraZoom} minimumTrackTintColor="#34D399" maximumTrackTintColor="rgba(255,255,255,0.42)" thumbTintColor="#FFFFFF" style={styles.cameraSlider} /><Text style={styles.cameraSliderLabel}>3.0x</Text></View><Pressable accessibilityRole="button" accessibilityLabel="ถ่ายภาพชื่อสินค้า" onPress={() => void captureLabelPhoto()} disabled={isReadingLabel} style={({ pressed }) => [styles.captureLabelButton, pressed && styles.pressed, isReadingLabel && styles.disabledButton]}>{isReadingLabel ? <ActivityIndicator color="#1F6F5B" /> : <View style={styles.captureLabelInner} />}</Pressable><Text style={styles.captureLabelHint}>{isLabelTorchOn ? "เปิดไฟฉายแล้ว · " : ""}ซูม {`${(1 + labelCameraZoom * 2).toFixed(1)}x`} · กดปุ่มเพื่อถ่ายภาพ</Text></View>
          </View>
        </View>
      </Modal>
      <Modal visible={isProductCameraVisible} animationType="slide" onRequestClose={skipProductPhoto}>
        <View style={styles.labelCameraModal}>
          <CameraView ref={productCameraRef} style={StyleSheet.absoluteFill} facing="back" />
          <View style={styles.labelCameraOverlay}>
            <View style={styles.labelCameraTopBar}>
              <Pressable accessibilityRole="button" accessibilityLabel="ข้ามการถ่ายรูปสินค้า" onPress={skipProductPhoto} style={({ pressed }) => [styles.cameraCloseButton, pressed && styles.pressed]}>
                <MaterialIcons name="close" size={24} color="#FFFFFF" />
              </Pressable>
              <Text style={styles.labelCameraTitle}>ถ่ายรูปสินค้า</Text>
              <View style={styles.cameraTopSpacer} />
            </View>
            <View style={styles.productPhotoGuide}>
              <View style={styles.productPhotoFrame}><MaterialIcons name="image" size={42} color="rgba(255,255,255,0.8)" /></View>
              <Text style={styles.labelTargetHint}>จัดสินค้าให้อยู่ในกรอบ</Text>
              <Text style={styles.labelTargetSubhint}>ถ่ายรูปเพื่อบันทึกไว้กับรายการสินค้า</Text>
            </View>
            <View style={styles.productCameraBottomBar}>
              <Pressable accessibilityRole="button" accessibilityLabel="ข้ามการถ่ายรูปสินค้า" onPress={skipProductPhoto} style={({ pressed }) => [styles.skipPhotoButton, pressed && styles.pressed]}>
                <MaterialIcons name="skip-next" size={18} color="#FFFFFF" />
                <Text style={styles.skipPhotoText}>ข้ามการถ่ายรูป</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="ถ่ายรูปสินค้า" onPress={() => void captureProductImage()} style={({ pressed }) => [styles.captureLabelButton, pressed && styles.pressed]}>
                <View style={styles.captureLabelInner} />
              </Pressable>
              <Text style={styles.captureLabelHint}>กดปุ่มเพื่อถ่ายรูปสินค้า</Text>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={Boolean(pendingSaveAction)} transparent animationType="fade" onRequestClose={() => setPendingSaveAction(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.saveConfirmCard}>
            <View style={styles.saveConfirmIcon}><MaterialIcons name="save" size={26} color="#1F6F5B" /></View>
            <Text style={styles.modalTitle}>ยืนยันการบันทึกข้อมูล</Text>
            <Text style={styles.modalCopy}>โปรดตรวจสอบข้อมูลให้ถูกต้องก่อนกดยืนยัน</Text>
            <View style={styles.saveConfirmDetails}>
              <View style={styles.saveConfirmRow}><Text style={styles.saveConfirmLabel}>สินค้า</Text><Text style={styles.saveConfirmValue} numberOfLines={1}>{form.name.trim() || "ยังไม่ได้ระบุชื่อ"}</Text></View>
              <View style={styles.saveConfirmRow}><Text style={styles.saveConfirmLabel}>บาร์โค้ด</Text><Text style={styles.saveConfirmValue} numberOfLines={1}>{scannedCode || form.productCode.trim() || "ยังไม่ได้ระบุ"}</Text></View>
              <View style={styles.saveConfirmRow}><Text style={styles.saveConfirmLabel}>จำนวน / ตำแหน่ง</Text><Text style={styles.saveConfirmValue}>{`${form.quantity || "—"} ชิ้น · ชั้น ${form.shelf || "—"} · แถว ${form.row || "—"}`}</Text></View>
            </View>
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="ยกเลิกการบันทึก" onPress={() => setPendingSaveAction(null)} style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]}><Text style={styles.modalCancelText}>ยกเลิก</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="ยืนยันบันทึกข้อมูล" onPress={confirmPendingSave} style={({ pressed }) => [styles.modalConfirm, pressed && styles.pressed]}><MaterialIcons name="check" size={17} color="#FFFFFF" /><Text style={styles.modalActionText}>{pendingSaveAction === "saveAndAdd" ? "บันทึกและเพิ่มใหม่" : pendingSaveAction === "newLot" ? "ยืนยันล็อตใหม่" : "ยืนยันบันทึก"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={isClearConfirmVisible} transparent animationType="fade" onRequestClose={() => setIsClearConfirmVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.clearConfirmCard}>
            <View style={styles.clearConfirmIcon}><MaterialIcons name="warning-amber" size={26} color="#B42318" /></View>
            <Text style={styles.modalTitle}>ยืนยันการล้างฟอร์ม</Text>
            <Text style={styles.modalCopy}>ข้อมูลที่กรอก บาร์โค้ด และผลสแกนที่ยังไม่ได้บันทึกจะถูกล้างทั้งหมด การดำเนินการนี้ย้อนกลับไม่ได้</Text>
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" onPress={() => setIsClearConfirmVisible(false)} style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]}><Text style={styles.modalCancelText}>ยกเลิก</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={confirmClearForm} style={({ pressed }) => [styles.clearConfirmButton, pressed && styles.pressed]}><MaterialIcons name="delete-outline" size={18} color="#FFFFFF" /><Text style={styles.clearConfirmText}>ยืนยันล้างข้อมูล</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={isOcrReviewVisible} transparent animationType="fade" onRequestClose={() => setIsOcrReviewVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>ตรวจสอบชื่อสินค้าแบบ Lens</Text>
            <Text style={styles.modalCopy}>ระบบอ่านข้อความทั้งหมดแล้วแยกชื่อสินค้าออกมาให้ เลือกตัวเลือกที่ตรงกับฉลากหรือแก้ไขเองก่อนยืนยัน</Text>
              <TextInput autoFocus value={ocrDraft} onChangeText={(value) => { setOcrDraft(value); setOcrSuggestions([]); }} style={styles.modalInput} multiline selectTextOnFocus placeholder="ชื่อสินค้า" placeholderTextColor="#98A2B3" />
              {isCheckingOcr ? <View style={styles.ocrChecking}><ActivityIndicator size="small" color="#1F6F5B" /><Text style={styles.ocrCheckingText}>กำลังตรวจทานคำสะกดและสร้างตัวเลือก…</Text></View> : ocrSuggestions.length > 0 ? <View style={styles.ocrSuggestionBox}><Text style={styles.ocrSuggestionTitle}>ชื่อที่อ่านได้ใกล้เคียง</Text><Text style={styles.ocrSuggestionCopy}>เลือกคำที่ตรงกับฉลากที่สุด หรือแก้ไขข้อความเองได้</Text>{ocrSuggestions.map((suggestion) => <Pressable key={suggestion} accessibilityRole="button" accessibilityLabel={`ใช้ชื่อที่อ่านได้ ${suggestion}`} onPress={() => setOcrDraft(suggestion)} style={({ pressed }) => [styles.ocrSuggestion, pressed && styles.pressed]}><MaterialIcons name="document-scanner" size={17} color="#1F6F5B" /><Text style={styles.ocrSuggestionText}>{suggestion}</Text><Text style={styles.ocrUseText}>ใช้</Text></Pressable>)}</View> : null}
              <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" onPress={() => setIsOcrReviewVisible(false)} style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]}><Text style={styles.modalCancelText}>ยกเลิก</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={confirmOcrName} style={({ pressed }) => [styles.modalConfirm, pressed && styles.pressed]}><Text style={styles.modalActionText}>ยืนยันชื่อ</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={isTemplatePickerVisible} transparent animationType="fade" onRequestClose={() => setIsTemplatePickerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>เลือกสินค้าต้นแบบ</Text>
            <Text style={styles.modalCopy}>เลือกชั้นวางที่มีข้อมูลบาร์โค้ดหรือรูปภาพที่ต้องการนำมาใช้ ช่องที่กรอกไว้แล้วจะไม่ถูกทับ</Text>
            <View style={styles.templateFilterRow}><View style={styles.templateFilterField}><TextInput accessibilityLabel="กรองตามชั้นวาง" value={templateShelfFilter} onChangeText={setTemplateShelfFilter} placeholder="ชั้นวาง เช่น 2" placeholderTextColor="#98A2B3" style={styles.templateFilterInput} keyboardType="default" /><Animated.View style={[styles.templateFilterClearAnimated, { opacity: templateShelfClearOpacity }]}><Pressable accessibilityRole="button" accessibilityLabel="ล้างตัวกรองชั้นวาง" accessibilityHint="กดเพื่อลบข้อความตัวกรองชั้นวาง" accessibilityState={{ disabled: !templateShelfFilter }} disabled={!templateShelfFilter} hitSlop={8} onHoverIn={() => setActiveTemplateFilterTooltip("shelf")} onHoverOut={() => setActiveTemplateFilterTooltip(null)} onPress={() => setTemplateShelfFilter("")} style={({ pressed }) => [styles.templateFilterClearButton, pressed && styles.pressed]}><MaterialIcons name="close" size={15} color="#667085" /></Pressable>{activeTemplateFilterTooltip === "shelf" && templateShelfFilter ? <Text pointerEvents="none" style={styles.templateFilterTooltip}>ล้างข้อความตัวกรองชั้นวาง</Text> : null}</Animated.View></View><View style={styles.templateFilterField}><TextInput accessibilityLabel="กรองตามแถว" value={templateRowFilter} onChangeText={setTemplateRowFilter} placeholder="แถว เช่น 10" placeholderTextColor="#98A2B3" style={styles.templateFilterInput} keyboardType="default" /><Animated.View style={[styles.templateFilterClearAnimated, { opacity: templateRowClearOpacity }]}><Pressable accessibilityRole="button" accessibilityLabel="ล้างตัวกรองแถว" accessibilityHint="กดเพื่อลบข้อความตัวกรองแถว" accessibilityState={{ disabled: !templateRowFilter }} disabled={!templateRowFilter} hitSlop={8} onHoverIn={() => setActiveTemplateFilterTooltip("row")} onHoverOut={() => setActiveTemplateFilterTooltip(null)} onPress={() => setTemplateRowFilter("")} style={({ pressed }) => [styles.templateFilterClearButton, pressed && styles.pressed]}><MaterialIcons name="close" size={15} color="#667085" /></Pressable>{activeTemplateFilterTooltip === "row" && templateRowFilter ? <Text pointerEvents="none" style={styles.templateFilterTooltip}>ล้างข้อความตัวกรองแถว</Text> : null}</Animated.View></View></View>
            <Pressable accessibilityRole="button" accessibilityLabel="ล้างตัวกรองชั้นวางและแถวทั้งหมด" accessibilityState={{ disabled: !templateShelfFilter.trim() && !templateRowFilter.trim() }} disabled={!templateShelfFilter.trim() && !templateRowFilter.trim()} onPress={() => { setTemplateShelfFilter(""); setTemplateRowFilter(""); }} style={({ pressed }) => [styles.clearTemplateFiltersButton, (!templateShelfFilter.trim() && !templateRowFilter.trim()) && styles.clearTemplateFiltersButtonDisabled, pressed && styles.pressed]}><MaterialIcons name="filter-alt-off" size={16} color={templateShelfFilter.trim() || templateRowFilter.trim() ? "#B42318" : "#98A2B3"} /><Text style={[styles.clearTemplateFiltersText, (!templateShelfFilter.trim() && !templateRowFilter.trim()) && styles.clearTemplateFiltersTextDisabled]}>ล้างตัวกรองทั้งหมด</Text></Pressable>
            <Text style={styles.templateResultCount}>พบ {filteredTemplateProducts.length} จาก {sameNameProducts.length} รายการ</Text>
            <ScrollView style={styles.templateList} keyboardShouldPersistTaps="handled">
              {filteredTemplateProducts.length === 0 ? <View style={styles.templateEmpty}><MaterialIcons name="search-off" size={24} color="#98A2B3" /><Text style={styles.templateEmptyText}>ไม่พบต้นแบบตามตัวกรอง</Text></View> : filteredTemplateProducts.map((template) => {
                const templateImage = template.imageUris?.[0] ?? template.imageUri;
                return <Pressable key={template.id} accessibilityRole="button" accessibilityLabel={`เลือกต้นแบบชั้น ${template.shelf} แถว ${template.row}`} onPress={() => applyProductTemplate(template)} style={({ pressed }) => [styles.templateRow, pressed && styles.pressed]}>
                  {templateImage ? <View style={styles.templateImageFrame}><Image source={{ uri: templateImage }} style={styles.templateImage} resizeMode="cover" /><View style={styles.templateThumbnailBadge}><MaterialIcons name="photo" size={11} color="#FFFFFF" /><Text style={styles.templateThumbnailBadgeText}>ตัวอย่าง</Text></View></View> : <View style={styles.templateImageEmpty}><MaterialIcons name="image" size={21} color="#98A2B3" /><Text style={styles.templateImageEmptyText}>ไม่มีรูป</Text></View>}
                  <View style={styles.templateCopy}><Text style={styles.templateLocation}>ชั้น {template.shelf} · แถว {template.row} · สินค้าตัวที่ {template.itemNumber ?? "—"}</Text><Text style={styles.templateDetails}>บาร์โค้ด: {template.productCode || "ไม่มี"} · รูปภาพ {template.imageUris?.length ?? (template.imageUri ? 1 : 0)} รูป</Text></View><MaterialIcons name="chevron-right" size={21} color="#667085" />
                </Pressable>;
              })}
            </ScrollView>
            <View style={styles.modalActions}><Pressable accessibilityRole="button" onPress={() => setIsTemplatePickerVisible(false)} style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]}><Text style={styles.modalCancelText}>ยกเลิก</Text></Pressable></View>
          </View>
        </View>
      </Modal>
      <OcrCropModal visible={Boolean(ocrCropAsset)} asset={ocrCropAsset} onCancel={() => setOcrCropAsset(null)} onAutoCrop={detectYellowLabel} onBoxDecision={recordBoxDecision} onConfirm={confirmCroppedLabel} />
      </KeyboardAvoidingView>
      {toastMessage ? <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastAnimation, transform: [{ translateY: toastAnimation.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }, toastMessage.kind === "ocr" ? styles.toastOcr : toastMessage.kind === "saved" ? styles.toastSaved : toastMessage.kind === "warning" ? styles.toastWarning : styles.toastInfo]}><View style={[styles.toastIcon, toastMessage.kind === "ocr" ? styles.toastIconOcr : toastMessage.kind === "saved" ? styles.toastIconSaved : toastMessage.kind === "warning" ? styles.toastIconWarning : styles.toastIconInfo]}><MaterialIcons name={toastMessage.kind === "ocr" ? "document-scanner" : toastMessage.kind === "saved" ? "save" : toastMessage.kind === "warning" ? "warning" : "info"} size={18} color="#FFFFFF" /></View><Text style={styles.toastText}>{toastMessage.message}</Text></Animated.View> : null}
    </ScreenContainer>
  );
}

function Field({ label, value, onChangeText, placeholder, ...props }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: "default" | "number-pad"; autoCapitalize?: "none"; autoFocus?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#98A2B3" style={styles.input} returnKeyType="done" {...props} />
    </View>
  );
}

function DatePartField({ label, value, onChangeText, placeholder, year = false }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; year?: boolean }) {
  return <View style={[styles.datePart, year && styles.datePartYear]}><Text style={styles.datePartLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#98A2B3" style={styles.datePartInput} keyboardType="number-pad" returnKeyType="done" /></View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 28 },
  header: { alignItems: "center", flexDirection: "row", gap: 7, marginBottom: 13 },
  backButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  headerText: { flex: 1, gap: 2, minWidth: 0, paddingTop: 1 },
  headerSaveButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 11, flexDirection: "row", gap: 4, justifyContent: "center", minHeight: 38, paddingHorizontal: 8 },
  headerSaveText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  clearFormButton: { alignItems: "center", backgroundColor: "#FEE4E2", borderColor: "#F04438", borderRadius: 10, borderWidth: 1.5, flexDirection: "row", gap: 4, paddingHorizontal: 7, paddingVertical: 7 },
  clearFormText: { color: "#B42318", fontSize: 11, fontWeight: "800" },
  title: { color: "#101828", fontSize: 22, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 11, lineHeight: 15 },
  scanSummaryCard: { backgroundColor: "#F0F9F5", borderColor: "#8BC8B3", borderRadius: 18, borderWidth: 1, marginBottom: 14, padding: 14 },
  scanSummaryHeader: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  scanSummaryTitleRow: { alignItems: "center", flex: 1, flexDirection: "row", gap: 9 },
  scanSummaryIcon: { alignItems: "center", backgroundColor: "#DDF4E9", borderRadius: 10, height: 36, justifyContent: "center", width: 36 },
  scanSummaryTitle: { color: "#14532D", fontSize: 14, fontWeight: "900" },
  scanSummarySubtitle: { color: "#477A63", fontSize: 11, marginTop: 2 },
  scanSummarySuccess: { alignItems: "center", flexDirection: "row", gap: 4 },
  scanSummarySuccessText: { color: "#039855", fontSize: 11, fontWeight: "800" },
  scanSummaryBody: { borderTopColor: "#C7E7D8", borderTopWidth: 1, flexDirection: "row", gap: 12, marginTop: 12, paddingTop: 12 },
  scanSummaryImages: { flexDirection: "row", flexWrap: "wrap", gap: 5, width: 104 },
  scanSummaryImage: { backgroundColor: "#DDEBE4", borderRadius: 8, height: 47, width: 47 },
  scanSummaryNoImage: { alignItems: "center", backgroundColor: "#E7F1EC", borderRadius: 9, height: 99, justifyContent: "center", width: 104 },
  scanSummaryNoImageText: { color: "#667085", fontSize: 10, marginTop: 3 },
  scanSummaryDetails: { flex: 1, justifyContent: "center" },
  scanSummaryDetailLabel: { color: "#477A63", fontSize: 11, fontWeight: "700" },
  barcodeValueRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#B7D8CE", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 7, marginTop: 5, paddingHorizontal: 9, paddingVertical: 8 },
  barcodeValue: { color: "#101828", flex: 1, fontSize: 15, fontWeight: "900", letterSpacing: 0.4 },
  scanSummaryMeta: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  scanSummaryMetaText: { color: "#477A63", fontSize: 11, fontWeight: "700" },
  formCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, padding: 18 },
  field: { marginBottom: 18 },
  imageField: { marginBottom: 18 },
  imageLabelRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  imageCount: { color: "#1F6F5B", fontSize: 12, fontWeight: "800", marginBottom: 7 },
  imageActionsRow: { flexDirection: "row", gap: 9 },
  productImage: { height: "100%", width: "100%" },
  imageActionButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 10, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 34 },
  imageActionButtonWide: { flex: 1, minHeight: 40 },
  imageActionText: { color: "#1F6F5B", fontSize: 12, fontWeight: "800" },
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 11 },
  imageTile: { backgroundColor: "#F2F4F7", borderRadius: 12, height: 76, overflow: "hidden", position: "relative", width: 76 },
  removeImageCircle: { alignItems: "center", backgroundColor: "rgba(180,35,24,0.92)", borderRadius: 10, height: 20, justifyContent: "center", position: "absolute", right: 4, top: 4, width: 20 },
  imageEmpty: { alignItems: "center", backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 13, borderStyle: "dashed", borderWidth: 1, flexDirection: "row", gap: 9, justifyContent: "center", marginTop: 11, minHeight: 76 },
  imageEmptyText: { color: "#667085", fontSize: 13, fontWeight: "700" },
  imageHint: { color: "#667085", fontSize: 11, lineHeight: 16, marginTop: 8 },
  label: { color: "#344054", fontSize: 14, fontWeight: "700", marginBottom: 7 },
  optionalLabel: { color: "#98A2B3", fontSize: 12, fontWeight: "600" },
  input: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, color: "#101828", fontSize: 16, minHeight: 48, paddingHorizontal: 13 },
  categoryHint: { color: "#667085", fontSize: 12, lineHeight: 17, marginTop: 7 },
  categorySuggestionList: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  categorySuggestion: { backgroundColor: "#F2F4F7", borderColor: "#D0D5DD", borderRadius: 999, borderWidth: 1, minHeight: 32, justifyContent: "center", paddingHorizontal: 11 },
  categorySuggestionActive: { backgroundColor: "#E8F3EF", borderColor: "#1F6F5B" },
  categorySuggestionText: { color: "#475467", fontSize: 12, fontWeight: "700" },
  categorySuggestionTextActive: { color: "#1F6F5B" },
  gradeOptionList: { flexDirection: "row", gap: 8, marginTop: 10 },
  gradeOption: { alignItems: "center", borderRadius: 13, borderWidth: 1, flex: 1, gap: 6, minHeight: 58, justifyContent: "center", paddingHorizontal: 6 },
  gradeBadge: { alignItems: "center", borderRadius: 999, height: 28, justifyContent: "center", width: 28 },
  gradeBadgeText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  gradeOptionText: { fontSize: 11, fontWeight: "800" },
  codeInputRow: { alignItems: "center", flexDirection: "row", gap: 9 },
  nameReadyHighlight: { borderRadius: 14, borderWidth: 1, marginHorizontal: -4, padding: 4 },
  codeInput: { flex: 1 },
  productNameInput: { minHeight: 52, fontSize: 17, paddingVertical: 13 },
  nameSuggestionSection: { backgroundColor: "#F0F9F5", borderRadius: 12, gap: 7, marginTop: 9, padding: 10 },
  nameSuggestionLabel: { color: "#1F6F5B", fontSize: 12, fontWeight: "800" },
  nameSuggestionList: { gap: 7 },
  nameSuggestionChip: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#B7D8CE", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 7, minHeight: 40, paddingHorizontal: 10 },
  nameSuggestionText: { color: "#101828", flex: 1, fontSize: 14, fontWeight: "700" },
  autocompleteRow: { alignItems: "center", backgroundColor: "#DDF4E9", borderRadius: 9, flexDirection: "row", gap: 8, minHeight: 48, paddingHorizontal: 10 },
  autocompleteCopy: { flex: 1, gap: 1 },
  autocompleteLabel: { color: "#1F6F5B", fontSize: 11, fontWeight: "800" },
  autocompleteValue: { color: "#101828", fontSize: 15, fontWeight: "800" },
  sameNameNotice: { alignItems: "flex-start", backgroundColor: "#EEF4FF", borderColor: "#C7D7FE", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 7, marginTop: 8, padding: 9 },
  sameNameNoticeText: { color: "#1D4ED8", flex: 1, fontSize: 11, lineHeight: 16 },
  sameNameNoticeCopy: { flex: 1, gap: 6 },
  templatePickerButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderColor: "#C7D7FE", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 3, paddingHorizontal: 9, paddingVertical: 6 },
  templatePickerButtonText: { color: "#1D4ED8", fontSize: 12, fontWeight: "800" },
  templateList: { marginTop: 14, maxHeight: 280 },
  templateFilterRow: { flexDirection: "row", gap: 8, marginTop: 14 },
  templateFilterField: { flex: 1, position: "relative" },
  templateFilterInput: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 10, borderWidth: 1, color: "#101828", flex: 1, fontSize: 13, minHeight: 42, paddingHorizontal: 10, paddingRight: 34 },
  templateFilterClearAnimated: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  templateFilterClearButton: { alignItems: "center", backgroundColor: "#E4E7EC", borderRadius: 10, height: 22, justifyContent: "center", position: "absolute", right: 9, top: 10, width: 22 },
  templateFilterClearButtonHidden: { opacity: 0 },
  templateFilterTooltip: { backgroundColor: "#101828", borderRadius: 6, bottom: 39, color: "#FFFFFF", fontSize: 11, maxWidth: 170, paddingHorizontal: 8, paddingVertical: 6, position: "absolute", right: 0, zIndex: 10 },
  clearTemplateFiltersButton: { alignItems: "center", alignSelf: "flex-end", borderColor: "#FECACA", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 5, marginTop: 8, paddingHorizontal: 9, paddingVertical: 6 },
  clearTemplateFiltersButtonDisabled: { borderColor: "#E4E7EC", opacity: 0.8 },
  clearTemplateFiltersText: { color: "#B42318", fontSize: 11, fontWeight: "800" },
  clearTemplateFiltersTextDisabled: { color: "#98A2B3" },
  templateResultCount: { color: "#667085", fontSize: 11, marginTop: 7 },
  templateEmpty: { alignItems: "center", gap: 6, justifyContent: "center", minHeight: 100 },
  templateEmptyText: { color: "#667085", fontSize: 13 },
  templateRow: { alignItems: "center", borderColor: "#E4E7EC", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 9, marginBottom: 8, padding: 9 },
  templateImageFrame: { borderRadius: 10, height: 68, overflow: "hidden", position: "relative", width: 68 },
  templateImage: { height: 68, width: 68 },
  templateThumbnailBadge: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.68)", bottom: 0, flexDirection: "row", gap: 3, justifyContent: "center", left: 0, paddingVertical: 3, position: "absolute", right: 0 },
  templateThumbnailBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  templateImageEmpty: { alignItems: "center", backgroundColor: "#F2F4F7", borderRadius: 10, height: 68, justifyContent: "center", width: 68 },
  templateImageEmptyText: { color: "#98A2B3", fontSize: 9, marginTop: 2 },
  templateCopy: { flex: 1, gap: 4 },
  templateLocation: { color: "#344054", fontSize: 13, fontWeight: "800" },
  templateDetails: { color: "#667085", fontSize: 11, lineHeight: 15 },
  clearNameButton: { alignItems: "center", backgroundColor: "#F2F4F7", borderRadius: 14, height: 28, justifyContent: "center", width: 28 },
  scanButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 12, height: 48, justifyContent: "center", width: 48 },
  codeHint: { color: "#667085", fontSize: 12, lineHeight: 17, marginTop: 6 },
  lotHint: { alignItems: "flex-start", backgroundColor: "#E8F3EF", borderRadius: 12, flexDirection: "row", gap: 8, marginTop: -7, marginBottom: 18, padding: 10 },
  lotHintText: { color: "#475467", flex: 1, fontSize: 12, lineHeight: 17 },
  lotUseText: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  locationHeaderRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  copyLocationButton: { alignItems: "center", borderColor: "#B7D8CE", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  copyLocationText: { color: "#1F6F5B", fontSize: 12, fontWeight: "800" },
  rowFields: { flexDirection: "row", gap: 10 },
  locationField: { flex: 1 },
  insertPositionOption: { alignItems: "center", backgroundColor: "#F8FAFC", borderColor: "#D0D5DD", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: -5, marginBottom: 17, padding: 11 },
  insertPositionOptionActive: { backgroundColor: "#E8F3EF", borderColor: "#1F6F5B" },
  insertPositionIcon: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#B7D8CE", borderRadius: 10, borderWidth: 1, height: 31, justifyContent: "center", width: 31 },
  insertPositionIconActive: { backgroundColor: "#1F6F5B", borderColor: "#1F6F5B" },
  insertPositionCopy: { flex: 1 },
  insertPositionTitle: { color: "#344054", fontSize: 13, fontWeight: "800" },
  insertPositionTitleActive: { color: "#1F6F5B" },
  insertPositionText: { color: "#667085", fontSize: 11, lineHeight: 16, marginTop: 2 },
  positionSuggestion: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 13, flexDirection: "row", gap: 9, marginTop: -4, marginBottom: 17, padding: 11 },
  positionSuggestionIcon: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 10, height: 30, justifyContent: "center", width: 30 },
  positionSuggestionCopy: { flex: 1 },
  positionSuggestionLabel: { color: "#475467", fontSize: 12, fontWeight: "700" },
  positionSuggestionValue: { color: "#1F6F5B", fontSize: 13, fontWeight: "800", marginTop: 2 },
  positionSuggestionAction: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  dateTypeSwitch: { backgroundColor: "#F2F4F7", borderRadius: 12, flexDirection: "row", gap: 5, marginBottom: 18, padding: 4 },
  dateTypeButton: { alignItems: "center", borderRadius: 9, flex: 1, minHeight: 40, justifyContent: "center" },
  dateTypeButtonActive: { backgroundColor: "#1F6F5B" },
  dateTypeText: { color: "#667085", fontSize: 14, fontWeight: "700" },
  dateTypeTextActive: { color: "#FFFFFF" },
  datePartsRow: { flexDirection: "row", gap: 9 },
  datePart: { flex: 1, gap: 6 },
  datePartYear: { flex: 1.35 },
  datePartLabel: { color: "#667085", fontSize: 12, fontWeight: "700" },
  datePartInput: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, color: "#101828", fontSize: 16, minHeight: 48, paddingHorizontal: 11, textAlign: "center" },
  calculatedCard: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 13, flexDirection: "row", gap: 10, marginTop: -4, marginBottom: 16, padding: 12 },
  calculatedCopy: { flex: 1, gap: 2 },
  calculatedLabel: { color: "#475467", fontSize: 12, fontWeight: "700" },
  calculatedValue: { color: "#1F6F5B", fontSize: 16, fontWeight: "800" },
  hint: { alignItems: "center", flexDirection: "row", gap: 7, marginTop: -4 },
  hintText: { color: "#667085", fontSize: 13 },
  saveButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 15, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 20, minHeight: 54 },
  saveButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  saveAndAddButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderColor: "#9CCBBB", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 10, minHeight: 50, paddingHorizontal: 14 },
  saveAndAddText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  newLotButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderColor: "#B7D8CE", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 10, justifyContent: "center", marginTop: 10, minHeight: 56, paddingHorizontal: 16 },
  newLotCopy: { gap: 2 },
  newLotTitle: { color: "#1F6F5B", fontSize: 15, fontWeight: "800", textAlign: "center" },
  newLotSubtitle: { color: "#667085", fontSize: 11, textAlign: "center" },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.55)", flex: 1, justifyContent: "center", padding: 22 },
  modalCard: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 20, width: "100%" },
  saveConfirmCard: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 22, width: "100%" },
  saveConfirmIcon: { alignItems: "center", alignSelf: "center", backgroundColor: "#E8F3EF", borderRadius: 28, height: 56, justifyContent: "center", marginBottom: 12, width: 56 },
  saveConfirmDetails: { backgroundColor: "#F8FAFC", borderColor: "#E4E7EC", borderRadius: 12, borderWidth: 1, gap: 10, marginTop: 15, padding: 12 },
  saveConfirmRow: { flexDirection: "row", gap: 10 },
  saveConfirmLabel: { color: "#667085", fontSize: 12, fontWeight: "700", width: 93 },
  saveConfirmValue: { color: "#101828", flex: 1, fontSize: 12, fontWeight: "800" },
  clearConfirmCard: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 22, width: "100%" },
  clearConfirmIcon: { alignItems: "center", alignSelf: "center", backgroundColor: "#FEE4E2", borderRadius: 28, height: 56, justifyContent: "center", marginBottom: 12, width: 56 },
  clearConfirmButton: { alignItems: "center", backgroundColor: "#B42318", borderRadius: 11, flex: 1, flexDirection: "row", gap: 6, justifyContent: "center", minHeight: 46, paddingHorizontal: 12 },
  clearConfirmText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  modalTitle: { color: "#101828", fontSize: 19, fontWeight: "800" },
  modalCopy: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: 7 },
  modalInput: { backgroundColor: "#F9FAFB", borderColor: "#1F6F5B", borderRadius: 12, borderWidth: 1, color: "#101828", fontSize: 17, lineHeight: 24, marginTop: 15, minHeight: 54, paddingHorizontal: 13, paddingVertical: 12 },
  ocrChecking: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 11 },
  ocrCheckingText: { color: "#667085", fontSize: 12 },
  ocrProgressCard: { alignItems: "center", backgroundColor: "#F0F9F5", borderColor: "#B7D8CE", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 9, marginTop: 11, padding: 11 },
  ocrProgressCardFailed: { backgroundColor: "#FFF4ED", borderColor: "#FECBA1" },
  ocrProgressCardSuccess: { backgroundColor: "#ECFDF3", borderColor: "#A6F4C5" },
  ocrProgressCopy: { flex: 1, gap: 2 },
  ocrProgressTitle: { color: "#344054", fontSize: 12, fontWeight: "800" },
  ocrProgressText: { color: "#667085", fontSize: 11, lineHeight: 16 },
  ocrReportPanel: { transformOrigin: "top" },
  ocrCorrectedLabel: { color: "#7A271A", fontSize: 11, fontWeight: "700", marginTop: 8 },
  ocrCorrectedInput: { backgroundColor: "#FFFFFF", borderColor: "#FECBA1", borderRadius: 8, borderWidth: 1, color: "#101828", fontSize: 13, marginTop: 5, minHeight: 38, paddingHorizontal: 10, paddingVertical: 7 },
  ocrCorrectedInputWarning: { borderColor: "#B42318", backgroundColor: "#FFF8F7" },
  ocrDuplicateWarning: { alignItems: "flex-start", flexDirection: "row", gap: 5, marginTop: 5 },
  ocrDuplicateWarningText: { color: "#B42318", flex: 1, fontSize: 11, lineHeight: 16 },
  ocrReportButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 5, marginTop: 7, paddingVertical: 3 },
  ocrReportText: { color: "#B42318", fontSize: 11, fontWeight: "800" },
  ocrConfirmButton: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 5, marginTop: 4, paddingVertical: 3 },
  ocrConfirmText: { color: "#1F6F5B", fontSize: 11, fontWeight: "800" },
  ocrResolvedRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 8 },
  ocrResolvedText: { color: "#1F6F5B", flex: 1, fontSize: 11, fontWeight: "700" },
  ocrUndoButton: { alignItems: "center", flexDirection: "row", gap: 4, paddingHorizontal: 5, paddingVertical: 3 },
  ocrUndoText: { color: "#667085", fontSize: 11, fontWeight: "700" },
  ocrSuggestionBox: { backgroundColor: "#F0F9F5", borderRadius: 12, gap: 7, marginTop: 11, padding: 11 },
  ocrSuggestionTitle: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  ocrSuggestionCopy: { color: "#667085", fontSize: 11, lineHeight: 16 },
  ocrSuggestion: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#B7D8CE", borderRadius: 9, borderWidth: 1, flexDirection: "row", gap: 7, minHeight: 38, paddingHorizontal: 9 },
  ocrSuggestionText: { color: "#101828", flex: 1, fontSize: 14, fontWeight: "700" },
  ocrUseText: { color: "#1F6F5B", fontSize: 12, fontWeight: "800" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 15 },
  modalCancel: { alignItems: "center", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 46 },
  modalConfirm: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 12, flex: 1, justifyContent: "center", minHeight: 46 },
  modalCancelText: { color: "#475467", fontSize: 14, fontWeight: "800" },
  modalActionText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.8 },
  labelCameraModal: { backgroundColor: "#000000", flex: 1 },
  labelCameraOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28 },
  labelCameraTopBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  cameraCloseButton: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  cameraTopSpacer: { height: 44, width: 44 },
  cameraTorchButtonActive: { backgroundColor: "rgba(245,158,11,0.78)" },
  cameraPresetRow: { flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 14, width: "100%" },
  productPhotoGuide: { alignItems: "center", justifyContent: "center" },
  cameraPresetButton: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.52)", borderColor: "rgba(255,255,255,0.38)", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, minHeight: 34, paddingHorizontal: 12 },
  cameraPresetButtonActive: { backgroundColor: "#D1FAE5", borderColor: "#6EE7B7" },
  cameraPresetText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  cameraPresetTextActive: { color: "#0F5132" },
  cameraZoomControls: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 16 },
  cameraControlButton: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  cameraZoomValue: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 18, minWidth: 64, paddingHorizontal: 12, paddingVertical: 9 },
  cameraZoomValueText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  cameraSliderRow: { alignItems: "center", flexDirection: "row", gap: 7, marginBottom: 14, width: "100%" },
  cameraSlider: { flex: 1, height: 36 },
  cameraSliderLabel: { color: "rgba(255,255,255,0.88)", fontSize: 11, fontWeight: "800", width: 34 },
  labelCameraTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  labelTargetArea: { alignItems: "center", justifyContent: "center" },
  labelTargetFrame: { borderColor: "rgba(255,255,255,0.65)", borderRadius: 14, borderWidth: 1.5, height: 150, maxWidth: 390, position: "relative", width: "92%" },
  targetCorner: { borderColor: "#34D399", height: 28, position: "absolute", width: 28 },
  targetCornerTopLeft: { borderLeftWidth: 4, borderTopWidth: 4, left: -2, top: -2 },
  targetCornerTopRight: { borderRightWidth: 4, borderTopWidth: 4, right: -2, top: -2 },
  targetCornerBottomLeft: { borderBottomWidth: 4, borderLeftWidth: 4, bottom: -2, left: -2 },
  targetCornerBottomRight: { borderBottomWidth: 4, borderRightWidth: 4, bottom: -2, right: -2 },
  labelTargetHint: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", marginTop: 18, textAlign: "center" },
  labelTargetSubhint: { color: "rgba(255,255,255,0.82)", fontSize: 12, marginTop: 5, textAlign: "center" },
  labelCameraBottomBar: { alignItems: "center", gap: 10 },
  productPhotoFrame: { alignItems: "center", borderColor: "rgba(255,255,255,0.78)", borderRadius: 18, borderStyle: "dashed", borderWidth: 2, height: 190, justifyContent: "center", width: "78%" },
  productCameraBottomBar: { alignItems: "center", gap: 10 },
  skipPhotoButton: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.55)", borderColor: "rgba(255,255,255,0.72)", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 6, minHeight: 42, paddingHorizontal: 14 },
  skipPhotoText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  captureLabelButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "rgba(255,255,255,0.55)", borderRadius: 40, borderWidth: 4, height: 76, justifyContent: "center", width: 76 },
  captureLabelInner: { backgroundColor: "#1F6F5B", borderRadius: 29, height: 58, width: 58 },
  captureLabelHint: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  toast: { alignItems: "center", alignSelf: "center", borderRadius: 16, bottom: 24, elevation: 8, flexDirection: "row", gap: 9, maxWidth: "92%", paddingHorizontal: 15, paddingVertical: 12, position: "absolute", shadowColor: "#101828", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10 },
  toastOcr: { backgroundColor: "#1D4ED8" },
  toastSaved: { backgroundColor: "#166534" },
  toastInfo: { backgroundColor: "#344054" },
  toastWarning: { backgroundColor: "#9A3412" },
  toastIcon: { alignItems: "center", borderRadius: 10, height: 25, justifyContent: "center", width: 25 },
  toastIconOcr: { backgroundColor: "#60A5FA" },
  toastIconSaved: { backgroundColor: "#22C55E" },
  toastIconInfo: { backgroundColor: "#667085" },
  toastIconWarning: { backgroundColor: "#FB923C" },
  toastText: { color: "#FFFFFF", flexShrink: 1, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  disabledButton: { opacity: 0.45 },
});
