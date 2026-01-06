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

// Backend base URL for client→server calls
// Prefer EXPO_PUBLIC env; fallback to relative origin ('')
// Accept multiple env names to be compatible with existing .env
const apiBaseFromEnv =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  '';

// If only host is provided, default to http and common port
const apiHost = process.env.EXPO_PUBLIC_API_HOST;
const defaultPort = process.env.EXPO_PUBLIC_API_PORT || '3001';
export const BACKEND_BASE_URL: string = apiBaseFromEnv || (apiHost ? `http://${apiHost}:${defaultPort}` : '');

// Hot Pepper API key exposed to client when available
export const HOTPEPPER_PUBLIC_API_KEY: string =
  process.env.EXPO_PUBLIC_HOTPEPPER_API_KEY || '';

export const buildApiUrl = (path: string): string => {
  if (!path.startsWith('/')) path = `/${path}`;
  // If BACKEND_BASE_URL is empty, use relative URL
  return `${BACKEND_BASE_URL}${path}`;
};
