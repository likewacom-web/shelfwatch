import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { formatProductPosition, getDaysRemaining, getExpiryDateForLot, getLotAlerts, getProductLots, type InventorySettings, type LotAlert, type Product } from "@/lib/inventory";
import { EXPIRY_ALERT_ROUTE } from "@/lib/notification-routes";

const CHANNEL_ID = "expiry-alerts";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function configureAndroidChannel() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "แจ้งเตือนสินค้าใกล้หมดอายุ",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 220, 150, 220],
      lightColor: "#D97706",
    });
  }
}

export async function requestExpiryNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  await configureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  return status === "granted";
}

export async function clearExpiryNotifications() {
  if (Platform.OS === "web") return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function sendTestExpiryNotification(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const granted = await requestExpiryNotificationPermission();
  if (!granted) return false;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "ทดสอบการแจ้งเตือน ShelfWatch",
      body: "การแจ้งเตือนสินค้าใกล้หมดอายุบนโทรศัพท์ทำงานเรียบร้อยแล้ว",
      data: { type: "expiry-notification-test", url: EXPIRY_ALERT_ROUTE },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
      channelId: CHANNEL_ID,
    },
  });
  return true;
}

export async function syncExpiryNotifications(products: Product[], settings: InventorySettings) {
  if (Platform.OS === "web" || !settings.notificationsEnabled) return;
  await configureAndroidChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  const lowStockAlerts = getLotAlerts(products, settings).filter((alert) => alert.type === "low-stock");
  const expirySchedules = products.flatMap((product) => getProductLots(product)
    .map((lot) => ({ product, lot, expiryDate: getExpiryDateForLot(lot) }))
    .filter((entry): entry is { product: Product; lot: LotAlert["lot"]; expiryDate: string } => entry.expiryDate !== null)
    .filter((entry) => getDaysRemaining(entry.expiryDate) > settings.nearExpiryDays));
  await Promise.all(
    [...expirySchedules.map(async ({ product, lot, expiryDate }) => {
      const [year, month, day] = expiryDate.split("-").map(Number);
      const triggerDate = new Date(year, month - 1, day - settings.nearExpiryDays, 9, 0, 0, 0);
      if (triggerDate <= now) return;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `ใกล้หมดอายุ: ${product.name}`,
          body: `ล็อตที่ ${lot.batchNumber} · ${formatProductPosition(product)}`,
          data: { productId: product.id, lotId: lot.id, alertType: "near-expiry", url: EXPIRY_ALERT_ROUTE },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: triggerDate,
          channelId: CHANNEL_ID,
        },
      });
    }),
    ...lowStockAlerts.map(async (alert) => {
      const triggerDate = getLotAlertTriggerDate(alert, settings, now);
      if (triggerDate <= now) return;
      await Notifications.scheduleNotificationAsync({
        content: { title: getLotAlertTitle(alert), body: getLotAlertBody(alert), data: { productId: alert.product.id, lotId: alert.lot.id, alertType: alert.type, url: EXPIRY_ALERT_ROUTE } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate, channelId: CHANNEL_ID },
      });
    })],
  );
}

function getLotAlertTriggerDate(alert: LotAlert, settings: InventorySettings, now: Date): Date {
  if (alert.type === "low-stock") {
    const trigger = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
    if (trigger <= now) trigger.setDate(trigger.getDate() + 1);
    return trigger;
  }
  const [year, month, day] = (alert.expiryDate ?? "").split("-").map(Number);
  return new Date(year, month - 1, day - settings.nearExpiryDays, 9, 0, 0, 0);
}

function getLotAlertTitle(alert: LotAlert): string {
  return alert.type === "low-stock" ? `จำนวนใกล้หมด: ${alert.product.name}` : `ใกล้หมดอายุ: ${alert.product.name}`;
}

function getLotAlertBody(alert: LotAlert): string {
  const lotText = `ล็อตที่ ${alert.lot.batchNumber}`;
  return alert.type === "low-stock"
    ? `${lotText} เหลือ ${alert.lot.quantity} หน่วย · ${formatProductPosition(alert.product)}`
    : `${lotText} จะเข้าสู่ช่วงใกล้หมดอายุ · ${formatProductPosition(alert.product)}`;
}
