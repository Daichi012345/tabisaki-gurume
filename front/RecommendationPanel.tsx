import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  recommendationSystem,
  RecommendationScore,
  UserAction,
  SpotData,
} from '../utils/recommendation';
import { API_BASE_URL } from '../utils/api';

type Props = {
  currentLocation: { lat: number; lng: number } | null;
  onSpotPress?: (spot: SpotData) => void;
};

export default function RecommendationPanel({
  currentLocation,
  onSpotPress,
}: Props) {
  const [recommendations, setRecommendations] = useState<RecommendationScore[]>([]);
  const [loading, setLoading] = useState(false);

  // ---------- 推薦スポットを取得 ----------
  const loadRecommendations = async () => {
    console.log('🔍 loadRecommendations開始');
    if (!currentLocation) {
      console.log('❌ 現在地が取得されていません:', currentLocation);
      return;
    }

    console.log('🎯 推薦取得開始:', currentLocation);
    setLoading(true);
    
    try {
      // ユーザー設定を取得
      let userPreferences = null;
      try {
  console.log('📡 ユーザー設定取得中:', API_BASE_URL);
  const response = await fetch(`${API_BASE_URL}/api/user/preferences`);
        const data = await response.json();
        if (data.success) {
          userPreferences = data.preferences;
          console.log('✅ ユーザー設定取得成功:', userPreferences);
        }
      } catch (err) {
        console.log('⚠️ ユーザー設定取得失敗、デフォルト設定で推薦します:', err);
      }

      console.log('🔍 推薦API呼び出し開始');
      const results = await recommendationSystem.getRecommendations(currentLocation, {
        maxDistance: userPreferences?.preferredDistance ?? 3000,
        count: 15,
        userPreferences,
      });
      
      console.log('✅ 推薦結果取得成功:', results.length, '件');
      setRecommendations(results);
    } catch (error) {
      console.error('❌ 推薦取得エラー:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      Alert.alert('エラー', `推薦スポットの取得に失敗しました: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  // ---------- 位置情報が変わったら再取得 ----------
  useEffect(() => {
    console.log('📍 RecommendationPanel useEffect:', currentLocation ? '位置情報あり' : '位置情報なし');
    loadRecommendations();
  }, [currentLocation]);

  // ---------- スポットをタップ ----------
  const handleSpotPress = (recommendationScore: RecommendationScore) => {
    const { spot } = recommendationScore;
    const action: UserAction = {
      type: 'search',
      spotId: spot.id,
      timestamp: new Date(),
    };
    recommendationSystem.recordUserAction(action);
    onSpotPress?.(spot);
  };

  // ---------- お気に入り登録 ----------
  const handleFavorite = (spot: SpotData) => {
    const action: UserAction = {
      type: 'favorite',
      spotId: spot.id,
      timestamp: new Date(),
    };
    recommendationSystem.recordUserAction(action);
    Alert.alert('お気に入り', `${spot.name}をお気に入りに追加しました`);
    loadRecommendations(); // 嗜好更新
  };

  // ---------- 推薦理由 ----------
  const renderReasons = (reasons: string[]) =>
    reasons.slice(0, 2).map((r, i) => (
      <Text key={i} style={styles.reason}>
        • {r}
      </Text>
    ));

  // ---------- カード描画 ----------
  const renderSpotCard = ({ item }: { item: RecommendationScore }) => {
    const { spot, score, reasons } = item;
    return (
      <TouchableOpacity style={styles.card} onPress={() => handleSpotPress(item)}>
        {spot.photos?.[0] ? (
          <Image source={{ uri: spot.photos[0] }} style={styles.image} />
        ) : (
          <View style={[styles.image, styles.noImage]}>
            <Text style={{ color: '#888' }}>No Image</Text>
          </View>
        )}
        <View style={styles.cardContent}>
          <View style={styles.header}>
            <Text style={styles.name} numberOfLines={1}>
              {spot.name}
            </Text>
            <View style={styles.scoreContainer}>
              <Text style={styles.score}>{score.toFixed(1)}</Text>
            </View>
          </View>

          <View style={styles.info}>
            <Text style={styles.cuisine}>{spot.cuisineType || 'グルメ'}</Text>
            <Text style={styles.price}>{spot.priceRange || '¥¥'}</Text>
            {spot.rating && (
              <Text style={styles.rating}>⭐ {spot.rating.toFixed(1)}</Text>
            )}
          </View>

          <View style={styles.reasonsContainer}>{renderReasons(reasons)}</View>


          {spot.distance && (
            <Text style={styles.distance}>
              📍 {(spot.distance / 1000).toFixed(1)} km
            </Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.favoriteBtn}
              onPress={() => handleFavorite(spot)}
            >
              <Text style={styles.favoriteBtnText}>❤️</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ---------- ローディング or 空状態 ----------
  if (!currentLocation) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>位置情報を取得してから推薦を表示します</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <Text style={styles.title}>🎯 あなたにおすすめ</Text>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={loadRecommendations}
          disabled={loading}
        >
          <Text style={styles.refreshBtnText}>{loading ? '⏳' : '🔄'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.emptyText}>推薦を取得中...</Text>
        </View>
      ) : recommendations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>推薦スポットがありません</Text>
        </View>
      ) : (
        <FlatList
          data={recommendations}
          keyExtractor={(i) => i.spot.id}
          renderItem={renderSpotCard}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
}

// ---------- スタイル ----------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  titleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  refreshBtn: { padding: 8 },
  refreshBtnText: { fontSize: 18 },
  listContainer: { padding: 12 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  image: { width: '100%', height: 120, resizeMode: 'cover' },
  noImage: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#eee' },
  cardContent: { padding: 12 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginRight: 8,
  },
  scoreContainer: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  score: { color: '#fff', fontSize: 12, fontWeight: '600' },
  info: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cuisine: {
    fontSize: 12,
    color: '#6c757d',
    backgroundColor: '#e9ecef',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  price: { fontSize: 12, color: '#28a745', fontWeight: '500', marginRight: 6 },
  rating: { fontSize: 12, color: '#ffc107', fontWeight: '500' },
  reasonsContainer: { marginBottom: 8 },
  reason: { fontSize: 11, color: '#007AFF', marginBottom: 2 },
  distance: { fontSize: 11, color: '#6c757d', marginBottom: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  favoriteBtn: { padding: 4 },
  favoriteBtnText: { fontSize: 16 },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: { fontSize: 14, color: '#6c757d', textAlign: 'center', marginTop: 6 },
});
