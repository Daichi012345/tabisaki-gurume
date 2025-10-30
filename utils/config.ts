// Centralized config helpers
// Resolves Google Maps API key robustly across environments
import appConfig from '../app.json';

// Prefer EXPO_PUBLIC env (Expo exposes these to the client),
// then fall back to keys configured in app.json for iOS/Android.
export const GOOGLE_MAPS_API_KEY: string =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  // Android app.json path
  ((appConfig as any)?.expo?.android?.config?.googleMaps?.apiKey as string | undefined) ||
  // iOS app.json path
  ((appConfig as any)?.expo?.ios?.config?.googleMapsApiKey as string | undefined) ||
  '';

export const ensureGoogleApiKey = (): string => {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('Google Maps API key is not set. Some features (Places/Photos/Geocoding) may not work.');
  }
  return GOOGLE_MAPS_API_KEY;
};
