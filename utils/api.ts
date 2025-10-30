// API設定の共通ファイル
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export const getApiBaseUrl = () => {
  // 1) 明示のベースURLがあれば最優先（.envでIP変更だけで反映させるため）
  const explicitBase = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.EXPO_PUBLIC_API_URL;
  if (explicitBase) {
    return explicitBase;
  }

  // 2) 環境変数からホストとポートを取得
  const apiHost = process.env.EXPO_PUBLIC_API_HOST || '10.108.0.164';
  const apiPort = process.env.EXPO_PUBLIC_API_PORT || '8080';
  
  // Expoの開発環境での実行を検出
  const { manifest } = Constants;
  
  if (__DEV__ && manifest?.debuggerHost) {
    // 3) 明示指定がない場合のみ、開発サーバーホストを利用
    const debuggerHost = manifest.debuggerHost.split(':').shift();
    const apiUrl = `http://${debuggerHost}:${apiPort}`;
    return apiUrl;
  }
  
  // プラットフォーム別の設定
  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${apiPort}`;
  } else {
    return `http://${apiHost}:${apiPort}`;
  }
};

export const API_BASE_URL = getApiBaseUrl();

// ネットワーク接続テスト用関数
export const testApiConnection = async () => {
  const apiHost = process.env.EXPO_PUBLIC_API_HOST || '10.108.0.164';
  const apiPort = process.env.EXPO_PUBLIC_API_PORT || '8080';
  
  const testUrls = [
    `http://${apiHost}:${apiPort}`,
    `http://localhost:${apiPort}`,
    `http://10.0.2.2:${apiPort}`,
  ];
  
  for (const testUrl of testUrls) {
    try {
      console.log(`Testing connection to: ${testUrl}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // タイムアウトを10秒に延長
      
      const response = await fetch(`${testUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        console.log(`✅ Connection successful to: ${testUrl}`);
        return { success: true, url: testUrl };
      }
    } catch (error) {
      console.log(`❌ Connection failed to: ${testUrl}`, error);
    }
  }
  
  return { success: false, url: null };
};

// API呼び出し用のヘルパー関数
export const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  try {
    console.log(`API Call: ${url}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒のタイムアウト
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`API Error: ${response.status} ${response.statusText}`);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    console.log(`✅ API Call successful: ${url}`);
    return response;
  } catch (error) {
    console.error(`❌ API Call failed: ${url}`, error);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - Please check your network connection');
      }
      
      if (error.message.includes('Network request failed')) {
        throw new Error('Network error - Please check if the server is running');
      }
      
      throw error;
    }
    
    throw new Error('Unknown error occurred');
  }
};