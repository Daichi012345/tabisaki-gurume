// 認証管理のコンテキスト
import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { apiCall } from './api';

// ユーザー情報の型定義
export type User = {
  id: number;
  name: string;
  email: string;
  avatar_url?: string;
  is_verified: boolean;
  created_at: string;
  preferences?: {
    favoriteGenres: string[];
    favoriteFoods: string[];
    priceRange: string;
    dietaryRestrictions: string[];
    preferredDistance: number;
    notifications: boolean;
  };
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  updateUser: (userData: Partial<User>) => Promise<boolean>;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // アプリ起動時に保存された認証情報を確認
  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      // 毎回ログイン画面から始まるように、保存された認証情報をクリア
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('user_data');
      
      // 状態を初期化
      setToken(null);
      setUser(null);
    } catch (error) {
      console.log('認証状態初期化エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  const verifyToken = async (authToken: string): Promise<boolean> => {
    try {
      const response = await apiCall('/api/auth/verify', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  };

  // ログイン処理
  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      console.log('🔐 ログイン試行:', email);
      const response = await apiCall('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const { token: newToken, user: userData } = data;
          
          // 認証情報を保存
          await AsyncStorage.setItem('auth_token', newToken);
          await AsyncStorage.setItem('user_data', JSON.stringify(userData));
          
          setUser(userData);
          setToken(newToken);
          console.log('✅ ログイン成功:', userData.name);
          return true;
        }
      }
      
      const errorData = await response.json();
      Alert.alert('ログインエラー', errorData.message || 'ログインに失敗しました');
      return false;
    } catch (error) {
      console.error('❌ ログインエラー:', error);
      Alert.alert('エラー', 'ネットワークエラーが発生しました');
      return false;
    }
  };

  // 新規登録処理
  const register = async (name: string, email: string, password: string): Promise<boolean> => {
    try {
      console.log('📝 新規登録試行:', name, email);
      const response = await apiCall('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const { token: newToken, user: userData } = data;
          
          // 認証情報を保存
          await AsyncStorage.setItem('auth_token', newToken);
          await AsyncStorage.setItem('user_data', JSON.stringify(userData));
          
          setUser(userData);
          setToken(newToken);
          console.log('✅ 新規登録成功:', userData.name);
          return true;
        }
      }
      
      const errorData = await response.json();
      Alert.alert('登録エラー', errorData.message || '新規登録に失敗しました');
      return false;
    } catch (error) {
      console.error('❌ 新規登録エラー:', error);
      Alert.alert('エラー', 'ネットワークエラーが発生しました');
      return false;
    }
  };

  // ログアウト処理
  const logout = async (): Promise<void> => {
    try {
      // 認証情報を削除
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('user_data');
      setUser(null);
      setToken(null);
      console.log('👋 ログアウト完了');
    } catch (error) {
      console.error('❌ ログアウトエラー:', error);
    }
  };

  // ユーザー情報更新
  const updateUser = async (userData: Partial<User>): Promise<boolean> => {
    try {
      if (!token) return false;

      const response = await apiCall('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(userData),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const updatedUser = { ...user, ...data.user };
          setUser(updatedUser as User);
          await AsyncStorage.setItem('user_data', JSON.stringify(updatedUser));
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('❌ ユーザー更新エラー:', error);
      return false;
    }
  };

  // ユーザー情報を最新に更新
  const refreshUser = async (): Promise<void> => {
    try {
      if (!token) return;

      const response = await apiCall('/api/auth/profile', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setUser(data.user);
          await AsyncStorage.setItem('user_data', JSON.stringify(data.user));
        }
      }
    } catch (error) {
      console.log('ユーザー情報更新エラー:', error);
    }
  };

  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    updateUser,
    refreshUser,
    isAuthenticated: !!user && !!token,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}