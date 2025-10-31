import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Alert, 
  ScrollView,
  ActivityIndicator,
  Modal
} from 'react-native';
import * as Location from 'expo-location';
import AIRankingModal from './AIRankingModal';
import { LOCAL_SPECIALTIES_KEYWORDS } from '../utils/aiScoring';
import { calculateAIScore, SpotScore } from '../utils/aiScoring';
import { ensureGoogleApiKey } from '../utils/config';
import { useAuth } from '../utils/auth';
import { apiCall } from '../utils/api';

const API_KEY: string = ensureGoogleApiKey();

// ---------- 型定義 ----------
type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  vicinity?: string;
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  types?: string[];
  reasons?: string[];
  photoUrl?: string;
};

type UserPreferences = {
  budget?: string;
  cuisineTypes?: string[];
  dietaryRestrictions?: string[];
  atmospherePreference?: string;
  groupSize?: number;
  occasion?: string;
};

// ---------- 高速位置取得 ----------
async function getLocationFast(): Promise<Location.LocationObject | null> {
  const timeout = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error('位置取得タイムアウト')), 5000)
  );

  try {
    const location = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeout,
    ]);
    return location;
  } catch (error) {
    console.warn('高速位置取得に失敗:', error);
    try {
      return await Location.getLastKnownPositionAsync();
    } catch {
      return null;
    }
  }
}

// ---------- 都道府県取得 ----------
async function getPrefectureFromCoords(lat: number, lng: number): Promise<string> {
  if (!API_KEY) throw new Error('Google Maps API キーが設定されていません');

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}&language=ja&result_type=administrative_area_level_1`
    );
    
    const data = await res.json();
    if (data.results?.[0]?.address_components) {
      for (const component of data.results[0].address_components) {
        if (component.types.includes('administrative_area_level_1')) {
          return component.long_name;
        }
      }
    }
    return '不明';
  } catch (error) {
    console.error('都道府県取得エラー:', error);
    return '不明';
  }
}

// ---------- Places API検索 ----------
async function searchPlaces(query: string, lat: number, lng: number): Promise<Place[]> {
  if (!API_KEY) throw new Error('Google Maps API キーが設定されていません');

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.name,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.formattedAddress,places.photos'
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 5000
        }
      },
      maxResultCount: 20
    })
  });

  const json = await res.json();
  return json.places?.map((p: any) => {
    const id = (p.name && typeof p.name === 'string' && p.name.startsWith('places/')) ? p.name.replace(/^places\//, '') : p.id;
    const photoName = p.photos?.[0]?.name; // e.g. "places/PLACE_ID/photos/PHOTO_ID"
    const photoUrl = photoName ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&key=${API_KEY}` : undefined;
    return {
      id,
      name: p.displayName?.text || 'Unknown',
      lat: p.location?.latitude || 0,
      lng: p.location?.longitude || 0,
      address: p.formattedAddress,
      vicinity: p.formattedAddress,
      rating: p.rating,
      user_ratings_total: p.userRatingCount,
      price_level: p.priceLevel,
      types: p.types,
      photoUrl,
    } as Place;
  }) || [];
}

// ---------- メインコンポーネント ----------
export default function RecommendationRankingScreen({ 
  navigation,
  route 
}: {
  navigation: any;
  route?: any;
}) {
  const { user, token } = useAuth();
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({});
  const [currentPrefecture, setCurrentPrefecture] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  
  // パラメータから現在地を取得（オプショナル）
  const currentLocation = route?.params?.currentLocation || null;
  const onPlacesUpdate = route?.params?.onPlacesUpdate || (() => {});
  
  // ご当地グルメ関連
  const [localSpecialties, setLocalSpecialties] = useState<Place[]>([]);
  const [showLocalSpecialties, setShowLocalSpecialties] = useState(false);
  const [loadingLocalSpecialties, setLoadingLocalSpecialties] = useState(false);
  
  // AIランキング関連
  const [aiScores, setAiScores] = useState<SpotScore[]>([]);
  const [showAIRanking, setShowAIRanking] = useState(false);
  const [loadingAIRanking, setLoadingAIRanking] = useState(false);
  const [rankingTitle, setRankingTitle] = useState<string | undefined>(undefined);
  const [rankingDescription, setRankingDescription] = useState<string | undefined>(undefined);
  const [rankingReasoningTitle, setRankingReasoningTitle] = useState<string | undefined>(undefined);

  // 初期化
  useEffect(() => {
    if (currentLocation) {
      initializePrefecture();
      loadUserPreferences();
    }
  }, [currentLocation]);

  const initializePrefecture = async () => {
    if (!currentLocation) return;
    
    try {
      const prefecture = await getPrefectureFromCoords(currentLocation.lat, currentLocation.lng);
      setCurrentPrefecture(prefecture);
    } catch (error) {
      console.error('都道府県取得失敗:', error);
    }
  };

  const loadUserPreferences = async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await apiCall('/api/user/preferences', { 
        method: 'GET',
        headers 
      });
      const data = await response.json();
      if (data.success) {
        setUserPreferences(data.preferences);
      }
    } catch (error) {
      console.error('ユーザー設定取得エラー:', error);
    }
  };

  // ご当地グルメ検索
  const searchLocalSpecialties = async () => {
    setLoadingLocalSpecialties(true);

    let loc = currentLocation as { lat: number; lng: number } | null;
    let prefecture = currentPrefecture;

    // 現在地・都道府県が未取得ならここで取得を試みる
    if (!loc) {
      try {
        setMsg('📡 現在地を取得中...');
        const quickLocation = await getLocationFast();
        if (quickLocation?.coords) {
          const { latitude, longitude } = quickLocation.coords;
          loc = { lat: latitude, lng: longitude };
        }
      } catch (e) {
        // 無視して後続で判定
      }
    }

    if (!prefecture && loc) {
      try {
        prefecture = await getPrefectureFromCoords(loc.lat, loc.lng);
        setCurrentPrefecture(prefecture);
      } catch (e) {
        // 失敗時は後続で判定
      }
    }

    if (!loc || !prefecture) {
      setLoadingLocalSpecialties(false);
      Alert.alert('位置情報が必要', '現在地の取得に失敗しました。位置情報の許可設定をご確認ください。');
      return;
    }

    setMsg('🍽️ ご当地グルメを検索中...');

    try {
      // 都道府県ごとの代表的なご当地キーワードを使用して精度を上げる
      const keywords = LOCAL_SPECIALTIES_KEYWORDS[prefecture] || [];
      if (keywords.length === 0) {
        setLoadingLocalSpecialties(false);
        Alert.alert('ご当地グルメ', `${prefecture}のご当地グルメ情報がありません`);
        return;
      }

      const allResults: Place[] = [];
      
      // 代表的なキーワード上位から検索（ヒット数と速度のバランスで最大5件）
      for (const specialty of keywords.slice(0, 5)) {
        try {
          const results = await searchPlaces(`${specialty} ${prefecture}`, loc.lat, loc.lng);
          allResults.push(...results.slice(0, 3)); // 各キーワードから3件まで
        } catch (error) {
          console.warn(`${specialty}の検索でエラー:`, error);
        }
      }
      
      if (allResults.length > 0) {
        // 重複を除去
        const uniqueResults = allResults.filter((place, index, self) => 
          index === self.findIndex(p => p.id === place.id)
        );

        // AIランキングと同様のモーダルで表示するため、AIスコアを計算してモーダルを開く
        setMsg('🍽️ ご当地グルメのスコアを計算中...');
  const scores = await calculateAIScore(uniqueResults, loc, prefecture);
        setAiScores(scores);
  setRankingTitle(`🍽️ ${prefecture}のご当地グルメランキング`);
  setRankingDescription('ご当地度・距離・評価などを総合して並べ替えています');
  setRankingReasoningTitle('📝 おすすめ理由:');
  setShowAIRanking(true);
        setShowLocalSpecialties(false);
        setLocalSpecialties(uniqueResults);
        setMsg(`🍽️ ${prefecture}のご当地グルメをランキング表示しました (${scores.length}件)`);
      } else {
        setMsg(`${prefecture}のご当地グルメが見つかりませんでした`);
      }
    } catch (error) {
      console.error('ご当地グルメ検索エラー:', error);
      Alert.alert('エラー', 'ご当地グルメの検索に失敗しました');
      setMsg('');
    } finally {
      setLoadingLocalSpecialties(false);
    }
  };

  // AIランキング計算
  const calculateAIRanking = async () => {
    let location = currentLocation;
    
    // 位置情報がない場合は改めて取得を試行
    if (!location) {
      setMsg('📡 位置情報を取得中...');
      try {
        const quickLocation = await getLocationFast();
        if (quickLocation?.coords) {
          const { latitude, longitude } = quickLocation.coords;
          location = { lat: latitude, lng: longitude };
        }
      } catch (error) {
        console.error('位置情報取得エラー:', error);
      }
    }

    if (!location) {
      Alert.alert('位置情報が必要', '位置情報の取得に失敗しました。端末の位置情報設定を確認してください。');
      return;
    }

    try {
      setLoadingAIRanking(true);
      
      // 周辺のレストランを自動検索
      setMsg('🔍 周辺のレストランを検索中...');
      let targetPlaces: Place[] = [];
      
      try {
        const nearbyRestaurants = await searchPlaces('レストラン', location.lat, location.lng);
        if (nearbyRestaurants.length === 0) {
          // レストランが見つからない場合は飲食店で検索
          const nearbyFood = await searchPlaces('飲食店', location.lat, location.lng);
          targetPlaces = nearbyFood;
        } else {
          targetPlaces = nearbyRestaurants;
        }
        
        if (targetPlaces.length === 0) {
          Alert.alert('スポット不足', '周辺にレストランが見つかりませんでした。別の場所で試してください。');
          return;
        }
        
  // 検索結果はマップに送り込まない（戻った時に一覧が表示されないようにする）
      } catch (searchError) {
        console.error('周辺レストラン検索エラー:', searchError);
        Alert.alert('エラー', '周辺のレストラン検索に失敗しました');
        return;
      }

      setMsg('🤖 AIが総合スコアを計算中...');

      // AIスコアリング実行
  const scores = await calculateAIScore(targetPlaces, location, currentPrefecture);
      setAiScores(scores);
  setRankingTitle(undefined);
  setRankingDescription(undefined);
  setRankingReasoningTitle(undefined);
      setShowAIRanking(true);
      setMsg(`🤖 AIランキング計算完了！ ${scores.length}件を分析`);
    } catch (error) {
      console.error('AIランキング計算エラー:', error);
      Alert.alert('エラー', 'AIランキングの計算に失敗しました');
      setMsg('');
    } finally {
      setLoadingAIRanking(false);
    }
  };

  const handleSpotSelect = (spot: Place) => {
    // 選択されたスポットを親に通知して地図画面に戻る
    onPlacesUpdate([spot]);
    navigation.goBack();
  };

  return (
  <View style={styles.container}>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* 使い方（最上部） */}
        <View style={styles.helpSection}>
          <Text style={styles.helpTitle}>💡 使い方</Text>
          <Text style={styles.helpText}>
            • ご当地グルメ：その地域の名物料理が楽しめるお店を検索{'\n'}
            • AIランキング：あなたの好みに合わせて周辺のお店をスコア化{'\n'}
            • タップしたお店は地図に表示されます
          </Text>
        </View>

        {/* 現在地表示 */}
        <View style={styles.locationInfo}>
          <Text style={styles.locationText}>
            📍 {currentPrefecture || '位置情報取得中...'}
          </Text>
          {msg ? <Text style={styles.statusText}>{msg}</Text> : null}
        </View>

        {/* ご当地グルメセクション */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🍽️ ご当地グルメ</Text>
          <Text style={styles.sectionDescription}>
            {currentPrefecture}の名物・郷土料理を楽しめるお店を探します
          </Text>
          <TouchableOpacity
            style={[styles.actionButton, styles.localButton]}
            onPress={searchLocalSpecialties}
            disabled={loadingLocalSpecialties || !currentLocation}
          >
            {loadingLocalSpecialties ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>ご当地グルメを探す</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* AIランキングセクション */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🤖 AIおすすめランキング</Text>
          <Text style={styles.sectionDescription}>
            あなたの好みと周辺の人気店をAIが分析してランキング化
          </Text>
          <TouchableOpacity
            style={[styles.actionButton, styles.aiButton]}
            onPress={calculateAIRanking}
            disabled={loadingAIRanking || !currentLocation}
          >
            {loadingAIRanking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>AIランキングを見る</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ご当地グルメモーダルは廃止（同画面内に表示） */}

      {/* AIランキングモーダル */}
      <AIRankingModal
        visible={showAIRanking}
        scores={aiScores}
        onClose={() => setShowAIRanking(false)}
        onSelectSpot={(score: SpotScore) => {
          handleSpotSelect(score.place);
          setShowAIRanking(false);
        }}
        title={rankingTitle}
        description={rankingDescription}
        reasoningTitle={rankingReasoningTitle}
      />
  </View>
  );
}

// ---------- スタイル ----------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  locationInfo: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  locationText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  statusText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  section: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  actionButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  localButton: {
    backgroundColor: '#FF6B35',
  },
  aiButton: {
    backgroundColor: '#4A90E2',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  helpSection: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  helpText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize: 18,
    color: '#666',
  },
  modalList: {
    flex: 1,
  },
  placeItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  placeName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  placeAddress: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  placeRating: {
    fontSize: 14,
    color: '#FFA500',
  },
});