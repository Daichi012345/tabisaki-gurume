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
import { apiCall, testApiConnection } from '../utils/api';

type FormState = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type Props = {
  onRegisterSuccess?: () => void;
};

export default function RegisterScreen({ onRegisterSuccess }: Props = {}): React.ReactElement {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  } as FormState);
  const [errors, setErrors] = useState({} as Partial<FormState>);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleChange = (key: keyof FormState, value: string) => {
    setForm((prev: FormState) => ({ ...prev, [key]: value }));
    setErrors((prev: Partial<FormState>) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<FormState> = {};

    if (!form.name.trim()) next.name = '名前を入力してください';
    if (!form.email.trim()) next.email = 'メールアドレスを入力してください';
    else if (!/^[\w-.]+@[\w-]+\.[a-z]{2,}$/i.test(form.email)) next.email = '有効なメールアドレスを入力してください';
    
    if (form.password.length < 6) {
      next.password = 'パスワードは6文字以上必要です';
    } else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/.test(form.password)) {
      next.password = 'パスワードは大文字、小文字、数字を含む必要があります';
    }
    
    if (form.confirmPassword !== form.password) next.confirmPassword = 'パスワードが一致しません';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      // まずネットワーク接続をテスト
      const isConnected = await testApiConnection();
      if (!isConnected) {
        Alert.alert(
          'ネットワークエラー',
          'APIサーバーに接続できません。\n\n確認事項:\n• Docker コンテナが起動している\n• ポート8080が開いている\n• ネットワーク接続が正常',
          [{ text: 'OK' }]
        );
        return;
      }
      
      // バックエンドAPIに登録リクエストを送信
      const response = await apiCall('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        Alert.alert('登録完了', data.message || 'アカウントを作成しました', [
          {
            text: 'OK',
            onPress: () => {
              if (onRegisterSuccess) {
                onRegisterSuccess();
              }
            }
          }
        ]);
        setForm({ name: '', email: '', password: '', confirmPassword: '' });
        setErrors({});
      } else {
        // バックエンドからのエラーレスポンスを処理
        const errorMessage = data.error || '登録に失敗しました';
        
        if (data.code === 'EMAIL_ALREADY_EXISTS') {
          setErrors({ email: 'このメールアドレスは既に登録されています' });
        } else if (data.code === 'VALIDATION_ERROR' && data.details) {
          // バリデーションエラーをフォームエラーに変換
          const newErrors: Partial<FormState> = {};
          data.details.forEach((detail: any) => {
            if (detail.param === 'name') newErrors.name = detail.msg;
            if (detail.param === 'email') newErrors.email = detail.msg;
            if (detail.param === 'password') newErrors.password = detail.msg;
          });
          setErrors(newErrors);
        }
        
        Alert.alert('登録エラー', errorMessage);
      }
    } catch (error) {
      const err = error as Error;
      
      // ネットワークエラーの詳細な情報を提供
      let errorMessage = 'サーバーに接続できませんでした。';
      
      if (err.message && err.message.includes('Network request failed')) {
        errorMessage += '\n\n原因の可能性:\n• APIサーバーが起動していない\n• ネットワーク接続の問題\n• ファイアウォールによるブロック\n• エミュレーターの設定問題';
      }
      
      Alert.alert('ネットワークエラー', errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled = submitting;

  // No keyboard listeners: card will stay fixed and the ScrollView handles content

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>新規登録</Text>
          <Text style={styles.subtitle}>アカウントを作成して旅のグルメをシェアしよう</Text>
        </View>

  <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.icon}>👤</Text>
            <TextInput
              style={[styles.input, errors.name ? styles.inputError : null]}
              placeholder="名前"
              placeholderTextColor="#9aa4b2"
              value={form.name}
              onChangeText={(v: string) => handleChange('name', v)}
              autoCapitalize="words"
            />
          </View>
          {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}

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
              autoCorrect={false}
            />
            <Pressable onPress={() => setShowPassword(s => !s)} style={styles.toggleButton}>
              <Text style={styles.toggleText}>{showPassword ? '非表示' : '表示'}</Text>
            </Pressable>
          </View>
          {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}

          <View style={styles.field}>
            <Text style={styles.icon}>🔒</Text>
            <TextInput
              style={[styles.input, errors.confirmPassword ? styles.inputError : null]}
              placeholder="パスワード（確認)"
              placeholderTextColor="#9aa4b2"
              value={form.confirmPassword}
              onChangeText={(v: string) => handleChange('confirmPassword', v)}
              secureTextEntry={!showConfirmPassword}
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
              autoCorrect={false}
            />
            <Pressable onPress={() => setShowConfirmPassword(s => !s)} style={styles.toggleButton}>
              <Text style={styles.toggleText}>{showConfirmPassword ? '非表示' : '表示'}</Text>
            </Pressable>
          </View>
          {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}

          <TouchableOpacity
            style={[styles.button, isDisabled ? styles.buttonDisabled : null]}
            onPress={handleSubmit}
            disabled={isDisabled}
          >
            <Text style={styles.buttonText}>{submitting ? '送信中...' : '登録する'}</Text>
          </TouchableOpacity>
  </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: '#f0f4f8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#546170',
    textAlign: 'center',
    maxWidth: 300,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
    maxWidth: 420,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  input: {
    flex: 1,
    height: 48,
    backgroundColor: '#f7fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  inputError: {
    borderColor: '#e74c3c',
  },
  errorText: {
    color: '#e74c3c',
    marginBottom: 8,
    marginLeft: 36,
  },
  button: {
    height: 50,
    backgroundColor: '#007AFF',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  buttonDisabled: {
    backgroundColor: '#8fbce6',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  icon: {
    width: 36,
    textAlign: 'center',
    fontSize: 18,
    marginRight: 8,
  },
  toggleButton: {
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  toggleText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
});
