// =============================================
// 🧠 旅先ぐるめぐり - 推薦ロジック（AI API連携対応）
// =============================================

export type SpotData = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number;
  cuisineType?: string;
  priceRange?: string;
  photos?: string[];
  distance?: number;
};

export type RecommendationScore = {
  spot: SpotData;
  score: number;
  reasons: string[];
};

export type UserAction = {
  type: 'visit' | 'favorite' | 'review' | 'search';
  spotId: string;
  timestamp: Date;
  rating?: number;
  duration?: number;
};

// =============================================
// 推薦システム本体
// =============================================
import { API_BASE_URL } from './api';

export const recommendationSystem = {
  /**
   * 🎯 現在地をもとにユーザー好みを考慮したAI推薦APIを呼び出す
   */
  async getRecommendations(
    currentLocation: { lat: number; lng: number },
    options?: { maxDistance?: number; count?: number; userPreferences?: any }
  ): Promise<RecommendationScore[]> {
    // Expo開発時のAPI URL設定
  const apiUrl = API_BASE_URL;
  console.log('🌐 推薦API URL:', apiUrl);

    try {
      const queryParams = new URLSearchParams({
        lat: String(currentLocation.lat),
        lng: String(currentLocation.lng),
        radius: String(options?.maxDistance ?? 3000),
        count: String(options?.count ?? 15),
      });
      console.log('📍 基本パラメータ:', Object.fromEntries(queryParams));

      // ユーザー設定があれば追加
      if (options?.userPreferences) {
        const prefs = options.userPreferences;
        console.log('👤 ユーザー設定適用:', prefs);
        if (prefs.favoriteGenres?.length > 0) {
          queryParams.append('genres', prefs.favoriteGenres.join(','));
        }
        if (prefs.priceRange) {
          queryParams.append('priceRange', prefs.priceRange);
        }
        if (prefs.dietaryRestrictions?.length > 0) {
          queryParams.append('dietary', prefs.dietaryRestrictions.join(','));
        }
      }

      const finalUrl = `${apiUrl}/api/recommend?${queryParams}`;
      console.log('🚀 最終リクエストURL:', finalUrl);
      const res = await fetch(finalUrl);

      if (!res.ok) {
        console.error('API通信エラー:', res.status);
        throw new Error(`API通信エラー: ${res.status}`);
      }

      const json = await res.json();
      console.log('📊 API応答:', json.success ? `成功 - ${json.count}件のスポット取得` : 'API応答失敗');

      if (!json.success) {
        console.warn('AI推薦API失敗:', json);
        return [];
      }

      // スポット情報をRecommendationScore形式に変換
      const recommendations = (json.spots || []).map((spot: any) => ({
        spot: {
          id: spot.id,
          name: spot.name,
          lat: spot.lat,
          lng: spot.lng,
          address: spot.address,
          rating: spot.rating,
          cuisineType: spot.cuisineType,
          priceRange: spot.priceRange,
          photos: spot.photos,
          distance: spot.distance,
        },
        score: spot.score || 0,
        reasons: spot.reasons || ['人気スポットです', '高評価グルメです'],
      }));
      
      console.log('✅ 推薦変換完了:', recommendations.length, '件');
      return recommendations;
    } catch (error) {
      console.error('推薦取得失敗:', error);
      return [];
    }
  },

  /**
   * 🧾 ユーザーの行動を記録（将来の嗜好学習用）
   */
  async recordUserAction(action: UserAction) {
    try {
      console.log('🧾 ユーザー行動記録:', action);

      await fetch(`${API_BASE_URL}/api/user/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: action.type,
          spotId: action.spotId,
          spotName: 'unknown',
          rating: action.rating,
          duration: action.duration,
        }),
      });
    } catch (err) {
      console.warn('行動記録送信エラー:', err);
    }
  },
};
