import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import LoginScreen from './LoginScreen';
import RegisterScreen from './RegisterScreen';

type AuthMode = 'login' | 'register';

type Props = {
  onLogin?: () => void;
};

export default function AuthScreen({ onLogin }: Props): React.ReactElement {
  const [mode, setMode] = useState<AuthMode>('login');
  const [fadeAnim] = useState(new Animated.Value(1));

  const switchMode = (newMode: AuthMode) => {
    if (mode === newMode) return;
    
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
    
    setTimeout(() => setMode(newMode), 150);
  };

  const handleRegisterSuccess = () => {
    switchMode('login');
  };

  return (
    <View style={styles.container}>
      {/* コンテンツエリア */}
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        {mode === 'login' ? (
          <LoginScreen onLogin={onLogin} />
        ) : (
          <RegisterScreen onRegisterSuccess={handleRegisterSuccess} />
        )}
      </Animated.View>

      {/* フッターテキスト */}
      <View style={styles.footer}>
        {mode === 'login' ? (
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>アカウントをお持ちでない方は</Text>
            <TouchableOpacity onPress={() => switchMode('register')}>
              <Text style={styles.linkText}>こちら</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>既にアカウントをお持ちの方は</Text>
            <TouchableOpacity onPress={() => switchMode('login')}>
              <Text style={styles.linkText}>こちら</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    flex: 1,
    marginTop: 40,
  },
  footer: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    color: '#64748b',
    fontSize: 14,
  },
  linkText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
});