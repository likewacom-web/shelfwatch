import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { StyleSheet, Text, View } from "react-native";

type FlowStep = "photo" | "scan" | "save";

type ProductFlowStepperProps = {
  activeStep: FlowStep;
  dark?: boolean;
};

const STEPS: { key: FlowStep; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { key: "photo", label: "ถ่ายรูป", icon: "photo-camera" },
  { key: "scan", label: "สแกนบาร์โค้ด", icon: "qr-code-scanner" },
  { key: "save", label: "บันทึก", icon: "save" },
];

export function ProductFlowStepper({ activeStep, dark = false }: ProductFlowStepperProps) {
  const activeIndex = STEPS.findIndex((step) => step.key === activeStep);
  return (
    <View style={[styles.container, dark && styles.containerDark]} accessibilityLabel={`ขั้นตอนปัจจุบัน ${STEPS[activeIndex]?.label ?? "ถ่ายรูป"}`} accessibilityRole="text">
      {STEPS.map((step, index) => {
        const isCurrent = index === activeIndex;
        const isComplete = index < activeIndex;
        return (
          <View key={step.key} style={styles.stepGroup}>
            <View style={styles.stepItem}>
              <View style={[styles.circle, dark && styles.circleDark, isComplete && styles.circleComplete, isCurrent && styles.circleCurrent]}>
                <MaterialIcons name={isComplete ? "check" : step.icon} size={16} color={isComplete || isCurrent ? "#FFFFFF" : dark ? "#D0D5DD" : "#98A2B3"} />
              </View>
              <Text style={[styles.label, dark && styles.labelDark, isCurrent && styles.labelCurrent, isComplete && styles.labelComplete]}>{step.label}</Text>
            </View>
            {index < STEPS.length - 1 ? <View style={[styles.connector, dark && styles.connectorDark, index < activeIndex && styles.connectorComplete]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "flex-start", backgroundColor: "#F8FAFC", borderColor: "#E4E7EC", borderRadius: 16, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginBottom: 14, paddingHorizontal: 12, paddingVertical: 11, width: "100%" },
  containerDark: { backgroundColor: "rgba(16,24,40,0.72)", borderColor: "rgba(255,255,255,0.24)" },
  stepGroup: { alignItems: "center", flex: 1, flexDirection: "row" },
  stepItem: { alignItems: "center", flex: 1, gap: 5 },
  circle: { alignItems: "center", backgroundColor: "#EAECF0", borderRadius: 18, height: 34, justifyContent: "center", width: 34 },
  circleDark: { backgroundColor: "rgba(255,255,255,0.16)" },
  circleCurrent: { backgroundColor: "#1F6F5B" },
  circleComplete: { backgroundColor: "#12B76A" },
  label: { color: "#667085", fontSize: 10, fontWeight: "700", textAlign: "center" },
  labelDark: { color: "#D0D5DD" },
  labelCurrent: { color: "#1F6F5B", fontWeight: "900" },
  labelComplete: { color: "#039855" },
  connector: { backgroundColor: "#D0D5DD", height: 2, marginHorizontal: 3, marginTop: -18, width: 22 },
  connectorDark: { backgroundColor: "rgba(255,255,255,0.28)" },
  connectorComplete: { backgroundColor: "#12B76A" },
});
