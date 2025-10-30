// AIスコアリングシステム
import AsyncStorage from '@react-native-async-storage/async-storage';

// Place型定義
export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number;
  priceRange?: string;
  cuisineType?: string;
}

// ユーザー嗜好データの型定義
export interface UserPreferences {
  favoriteGenres: string[];
  favoriteFoods: string[];
  budgetRange: string;
  allergies: string[];
  priceWeight: number;     // 価格重視度 (0-1)
  distanceWeight: number;  // 距離重視度 (0-1)
  ratingWeight: number;    // 評価重視度 (0-1)
  localWeight: number;     // ご当地度重視度 (0-1)
}

// スコア算出結果の型定義
export interface SpotScore {
  place: Place;
  totalScore: number;
  distanceScore: number;
  ratingScore: number;
  priceScore: number;
  preferenceScore: number;
  localScore: number;
  reasoning: string[];
}

// ご当地グルメキーワード（都道府県別）
const LOCAL_SPECIALTIES_KEYWORDS: { [key: string]: string[] } = {
  '北海道': ['札幌ラーメン', '海鮮丼', 'ジンギスカン', '白い恋人', 'スープカレー', '毛ガニ', '帯広豚丼'],
  '青森県': ['りんご', '大間マグロ', 'せんべい汁', 'りんごパイ', 'ホタテ'],
  '岩手県': ['わんこそば', '冷麺', '前沢牛', 'じゃじゃ麺', '南部せんべい'],
  '宮城県': ['牛タン', 'ずんだ餅', '笹かまぼこ', 'はらこ飯', '仙台味噌'],
  '秋田県': ['きりたんぽ', '比内地鶏', 'いぶりがっこ', '稲庭うどん'],
  '山形県': ['米沢牛', 'さくらんぼ', '芋煮', 'ラ・フランス', '玉こんにゃく'],
  '福島県': ['喜多方ラーメン', '白河ラーメン', 'ままどおる', '桃'],
  '茨城県': ['納豆', 'あんこう鍋', 'ほしいも', 'メロン'],
  '栃木県': ['宇都宮餃子', 'いちご', '湯波', 'しもつかれ'],
  '群馬県': ['上州牛', 'こんにゃく', '焼きまんじゅう', 'だるま弁当'],
  '埼玉県': ['川越いも', '秩父そば', '草加せんべい', '十万石まんじゅう'],
  '千葉県': ['落花生', 'なめろう', 'びわ', '勝浦タンタンメン'],
  '東京都': ['もんじゃ焼き', '寿司', 'どじょう鍋', '人形焼', '深川めし'],
  '神奈川県': ['シウマイ', '湘南しらす', 'サンマーメン', '鎌倉野菜'],
  '新潟県': ['コシヒカリ', '日本酒', 'のっぺ', 'へぎそば', 'タレカツ'],
  '富山県': ['白エビ', 'ホタルイカ', '富山ブラック', 'ます寿司'],
  '石川県': ['金沢カレー', '加賀野菜', 'のどぐろ', '治部煮'],
  '福井県': ['越前そば', '越前がに', 'ソースカツ丼', '羽二重餅'],
  '山梨県': ['ほうとう', 'ぶどう', '甲州ワイン', '桃'],
  '長野県': ['信州そば', 'おやき', 'りんご', '野沢菜'],
  '岐阜県': ['飛騨牛', '朴葉味噌', '五平餅', '鮎'],
  '静岡県': ['浜松餃子', 'うなぎ', 'わさび', '静岡おでん', 'みかん'],
  '愛知県': ['味噌カツ', 'ひつまぶし', 'きしめん', 'エビフライ', '手羽先'],
  '三重県': ['松阪牛', '伊勢うどん', 'てこね寿司', '赤福'],
  '滋賀県': ['近江牛', 'ふな寿司', '信楽焼', '湖魚料理'],
  '京都府': ['京料理', '湯豆腐', '抹茶', '京野菜', 'おばんざい'],
  '大阪府': ['たこ焼き', 'お好み焼き', '串カツ', 'きつねうどん', 'イカ焼き'],
  '兵庫県': ['神戸牛', '明石焼き', 'そばめし', '淡路島玉ねぎ'],
  '奈良県': ['柿の葉寿司', '奈良漬', '三輪そうめん', '大和牛'],
  '和歌山県': ['梅干し', 'みかん', '和歌山ラーメン', '熊野牛'],
  '鳥取県': ['松葉ガニ', '二十世紀梨', '鳥取和牛', 'あご野焼き'],
  '島根県': ['出雲そば', 'しじみ', '宍道湖七珍', 'のどぐろ'],
  '岡山県': ['白桃', 'マスカット', 'きびだんご', '岡山ばら寿司'],
  '広島県': ['牡蠣', 'お好み焼き', 'もみじまんじゅう', 'あなご'],
  '山口県': ['ふぐ', 'ういろう', '瓦そば', '萩焼'],
  '徳島県': ['阿波踊り', 'すだち', '鳴門わかめ', '徳島ラーメン'],
  '香川県': ['讃岐うどん', 'オリーブ', '骨付鳥', '和三盆'],
  '愛媛県': ['みかん', '鯛めし', 'じゃこ天', '今治タオル'],
  '高知県': ['カツオのたたき', 'ゆず', '土佐酒', 'ちゃんぽん'],
  '福岡県': ['明太子', 'もつ鍋', '博多ラーメン', '水炊き', 'あまおう'],
  '佐賀県': ['呼子のイカ', '佐賀牛', '有田焼', '嬉野茶'],
  '長崎県': ['ちゃんぽん', 'カステラ', '皿うどん', '長崎和牛'],
  '熊本県': ['馬刺し', '熊本ラーメン', 'いきなり団子', 'デコポン'],
  '大分県': ['関サバ', '関アジ', 'とり天', '別府温泉'],
  '宮崎県': ['宮崎牛', 'チキン南蛮', 'マンゴー', '地鶏'],
  '鹿児島県': ['黒豚', '焼酎', 'さつまいも', '鹿児島和牛'],
  '沖縄県': ['ゴーヤチャンプルー', 'ソーキそば', 'サーターアンダギー', '泡盛', 'ちんすこう']
};

// AIスコアリング関数
export const calculateAIScore = async (
  places: Place[],
  currentLocation: { lat: number; lng: number },
  currentPrefecture?: string
): Promise<SpotScore[]> => {
  try {
    // ユーザー嗜好を取得
    const preferences = await getUserPreferences();
    
    const scoredPlaces = places.map(place => {
      // 1. 距離スコア (0-10): 近いほど高得点
      const distance = getDistance(currentLocation, { lat: place.lat, lng: place.lng });
      const distanceScore = Math.max(0, 10 - (distance / 1000) * 2); // 1kmで2点減点
      
      // 2. 評価スコア (0-10): GoogleのratingをベースWithError handling
      const ratingScore = place.rating ? (place.rating / 5) * 10 : 5; // rating無しは平均点
      
      // 3. 価格スコア (0-10): ユーザーの予算に合わせて
      const priceScore = calculatePriceScore(place.priceRange, preferences.budgetRange);
      
      // 4. 嗜好スコア (0-10): ユーザーの好みにマッチするか
      const preferenceScore = calculatePreferenceScore(place, preferences);
      
      // 5. ご当地度スコア (0-10): 現在地の名物料理かどうか
      const localScore = calculateLocalScore(place, currentPrefecture);
      
      // 重み付け総合スコア計算
      const totalScore = (
        distanceScore * preferences.distanceWeight +
        ratingScore * preferences.ratingWeight +
        priceScore * preferences.priceWeight +
        preferenceScore * 0.25 +
        localScore * preferences.localWeight
      ) / (preferences.distanceWeight + preferences.ratingWeight + preferences.priceWeight + 0.25 + preferences.localWeight);
      
      // AIの判断理由を生成
      const reasoning = generateReasoning(
        place, distanceScore, ratingScore, priceScore, preferenceScore, localScore
      );
      
      return {
        place,
        totalScore: Math.round(totalScore * 100) / 100,
        distanceScore: Math.round(distanceScore * 100) / 100,
        ratingScore: Math.round(ratingScore * 100) / 100,
        priceScore: Math.round(priceScore * 100) / 100,
        preferenceScore: Math.round(preferenceScore * 100) / 100,
        localScore: Math.round(localScore * 100) / 100,
        reasoning
      };
    });
    
    // 総合スコアでソート（降順）
    return scoredPlaces.sort((a, b) => b.totalScore - a.totalScore);
    
  } catch (error) {
    console.error('AIスコア計算エラー:', error);
    // エラー時は距離順でフォールバック
    return places.map(place => ({
      place,
      totalScore: 5.0,
      distanceScore: 5.0,
      ratingScore: place.rating ? (place.rating / 5) * 10 : 5.0,
      priceScore: 5.0,
      preferenceScore: 5.0,
      localScore: 5.0,
      reasoning: ['AIスコア計算中にエラーが発生しました']
    }));
  }
};

// ユーザー嗜好を取得（MyPageから）
const getUserPreferences = async (): Promise<UserPreferences> => {
  try {
    const preferences = await AsyncStorage.getItem('userPreferences');
    const defaultPrefs: UserPreferences = {
      favoriteGenres: [],
      favoriteFoods: [],
      budgetRange: '～2000円',
      allergies: [],
      priceWeight: 0.3,
      distanceWeight: 0.3,
      ratingWeight: 0.25,
      localWeight: 0.15
    };
    
    return preferences ? { ...defaultPrefs, ...JSON.parse(preferences) } : defaultPrefs;
  } catch {
    return {
      favoriteGenres: [],
      favoriteFoods: [],
      budgetRange: '～2000円',
      allergies: [],
      priceWeight: 0.3,
      distanceWeight: 0.3,
      ratingWeight: 0.25,
      localWeight: 0.15
    };
  }
};

// 距離計算（簡易版）
const getDistance = (pos1: { lat: number; lng: number }, pos2: { lat: number; lng: number }): number => {
  const R = 6371000; // 地球の半径（メートル）
  const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
  const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// 価格スコア計算
const calculatePriceScore = (placePriceRange?: string, userBudget?: string): number => {
  if (!placePriceRange || !userBudget) return 5;
  
  const priceMap: { [key: string]: number } = {
    '～1000円': 1,
    '～2000円': 2,
    '～3000円': 3,
    '～5000円': 4,
    '5000円～': 5
  };
  
  const placePrice = priceMap[placePriceRange] || 3;
  const userPrice = priceMap[userBudget] || 3;
  
  // ユーザー予算内なら高得点、超えると減点
  if (placePrice <= userPrice) {
    return 10 - (userPrice - placePrice); // 予算内で安いほど高得点
  } else {
    return Math.max(0, 10 - (placePrice - userPrice) * 3); // 予算超過で大幅減点
  }
};

// 嗜好スコア計算
const calculatePreferenceScore = (place: Place, preferences: UserPreferences): number => {
  let score = 5; // ベーススコア
  
  // ジャンルマッチング
  if (preferences.favoriteGenres.length > 0 && place.cuisineType) {
    const genreMatch = preferences.favoriteGenres.some(genre => 
      place.cuisineType?.includes(genre) || place.name.includes(genre)
    );
    if (genreMatch) score += 3;
  }
  
  // 料理マッチング
  if (preferences.favoriteFoods.length > 0) {
    const foodMatch = preferences.favoriteFoods.some(food => 
      place.name.includes(food) || place.cuisineType?.includes(food)
    );
    if (foodMatch) score += 2;
  }
  
  // アレルギーチェック（マイナス要素）
  if (preferences.allergies.length > 0) {
    const allergyRisk = preferences.allergies.some(allergy => 
      place.name.includes(allergy) || place.cuisineType?.includes(allergy)
    );
    if (allergyRisk) score -= 5;
  }
  
  return Math.max(0, Math.min(10, score));
};

// ご当地度スコア計算
const calculateLocalScore = (place: Place, currentPrefecture?: string): number => {
  if (!currentPrefecture || !LOCAL_SPECIALTIES_KEYWORDS[currentPrefecture]) return 5;
  
  const localKeywords = LOCAL_SPECIALTIES_KEYWORDS[currentPrefecture];
  let score = 0;
  
  // 店名やジャンルにご当地キーワードが含まれているかチェック
  localKeywords.forEach(keyword => {
    if (place.name.includes(keyword) || place.cuisineType?.includes(keyword)) {
      score += 2;
    }
  });
  
  // 最大10点
  return Math.min(10, score + 3); // ベース3点 + ボーナス
};

// AI判断理由生成
const generateReasoning = (
  place: Place,
  distanceScore: number,
  ratingScore: number,
  priceScore: number,
  preferenceScore: number,
  localScore: number
): string[] => {
  const reasons: string[] = [];
  
  if (distanceScore >= 8) reasons.push('📍 アクセス抜群の立地');
  else if (distanceScore < 5) reasons.push('📍 少し距離がありますが...');
  
  if (ratingScore >= 8) reasons.push('⭐ 高評価の人気店');
  else if (ratingScore < 6) reasons.push('⭐ 評価は平均的');
  
  if (priceScore >= 8) reasons.push('💰 お財布に優しい価格');
  else if (priceScore < 5) reasons.push('💰 少し予算オーバーかも');
  
  if (preferenceScore >= 7) reasons.push('❤️ あなたの好みにピッタリ');
  else if (preferenceScore < 5) reasons.push('🤔 好みと少し違うかも');
  
  if (localScore >= 7) reasons.push('🏯 この土地ならではの名物');
  
  return reasons;
};

export default { calculateAIScore };