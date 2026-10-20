import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Updates from "expo-updates";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { shouldCheckForUpdate } from "@/lib/update-policy";

export type UpdateCheckResult = "available" | "none" | "unsupported" | "error";
let manualCheck: (() => Promise<UpdateCheckResult>) | null = null;

export function checkForUpdateManually() {
  return manualCheck ? manualCheck() : Promise.resolve<UpdateCheckResult>("unsupported");
}

export function UpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const checkingRef = useRef(false);

  const checkForUpdate = async (): Promise<UpdateCheckResult> => {
    if (!shouldCheckForUpdate(Platform.OS, __DEV__, checkingRef.current, Updates.isEnabled)) {
      return Platform.OS === "web" || __DEV__ || !Updates.isEnabled ? "unsupported" : "none";
    }

    checkingRef.current = true;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setErrorMessage("");
        setVisible(true);
        return "available";
      }
      return "none";
    } catch (error) {
      console.warn("ตรวจสอบอัปเดตไม่สำเร็จ", error);
      return "error";
    } finally {
      checkingRef.current = false;
    }
  };

  const downloadAndReload = async () => {
    setIsDownloading(true);
    setErrorMessage("");
    try {
      const result = await Updates.fetchUpdateAsync();
      if (result.isNew) {
        await Updates.reloadAsync();
      } else {
        setVisible(false);
      }
    } catch (error) {
      console.warn("ดาวน์โหลดอัปเดตไม่สำเร็จ", error);
      setErrorMessage("ดาวน์โหลดอัปเดตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    manualCheck = checkForUpdate;
    void checkForUpdate();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkForUpdate();
    });
    return () => {
      subscription.remove();
      manualCheck = null;
    };
  }, []);

  if (Platform.OS === "web" || __DEV__) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!isDownloading) setVisible(false);
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="system-update" size={28} color="#1F6F5B" />
          </View>
          <Text style={styles.title}>มีอัปเดตใหม่</Text>
          <Text style={styles.description}>
            มีเวอร์ชันใหม่ของ ShelfWatch พร้อมใช้งาน อัปเดตเพื่อรับฟีเจอร์และการแก้ไขล่าสุด
          </Text>
          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
          <View style={styles.actions}>
            {!isDownloading ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="อัปเดตภายหลัง"
                onPress={() => setVisible(false)}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              >
                <Text style={styles.cancelText}>ไว้ทีหลัง</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="อัปเดตแอปตอนนี้"
              disabled={isDownloading}
              onPress={() => void downloadAndReload()}
              style={({ pressed }) => [styles.updateButton, pressed && styles.pressed, isDownloading && styles.disabled]}
            >
              {isDownloading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.updateText}>อัปเดตตอนนี้</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.55)", flex: 1, justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 22, width: "100%" },
  iconCircle: { alignItems: "center", alignSelf: "center", backgroundColor: "#E8F3EF", borderRadius: 28, height: 56, justifyContent: "center", marginBottom: 12, width: 56 },
  title: { color: "#101828", fontSize: 20, fontWeight: "800", textAlign: "center" },
  description: { color: "#667085", fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: "center" },
  error: { color: "#B42318", fontSize: 12, lineHeight: 17, marginTop: 12, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  cancelButton: { alignItems: "center", borderColor: "#D0D5DD", borderRadius: 11, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 46 },
  cancelText: { color: "#475467", fontSize: 14, fontWeight: "700" },
  updateButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 11, flex: 1, justifyContent: "center", minHeight: 46 },
  updateText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.65 },
});
