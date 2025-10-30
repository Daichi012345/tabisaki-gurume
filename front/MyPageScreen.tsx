import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../utils/auth';
import { apiCall } from '../utils/api';

type UserPreferences = {
  favoriteGenres: string[];
  favoriteFoods: string[];
  priceRange: string;
  dietaryRestrictions: string[];
  preferredDistance: number;
};

type Props = { onClose: () => void; };

const OPTIONS = {
  genres: ['和食', '洋食', '中華', 'イタリアン', 'フレンチ', 'カフェ', 'ラーメン', '寿司', '焼肉', '韓国料理', 'タイ料理', 'インド料理', 'メキシコ料理', 'ベトナム料理', 'ファストフード', '居酒屋', 'スイーツ', 'ベーカリー'],
  foods: ['パスタ', 'ピザ', 'ハンバーガー', 'ステーキ', 'カレー', '丼物', 'デザート', 'コーヒー', 'ラーメン', 'うどん', 'そば', '寿司', '刺身', '天ぷら', '焼き鳥', 'サラダ', 'スープ', '定食', '弁当', 'サンドイッチ', 'タコス', 'パッタイ', 'トムヤムクン', 'ビビンバ', 'キムチ', 'フォー', '春巻き', 'チャーハン', '麻婆豆腐', 'パン', 'ケーキ', 'アイスクリーム', 'お酒', '紅茶', 'スムージー'],
  prices: [
    { label: '〜1,000円', value: '¥' },
    { label: '1,000〜3,000円', value: '¥¥' },
    { label: '3,000〜5,000円', value: '¥¥¥' },
    { label: '5,000円〜', value: '¥¥¥¥' }
  ],
  dietary: ['ベジタリアン', 'ヴィーガン', 'グルテンフリー', 'ハラル', '低糖質', 'アレルギー対応']
};

export default function MyPageScreen({ onClose }: Props) {
  const { user, token } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>({
    favoriteGenres: [], favoriteFoods: [], priceRange: '¥¥',
    dietaryRestrictions: [], preferredDistance: 2000,
  });
  const [loading, setLoading] = useState(false);
  const [modalType, setModalType] = useState<'genre'|'food'|'dietary'|'allergy'|null>(null);
  const [allergyDetails, setAllergyDetails] = useState('');

  useEffect(() => { user && loadPreferences(); }, [user]);

  const loadPreferences = async () => {
    try {
      setLoading(true);
      const response = await apiCall('/api/user/preferences', { 
        method: 'GET', headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      data.success && setPreferences(data.preferences);
    } catch (error) {
      console.log('設定読み込みエラー');
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async () => {
    if (!user || !token) return Alert.alert('エラー', 'ログインが必要です');
    try {
      setLoading(true);
      
      // サーバーに保存
      const response = await apiCall('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(preferences),
      });
      const data = await response.json();
      
      if (data.success) {
        // AIスコアリング用にAsyncStorageにも保存
        const aiPreferences = {
          favoriteGenres: preferences.favoriteGenres,
          favoriteFoods: preferences.favoriteFoods,
          budgetRange: mapPriceToRange(preferences.priceRange),
          allergies: preferences.dietaryRestrictions,
          priceWeight: 0.3,
          distanceWeight: 0.3, 
          ratingWeight: 0.25,
          localWeight: 0.15
        };
        await AsyncStorage.setItem('userPreferences', JSON.stringify(aiPreferences));
        
        Alert.alert('成功', '設定を保存しました！', [{ text: 'OK', onPress: onClose }]);
      } else {
        Alert.alert('エラー', data.message || '保存に失敗しました');
      }
    } catch (error) {
      Alert.alert('エラー', 'ネットワークエラー');
    } finally {
      setLoading(false);
    }
  };
  
  // 価格記号から価格帯への変換
  const mapPriceToRange = (priceSymbol: string): string => {
    const priceMap: { [key: string]: string } = {
      '¥': '～1000円',
      '¥¥': '～2000円', 
      '¥¥¥': '～3000円',
      '¥¥¥¥': '5000円～'
    };
    return priceMap[priceSymbol] || '～2000円';
  };

  const toggleItem = (type: keyof UserPreferences, item: string) => {
    setPreferences(prev => ({
      ...prev,
      [type]: Array.isArray(prev[type])
        ? (prev[type] as string[]).includes(item)
          ? (prev[type] as string[]).filter(i => i !== item)
          : [...(prev[type] as string[]), item]
        : prev[type]
    }));
  };

  const handleDietary = (dietary: string) => {
    if (dietary === 'アレルギー対応') {
      preferences.dietaryRestrictions.some(d => d.startsWith('アレルギー対応'))
        ? (setPreferences(prev => ({ ...prev, dietaryRestrictions: prev.dietaryRestrictions.filter(d => !d.startsWith('アレルギー対応')) })), setAllergyDetails(''))
        : setModalType('allergy');
    } else {
      toggleItem('dietaryRestrictions', dietary);
    }
  };

  const saveAllergy = () => {
    allergyDetails.trim() && setPreferences(prev => ({
      ...prev,
      dietaryRestrictions: [...prev.dietaryRestrictions.filter(d => !d.startsWith('アレルギー対応')), `アレルギー対応: ${allergyDetails.trim()}`]
    }));
    setModalType(null);
  };

  const renderSection = (title: string, items: string[], onPress: () => void) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <TouchableOpacity style={styles.button} onPress={onPress}>
        <Text style={styles.buttonText}>選択 ({items.length}件)</Text>
      </TouchableOpacity>
      <View style={styles.items}>
        {items.map(item => (
          <View key={item} style={styles.item}>
            <Text style={styles.itemText}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderModal = () => {
    if (!modalType) return null;
    
    if (modalType === 'allergy') {
      return (
        <Modal visible transparent>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.overlay}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={styles.allergyModal}>
                  <View style={styles.allergyHeader}>
                    <Text style={styles.allergyTitle}>アレルギー詳細入力</Text>
                    <TouchableOpacity 
                      style={styles.allergyCloseButton}
                      onPress={() => setModalType(null)}
                    >
                      <Text style={styles.allergyCloseText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  
                  <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <View style={styles.allergyContent}>
                      <Text style={styles.allergyLabel}>
                        具体的なアレルギー内容をご入力ください
                      </Text>
                      <Text style={styles.allergyDescription}>
                        レストランでの対応に必要な情報を詳しく教えてください
                      </Text>
                      
                      <TextInput
                        style={styles.allergyInput}
                        placeholder="例：卵、乳製品、えび、かに、そば、小麦など"
                        placeholderTextColor="#999"
                        value={allergyDetails}
                        onChangeText={setAllergyDetails}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                      />
                      
                      <View style={styles.allergyButtons}>
                        <TouchableOpacity 
                          style={styles.allergyCancelBtn}
                          onPress={() => {
                            Keyboard.dismiss();
                            setModalType(null);
                            setAllergyDetails('');
                          }}
                        >
                          <Text style={styles.allergyCancelText}>キャンセル</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                          style={[
                            styles.allergySaveBtn,
                            !allergyDetails.trim() && styles.allergySaveBtnDisabled
                          ]}
                          onPress={() => {
                            Keyboard.dismiss();
                            saveAllergy();
                          }}
                          disabled={!allergyDetails.trim()}
                        >
                          <Text style={[
                            styles.allergySaveText,
                            !allergyDetails.trim() && styles.allergySaveTextDisabled
                          ]}>
                            保存
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableWithoutFeedback>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      );
    }

    const data = modalType === 'genre' ? OPTIONS.genres : modalType === 'food' ? OPTIONS.foods : OPTIONS.dietary;
    const key = modalType === 'genre' ? 'favoriteGenres' : modalType === 'food' ? 'favoriteFoods' : 'dietaryRestrictions';
    
    return (
      <Modal visible>
        <View style={styles.modalContainer}>
          <View style={styles.header}>
            <Text style={styles.modalTitle}>選択</Text>
            <TouchableOpacity onPress={() => setModalType(null)}>
              <Text style={styles.closeText}>完了</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {data.map(item => {
              const isSelected = modalType === 'dietary' && item === 'アレルギー対応'
                ? preferences.dietaryRestrictions.some(d => d.startsWith('アレルギー対応'))
                : preferences[key].includes(item);
              
              return (
                <TouchableOpacity
                  key={item}
                  style={[styles.option, isSelected && styles.selectedOption]}
                  onPress={() => modalType === 'dietary' ? handleDietary(item) : toggleItem(key, item)}
                >
                  <Text style={[styles.optionText, isSelected && styles.selectedText]}>{item}</Text>
                  {isSelected && <Text style={styles.check}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>マイページ</Text>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {!user ? (
          <View style={styles.loginPrompt}>
            <Text style={styles.loginPromptTitle}>ログインが必要です</Text>
            <TouchableOpacity style={styles.loginButton} onPress={onClose}>
              <Text style={styles.loginButtonText}>ログイン画面に戻る</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>👤 ユーザー情報</Text>
              <Text style={styles.userName}>{user.name}</Text>
              <Text style={styles.userEmail}>{user.email}</Text>
            </View>

            {renderSection('🍽️ 好きなジャンル', preferences.favoriteGenres, () => setModalType('genre'))}
            {renderSection('🥘 好きな料理', preferences.favoriteFoods, () => setModalType('food'))}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>💰 希望価格帯</Text>
              {OPTIONS.prices.map(price => (
                <TouchableOpacity
                  key={price.value}
                  style={[styles.priceButton, preferences.priceRange === price.value && styles.selectedPrice]}
                  onPress={() => setPreferences(prev => ({ ...prev, priceRange: price.value }))}
                >
                  <Text style={styles.priceText}>{price.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {renderSection('🚫 食事制限・アレルギー', preferences.dietaryRestrictions, () => setModalType('dietary'))}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📍 検索範囲</Text>
              <Text style={styles.distanceLabel}>{(preferences.preferredDistance / 1000).toFixed(1)}km</Text>
              <View style={styles.distanceButtons}>
                {[1000, 2000, 3000, 5000].map(distance => (
                  <TouchableOpacity
                    key={distance}
                    style={[styles.distanceButton, preferences.preferredDistance === distance && styles.selectedDistance]}
                    onPress={() => setPreferences(prev => ({ ...prev, preferredDistance: distance }))}
                  >
                    <Text style={styles.distanceButtonText}>{distance / 1000}km</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity 
              style={[styles.saveButton, loading && styles.saveButtonDisabled]}
              onPress={savePreferences}
              disabled={loading}
            >
              <Text style={styles.saveButtonText}>{loading ? '保存中...' : '設定を保存'}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      {renderModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e9ecef' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#2c3e50' },
  closeButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e9ecef', justifyContent: 'center', alignItems: 'center' },
  closeButtonText: { fontSize: 16, color: '#6c757d' },
  content: { flex: 1, paddingHorizontal: 20 },
  section: { backgroundColor: '#fff', marginVertical: 10, padding: 20, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50', marginBottom: 15 },
  userName: { fontSize: 16, color: '#495057', fontWeight: '500' },
  userEmail: { fontSize: 14, color: '#6c757d', marginTop: 4 },
  loginPrompt: { backgroundColor: '#fff', marginVertical: 20, padding: 30, borderRadius: 12, alignItems: 'center' },
  loginPromptTitle: { fontSize: 20, fontWeight: 'bold', color: '#e74c3c', marginBottom: 12 },
  loginButton: { backgroundColor: '#007bff', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  loginButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  button: { backgroundColor: '#007bff', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, marginBottom: 15 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '500', textAlign: 'center' },
  items: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { backgroundColor: '#e3f2fd', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#2196f3' },
  itemText: { color: '#1976d2', fontSize: 14, fontWeight: '500' },
  priceButton: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, borderWidth: 2, borderColor: '#dee2e6', backgroundColor: '#fff', alignItems: 'center', marginBottom: 8 },
  selectedPrice: { borderColor: '#28a745', backgroundColor: '#d4edda' },
  priceText: { fontSize: 14, color: '#6c757d', fontWeight: '500' },
  distanceLabel: { fontSize: 24, fontWeight: 'bold', color: '#007bff', textAlign: 'center', marginBottom: 15 },
  distanceButtons: { flexDirection: 'row', gap: 8 },
  distanceButton: { flex: 1, paddingVertical: 10, borderRadius: 6, borderWidth: 1, borderColor: '#dee2e6', backgroundColor: '#fff', alignItems: 'center' },
  selectedDistance: { borderColor: '#007bff', backgroundColor: '#e7f3ff' },
  distanceButtonText: { fontSize: 14, color: '#6c757d' },
  saveButton: { backgroundColor: '#28a745', paddingVertical: 16, borderRadius: 8, marginVertical: 30, marginHorizontal: 20 },
  saveButtonDisabled: { backgroundColor: '#6c757d' },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  modalContainer: { flex: 1, backgroundColor: '#f8f9fa' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#fff', margin: 20, padding: 20, borderRadius: 12, minWidth: 300 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50', marginBottom: 15, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#f8f9fa', minHeight: 80, marginBottom: 20 },
  buttons: { flexDirection: 'row', gap: 10 },
  cancelButton: { flex: 1, backgroundColor: '#6c757d', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  closeText: { fontSize: 16, color: '#007bff', fontWeight: '500' },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 20, backgroundColor: '#fff', marginVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: '#e9ecef' },
  selectedOption: { borderColor: '#28a745', backgroundColor: '#d4edda' },
  optionText: { fontSize: 16, color: '#495057' },
  selectedText: { color: '#155724', fontWeight: '500' },
  check: { fontSize: 18, color: '#28a745', fontWeight: 'bold' },
  // アレルギー専用スタイル
  allergyModal: { backgroundColor: '#fff', marginHorizontal: 20, borderRadius: 16, maxHeight: '80%', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 10 },
  allergyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#f1f3f4', backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  allergyTitle: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50' },
  allergyCloseButton: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f8f9fa', justifyContent: 'center', alignItems: 'center' },
  allergyCloseText: { fontSize: 16, color: '#6c757d', fontWeight: 'bold' },
  allergyContent: { padding: 20 },
  allergyLabel: { fontSize: 16, fontWeight: '600', color: '#2c3e50', marginBottom: 8, textAlign: 'center' },
  allergyDescription: { fontSize: 14, color: '#6c757d', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  allergyInput: { borderWidth: 2, borderColor: '#e3f2fd', borderRadius: 12, padding: 16, fontSize: 16, backgroundColor: '#fafbfc', minHeight: 100, marginBottom: 20, textAlignVertical: 'top', color: '#2c3e50' },
  allergyButtons: { flexDirection: 'row', gap: 12 },
  allergyCancelBtn: { flex: 1, backgroundColor: '#f8f9fa', paddingVertical: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#dee2e6' },
  allergyCancelText: { color: '#6c757d', fontSize: 16, fontWeight: '600' },
  allergySaveBtn: { flex: 1, backgroundColor: '#007bff', paddingVertical: 14, borderRadius: 10, alignItems: 'center', shadowColor: '#007bff', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 },
  allergySaveBtnDisabled: { backgroundColor: '#cbd3da', shadowOpacity: 0 },
  allergySaveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  allergySaveTextDisabled: { color: '#adb5bd' },
});