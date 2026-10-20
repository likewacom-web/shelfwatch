import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { UndoDeleteBanner } from "@/components/undo-delete-banner";
import { useColors } from "@/hooks/use-colors";
import { InventoryProvider, useInventory } from "@/lib/inventory-context";
import { useThemeContext } from "@/lib/theme-provider";

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  return (
    <InventoryProvider>
      <ThemeSettingsBridge>
      <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 8,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "ภาพรวม",
          tabBarIcon: ({ color }) => <MaterialIcons size={25} name="dashboard" color={color} />,
        }}
      />
      <Tabs.Screen
        name="shelves"
        options={{
          title: "ชั้นวาง",
          tabBarIcon: ({ color }) => <MaterialIcons size={25} name="view-module" color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "แจ้งเตือน",
          tabBarIcon: ({ color }) => <MaterialIcons size={25} name="notifications-none" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "ตั้งค่า",
          tabBarIcon: ({ color }) => <MaterialIcons size={25} name="settings" color={color} />,
        }}
      />
      <Tabs.Screen
        name="user"
        options={{
          title: "ผู้ใช้",
          tabBarIcon: ({ color }) => <MaterialIcons size={25} name="person-outline" color={color} />,
        }}
      />
      <Tabs.Screen name="scanner" options={{ href: null }} />
      <Tabs.Screen name="shelf/[shelf]" options={{ href: null }} />
      <Tabs.Screen name="shelf/[shelf]/row/[row]" options={{ href: null }} />
      <Tabs.Screen name="product-form" options={{ href: null }} />
      <Tabs.Screen name="product/[id]" options={{ href: null }} />
      <Tabs.Screen name="storage-map" options={{ href: null }} />
      <Tabs.Screen name="activity" options={{ href: null }} />
      <Tabs.Screen name="archived" options={{ href: null }} />
      <Tabs.Screen name="category-management" options={{ href: null }} />
      </Tabs>
      <UndoDeleteBanner />
      </ThemeSettingsBridge>
    </InventoryProvider>
  );
}

function ThemeSettingsBridge({ children }: { children: React.ReactNode }) {
  const { settings, isLoading } = useInventory();
  const { setBackgroundImageOpacity, setBackgroundImageUri, setBrandColor, setColorScheme } = useThemeContext();
  useEffect(() => {
    if (!isLoading) {
      setBrandColor(settings.brandColor);
      setColorScheme(settings.colorScheme);
      setBackgroundImageUri(settings.backgroundImageUri);
      setBackgroundImageOpacity(settings.backgroundImageOpacity);
    }
  }, [isLoading, setBackgroundImageOpacity, setBackgroundImageUri, setBrandColor, setColorScheme, settings.backgroundImageOpacity, settings.backgroundImageUri, settings.brandColor, settings.colorScheme]);
  return <>{children}</>;
}
