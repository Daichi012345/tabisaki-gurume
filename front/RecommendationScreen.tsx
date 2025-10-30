import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  Dimensions,
  SafeAreaView,
} from 'react-native';
import * as Location from 'expo-location';
import {
  recommendationSystem,
  RecommendationScore,
  UserAction,
  SpotData,
} from '../utils/recommendation';
import { API_BASE_URL } from '../utils/api';

const { width } = Dimensions.get('window');

type Props = {
  initialLocation?: { lat: number; lng: number } | null;
  onClose?: () => void;
  onSpotPress?: (spot: SpotData) => void;
  userPreferences?: any;
  token?: string | null;
};

export default function RecommendationScreen({ 
  initialLocation, 
  onClose, 
  onSpotPress,
  userPreferences,
  token
}: Props) {
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(
    initialLocation || null
  );
  const [recommendations, setRecommendations] = useState<RecommendationScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(!initialLocation);

  // 位置情報取得（初期位置がない場合）
  useEffect(() => {
    if (!initialLocation) {
      getCurrentLocation();
    }
  }, [initialLocation]);

  // 現在地取得後に推薦を自動取得
  useEffect(() => {
    if (currentLocation) {
      loadRecommendations();
    }
  }, [currentLocation]);

  const getCurrentLocation = async () => {
    try {
      console.log('🌍 位置情報取得開始');
      setLocationLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('位置情報の許可が必要です', 'おすすめスポットを表示するには位置情報の許可が必要です。');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const newLocation = {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      };

      console.log('✅ 位置情報取得成功:', newLocation);
      setCurrentLocation(newLocation);
    } catch (error) {
      console.error('❌ 位置情報取得エラー:', error);
      Alert.alert('エラー', '位置情報の取得に失敗しました');
    } finally {
      setLocationLoading(false);
    }
  };

  const loadRecommendations = async () => {
    if (!currentLocation) {
      console.log('❌ 現在地が取得されていません');
      return;
    }

    console.log('🔍 推薦取得開始:', currentLocation);
    setLoading(true);

    try {
      // ユーザー設定を使用（プロパティで渡されたものを優先）
      let finalUserPreferences = userPreferences;
      
      if (!finalUserPreferences) {
        // プロパティで渡されていない場合のみAPIから取得
        try {
          const apiUrl = API_BASE_URL;
          
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }
          
          const response = await fetch(`${apiUrl}/api/user/preferences`, { headers });
          const data = await response.json();
          if (data.success) {
            finalUserPreferences = data.preferences;
            console.log('✅ ユーザー設定取得成功');
          }
        } catch (err) {
          console.log('⚠️ ユーザー設定取得失敗、デフォルト設定で推薦');
        }
      } else {
        console.log('✅ プロパティからユーザー設定を使用');
      }

      const results = await recommendationSystem.getRecommendations(currentLocation, {
        maxDistance: finalUserPreferences?.preferredDistance ?? 3000,
        count: 20, // より多くのスポットを取得
        userPreferences: finalUserPreferences,
      });

      console.log('✅ 推薦結果取得成功:', results.length, '件');
      setRecommendations(results);

      if (results.length === 0) {
        Alert.alert('情報', '周辺におすすめスポットが見つかりませんでした。検索範囲を広げてお試しください。');
      }
    } catch (error) {
      console.error('❌ 推薦取得エラー:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      Alert.alert('エラー', `推薦スポットの取得に失敗しました: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSpotPress = (recommendationScore: RecommendationScore) => {
    const { spot } = recommendationScore;
    
    // ユーザー行動を記録
    const action: UserAction = {
      type: 'search',
      spotId: spot.id,
      timestamp: new Date(),
    };
    recommendationSystem.recordUserAction(action);

    // 親コンポーネントにスポット選択を通知
    onSpotPress?.(spot);
  };

  const handleRefresh = () => {
    loadRecommendations();
  };

  const renderSpotCard = (recommendationScore: RecommendationScore) => {
    const { spot, score, reasons } = recommendationScore;
    
    return (
      <TouchableOpacity
        key={spot.id}
        style={styles.spotCard}
        onPress={() => handleSpotPress(recommendationScore)}
      >
        {/* スポット画像 */}
        {spot.photos && spot.photos.length > 0 && (
          <Image
            source={{ uri: spot.photos[0] }}
            style={styles.spotImage}
            resizeMode="cover"
          />
        )}

        <View style={styles.spotInfo}>
          {/* 基本情報 */}
          <View style={styles.spotHeader}>
            <Text style={styles.spotName} numberOfLines={2}>
              {spot.name}
            </Text>
            <View style={styles.scoreContainer}>
              <Text style={styles.scoreText}>{Math.round(score)}</Text>
            </View>
          </View>

          {/* 詳細情報 */}
          <View style={styles.spotDetails}>
            {spot.rating && (
              <View style={styles.ratingContainer}>
                <Text style={styles.ratingText}>⭐ {spot.rating.toFixed(1)}</Text>
              </View>
            )}
            {spot.cuisineType && (
              <View style={styles.typeContainer}>
                <Text style={styles.typeText}>{spot.cuisineType}</Text>
              </View>
            )}
            {spot.priceRange && (
              <View style={styles.priceContainer}>
                <Text style={styles.priceText}>{spot.priceRange}</Text>
              </View>
            )}
          </View>

          {/* 住所 */}
          {spot.address && (
            <Text style={styles.spotAddress} numberOfLines={2}>
              📍 {spot.address}
            </Text>
          )}

          {/* 距離 */}
          {spot.distance && (
            <Text style={styles.distanceText}>
              🚶 {(spot.distance / 1000).toFixed(1)}km
            </Text>
          )}

          {/* 推薦理由 */}
          <View style={styles.reasonsContainer}>
            {reasons.slice(0, 2).map((reason, index) => (
              <Text key={index} style={styles.reasonText} numberOfLines={1}>
                • {reason}
              </Text>
            ))}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <Text style={styles.title}>🎯 周辺のおすすめ</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity style={styles.refreshButton} onPress={handleRefresh}>
            <Text style={styles.refreshButtonText}>🔄</Text>
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 現在地情報 */}
      {currentLocation && (
        <View style={styles.locationInfo}>
          <Text style={styles.locationText}>
            📍 現在地: {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}
          </Text>
        </View>
      )}

      {/* コンテンツエリア */}
      <View style={styles.content}>
        {locationLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>位置情報を取得中...</Text>
          </View>
        ) : loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>おすすめスポットを検索中...</Text>
          </View>
        ) : recommendations.length > 0 ? (
          <ScrollView 
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.spotsContainer}>
              {recommendations.map(renderSpotCard)}
            </View>
          </ScrollView>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>🔍</Text>
            <Text style={styles.emptyTitle}>スポットが見つかりませんでした</Text>
            <Text style={styles.emptySubtitle}>
              周辺におすすめのグルメスポットが見つかりませんでした。
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
              <Text style={styles.retryButtonText}>再検索</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshButtonText: {
    fontSize: 18,
    color: 'white',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e9ecef',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    color: '#6c757d',
  },
  locationInfo: {
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  locationText: {
    fontSize: 14,
    color: '#1976d2',
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  scrollView: {
    flex: 1,
  },
  spotsContainer: {
    padding: 16,
  },
  spotCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  spotImage: {
    width: '100%',
    height: 180,
  },
  spotInfo: {
    padding: 16,
  },
  spotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  spotName: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginRight: 12,
  },
  scoreContainer: {
    backgroundColor: '#FF6B6B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 40,
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
  },
  spotDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  ratingContainer: {
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  ratingText: {
    fontSize: 14,
    color: '#F57C00',
    fontWeight: '500',
  },
  typeContainer: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  typeText: {
    fontSize: 14,
    color: '#1976D2',
  },
  priceContainer: {
    backgroundColor: '#E8F5E8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priceText: {
    fontSize: 14,
    color: '#388E3C',
    fontWeight: '500',
  },
  spotAddress: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    lineHeight: 20,
  },
  distanceText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
    marginBottom: 12,
  },
  reasonsContainer: {
    marginTop: 8,
  },
  reasonText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
    fontStyle: 'italic',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
});