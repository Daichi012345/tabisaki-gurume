// Dynamic Expo app config to avoid committing API keys
// Reads keys from environment variables at build/runtime

module.exports = ({ config }) => {
  const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  return {
    expo: {
      name: 'tabisaki-gurume',
      slug: 'tabisaki-gurume',
      version: '1.0.0',
      orientation: 'portrait',
      icon: './assets/icon.png',
      userInterfaceStyle: 'light',
      newArchEnabled: true,
      splash: {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
      ios: {
        supportsTablet: true,
        infoPlist: {
          NSLocationWhenInUseUsageDescription: 'このアプリは現在地を表示するために位置情報を使用します。',
        },
        config: {
          googleMapsApiKey: GOOGLE_KEY,
        },
      },
      android: {
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#ffffff',
        },
        edgeToEdgeEnabled: true,
        permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
        config: {
          googleMaps: {
            apiKey: GOOGLE_KEY,
          },
        },
        package: 'com.hayashidaichi.tabisakigurume',
      },
      web: {
        favicon: './assets/favicon.png',
      },
    },
  };
};
