// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "com.app.expiryshelftracker";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Extract timestamp from bundle ID and prefix with "manus" for deep link scheme
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "ShelfWatch",
  appSlug: "expiry-shelf-tracker",
  // S3 URL of the app logo - set this to the URL returned by generate_image when creating custom logo
  // Leave empty to use the default icon from assets/images/icon.png
  logoUrl: "/manus-storage/shelfwatch-app-icon_3d2ba7c4.png",
  // ตั้งค่าเมื่อมี Native Build ที่พร้อมให้ผู้ใช้ดาวน์โหลด
  nativeBuildVersion: "",
  nativeBuildUrl: "",
  scheme: schemeFromBundleId,
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.1.0",
  runtimeVersion: {
    policy: "appVersion",
  },
  updates: {
    fallbackToCacheTimeout: 0,
  },
  extra: {
    nativeBuildVersion: env.nativeBuildVersion,
    nativeBuildUrl: env.nativeBuildUrl,
  },
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#1D4ED8",
      foregroundImage: "./assets/images/android-icon-foreground.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    versionCode: 10100,
    permissions: ["POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-updates",
    "expo-font",
    "expo-web-browser",
    [
      "expo-camera",
      {
        "cameraPermission": "อนุญาตให้ $(PRODUCT_NAME) ใช้กล้องเพื่อสแกนบาร์โค้ดสินค้า",
      },
    ],
    [
      "expo-image-picker",
      {
        "photosPermission": "อนุญาตให้ $(PRODUCT_NAME) เข้าถึงรูปภาพเพื่อแนบรูปสินค้า รูปโปรไฟล์ และภาพพื้นหลัง",
        "cameraPermission": "อนุญาตให้ $(PRODUCT_NAME) ใช้กล้องเพื่อถ่ายรูปสินค้า รูปโปรไฟล์ และภาพพื้นหลัง",
      },
    ],
    [
      "expo-notifications",
      {
        "color": "#1F6F5B",
        "defaultChannel": "expiry-alerts",
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-speech-recognition",
      {
        microphonePermission: "อนุญาตให้ $(PRODUCT_NAME) ใช้ไมโครโฟนเพื่อค้นหาสินค้าด้วยเสียง",
        speechRecognitionPermission: "อนุญาตให้ $(PRODUCT_NAME) แปลงคำพูดเป็นคำค้นหาสินค้า",
        androidSpeechServicePackages: ["com.google.android.googlequicksearchbox"],
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
