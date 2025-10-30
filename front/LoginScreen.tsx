import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { useAuth } from '../utils/auth';

type LoginState = {
  email: string;
  password: string;
};

type Props = {
  onLogin?: () => void;
};

export default function LoginScreen({ onLogin }: Props): React.ReactElement {
  const { login } = useAuth();
  const [form, setForm] = useState<LoginState>({ email: '', password: '' });
  const [errors, setErrors] = useState<Partial<LoginState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (key: keyof LoginState, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<LoginState> = {};
    if (!form.email.trim()) next.email = 'メールアドレスを入力してください';
    else if (!/^[\w-.]+@[\w-]+\.[a-z]{2,}$/i.test(form.email)) next.email = '有効なメールアドレスを入力してください';
    if (!form.password) next.password = 'パスワードを入力してください';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleLogin = async () => {
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    
    try {
      console.log('🔐 ログイン試行:', form.email);
      const success = await login(form.email, form.password);
      
      if (success) {
        console.log('✅ ログイン成功');
        if (onLogin) onLogin();
      }
      // エラーはauth.tsxで既にAlert表示されるため、ここでは何もしない
    } catch (error) {
      console.error('❌ ログインエラー:', error);
      Alert.alert('エラー', '予期しないエラーが発生しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>ログイン</Text>
          <Text style={styles.subtitle}>アカウントにサインインしてください</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.icon}>✉️</Text>
            <TextInput
              style={[styles.input, errors.email ? styles.inputError : null]}
              placeholder="メールアドレス"
              placeholderTextColor="#9aa4b2"
              value={form.email}
              onChangeText={(v: string) => handleChange('email', v)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
            />
          </View>
          {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}

          <View style={styles.field}>
            <Text style={styles.icon}>🔒</Text>
            <TextInput
              style={[styles.input, errors.password ? styles.inputError : null]}
              placeholder="パスワード"
              placeholderTextColor="#9aa4b2"
              value={form.password}
              onChangeText={(v: string) => handleChange('password', v)}
              secureTextEntry={!showPassword}
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
            />
            <Pressable onPress={() => setShowPassword(s => !s)} style={styles.toggleButton}>
              <Text style={styles.toggleText}>{showPassword ? '非表示' : '表示'}</Text>
            </Pressable>
          </View>
          {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

          <TouchableOpacity style={[styles.button, submitting ? styles.buttonDisabled : null]} onPress={handleLogin} disabled={submitting}>
            <Text style={styles.buttonText}>{submitting ? 'ログイン中...' : 'ログイン'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
  header: { alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  subtitle: { marginTop: 6, fontSize: 14, color: '#546170', textAlign: 'center', maxWidth: 300 },
  card: { width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 20, maxWidth: 420, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 6 },
  field: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  icon: { width: 36, textAlign: 'center', fontSize: 18, marginRight: 8 },
  input: { flex: 1, height: 48, backgroundColor: '#f7fafc', borderRadius: 10, paddingHorizontal: 12 },
  inputError: { borderColor: '#e74c3c' },
  errorText: { color: '#e74c3c', marginBottom: 8, marginLeft: 36 },
  button: { height: 50, backgroundColor: '#007AFF', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 16, shadowColor: '#007AFF', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 4 },
  buttonDisabled: { backgroundColor: '#8fbce6' },
  buttonText: { color: '#fff', fontWeight: '600' },
  toggleButton: { marginLeft: 8, paddingHorizontal: 6, paddingVertical: 6 },
  toggleText: { color: '#007AFF', fontWeight: '600' },
});
