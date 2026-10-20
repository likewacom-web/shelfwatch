import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as DocumentPicker from "expo-document-picker";
import Constants from "expo-constants";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { checkForUpdateManually } from "@/components/update-prompt";
import { getDisplayAppVersion } from "@/lib/app-version";
import { CURRENT_CHANGELOG } from "@/lib/changelog";
import { getNativeBuildDownloadUrl, getNativeBuildVersion } from "@/lib/native-build";
import { getUpdateConnectionStatus } from "@/lib/update-status";
import { clearExpiryNotifications, requestExpiryNotificationPermission, sendTestExpiryNotification, syncExpiryNotifications } from "@/lib/expiry-notifications";
import { getInventoryBackupRestorePreview, getInventoryBackupSummary, parseInventoryBackup, serializeInventoryBackup, type InventoryBackup } from "@/lib/inventory-backup";
import { hydrateBackupImages, readInventoryBackupText, saveAndShareInventoryBackup } from "@/lib/inventory-backup-files";
import { useInventory } from "@/lib/inventory-context";

const QUICK_THRESHOLD_OPTIONS = [1, 3, 7, 14, 30];
const QUICK_LOW_STOCK_OPTIONS = [1, 3, 5, 10];
const BRAND_COLOR_OPTIONS = ["#1D4ED8", "#0F766E", "#7C3AED", "#DB2777", "#EA580C", "#4F46E5"];
const APP_VERSION = getDisplayAppVersion(Constants.nativeApplicationVersion, Constants.expoConfig?.version);
const NATIVE_BUILD_DOWNLOAD_URL = getNativeBuildDownloadUrl(Constants.expoConfig?.extra?.nativeBuildUrl);
const NATIVE_BUILD_VERSION = getNativeBuildVersion(Constants.expoConfig?.extra?.nativeBuildVersion);

type BackupOperation = "export" | "restore";
interface BackupProgressState {
  operation: BackupOperation;
  percent: number;
  message: string;
}

function ChangelogModal({ visible, version, brandColor, onClose }: { visible: boolean; version: string; brandColor: string; onClose: () => void }) {
  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.previewOverlay} accessibilityViewIsModal>
        <View style={styles.changelogDialog}>
          <View style={[styles.previewHeroIcon, { backgroundColor: `${brandColor}18` }]}><MaterialIcons name="new-releases" size={25} color={brandColor} /></View>
          <Text style={styles.previewTitle}>รายละเอียดการเปลี่ยนแปลง</Text>
          <Text style={styles.changelogVersion}>เวอร์ชันปัจจุบัน {version}</Text>
          <ScrollView style={styles.previewScroll} contentContainerStyle={styles.changelogScrollContent} showsVerticalScrollIndicator={false}>
            {CURRENT_CHANGELOG.map((item) => (
              <View key={item.title} style={styles.changelogRow}>
                <View style={[styles.changelogIcon, { backgroundColor: `${brandColor}18` }]}><MaterialIcons name={item.icon as ComponentProps<typeof MaterialIcons>["name"]} size={20} color={brandColor} /></View>
                <View style={styles.changelogCopy}><Text style={styles.changelogItemTitle}>{item.title}</Text><Text style={styles.changelogItemDescription}>{item.description}</Text></View>
              </View>
            ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.changelogCloseButton, { backgroundColor: brandColor }, pressed && styles.pressed]}><Text style={styles.changelogCloseText}>ปิด</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

function BackupProgressModal({ progress, brandColor }: { progress: BackupProgressState | null; brandColor: string }) {
  const animatedProgress = useRef(new Animated.Value(0)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));
  const isVisible = Boolean(progress);
  const fillWidth = animatedProgress.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });

  useEffect(() => {
    if (!progress) {
      animatedProgress.setValue(0);
      return;
    }
    Animated.timing(animatedProgress, { toValue: percent, duration: 260, useNativeDriver: false }).start();
  }, [animatedProgress, percent, progress]);

  useEffect(() => {
    if (!isVisible) {
      iconPulse.setValue(1);
      return;
    }
    const pulseAnimation = Animated.loop(Animated.sequence([
      Animated.timing(iconPulse, { toValue: 1.08, duration: 650, useNativeDriver: true }),
      Animated.timing(iconPulse, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]));
    pulseAnimation.start();
    return () => pulseAnimation.stop();
  }, [iconPulse, isVisible]);

  const isExport = progress?.operation === "export";
  return (
    <Modal transparent visible={Boolean(progress)} animationType="fade" statusBarTranslucent>
      <View style={styles.progressOverlay} accessibilityViewIsModal>
        <View style={styles.progressDialog}>
          <Animated.View style={[styles.progressIcon, { backgroundColor: `${brandColor}18`, transform: [{ scale: iconPulse }] }]}>
            <ActivityIndicator size="small" color={brandColor} />
          </Animated.View>
          <Text style={styles.progressTitle}>{isExport ? "กำลังสำรองข้อมูล" : "กำลังกู้คืนข้อมูล"}</Text>
          <Text style={styles.progressMessage} accessibilityLiveRegion="polite">{progress?.message}</Text>
          <View style={styles.progressTrack}><Animated.View style={[styles.progressFill, { backgroundColor: brandColor, width: fillWidth }]} /></View>
          <Text style={[styles.progressPercent, { color: brandColor }]}>{Math.round(percent)}%</Text>
          <Text style={styles.progressFootnote}>โปรดรอจนกว่ากระบวนการจะเสร็จสิ้น</Text>
        </View>
      </View>
    </Modal>
  );
}

function formatBackupCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function RestorePreviewModal({ backup, brandColor, onCancel, onConfirm }: { backup: InventoryBackup | null; brandColor: string; onCancel: () => void; onConfirm: () => void }) {
  if (!backup) return null;
  const preview = getInventoryBackupRestorePreview(backup);
  const metrics = [
    { icon: "inventory-2" as const, label: "สินค้า", value: preview.productCount },
    { icon: "layers" as const, label: "ล็อต", value: preview.lotCount },
    { icon: "history" as const, label: "ประวัติ", value: preview.historyCount },
    { icon: "image" as const, label: "รูปภาพ", value: preview.imageCount },
  ];

  return (
    <Modal transparent visible animationType="slide" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.previewOverlay} accessibilityViewIsModal>
        <View style={styles.previewDialog}>
          <View style={[styles.previewHeroIcon, { backgroundColor: `${brandColor}18` }]}><MaterialIcons name="fact-check" size={25} color={brandColor} /></View>
          <Text style={styles.previewTitle}>ตรวจสอบก่อนกู้คืน</Text>
          <Text style={styles.previewSubtitle}>โปรดตรวจสอบข้อมูลในไฟล์สำรองก่อนแทนที่ข้อมูล ShelfWatch ที่อยู่ในอุปกรณ์</Text>
          <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewScrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.previewMeta}><MaterialIcons name="schedule" size={17} color="#475467" /><Text style={styles.previewMetaText}>สำรองเมื่อ {formatBackupCreatedAt(preview.createdAt)}</Text></View>
            <View style={[styles.previewActiveProfile, { borderColor: `${brandColor}40`, backgroundColor: `${brandColor}0D` }]}><MaterialIcons name="person" size={19} color={brandColor} /><View style={styles.previewActiveCopy}><Text style={styles.previewActiveLabel}>ผู้ใช้ที่กำลังใช้งานหลังการกู้คืน</Text><Text style={[styles.previewActiveName, { color: brandColor }]}>{preview.activeProfileName}</Text></View></View>
            <View style={styles.previewMetrics}>{metrics.map((metric) => <View key={metric.label} style={styles.previewMetric}><MaterialIcons name={metric.icon} size={19} color={brandColor} /><Text style={styles.previewMetricValue}>{metric.value}</Text><Text style={styles.previewMetricLabel}>{metric.label}</Text></View>)}</View>
            <Text style={styles.previewSectionTitle}>ผู้ใช้และคลังสินค้าในไฟล์ ({preview.profileCount})</Text>
            {preview.profiles.map((profile) => <View key={profile.id} style={styles.previewProfileRow}><View style={[styles.previewAvatar, { backgroundColor: `${brandColor}18` }]}><Text style={[styles.previewAvatarText, { color: brandColor }]}>{profile.displayName.slice(0, 1)}</Text></View><View style={styles.previewProfileCopy}><View style={styles.previewProfileTitleRow}><Text style={styles.previewProfileName} numberOfLines={1}>{profile.displayName}</Text>{profile.isActiveProfile ? <View style={[styles.previewCurrentBadge, { backgroundColor: `${brandColor}18` }]}><Text style={[styles.previewCurrentBadgeText, { color: brandColor }]}>กำลังใช้งาน</Text></View> : null}</View><Text style={styles.previewStorageName} numberOfLines={1}>{profile.storageName}</Text><Text style={styles.previewProfileStats}>{profile.productCount} สินค้า · {profile.lotCount} ล็อต · {profile.historyCount} เหตุการณ์</Text></View></View>)}
            <View style={styles.previewWarning}><MaterialIcons name="warning-amber" size={19} color="#B54708" /><Text style={styles.previewWarningText}>เมื่อยืนยัน ข้อมูลผู้ใช้ สินค้า ล็อต การตั้งค่า และประวัติที่อยู่ในอุปกรณ์จะถูกแทนที่ด้วยข้อมูลในไฟล์นี้</Text></View>
          </ScrollView>
          <View style={styles.previewActions}><Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.previewCancelButton, pressed && styles.pressed]}><Text style={styles.previewCancelText}>กลับไปเลือกไฟล์</Text></Pressable><Pressable accessibilityRole="button" onPress={onConfirm} style={({ pressed }) => [styles.previewConfirmButton, { backgroundColor: brandColor }, pressed && styles.pressed]}><Text style={styles.previewConfirmText}>ยืนยันกู้คืน</Text></Pressable></View>
        </View>
      </View>
    </Modal>
  );
}

function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getBackupImageBytes(backup: InventoryBackup): number {
  return backup.images.reduce((total, image) => {
    const padding = image.base64.endsWith("==") ? 2 : image.base64.endsWith("=") ? 1 : 0;
    return total + Math.max(0, Math.floor(image.base64.length * 0.75) - padding);
  }, 0);
}

function ExportPreviewModal({ backup, brandColor, onCancel, onConfirm }: { backup: InventoryBackup | null; brandColor: string; onCancel: () => void; onConfirm: () => void }) {
  if (!backup) return null;
  const summary = getInventoryBackupSummary(backup);
  const imageBytes = getBackupImageBytes(backup);
  return <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
    <View style={styles.previewBackdrop}><View style={styles.previewDialog}>
      <View style={[styles.previewHeroIcon, { backgroundColor: `${brandColor}18` }]}><MaterialIcons name="backup" size={25} color={brandColor} /></View>
      <Text style={styles.previewTitle}>ตรวจสอบก่อนสำรองข้อมูล</Text>
      <Text style={styles.previewSubtitle}>ตรวจสอบจำนวนข้อมูลและรูปภาพก่อนสร้างไฟล์สำรอง</Text>
      <View style={styles.exportSummaryGrid}>
        <View style={styles.exportSummaryMetric}><MaterialIcons name="inventory-2" size={20} color={brandColor} /><Text style={styles.previewMetricValue}>{summary.productCount}</Text><Text style={styles.previewMetricLabel}>สินค้า</Text></View>
        <View style={styles.exportSummaryMetric}><MaterialIcons name="layers" size={20} color={brandColor} /><Text style={styles.previewMetricValue}>{summary.historyCount}</Text><Text style={styles.previewMetricLabel}>ประวัติ</Text></View>
        <View style={styles.exportSummaryMetric}><MaterialIcons name="image" size={20} color={brandColor} /><Text style={styles.previewMetricValue}>{summary.imageCount}</Text><Text style={styles.previewMetricLabel}>รูปภาพ</Text></View>
      </View>
      <View style={[styles.exportSizeRow, { borderColor: `${brandColor}35`, backgroundColor: `${brandColor}0D` }]}><MaterialIcons name="data-usage" size={20} color={brandColor} /><View style={styles.exportSizeCopy}><Text style={styles.exportSizeLabel}>ขนาดรูปภาพรวม</Text><Text style={[styles.exportSizeValue, { color: brandColor }]}>{formatBackupSize(imageBytes)}</Text></View></View>
      <Text style={styles.exportSummaryNote}>ไฟล์สำรองจะรวมผู้ใช้ {summary.profileCount} คน การตั้งค่า ล็อต ประวัติ และรูปภาพที่อ่านได้ทั้งหมด</Text>
      {backup.skippedImageCount ? <View style={styles.exportImageWarning}><MaterialIcons name="error-outline" size={19} color="#B42318" /><Text style={styles.exportImageWarningText}>ไม่สามารถอ่านหรือบีบอัดรูปภาพได้ {backup.skippedImageCount} รูป รูปเหล่านี้จะไม่ถูกรวมในไฟล์สำรอง</Text></View> : null}
      <View style={styles.previewActions}><Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.previewCancelButton, pressed && styles.pressed]}><Text style={styles.previewCancelText}>ยกเลิก</Text></Pressable><Pressable accessibilityRole="button" onPress={onConfirm} style={({ pressed }) => [styles.previewConfirmButton, { backgroundColor: brandColor }, pressed && styles.pressed]}><MaterialIcons name="file-upload" size={18} color="#FFFFFF" /><Text style={styles.previewConfirmText}>ยืนยันสำรอง</Text></Pressable></View>
    </View></View>
  </Modal>;
}

export default function SettingsScreen() {
  const { products, settings, updateSettings, exportBackupData, restoreBackupData } = useInventory();
  const [threshold, setThreshold] = useState(String(settings.nearExpiryDays));
  const [lowStockThreshold, setLowStockThreshold] = useState(String(settings.lowStockThreshold));
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupProgress, setBackupProgress] = useState<BackupProgressState | null>(null);
  const [pendingRestoreBackup, setPendingRestoreBackup] = useState<InventoryBackup | null>(null);
  const [pendingExportBackup, setPendingExportBackup] = useState<InventoryBackup | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isChangelogVisible, setIsChangelogVisible] = useState(false);

  const errorMessage = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

  const checkForUpdates = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      const result = await checkForUpdateManually();
      if (result === "none") Alert.alert("ใช้งานเวอร์ชันล่าสุดแล้ว", "ShelfWatch ของคุณเป็นเวอร์ชันล่าสุด");
      else if (result === "unsupported") Alert.alert("ยังไม่พร้อมตรวจสอบอัปเดต", "ฟังก์ชันนี้ใช้ได้เมื่อเปิดแอปจาก Native Build ที่เชื่อมต่อระบบ OTA แล้ว หากเป็นแอปทดสอบหรือเวอร์ชันที่ยังไม่ได้ตั้งค่า EAS Update กรุณาอัปเดตแอปผ่านไฟล์ติดตั้งรุ่นใหม่");
      else if (result === "error") Alert.alert("ตรวจสอบอัปเดตไม่สำเร็จ", "กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const downloadNativeBuild = async () => {
    if (!NATIVE_BUILD_DOWNLOAD_URL) {
      Alert.alert("ยังไม่มีลิงก์ดาวน์โหลด", "ผู้ดูแลระบบยังไม่ได้ตั้งค่าลิงก์ Native Build กรุณาติดตั้งแอปจากไฟล์รุ่นล่าสุดที่ได้รับจากผู้ดูแล");
      return;
    }
    try {
      if (await Linking.canOpenURL(NATIVE_BUILD_DOWNLOAD_URL)) await Linking.openURL(NATIVE_BUILD_DOWNLOAD_URL);
      else Alert.alert("เปิดลิงก์ไม่ได้", "ไม่สามารถเปิดหน้าดาวน์โหลด Native Build บนอุปกรณ์นี้ได้");
    } catch (error) {
      Alert.alert("เปิดหน้าดาวน์โหลดไม่สำเร็จ", errorMessage(error, "กรุณาลองใหม่อีกครั้ง"));
    }
  };

  const applyBrandColor = async (brandColor: string) => {
    await updateSettings({ brandColor });
  };

  const applyColorScheme = async (colorScheme: "light" | "dark") => {
    await updateSettings({ colorScheme });
  };

  const applyThreshold = async (value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 90) {
      Alert.alert("จำนวนวันไม่ถูกต้อง", "โปรดระบุจำนวนวันตั้งแต่ 1 ถึง 90 วัน");
      setThreshold(String(settings.nearExpiryDays));
      return;
    }
    setThreshold(String(value));
    setIsSaving(true);
    const nextSettings = { ...settings, nearExpiryDays: value };
    try {
      await updateSettings({ nearExpiryDays: value });
      if (nextSettings.notificationsEnabled) await syncExpiryNotifications(products, nextSettings);
    } finally {
      setIsSaving(false);
    }
  };

  const saveThreshold = async () => applyThreshold(Number(threshold));

  const applyLowStockThreshold = async (value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 999) {
      Alert.alert("จำนวนไม่ถูกต้อง", "โปรดระบุจำนวนหน่วยตั้งแต่ 1 ถึง 999 หน่วย");
      setLowStockThreshold(String(settings.lowStockThreshold));
      return;
    }
    setLowStockThreshold(String(value));
    setIsSaving(true);
    const nextSettings = { ...settings, lowStockThreshold: value };
    try {
      await updateSettings({ lowStockThreshold: value });
      if (nextSettings.notificationsEnabled) await syncExpiryNotifications(products, nextSettings);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (Platform.OS === "web" && enabled) {
      Alert.alert("ใช้ได้บนอุปกรณ์มือถือ", "การแจ้งเตือนจะพร้อมใช้งานเมื่อเปิดแอปบน iPhone หรือ Android");
      return;
    }
    if (!enabled) {
      await clearExpiryNotifications();
      await updateSettings({ notificationsEnabled: false });
      return;
    }
    const granted = await requestExpiryNotificationPermission();
    if (!granted) {
      Alert.alert("ยังไม่ได้รับสิทธิ์", "คุณสามารถอนุญาตการแจ้งเตือนได้จากการตั้งค่าของอุปกรณ์");
      return;
    }
    const nextSettings = { ...settings, notificationsEnabled: true };
    await updateSettings({ notificationsEnabled: true });
    await syncExpiryNotifications(products, nextSettings);
  };

  const testNotification = async () => {
    if (Platform.OS === "web") {
      Alert.alert("ใช้ได้บนโทรศัพท์", "การทดสอบการแจ้งเตือนต้องเปิดแอปบน iPhone หรือ Android");
      return;
    }
    setIsTesting(true);
    try {
      const scheduled = await sendTestExpiryNotification();
      if (!scheduled) {
        Alert.alert("ยังไม่ได้รับสิทธิ์", "โปรดอนุญาตการแจ้งเตือนจากการตั้งค่าของโทรศัพท์ แล้วลองอีกครั้ง");
        return;
      }
      Alert.alert("ส่งการทดสอบแล้ว", "รอการแจ้งเตือนจำลองประมาณ 2 วินาที");
    } finally {
      setIsTesting(false);
    }
  };

  const exportBackup = async () => {
    setIsExporting(true);
    setBackupProgress({ operation: "export", percent: 2, message: "กำลังเตรียมข้อมูลและรูปภาพสำหรับสำรอง" });
    try {
      const backup = await exportBackupData((update) => setBackupProgress({ operation: "export", ...update }));
      setPendingExportBackup(backup);
    } catch (error) {
      Alert.alert("เตรียมสำรองข้อมูลไม่สำเร็จ", errorMessage(error, "ไม่สามารถเตรียมไฟล์สำรองได้ โปรดลองอีกครั้ง"));
    } finally {
      setIsExporting(false);
      setBackupProgress(null);
    }
  };

  const confirmExport = async () => {
    if (!pendingExportBackup) return;
    const backup = pendingExportBackup;
    setPendingExportBackup(null);
    setIsExporting(true);
    setBackupProgress({ operation: "export", percent: 90, message: "กำลังเปิดหน้าต่างบันทึกไฟล์" });
    try {
      await saveAndShareInventoryBackup(serializeInventoryBackup(backup));
      setBackupProgress({ operation: "export", percent: 100, message: "สร้างไฟล์สำรองเสร็จสมบูรณ์" });
      const summary = getInventoryBackupSummary(backup);
      Alert.alert(backup.skippedImageCount ? "สร้างไฟล์สำรองแล้ว แต่มีรูปภาพถูกข้าม" : "สร้างไฟล์สำรองแล้ว", backup.skippedImageCount ? `สำรองรูปภาพสำเร็จ ${summary.imageCount} รูป และข้าม ${backup.skippedImageCount} รูปที่อ่านหรือบีบอัดไม่ได้` : `สำรองผู้ใช้ ${summary.profileCount} คน สินค้า ${summary.productCount} รายการ ประวัติ ${summary.historyCount} รายการ และรูปภาพ ${summary.imageCount} รูปเรียบร้อย`);
    } catch (error) {
      Alert.alert("สำรองข้อมูลไม่สำเร็จ", errorMessage(error, "ไม่สามารถสร้างไฟล์สำรองได้ โปรดลองอีกครั้ง"));
    } finally {
      setIsExporting(false);
      setBackupProgress(null);
    }
  };

  const applyRestore = async (backup: InventoryBackup) => {
    setIsRestoring(true);
    setBackupProgress({ operation: "restore", percent: 2, message: "กำลังเตรียมกู้คืนรูปสินค้า" });
    try {
      const hydrated = await hydrateBackupImages(backup, (completed, total) => {
        const percent = total > 0 ? 4 + Math.round((completed / total) * 30) : 34;
        const message = total > 0 ? `กำลังกู้คืนรูปสินค้า ${completed} จาก ${total} รูป` : "ไม่มีรูปสินค้าที่ต้องกู้คืน";
        setBackupProgress({ operation: "restore", percent, message });
      });
      setBackupProgress({ operation: "restore", percent: 36, message: "กำลังเตรียมแทนที่ข้อมูลเดิม" });
      await restoreBackupData(hydrated.backup, (update) => setBackupProgress({ operation: "restore", percent: 36 + Math.round(update.percent * 0.64), message: update.message }));
      const summary = getInventoryBackupSummary(hydrated.backup);
      const imageNote = hydrated.skippedImageCount > 0 ? ` รูปสินค้า ${hydrated.skippedImageCount} รูปไม่สามารถกู้คืนได้` : "";
      Alert.alert("กู้คืนข้อมูลแล้ว", `กู้คืนผู้ใช้ ${summary.profileCount} คน สินค้า ${summary.productCount} รายการ และประวัติ ${summary.historyCount} รายการเรียบร้อย${imageNote}`);
    } catch (error) {
      Alert.alert("กู้คืนข้อมูลไม่สำเร็จ", errorMessage(error, "ข้อมูลเดิมยังคงอยู่ โปรดลองใช้ไฟล์สำรองอื่น"));
    } finally {
      setIsRestoring(false);
      setBackupProgress(null);
    }
  };

  const confirmRestore = () => {
    if (!pendingRestoreBackup) return;
    const backup = pendingRestoreBackup;
    setPendingRestoreBackup(null);
    void applyRestore(backup);
  };

  const chooseBackupFile = async () => {
    if (isRestoring) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/json", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("ไม่พบไฟล์สำรองที่เลือก");
      setBackupProgress({ operation: "restore", percent: 8, message: "กำลังอ่านไฟล์สำรองที่เลือก" });
      const content = await readInventoryBackupText(asset.uri, asset.file);
      setBackupProgress({ operation: "restore", percent: 22, message: "กำลังตรวจสอบรูปแบบไฟล์สำรอง" });
      const backup = parseInventoryBackup(content);
      setBackupProgress(null);
      setPendingRestoreBackup(backup);
    } catch (error) {
      setBackupProgress(null);
      Alert.alert("เปิดไฟล์ไม่สำเร็จ", errorMessage(error, "โปรดเลือกไฟล์สำรอง ShelfWatch ที่ถูกต้อง"));
    }
  };

  const otaStatus = getUpdateConnectionStatus(Platform.OS, __DEV__, Updates.isEnabled);
  const otaStatusLabel = otaStatus === "ready" ? "พร้อมรับการอัปเดต OTA" : otaStatus === "development" ? "โหมดเว็บ/พัฒนา — ไม่รับ OTA" : "ยังไม่ได้เชื่อมต่อระบบ OTA";
  const otaStatusDescription = otaStatus === "ready" ? "แอปสามารถตรวจสอบและรับอัปเดตจากระบบ OTA ได้" : otaStatus === "development" ? "ต้องใช้ Native Build รุ่นใช้งานจริงจึงจะตรวจสอบ OTA ได้" : "ต้องตั้งค่า EAS Update และติดตั้ง Native Build รุ่นที่เชื่อมต่อแล้ว";
  const otaStatusColor = otaStatus === "ready" ? "#1F6F5B" : otaStatus === "development" ? "#B54708" : "#B42318";
  const otaStatusIcon = otaStatus === "ready" ? "cloud-done" : otaStatus === "development" ? "build" : "cloud-off";

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>ตั้งค่า</Text>
      <Text style={styles.subtitle}>กำหนดวิธีแสดงและแจ้งเตือนสินค้าใกล้หมดอายุ</Text>

      <View style={styles.card}>
        <View style={[styles.sectionIcon, { backgroundColor: `${settings.brandColor}18` }]}><MaterialIcons name="palette" size={21} color={settings.brandColor} /></View>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>สีแบรนด์และโหมดแสดงผล</Text><Text style={styles.sectionCopy}>เลือกสีหลักของแอป และสลับโหมดให้เหมาะกับสภาพแวดล้อมการใช้งาน</Text></View>
        <Text style={styles.quickLabel}>สีหลักของแอป</Text>
        <View style={styles.brandColors}>{BRAND_COLOR_OPTIONS.map((color) => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`เลือกสีแบรนด์ ${color}`} onPress={() => applyBrandColor(color)} style={({ pressed }) => [styles.brandColorButton, { backgroundColor: color, borderColor: settings.brandColor === color ? "#101828" : color }, settings.brandColor === color && styles.brandColorSelected, pressed && styles.pressed]}>{settings.brandColor === color ? <MaterialIcons name="check" size={18} color="#FFFFFF" /> : null}</Pressable>)}</View>
        <Text style={styles.quickLabel}>โหมดแสดงผล</Text>
        <View style={styles.schemeOptions}><Pressable accessibilityRole="button" onPress={() => applyColorScheme("light")} style={({ pressed }) => [styles.schemeOption, settings.colorScheme === "light" && { borderColor: settings.brandColor, backgroundColor: `${settings.brandColor}12` }, pressed && styles.pressed]}><MaterialIcons name="light-mode" size={20} color={settings.colorScheme === "light" ? settings.brandColor : "#667085"} /><Text style={[styles.schemeOptionText, settings.colorScheme === "light" && { color: settings.brandColor }]}>โหมดสว่าง</Text></Pressable><Pressable accessibilityRole="button" onPress={() => applyColorScheme("dark")} style={({ pressed }) => [styles.schemeOption, settings.colorScheme === "dark" && { borderColor: settings.brandColor, backgroundColor: `${settings.brandColor}12` }, pressed && styles.pressed]}><MaterialIcons name="dark-mode" size={20} color={settings.colorScheme === "dark" ? settings.brandColor : "#667085"} /><Text style={[styles.schemeOptionText, settings.colorScheme === "dark" && { color: settings.brandColor }]}>โหมดมืด</Text></Pressable></View>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionIcon}><MaterialIcons name="schedule" size={21} color="#1F6F5B" /></View>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>เกณฑ์ใกล้หมดอายุ</Text><Text style={styles.sectionCopy}>เลือกระยะเวลาแจ้งล่วงหน้าได้ หรือกำหนดจำนวนวันเองตั้งแต่ 1 ถึง 90 วัน</Text></View>
        <Text style={styles.quickLabel}>เลือกระยะเวลาอย่างรวดเร็ว</Text>
        <View style={styles.quickOptions}>{QUICK_THRESHOLD_OPTIONS.map((days) => <Pressable key={days} accessibilityRole="button" disabled={isSaving} onPress={() => applyThreshold(days)} style={({ pressed }) => [styles.quickOption, Number(threshold) === days && styles.quickOptionActive, (pressed || isSaving) && styles.pressed]}><Text style={[styles.quickOptionText, Number(threshold) === days && styles.quickOptionTextActive]}>{days} วัน</Text></Pressable>)}</View>
        <View style={styles.inputRow}>
          <TextInput value={threshold} onChangeText={setThreshold} keyboardType="number-pad" style={styles.input} returnKeyType="done" />
          <Text style={styles.dayLabel}>วัน</Text>
          <Pressable disabled={isSaving} onPress={saveThreshold} style={({ pressed }) => [styles.saveButton, (pressed || isSaving) && styles.pressed]}><Text style={styles.saveText}>{isSaving ? "กำลังบันทึก" : "บันทึก"}</Text></Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionIcon}><MaterialIcons name="inventory-2" size={21} color="#B54708" /></View>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>เกณฑ์จำนวนใกล้หมด</Text><Text style={styles.sectionCopy}>แจ้งเตือนเมื่อจำนวนสินค้าในล็อตเหลือน้อยกว่าหรือเท่ากับจำนวนที่กำหนด</Text></View>
        <Text style={styles.quickLabel}>เลือกจำนวนอย่างรวดเร็ว</Text>
        <View style={styles.quickOptions}>{QUICK_LOW_STOCK_OPTIONS.map((quantity) => <Pressable key={quantity} accessibilityRole="button" disabled={isSaving} onPress={() => applyLowStockThreshold(quantity)} style={({ pressed }) => [styles.quickOption, Number(lowStockThreshold) === quantity && styles.quickOptionActive, (pressed || isSaving) && styles.pressed]}><Text style={[styles.quickOptionText, Number(lowStockThreshold) === quantity && styles.quickOptionTextActive]}>{quantity} หน่วย</Text></Pressable>)}</View>
        <View style={styles.inputRow}><TextInput value={lowStockThreshold} onChangeText={setLowStockThreshold} keyboardType="number-pad" style={styles.input} returnKeyType="done" /><Text style={styles.dayLabel}>หน่วย</Text><Pressable disabled={isSaving} onPress={() => applyLowStockThreshold(Number(lowStockThreshold))} style={({ pressed }) => [styles.saveButton, (pressed || isSaving) && styles.pressed]}><Text style={styles.saveText}>{isSaving ? "กำลังบันทึก" : "บันทึก"}</Text></Pressable></View>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}><View style={styles.switchTitleRow}><MaterialIcons name="notifications-active" size={21} color="#D97706" /><Text style={styles.sectionTitle}>แจ้งเตือนบนอุปกรณ์</Text></View><Text style={styles.sectionCopy}>แจ้งเตือนเวลา 09:00 น. ในวันที่สินค้าเข้าสู่ช่วงใกล้หมดอายุ</Text></View>
          <Switch value={settings.notificationsEnabled} onValueChange={toggleNotifications} trackColor={{ false: "#D0D5DD", true: "#77AD9F" }} thumbColor={settings.notificationsEnabled ? "#1F6F5B" : "#F9FAFB"} />
        </View>
        <Pressable accessibilityRole="button" disabled={isTesting} onPress={testNotification} style={({ pressed }) => [styles.testButton, (pressed || isTesting) && styles.pressed]}><MaterialIcons name="notifications-active" size={20} color="#1F6F5B" /><Text style={styles.testButtonText}>{isTesting ? "กำลังส่งการทดสอบ" : "ทดสอบการแจ้งเตือนบนโทรศัพท์"}</Text></Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}><View style={styles.switchTitleRow}><MaterialIcons name="highlight" size={21} color="#1F6F5B" /><Text style={styles.sectionTitle}>ไฮไลท์ช่องชื่อหลังบันทึก</Text></View><Text style={styles.sectionCopy}>แสดงสีเขียวชั่วคราวและโฟกัสช่องชื่อ เพื่อให้พร้อมพิมพ์สินค้ารายการถัดไป</Text></View>
          <Switch value={settings.nameFieldHighlightEnabled} onValueChange={(enabled) => void updateSettings({ nameFieldHighlightEnabled: enabled })} trackColor={{ false: "#D0D5DD", true: "#77AD9F" }} thumbColor={settings.nameFieldHighlightEnabled ? "#1F6F5B" : "#F9FAFB"} />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionIcon}><MaterialIcons name="system-update" size={21} color="#1F6F5B" /></View>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>อัปเดตแอป</Text><Text style={styles.sectionCopy}>ตรวจสอบเวอร์ชันใหม่ด้วยตัวเองได้ทุกเมื่อ ระบบจะแจ้งเตือนก่อนดาวน์โหลดและรีสตาร์ตแอป</Text></View>
        <View style={[styles.otaStatusRow, { backgroundColor: `${otaStatusColor}12`, borderColor: `${otaStatusColor}35` }]}><MaterialIcons name={otaStatusIcon} size={20} color={otaStatusColor} /><View style={styles.otaStatusCopy}><Text style={[styles.otaStatusLabel, { color: otaStatusColor }]}>{otaStatusLabel}</Text><Text style={styles.otaStatusDescription}>{otaStatusDescription}</Text></View></View>
        {otaStatus !== "ready" ? <View style={styles.nativeBuildVersionRow}><MaterialIcons name="verified" size={20} color="#475467" /><View style={styles.nativeBuildVersionCopy}><Text style={styles.nativeBuildVersionLabel}>Native Build ล่าสุดที่พร้อมดาวน์โหลด</Text><Text style={styles.nativeBuildVersionValue}>{NATIVE_BUILD_VERSION ?? "ยังไม่ได้ระบุ"}</Text></View></View> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="ตรวจสอบการอัปเดต" disabled={isCheckingUpdate} onPress={() => void checkForUpdates()} style={({ pressed }) => [styles.updateButton, (pressed || isCheckingUpdate) && styles.pressed]}>{isCheckingUpdate ? <ActivityIndicator size="small" color="#1F6F5B" /> : <MaterialIcons name="refresh" size={20} color="#1F6F5B" />}<Text style={styles.updateButtonText}>{isCheckingUpdate ? "กำลังตรวจสอบการอัปเดต" : "ตรวจสอบการอัปเดต"}</Text></Pressable>
        {otaStatus !== "ready" ? <Pressable accessibilityRole="button" accessibilityLabel="ดาวน์โหลด Native Build แบบแมนนวล" onPress={() => void downloadNativeBuild()} style={({ pressed }) => [styles.nativeBuildButton, pressed && styles.pressed]}><MaterialIcons name="get-app" size={20} color="#344054" /><Text style={styles.nativeBuildButtonText}>ดาวน์โหลด Native Build แบบแมนนวล</Text></Pressable> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.sectionIcon}><MaterialIcons name="backup" size={21} color="#1D4ED8" /></View>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>สำรองและกู้คืนข้อมูล</Text><Text style={styles.sectionCopy}>สร้างไฟล์เดียวสำหรับข้อมูลผู้ใช้ สินค้า ล็อต การตั้งค่า และประวัติทั้งหมด เพื่อนำไปเก็บไว้หรือกู้คืนบนอุปกรณ์เครื่องนี้</Text></View>
        <Pressable accessibilityRole="button" disabled={isExporting || isRestoring || Boolean(backupProgress)} onPress={exportBackup} style={({ pressed }) => [styles.backupButton, (pressed || isExporting || isRestoring || Boolean(backupProgress)) && styles.pressed]}><MaterialIcons name="file-upload" size={20} color="#FFFFFF" /><Text style={styles.backupButtonText}>{isExporting ? "กำลังสร้างไฟล์สำรอง" : "สำรองข้อมูลเป็นไฟล์"}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={isExporting || isRestoring || Boolean(backupProgress)} onPress={chooseBackupFile} style={({ pressed }) => [styles.restoreButton, (pressed || isExporting || isRestoring || Boolean(backupProgress)) && styles.pressed]}><MaterialIcons name="file-download" size={20} color="#1D4ED8" /><Text style={styles.restoreButtonText}>{isRestoring ? "กำลังกู้คืนข้อมูล" : "เลือกไฟล์เพื่อกู้คืน"}</Text></Pressable>
        <Text style={styles.backupNote}>บน iPhone และ Android รูปสินค้าจะรวมในไฟล์สำรองตามขนาดไฟล์ที่รองรับ ส่วนเว็บจะสำรองข้อมูลรายการ แต่ไม่รวมไฟล์รูปเดิม</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/category-management")} style={({ pressed }) => [styles.archivedButton, pressed && styles.pressed]}><MaterialIcons name="category" size={20} color="#1D4ED8" /><Text style={styles.archivedButtonText}>จัดการหมวดหมู่สินค้า</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/archived")} style={({ pressed }) => [styles.archivedButton, pressed && styles.pressed]}><MaterialIcons name="inventory" size={20} color="#344054" /><Text style={styles.archivedButtonText}>ดูรายการสินค้าที่ลบแล้ว</Text></Pressable>
      </View>

      <View style={styles.note}><MaterialIcons name="info-outline" size={19} color="#475467" /><Text style={styles.noteText}>รายการแจ้งเตือนในแอปจะแสดงเสมอ แม้ไม่ได้เปิดการแจ้งเตือนของอุปกรณ์</Text></View>
      <Text style={styles.versionText}>เวอร์ชันแอป {APP_VERSION}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="ดูรายละเอียดการเปลี่ยนแปลง" onPress={() => setIsChangelogVisible(true)} style={({ pressed }) => [styles.changelogButton, pressed && styles.pressed]}><MaterialIcons name="list-alt" size={18} color="#1F6F5B" /><Text style={styles.changelogButtonText}>ดูรายละเอียดการเปลี่ยนแปลง</Text></Pressable>
      </ScrollView>
      <BackupProgressModal progress={backupProgress} brandColor={settings.brandColor} />
      <ExportPreviewModal backup={pendingExportBackup} brandColor={settings.brandColor} onCancel={() => setPendingExportBackup(null)} onConfirm={() => void confirmExport()} />
      <RestorePreviewModal backup={pendingRestoreBackup} brandColor={settings.brandColor} onCancel={() => setPendingRestoreBackup(null)} onConfirm={confirmRestore} />
      <ChangelogModal visible={isChangelogVisible} version={APP_VERSION} brandColor={settings.brandColor} onClose={() => setIsChangelogVisible(false)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40, paddingHorizontal: 20, paddingTop: 12 },
  title: { color: "#101828", fontSize: 28, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 4 },
  card: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 20, padding: 17 },
  brandColors: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 9 },
  brandColorButton: { alignItems: "center", borderRadius: 18, borderWidth: 3, height: 36, justifyContent: "center", width: 36 },
  brandColorSelected: { borderColor: "#101828" },
  schemeOptions: { flexDirection: "row", gap: 10, marginTop: 9 },
  schemeOption: { alignItems: "center", backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 44 },
  schemeOptionText: { color: "#475467", fontSize: 13, fontWeight: "800" },
  sectionIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 12, height: 42, justifyContent: "center", width: 42 },
  sectionHeader: { marginTop: 12 },
  sectionTitle: { color: "#344054", fontSize: 16, fontWeight: "800" },
  sectionCopy: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: 5 },
  quickLabel: { color: "#475467", fontSize: 13, fontWeight: "700", marginTop: 16 },
  quickOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 9 },
  quickOption: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  quickOptionActive: { backgroundColor: "#1F6F5B", borderColor: "#1F6F5B" },
  quickOptionText: { color: "#475467", fontSize: 13, fontWeight: "800" },
  quickOptionTextActive: { color: "#FFFFFF" },
  inputRow: { alignItems: "center", flexDirection: "row", gap: 9, marginTop: 17 },
  input: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, color: "#101828", fontSize: 16, fontWeight: "700", height: 47, paddingHorizontal: 12, textAlign: "center", width: 68 },
  dayLabel: { color: "#475467", fontSize: 15, fontWeight: "600" },
  saveButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 11, justifyContent: "center", marginLeft: "auto", minHeight: 42, paddingHorizontal: 13 },
  saveText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  switchRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  switchCopy: { flex: 1 },
  switchTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  testButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 12, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 16, minHeight: 46 },
  testButtonText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  updateButton: { alignItems: "center", backgroundColor: "#E8F3EF", borderColor: "#B7D8CE", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 16, minHeight: 46 },
  updateButtonText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  otaStatusRow: { alignItems: "flex-start", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 9, marginTop: 14, padding: 11 },
  otaStatusCopy: { flex: 1 },
  otaStatusLabel: { fontSize: 13, fontWeight: "800" },
  otaStatusDescription: { color: "#667085", fontSize: 12, lineHeight: 18, marginTop: 2 },
  nativeBuildVersionRow: { alignItems: "flex-start", backgroundColor: "#F8FAFC", borderColor: "#E4E7EC", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 9, marginTop: 10, padding: 11 },
  nativeBuildVersionCopy: { flex: 1 },
  nativeBuildVersionLabel: { color: "#475467", fontSize: 12, fontWeight: "700" },
  nativeBuildVersionValue: { color: "#101828", fontSize: 15, fontWeight: "800", marginTop: 3 },
  nativeBuildButton: { alignItems: "center", backgroundColor: "#F2F4F7", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 10, minHeight: 46 },
  nativeBuildButtonText: { color: "#344054", fontSize: 13, fontWeight: "800" },
  backupButton: { alignItems: "center", backgroundColor: "#1D4ED8", borderRadius: 12, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 17, minHeight: 48, paddingHorizontal: 14 },
  backupButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  restoreButton: { alignItems: "center", backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 10, minHeight: 48, paddingHorizontal: 14 },
  restoreButtonText: { color: "#1D4ED8", fontSize: 14, fontWeight: "800" },
  backupNote: { color: "#667085", fontSize: 12, lineHeight: 18, marginTop: 12 },
  archivedButton: { alignItems: "center", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 12, minHeight: 46, paddingHorizontal: 14 },
  archivedButtonText: { color: "#344054", fontSize: 14, fontWeight: "700" },
  progressOverlay: { alignItems: "center", backgroundColor: "rgba(16, 24, 40, 0.48)", flex: 1, justifyContent: "center", padding: 24 },
  progressDialog: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 24, maxWidth: 360, paddingHorizontal: 24, paddingVertical: 28, shadowColor: "#101828", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.2, shadowRadius: 24, width: "100%" },
  progressIcon: { alignItems: "center", borderRadius: 26, height: 52, justifyContent: "center", width: 52 },
  progressTitle: { color: "#101828", fontSize: 18, fontWeight: "800", marginTop: 16, textAlign: "center" },
  progressMessage: { color: "#667085", fontSize: 13, lineHeight: 20, marginTop: 7, minHeight: 40, textAlign: "center" },
  progressTrack: { backgroundColor: "#E4E7EC", borderRadius: 999, height: 10, marginTop: 16, overflow: "hidden", width: "100%" },
  progressFill: { borderRadius: 999, height: "100%" },
  progressPercent: { fontSize: 15, fontWeight: "800", marginTop: 9 },
  progressFootnote: { color: "#98A2B3", fontSize: 12, marginTop: 12, textAlign: "center" },
  previewOverlay: { alignItems: "center", backgroundColor: "rgba(16, 24, 40, 0.48)", flex: 1, justifyContent: "flex-end" },
  previewBackdrop: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.48)", flex: 1, justifyContent: "center", padding: 20 },
  previewDialog: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "90%", paddingHorizontal: 20, paddingTop: 18, width: "100%" },
  previewHeroIcon: { alignItems: "center", alignSelf: "center", borderRadius: 26, height: 52, justifyContent: "center", width: 52 },
  previewTitle: { color: "#101828", fontSize: 21, fontWeight: "800", marginTop: 12, textAlign: "center" },
  previewSubtitle: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: 6, textAlign: "center" },
  previewScroll: { marginTop: 16, width: "100%" },
  previewScrollContent: { paddingBottom: 14 },
  previewMeta: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "center" },
  previewMetaText: { color: "#475467", fontSize: 12, fontWeight: "600" },
  previewActiveProfile: { alignItems: "center", borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 14, padding: 12 },
  previewActiveCopy: { flex: 1 },
  previewActiveLabel: { color: "#475467", fontSize: 12, fontWeight: "600" },
  previewActiveName: { fontSize: 15, fontWeight: "800", marginTop: 2 },
  previewMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 14 },
  previewMetric: { alignItems: "center", backgroundColor: "#F8FAFC", borderColor: "#E4E7EC", borderRadius: 13, borderWidth: 1, flexBasis: "47%", flexGrow: 1, paddingVertical: 11 },
  previewMetricValue: { color: "#101828", fontSize: 18, fontWeight: "800", marginTop: 4 },
  previewMetricLabel: { color: "#667085", fontSize: 12, fontWeight: "700", marginTop: 1 },
  exportSummaryGrid: { flexDirection: "row", gap: 8, marginTop: 16 },
  exportSummaryMetric: { alignItems: "center", backgroundColor: "#F8FAFC", borderColor: "#E4E7EC", borderRadius: 13, borderWidth: 1, flex: 1, paddingVertical: 11 },
  exportSizeRow: { alignItems: "center", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 12, padding: 12 },
  exportSizeCopy: { flex: 1 },
  exportSizeLabel: { color: "#475467", fontSize: 12, fontWeight: "700" },
  exportSizeValue: { fontSize: 20, fontWeight: "900", marginTop: 2 },
  exportSummaryNote: { color: "#667085", fontSize: 12, lineHeight: 18, marginTop: 12 },
  exportImageWarning: { alignItems: "flex-start", backgroundColor: "#FEF3F2", borderColor: "#FECDCA", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 12, padding: 10 },
  exportImageWarningText: { color: "#B42318", flex: 1, fontSize: 12, lineHeight: 18 },
  previewSectionTitle: { color: "#344054", fontSize: 14, fontWeight: "800", marginTop: 18 },
  previewProfileRow: { alignItems: "center", borderBottomColor: "#EAECF0", borderBottomWidth: 1, flexDirection: "row", gap: 10, paddingVertical: 11 },
  previewAvatar: { alignItems: "center", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  previewAvatarText: { fontSize: 15, fontWeight: "800" },
  previewProfileCopy: { flex: 1 },
  previewProfileTitleRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  previewProfileName: { color: "#344054", flexShrink: 1, fontSize: 14, fontWeight: "800" },
  previewCurrentBadge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  previewCurrentBadgeText: { fontSize: 10, fontWeight: "800" },
  previewStorageName: { color: "#667085", fontSize: 12, marginTop: 2 },
  previewProfileStats: { color: "#475467", fontSize: 11, fontWeight: "600", marginTop: 3 },
  previewWarning: { alignItems: "flex-start", backgroundColor: "#FFFAEB", borderRadius: 12, flexDirection: "row", gap: 8, marginTop: 14, padding: 11 },
  previewWarningText: { color: "#93370D", flex: 1, fontSize: 12, lineHeight: 18 },
  previewActions: { flexDirection: "row", gap: 10, paddingBottom: 18, paddingTop: 10 },
  previewCancelButton: { alignItems: "center", backgroundColor: "#F2F4F7", borderRadius: 12, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 10 },
  previewCancelText: { color: "#475467", fontSize: 13, fontWeight: "800" },
  previewConfirmButton: { alignItems: "center", borderRadius: 12, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 10 },
  previewConfirmText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  note: { alignItems: "flex-start", backgroundColor: "#F2F4F7", borderRadius: 14, flexDirection: "row", gap: 9, marginTop: 18, padding: 14 },
  versionText: { color: "#98A2B3", fontSize: 12, marginTop: 16, paddingBottom: 8, textAlign: "center" },
  changelogButton: { alignItems: "center", alignSelf: "center", flexDirection: "row", gap: 7, marginTop: 2, minHeight: 40, paddingHorizontal: 10 },
  changelogButtonText: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  changelogDialog: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "88%", paddingHorizontal: 20, paddingTop: 18, width: "100%" },
  changelogVersion: { color: "#667085", fontSize: 13, fontWeight: "700", marginTop: 6, textAlign: "center" },
  changelogScrollContent: { paddingBottom: 10, paddingTop: 16 },
  changelogRow: { alignItems: "flex-start", borderBottomColor: "#EAECF0", borderBottomWidth: 1, flexDirection: "row", gap: 11, paddingVertical: 13 },
  changelogIcon: { alignItems: "center", borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  changelogCopy: { flex: 1, paddingTop: 1 },
  changelogItemTitle: { color: "#344054", fontSize: 14, fontWeight: "800", lineHeight: 20 },
  changelogItemDescription: { color: "#667085", fontSize: 12, lineHeight: 18, marginTop: 3 },
  changelogCloseButton: { alignItems: "center", borderRadius: 12, justifyContent: "center", marginBottom: 18, marginTop: 10, minHeight: 48 },
  changelogCloseText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  noteText: { color: "#475467", flex: 1, fontSize: 13, lineHeight: 19 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
});
