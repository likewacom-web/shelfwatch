import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import Slider from "@react-native-community/slider";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { getProductStatus } from "@/lib/inventory";
import { useInventory } from "@/lib/inventory-context";
import { persistBackgroundImage, persistProfileImage } from "@/lib/profile-image";
import { useThemeContext } from "@/lib/theme-provider";
import { getProfileAvatarColor, getProfileAvatarInitial, type UserProfile } from "@/lib/user-profile";

function ProfileAvatar({ profile, large = false, active = false }: { profile: UserProfile; large?: boolean; active?: boolean }) {
  const containerStyle = large ? styles.avatar : [styles.userAvatar, active && styles.userAvatarActive];
  const imageStyle = large ? styles.avatarImage : styles.userAvatarImage;
  const avatarColor = getProfileAvatarColor(profile.id);
  return <View style={[containerStyle, !profile.avatarUri && { backgroundColor: avatarColor }]}>{profile.avatarUri ? <Image source={{ uri: profile.avatarUri }} style={imageStyle} accessibilityLabel={`รูปโปรไฟล์ ${profile.displayName}`} /> : <Text style={styles.avatarFallbackText}>{getProfileAvatarInitial(profile.displayName)}</Text>}</View>;
}

export default function UserScreen() {
  const { profile, profiles, activeUserId, products, positionHistory, settings, updateProfile, updateSettings, createUser, switchUser, isLoading } = useInventory();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [storageName, setStorageName] = useState(profile.storageName);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newStorageName, setNewStorageName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [isUpdatingBackground, setIsUpdatingBackground] = useState(false);
  const [backgroundOpacity, setBackgroundOpacity] = useState(settings.backgroundImageOpacity);
  const [isUsersOpen, setIsUsersOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isProfilePreviewOpen, setIsProfilePreviewOpen] = useState(false);
  const { setBackgroundImageOpacity } = useThemeContext();

  useEffect(() => {
    setDisplayName(profile.displayName);
    setStorageName(profile.storageName);
  }, [profile]);

  useEffect(() => {
    setBackgroundOpacity(settings.backgroundImageOpacity);
  }, [settings.backgroundImageOpacity]);

  const urgentCount = useMemo(() => products.filter((product) => getProductStatus(product, settings.nearExpiryDays) !== "safe").length, [products, settings.nearExpiryDays]);

  const saveProfile = async () => {
    if (!displayName.trim() || !storageName.trim()) {
      Alert.alert("กรอกข้อมูลให้ครบ", "โปรดระบุชื่อผู้ใช้และชื่อสถานที่จัดเก็บ");
      return;
    }
    setIsSaving(true);
    try {
      await updateProfile({ displayName: displayName.trim(), storageName: storageName.trim() });
      Alert.alert("บันทึกแล้ว", "อัปเดตข้อมูลผู้ใช้เรียบร้อย");
    } finally {
      setIsSaving(false);
    }
  };

  const saveProfileImage = async (sourceUri: string) => {
    setIsUpdatingAvatar(true);
    try {
      const avatarUri = await persistProfileImage(sourceUri);
      await updateProfile({ avatarUri });
    } catch {
      Alert.alert("บันทึกรูปไม่สำเร็จ", "ไม่สามารถเก็บรูปโปรไฟล์ในอุปกรณ์ได้ โปรดลองอีกครั้ง");
    } finally {
      setIsUpdatingAvatar(false);
    }
  };

  const chooseProfileImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (!result.canceled && result.assets[0]?.uri) await saveProfileImage(result.assets[0].uri);
  };

  const takeProfileImage = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("ต้องอนุญาตการใช้กล้อง", "โปรดอนุญาตการใช้กล้องจากการตั้งค่าอุปกรณ์เพื่อถ่ายรูปโปรไฟล์");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (!result.canceled && result.assets[0]?.uri) await saveProfileImage(result.assets[0].uri);
  };

  const selectProfileImage = () => {
    Alert.alert("เปลี่ยนรูปโปรไฟล์", "เลือกรูปจากอัลบั้มหรือถ่ายรูปใหม่", [
      { text: "เลือกจากอัลบั้ม", onPress: () => { void chooseProfileImage(); } },
      { text: "ถ่ายรูป", onPress: () => { void takeProfileImage(); } },
      ...(profile.avatarUri ? [{ text: "ลบรูปโปรไฟล์", style: "destructive" as const, onPress: () => { void updateProfile({ avatarUri: undefined }); } }] : []),
      { text: "ยกเลิก", style: "cancel" },
    ]);
  };

  const saveBackgroundImage = async (sourceUri: string) => {
    setIsUpdatingBackground(true);
    try {
      const backgroundImageUri = await persistBackgroundImage(sourceUri);
      await updateSettings({ backgroundImageUri });
    } catch {
      Alert.alert("บันทึกภาพพื้นหลังไม่สำเร็จ", "ไม่สามารถเก็บภาพพื้นหลังในอุปกรณ์ได้ โปรดลองอีกครั้ง");
    } finally {
      setIsUpdatingBackground(false);
    }
  };

  const chooseBackgroundImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.65 });
    if (!result.canceled && result.assets[0]?.uri) await saveBackgroundImage(result.assets[0].uri);
  };

  const takeBackgroundImage = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("ต้องอนุญาตการใช้กล้อง", "โปรดอนุญาตการใช้กล้องจากการตั้งค่าอุปกรณ์เพื่อถ่ายภาพพื้นหลัง");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.65 });
    if (!result.canceled && result.assets[0]?.uri) await saveBackgroundImage(result.assets[0].uri);
  };

  const selectBackgroundImage = () => {
    Alert.alert("เปลี่ยนภาพพื้นหลัง", "ภาพจะถูกแสดงแบบโปร่งบางเพื่อให้อ่านข้อมูลได้ง่าย", [
      { text: "เลือกจากอัลบั้ม", onPress: () => { void chooseBackgroundImage(); } },
      { text: "ถ่ายรูป", onPress: () => { void takeBackgroundImage(); } },
      ...(settings.backgroundImageUri ? [{ text: "ใช้พื้นหลังสีปกติ", style: "destructive" as const, onPress: () => { void updateSettings({ backgroundImageUri: undefined }); } }] : []),
      { text: "ยกเลิก", style: "cancel" },
    ]);
  };

  const updateBackgroundOpacity = (value: number) => {
    setBackgroundOpacity(value);
    setBackgroundImageOpacity(value);
  };

  const saveBackgroundOpacity = async (value: number) => {
    try {
      await updateSettings({ backgroundImageOpacity: value });
    } catch {
      setBackgroundOpacity(settings.backgroundImageOpacity);
      setBackgroundImageOpacity(settings.backgroundImageOpacity);
      Alert.alert("บันทึกความโปร่งใสไม่สำเร็จ", "ไม่สามารถบันทึกระดับความโปร่งใสได้ โปรดลองอีกครั้ง");
    }
  };

  const selectUser = async (userId: string) => {
    if (userId === activeUserId) {
      setIsUsersOpen(false);
      return;
    }
    setIsSwitching(true);
    try {
      await switchUser(userId);
      setIsUsersOpen(false);
    } finally {
      setIsSwitching(false);
    }
  };

  const saveNewUser = async () => {
    if (!newDisplayName.trim() || !newStorageName.trim()) {
      Alert.alert("กรอกข้อมูลให้ครบ", "โปรดระบุชื่อผู้ใช้และชื่อสถานที่จัดเก็บสำหรับผู้ใช้ใหม่");
      return;
    }
    setIsCreating(true);
    try {
      await createUser({ displayName: newDisplayName, storageName: newStorageName });
      setNewDisplayName("");
      setNewStorageName("");
      setIsCreateOpen(false);
      setIsUsersOpen(false);
      Alert.alert("สร้างผู้ใช้แล้ว", "สลับไปยังผู้ใช้ใหม่พร้อมคลังสินค้าแยกต่างหากแล้ว คุณสามารถเพิ่มรูปโปรไฟล์ได้จากหน้านี้");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <ScreenContainer className="px-5 pt-3">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>ผู้ใช้</Text>
        <Text style={styles.subtitle}>สลับผู้ใช้เพื่อจัดการคลังสินค้าและการตั้งค่าแยกกันในอุปกรณ์เครื่องนี้</Text>
        <View style={styles.profileCard}>
          <Pressable accessibilityRole="button" accessibilityLabel="ดูรูปโปรไฟล์ขนาดใหญ่" disabled={!profile.avatarUri} onPress={() => setIsProfilePreviewOpen(true)} style={({ pressed }) => [styles.profilePreviewTrigger, pressed && styles.pressed]}><ProfileAvatar profile={profile} large /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="เปลี่ยนรูปโปรไฟล์" disabled={isUpdatingAvatar || isLoading} onPress={selectProfileImage} style={({ pressed }) => [styles.avatarEditButton, (pressed || isUpdatingAvatar || isLoading) && styles.pressed]}><MaterialIcons name="photo-camera" size={16} color="#1F6F5B" /></Pressable>
          <Text style={styles.profileName}>{profile.displayName}</Text>
          <Text style={styles.storageName}>{profile.storageName}</Text>
          <Pressable accessibilityRole="button" disabled={isUpdatingAvatar || isLoading} onPress={selectProfileImage} style={({ pressed }) => [styles.photoButton, (pressed || isUpdatingAvatar || isLoading) && styles.pressed]}><MaterialIcons name={profile.avatarUri ? "edit" : "add-a-photo"} size={18} color="#1F6F5B" /><Text style={styles.photoButtonText}>{isUpdatingAvatar ? "กำลังบันทึกรูป" : profile.avatarUri ? "เปลี่ยนรูปโปรไฟล์" : "เพิ่มรูปโปรไฟล์"}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={isLoading} onPress={() => setIsUsersOpen(true)} style={({ pressed }) => [styles.switchButton, (pressed || isLoading) && styles.pressed]}><MaterialIcons name="people-outline" size={18} color="#1F6F5B" /><Text style={styles.switchButtonText}>สลับผู้ใช้ ({profiles.length})</Text></Pressable>
        </View>
        <View style={styles.statsRow}><Stat icon="inventory-2" count={products.length} label="สินค้าทั้งหมด" color="#1F6F5B" surface="#E8F3EF" /><Stat icon="warning-amber" count={urgentCount} label="รายการเร่งด่วน" color="#B54708" surface="#FEF0C7" /><Stat icon="swap-horiz" count={positionHistory.length} label="ประวัติการย้าย" color="#475467" surface="#F2F4F7" /></View>
        <View style={styles.formCard}><Text style={styles.sectionTitle}>ข้อมูลผู้ใช้ปัจจุบัน</Text><Field label="ชื่อผู้ใช้" value={displayName} onChangeText={setDisplayName} placeholder="เช่น สมชาย ใจดี" /><Field label="ชื่อสถานที่จัดเก็บ" value={storageName} onChangeText={setStorageName} placeholder="เช่น ห้องเก็บสินค้าสาขาหลัก" /><Pressable accessibilityRole="button" disabled={isSaving || isLoading} onPress={saveProfile} style={({ pressed }) => [styles.saveButton, (pressed || isSaving || isLoading) && styles.pressed]}><MaterialIcons name="save" size={20} color="#FFFFFF" /><Text style={styles.saveText}>{isSaving ? "กำลังบันทึก" : "บันทึกข้อมูลผู้ใช้"}</Text></Pressable></View>
        <View style={styles.backgroundCard}><Text style={styles.sectionTitle}>ภาพพื้นหลังแอป</Text><Text style={styles.backgroundCopy}>ใช้รูปของคุณเป็นพื้นหลังแบบโปร่งบางในหน้าจอของผู้ใช้นี้ เพื่อคงการอ่านข้อมูลให้ชัดเจน</Text><View style={styles.backgroundPreview}>{settings.backgroundImageUri ? <Image source={{ uri: settings.backgroundImageUri }} style={[styles.backgroundPreviewImage, { opacity: backgroundOpacity }]} /> : <View style={styles.backgroundEmpty}><MaterialIcons name="wallpaper" size={25} color="#1F6F5B" /><Text style={styles.backgroundEmptyText}>กำลังใช้พื้นหลังสีปกติ</Text></View>}</View><View style={styles.opacityHeader}><Text style={styles.opacityLabel}>ความโปร่งใสของภาพ</Text><Text style={styles.opacityValue}>{Math.round(backgroundOpacity * 100)}%</Text></View><Slider accessibilityLabel="ปรับความโปร่งใสของภาพพื้นหลัง" disabled={!settings.backgroundImageUri || isUpdatingBackground || isLoading} minimumValue={0.05} maximumValue={0.6} step={0.05} value={backgroundOpacity} minimumTrackTintColor="#1F6F5B" maximumTrackTintColor="#D0D5DD" thumbTintColor="#1F6F5B" onValueChange={updateBackgroundOpacity} onSlidingComplete={(value) => { void saveBackgroundOpacity(value); }} style={[styles.opacitySlider, !settings.backgroundImageUri && styles.opacitySliderDisabled]} /><Text style={styles.opacityHint}>{settings.backgroundImageUri ? "ลากเพื่อปรับได้ตั้งแต่ 5% ถึง 60%" : "เลือกภาพพื้นหลังก่อนจึงจะปรับความโปร่งใสได้"}</Text><Pressable accessibilityRole="button" disabled={isUpdatingBackground || isLoading} onPress={selectBackgroundImage} style={({ pressed }) => [styles.backgroundButton, (pressed || isUpdatingBackground || isLoading) && styles.pressed]}><MaterialIcons name={settings.backgroundImageUri ? "edit" : "add-photo-alternate"} size={19} color="#FFFFFF" /><Text style={styles.backgroundButtonText}>{isUpdatingBackground ? "กำลังบันทึกภาพพื้นหลัง" : settings.backgroundImageUri ? "เปลี่ยนภาพพื้นหลัง" : "เลือกภาพพื้นหลัง"}</Text></Pressable></View>
        <View style={styles.note}><MaterialIcons name="privacy-tip" size={19} color="#475467" /><Text style={styles.noteText}>รูปโปรไฟล์ ภาพพื้นหลัง สินค้า การตั้งค่า และประวัติการย้ายจะแยกตามผู้ใช้ และบันทึกไว้ในอุปกรณ์เครื่องนี้เท่านั้น</Text></View>
      </ScrollView>
      <UserPickerModal visible={isUsersOpen} profiles={profiles} activeUserId={activeUserId} isSwitching={isSwitching} onClose={() => setIsUsersOpen(false)} onSelect={selectUser} onCreate={() => setIsCreateOpen(true)} />
      <CreateUserModal visible={isCreateOpen} displayName={newDisplayName} storageName={newStorageName} isCreating={isCreating} onClose={() => setIsCreateOpen(false)} onDisplayNameChange={setNewDisplayName} onStorageNameChange={setNewStorageName} onSave={saveNewUser} />
      <Modal visible={isProfilePreviewOpen} transparent animationType="fade" onRequestClose={() => setIsProfilePreviewOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="ปิดรูปโปรไฟล์" onPress={() => setIsProfilePreviewOpen(false)} style={styles.profilePreviewOverlay}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.profilePreviewCard}>
            <Image source={{ uri: profile.avatarUri }} style={styles.profilePreviewImage} resizeMode="contain" />
            <Pressable accessibilityRole="button" accessibilityLabel="ปิดหน้าดูรูปโปรไฟล์" onPress={() => setIsProfilePreviewOpen(false)} style={({ pressed }) => [styles.profilePreviewClose, pressed && styles.pressed]}><MaterialIcons name="close" size={22} color="#FFFFFF" /></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

function UserPickerModal({ visible, profiles, activeUserId, isSwitching, onClose, onSelect, onCreate }: { visible: boolean; profiles: UserProfile[]; activeUserId: string; isSwitching: boolean; onClose: () => void; onSelect: (userId: string) => void; onCreate: () => void }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalOverlay}><View style={styles.modalSheet}><View style={styles.modalHeader}><View><Text style={styles.modalTitle}>เลือกผู้ใช้</Text><Text style={styles.modalSubtitle}>ข้อมูลคลัง การตั้งค่า และรูปโปรไฟล์จะแยกตามผู้ใช้</Text></View><Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}><MaterialIcons name="close" size={22} color="#475467" /></Pressable></View><ScrollView style={styles.userList} contentContainerStyle={styles.userListContent}>{profiles.map((candidate) => <Pressable key={candidate.id} accessibilityRole="button" disabled={isSwitching} onPress={() => onSelect(candidate.id)} style={({ pressed }) => [styles.userRow, candidate.id === activeUserId && styles.userRowActive, (pressed || isSwitching) && styles.pressed]}><ProfileAvatar profile={candidate} active={candidate.id === activeUserId} /><View style={styles.userCopy}><Text style={styles.userName}>{candidate.displayName}</Text><Text style={styles.userStorage}>{candidate.storageName}</Text></View>{candidate.id === activeUserId ? <MaterialIcons name="check-circle" size={22} color="#1F6F5B" /> : <MaterialIcons name="chevron-right" size={24} color="#98A2B3" />}</Pressable>)}</ScrollView><Pressable accessibilityRole="button" disabled={isSwitching} onPress={onCreate} style={({ pressed }) => [styles.addUserButton, (pressed || isSwitching) && styles.pressed]}><MaterialIcons name="person-add" size={20} color="#FFFFFF" /><Text style={styles.addUserText}>สร้างผู้ใช้ใหม่</Text></Pressable></View></View></Modal>;
}

function CreateUserModal({ visible, displayName, storageName, isCreating, onClose, onDisplayNameChange, onStorageNameChange, onSave }: { visible: boolean; displayName: string; storageName: string; isCreating: boolean; onClose: () => void; onDisplayNameChange: (value: string) => void; onStorageNameChange: (value: string) => void; onSave: () => void }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalOverlay}><View style={styles.modalSheet}><View style={styles.modalHeader}><View><Text style={styles.modalTitle}>สร้างผู้ใช้ใหม่</Text><Text style={styles.modalSubtitle}>ผู้ใช้ใหม่เริ่มต้นด้วยคลังสินค้าและการตั้งค่าว่าง</Text></View><Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}><MaterialIcons name="close" size={22} color="#475467" /></Pressable></View><Field label="ชื่อผู้ใช้" value={displayName} onChangeText={onDisplayNameChange} placeholder="เช่น แผนกคลังสินค้า" /><Field label="ชื่อสถานที่จัดเก็บ" value={storageName} onChangeText={onStorageNameChange} placeholder="เช่น คลังสาขา 2" /><Pressable accessibilityRole="button" disabled={isCreating} onPress={onSave} style={({ pressed }) => [styles.addUserButton, (pressed || isCreating) && styles.pressed]}><MaterialIcons name="person-add" size={20} color="#FFFFFF" /><Text style={styles.addUserText}>{isCreating ? "กำลังสร้าง" : "สร้างและสลับผู้ใช้"}</Text></Pressable></View></View></Modal>;
}

function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#98A2B3" style={styles.input} returnKeyType="done" /></View>;
}

function Stat({ icon, count, label, color, surface }: { icon: "inventory-2" | "warning-amber" | "swap-horiz"; count: number; label: string; color: string; surface: string }) {
  return <View style={styles.stat}><View style={[styles.statIcon, { backgroundColor: surface }]}><MaterialIcons name={icon} size={18} color={color} /></View><Text style={styles.statCount}>{count}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 110 },
  title: { color: "#101828", fontSize: 28, fontWeight: "800" },
  subtitle: { color: "#667085", fontSize: 14, lineHeight: 20, marginTop: 4 },
  profileCard: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 22, marginTop: 20, padding: 22 },
  profilePreviewTrigger: { borderRadius: 40 },
  avatar: { alignItems: "center", backgroundColor: "#D8F3E8", borderRadius: 38, height: 76, justifyContent: "center", overflow: "hidden", width: 76 },
  avatarImage: { height: "100%", width: "100%" },
  avatarFallbackText: { color: "#FFFFFF", fontSize: 24, fontWeight: "800" },
  profilePreviewOverlay: { alignItems: "center", backgroundColor: "rgba(16,24,40,0.88)", flex: 1, justifyContent: "center", padding: 20 },
  profilePreviewCard: { alignItems: "center", maxHeight: "85%", maxWidth: "100%", position: "relative" },
  profilePreviewImage: { height: 360, maxWidth: "100%", width: 360 },
  profilePreviewClose: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 20, height: 40, justifyContent: "center", position: "absolute", right: -10, top: -10, width: 40 },
  avatarEditButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#B7E2D0", borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", marginLeft: 48, marginTop: -17, width: 36 },
  profileName: { color: "#FFFFFF", fontSize: 20, fontWeight: "800", marginTop: 8 },
  storageName: { color: "#D8F3E8", fontSize: 14, marginTop: 3 },
  photoButton: { alignItems: "center", backgroundColor: "#D8F3E8", borderRadius: 11, flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 15, minHeight: 40, paddingHorizontal: 14 },
  photoButtonText: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  switchButton: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 11, flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 9, minHeight: 40, paddingHorizontal: 14 },
  switchButtonText: { color: "#1F6F5B", fontSize: 13, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: 9, marginTop: 14 },
  stat: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 15, borderWidth: 1, flex: 1, minHeight: 108, padding: 11 },
  statIcon: { alignItems: "center", borderRadius: 9, height: 29, justifyContent: "center", width: 29 },
  statCount: { color: "#101828", fontSize: 21, fontWeight: "800", marginTop: 8 },
  statLabel: { color: "#667085", fontSize: 10, fontWeight: "700", marginTop: 2 },
  formCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 20, padding: 17 },
  sectionTitle: { color: "#344054", fontSize: 16, fontWeight: "800", marginBottom: 17 },
  field: { marginBottom: 16 },
  label: { color: "#344054", fontSize: 13, fontWeight: "700", marginBottom: 7 },
  input: { backgroundColor: "#F9FAFB", borderColor: "#D0D5DD", borderRadius: 12, borderWidth: 1, color: "#101828", fontSize: 15, minHeight: 48, paddingHorizontal: 13 },
  saveButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 13, flexDirection: "row", gap: 8, justifyContent: "center", minHeight: 49, marginTop: 2 },
  saveText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  backgroundCard: { backgroundColor: "#FFFFFF", borderColor: "#E4E7EC", borderRadius: 20, borderWidth: 1, marginTop: 16, padding: 17 },
  backgroundCopy: { color: "#667085", fontSize: 13, lineHeight: 19, marginTop: -8 },
  backgroundPreview: { backgroundColor: "#E8F3EF", borderRadius: 14, height: 132, marginTop: 14, overflow: "hidden" },
  backgroundPreviewImage: { height: "100%", width: "100%" },
  backgroundEmpty: { alignItems: "center", flex: 1, justifyContent: "center" },
  backgroundEmptyText: { color: "#1F6F5B", fontSize: 13, fontWeight: "700", marginTop: 7 },
  opacityHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 15 },
  opacityLabel: { color: "#344054", fontSize: 13, fontWeight: "800" },
  opacityValue: { color: "#1F6F5B", fontSize: 14, fontWeight: "800" },
  opacitySlider: { height: 34, marginTop: 2, width: "100%" },
  opacitySliderDisabled: { opacity: 0.45 },
  opacityHint: { color: "#667085", fontSize: 12, lineHeight: 18, marginTop: 1 },
  backgroundButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 12, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 13, minHeight: 48 },
  backgroundButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  note: { alignItems: "flex-start", backgroundColor: "#F2F4F7", borderRadius: 14, flexDirection: "row", gap: 9, marginTop: 17, padding: 14 },
  noteText: { color: "#475467", flex: 1, fontSize: 13, lineHeight: 19 },
  modalOverlay: { backgroundColor: "rgba(16,24,40,0.48)", flex: 1, justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 25, borderTopRightRadius: 25, maxHeight: "82%", padding: 22 },
  modalHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  modalTitle: { color: "#101828", fontSize: 21, fontWeight: "800" },
  modalSubtitle: { color: "#667085", fontSize: 13, lineHeight: 18, marginTop: 3 },
  closeButton: { alignItems: "center", backgroundColor: "#F2F4F7", borderRadius: 14, height: 36, justifyContent: "center", width: 36 },
  userList: { maxHeight: 380 },
  userListContent: { gap: 10, paddingBottom: 8 },
  userRow: { alignItems: "center", backgroundColor: "#F9FAFB", borderColor: "#EAECF0", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 11, padding: 12 },
  userRowActive: { backgroundColor: "#E8F3EF", borderColor: "#77AD9F" },
  userAvatar: { alignItems: "center", backgroundColor: "#EAECF0", borderRadius: 20, height: 40, justifyContent: "center", overflow: "hidden", width: 40 },
  userAvatarActive: { backgroundColor: "#FFFFFF" },
  userAvatarImage: { height: "100%", width: "100%" },
  userCopy: { flex: 1 },
  userName: { color: "#344054", fontSize: 15, fontWeight: "800" },
  userStorage: { color: "#667085", fontSize: 12, marginTop: 2 },
  addUserButton: { alignItems: "center", backgroundColor: "#1F6F5B", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 16, minHeight: 52 },
  addUserText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
