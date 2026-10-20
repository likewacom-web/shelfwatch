import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { describeGeminiError, getGeminiApiKey, maskApiKey, setGeminiApiKey, testGeminiApiKey } from "@/lib/gemini-ocr";

const AI_STUDIO_URL = "https://aistudio.google.com/apikey";

/** Settings card for the Gemini API key used to read product names from photos. */
export function GeminiKeyCard() {
  const [savedKey, setSavedKey] = useState("");
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void getGeminiApiKey().then((key) => {
      setSavedKey(key);
      setIsEditing(!key);
    });
  }, []);

  const save = async () => {
    const key = draft.trim();
    if (!key) {
      Alert.alert("ยังไม่ได้ใส่ key", "วาง API key ที่คัดลอกมาจาก Google AI Studio");
      return;
    }
    setIsBusy(true);
    try {
      await testGeminiApiKey(key);
      await setGeminiApiKey(key);
      setSavedKey(key);
      setDraft("");
      setIsEditing(false);
      Alert.alert("พร้อมใช้งาน", "ทดสอบ key สำเร็จ ใช้ปุ่มถ่ายรูปอ่านชื่อสินค้าได้แล้ว");
    } catch (error) {
      Alert.alert("ใช้ key นี้ไม่ได้", describeGeminiError(error));
    } finally {
      setIsBusy(false);
    }
  };

  const remove = () => {
    Alert.alert("ลบ API key?", "หลังลบจะใช้การอ่านชื่อสินค้าจากรูปไม่ได้จนกว่าจะใส่ key ใหม่", [
      { text: "ยกเลิก", style: "cancel" },
      { text: "ลบ", style: "destructive", onPress: () => void setGeminiApiKey("").then(() => { setSavedKey(""); setIsEditing(true); }) },
    ]);
  };

  return (
    <View style={styles.card}>
      <View style={styles.sectionIcon}><MaterialIcons name="document-scanner" size={21} color="#1F6F5B" /></View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>อ่านชื่อสินค้าด้วย AI</Text>
        <Text style={styles.sectionCopy}>การถ่ายรูปอ่านชื่อสินค้าใช้ Google Gemini ขอ API key ได้ฟรีที่ Google AI Studio แล้ววางที่นี่ key จะเก็บไว้ในเครื่องนี้เท่านั้น</Text>
      </View>
      {savedKey && !isEditing ? (
        <View style={styles.statusRow}>
          <MaterialIcons name="check-circle" size={20} color="#1F6F5B" />
          <Text style={styles.statusText}>ตั้งค่าแล้ว · {maskApiKey(savedKey)}</Text>
          <Pressable accessibilityRole="button" onPress={() => setIsEditing(true)} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}><Text style={styles.linkText}>เปลี่ยน</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={remove} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}><Text style={[styles.linkText, styles.danger]}>ลบ</Text></Pressable>
        </View>
      ) : (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="วาง API key เช่น AIza..."
            placeholderTextColor="#98A2B3"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
            accessibilityLabel="Gemini API key"
            returnKeyType="done"
            onSubmitEditing={() => void save()}
          />
          <Pressable accessibilityRole="button" disabled={isBusy} onPress={() => void save()} style={({ pressed }) => [styles.primaryButton, (pressed || isBusy) && styles.pressed]}>
            {isBusy ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="vpn-key" size={19} color="#FFFFFF" />}
            <Text style={styles.primaryText}>{isBusy ? "กำลังทดสอบ key" : "ทดสอบและบันทึก"}</Text>
          </Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(AI_STUDIO_URL)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <MaterialIcons name="open-in-new" size={18} color="#1F6F5B" />
            <Text style={styles.secondaryText}>ขอ API key ฟรี (Google AI Studio)</Text>
          </Pressable>
          {savedKey ? <Pressable accessibilityRole="button" onPress={() => { setDraft(""); setIsEditing(false); }} style={({ pressed }) => [styles.linkButtonCenter, pressed && styles.pressed]}><Text style={styles.linkText}>ยกเลิก</Text></Pressable> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 20, padding: 17 },
  sectionIcon: { alignItems: "center", backgroundColor: "#E8F3EF", borderRadius: 12, height: 42, justifyContent: "center", width: 42 },
  sectionHeader: { marginTop: 12 },
  sectionTitle: { color: "#344054", fontSize: 16, fontWeight: "800" },
  sectionCopy: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: 5 },
  statusRow: { alignItems: "center", backgroundColor: "#E8F3EF", borderColor: "#B7D8CE", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, marginTop: 16, minHeight: 46, paddingHorizontal: 12 },
  statusText: { color: "#1F6F5B", flex: 1, fontSize: 14, fontWeight: "700" },
  input: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, color: "#101828", fontSize: 15, height: 47, marginTop: 16, paddingHorizontal: 12 },
  primaryButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 12, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 12, minHeight: 48 },
  primaryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  secondaryButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#B7D8CE", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 10, minHeight: 46 },
  secondaryText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  linkButton: { paddingHorizontal: 6, paddingVertical: 6 },
  linkButtonCenter: { alignItems: "center", marginTop: 8, paddingVertical: 6 },
  linkText: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  danger: { color: "#B42318" },
  pressed: { opacity: 0.7 },
});
