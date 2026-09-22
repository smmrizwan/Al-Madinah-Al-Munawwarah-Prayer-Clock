import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // IMPORTANT: change appId to your own unique reverse-domain ID before
  // publishing to Google Play (e.g. "com.yourname.madinahclock").
  // Once published, the appId can never be changed.
  appId: 'com.madinah.clock',
  appName: 'Al-Madinah al-Munawwarah clock',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
