declare module '@env' {
  export const EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: string;
}

// TypeScriptでprocess.envの型を拡張
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: string;
  }
}