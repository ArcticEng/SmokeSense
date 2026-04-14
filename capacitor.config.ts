import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "za.co.arcticengineering.smokesense",
  appName: "SmokeSense",
  webDir: "out", // next export output
  server: {
    // For development, point to your local Next.js dev server:
    // url: "http://192.168.1.xxx:3000",
    // cleartext: true,

    // For production, the app loads from the bundled web assets
    androidScheme: "https",
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    LocalNotifications: {
      smallIcon: "ic_stat_smoke",
      iconColor: "#ef4444",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0f1117",
    },
  },
  // iOS-specific
  ios: {
    contentInset: "automatic",
    scheme: "SmokeSense",
  },
  // Android-specific
  android: {
    allowMixedContent: false,
    backgroundColor: "#0f1117",
  },
};

export default config;

/*
  ═══════════════════════════════════════════════
   MOBILE APP BUILD STEPS
  ═══════════════════════════════════════════════

  1. Install Capacitor:
     npm install @capacitor/core @capacitor/cli
     npm install @capacitor/ios @capacitor/android
     npm install @capacitor/push-notifications
     npm install @capacitor/local-notifications
     npm install @capacitor/status-bar

  2. Update next.config.js for static export:
     Add: output: "export"
     (or keep "standalone" for SSR and use server.url instead)

  3. Build & sync:
     next build
     npx cap add ios        # first time only
     npx cap add android    # first time only
     npx cap sync

  4. Open native IDE:
     npx cap open ios       # opens Xcode
     npx cap open android   # opens Android Studio

  5. For push notifications:
     - iOS: Add Push Notifications capability in Xcode
     - Android: Add google-services.json from Firebase
     - Register FCM token on app launch and send to your
       Supabase backend (store in a user_fcm_tokens table)

  6. Live reload during dev:
     Uncomment the server.url line above with your local IP
     npx cap run ios --livereload --external
*/
