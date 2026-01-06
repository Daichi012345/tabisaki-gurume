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
  // 追加の任意情報（画面側で持っている場合は活用）
  userRatingsTotal?: number; // = user_ratings_total / userRatingCount
  priceLevel?: number | string;       // GoogleのpriceLevel(0-4) or enum string
  priceRange?: string;
  cuisineType?: string;
  types?: string[];          // Googleのtypes
  openNow?: boolean;         // 営業中フラグ
}

// ユーザー嗜好データの型定義
export interface UserPreferences {
  favoriteGenres: string[];
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
  aiTotalScore: number; // ローカル除外のAI総合（距離/評価/価格/嗜好）
  localTotalScore: number; // ご当地度単体（0-10）
  distanceScore: number;
  ratingScore: number;
  priceScore: number;
  preferenceScore: number;
  localScore: number;
  aiScore5: number;        // UI用AI総合の5段階(1-5)
  localScore5: number;     // UI用ご当地度5段階(1-5)
  uiScore5: number;        // 現在のランキングモードで表示すべき5段階(1-5)
  uiScore5Label: string;   // そのラベル
  reasoning: string[];
}

// ご当地グルメキーワード（都道府県別）
// 他モジュールからも参照できるように export
export const LOCAL_SPECIALTIES_KEYWORDS: { [key: string]: string[] } = {
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

// 代表的な外食チェーン（除外/減点対象にできる）
export const CHAIN_KEYWORDS: string[] = [
  // ファストフード/カフェ
  'マクドナルド', 'マック', 'マクド', 'スターバックス', 'スタバ', 'ドトール', 'タリーズ', 'ミスタードーナツ', 'ミスド',
  'モスバーガー', 'ロッテリア', 'フレッシュネスバーガー', 'ケンタッキー', 'kfc',
  // ファミレス/大手外食
  'サイゼリヤ', 'ガスト', 'ジョナサン', 'デニーズ', 'ロイヤルホスト', 'バーミヤン', 'びっくりドンキー',
  // 牛丼
  'すき家', 'すきや', '吉野家', '松屋',
  // カレー/うどん
  'coco壱', 'ココイチ', '壱番屋', '丸亀製麺', 'カレーハウスcoco壱番屋',
  // 寿司
  'くら寿司', 'スシロー', 'はま寿司', 'かっぱ寿司',
  // 中華/その他チェーン
  '餃子の王将', '王将', '日高屋', 'いきなり!ステーキ', 'いきなりステーキ',
  // ピザ
  'ドミノ・ピザ', 'ドミノピザ', 'ピザハット', 'ピザーラ',
  // とんかつ/丼等
  'かつや', '天丼てんや', 'てんや'
].map(k => k.toLowerCase());

// ジャンル同義語: ユーザー選択ジャンルを内部で拡張してマッチ精度を向上
export const GENRE_SYNONYMS: Record<string, string[]> = {
  'スイーツ': ['スイーツ', '甘味', 'デザート', 'カフェ', 'パティスリー', 'ケーキ', '洋菓子', '和菓子', 'アイス', 'ジェラート', 'チョコ', '菓子', 'ベーカリー', '焼き菓子', 'たい焼き', 'プリン', 'パンケーキ'],
  'カフェ': ['カフェ', 'coffee', 'コーヒー', '喫茶', 'スイーツ', 'デザート'],
  'ラーメン': ['ラーメン', 'ramen'],
  '寿司': ['寿司', 'sushi'],
  '焼肉': ['焼肉', 'yakiniku', 'ホルモン'],
  '韓国料理': ['韓国', '韓国料理', 'korean'],
};

// Google Places types → 日本語ジャンル簡易マッピング
const TYPE_TO_GENRE: Record<string, string> = {
  'cafe': 'カフェ',
  'coffee_shop': 'カフェ',
  'bakery': 'スイーツ',
  'dessert': 'スイーツ',
  'ice_cream_shop': 'スイーツ',
  'restaurant': 'レストラン',
  'confectionery': 'スイーツ',
  'cake_shop': 'スイーツ',
  'bar': 'バー',
  'meal_takeaway': 'テイクアウト',
  'meal_delivery': 'デリバリー',
  'supermarket': '食品',
  'food': '食品'
};

// ご当地産物・郷土性を示すアンカー（全国共通）
export const LOCAL_ANCHOR_KEYWORDS: string[] = [
  '郷土料理', '地元食材', '地産地消', '地酒', '地ビール', '地ワイン',
  '漁港', '市場', '直売所', '道の駅', '物産館',
  '特産', '名産', '名物',
  '農園', '果樹園', '牧場', 'ワイナリー', '酒蔵', '味噌蔵', '醤油蔵'
].map(k => k.toLowerCase());

// AIスコアリング関数
export const calculateAIScore = async (
  places: Place[],
  currentLocation: { lat: number; lng: number },
  currentPrefecture?: string,
  debug: boolean = (process.env.EXPO_PUBLIC_DEBUG_SCORING === '1'),
  options?: { localStrict?: boolean },
  userPrefOverride?: Partial<UserPreferences> // DB等から取得した最新嗜好を上書き適用
): Promise<SpotScore[]> => {
  try {
    // ユーザー嗜好を取得
    // AsyncStorage保存分 + オーバーライド（DB）をマージ
    const stored = await getUserPreferences();
    const overrideMapped = userPrefOverride ? mapBackendPreferences(userPrefOverride) : {};
    const preferences: UserPreferences = { ...stored, ...overrideMapped };
    // preferredDistanceによる距離重視度の動的補正（オーバーライドが距離指定を含む場合）
    if ((userPrefOverride as any)?.preferredDistance) {
      const d = Number((userPrefOverride as any).preferredDistance);
      if (!Number.isNaN(d) && d > 0) {
        // 近距離志向なら距離Weightを強める（最大0.5まで微増）
        const boost = d <= 800 ? 0.15 : d <= 1500 ? 0.05 : 0;
        preferences.distanceWeight = clamp01(preferences.distanceWeight + boost);
      }
    }
    // ===== ジャンル最優先モード =====
    const dominantMode = (process.env.EXPO_PUBLIC_PREFERENCE_DOMINANT === '1') && (preferences.favoriteGenres?.length > 0);
    // 安全第一モード: アレルギー・食事制限が設定されている場合は嗜好/安全を最優先に重みを再配分
    const safetyFirst = (preferences.allergies?.length ?? 0) > 0;
    const excludeNonMatch = (process.env.EXPO_PUBLIC_PREFERENCE_EXCLUDE === '1') && (preferences.favoriteGenres?.length > 0);
    const preferenceTargetWeight = safetyFirst
      ? Number(process.env.EXPO_PUBLIC_PREFERENCE_SAFETY_WEIGHT ?? 0.65) // 安全第一時は嗜好/制限適合を最優先
      : dominantMode
        ? Number(process.env.EXPO_PUBLIC_PREFERENCE_DOMINANT_WEIGHT ?? 0.55) // 支配的重み(デフォルト0.55)
        : ((preferences.favoriteGenres && preferences.favoriteGenres.length > 0)
          ? Number(process.env.EXPO_PUBLIC_PREFERENCE_WEIGHT ?? 0.35)
          : 0.25);

    // 残余重みを「ジャンル > 価格 > 距離 > 評価 > ご当地」の順で再配分（デフォルトON）
    // 環境変数 EXPO_PUBLIC_ORDER_GPD を '0' にすると従来の比率配分に戻す
    let weights: { preference: number; distance: number; rating: number; price: number; local: number };
    const remainder = Math.max(0.0001, 1 - preferenceTargetWeight);
    if ((process.env.EXPO_PUBLIC_ORDER_GPD ?? '1') !== '0') {
      // 固定比率で順序を明確化（安全第一モード時は距離<評価<価格<ご当地の順で控えめに）
      if (safetyFirst) {
        const priceR = 0.25, distanceR = 0.20, ratingR = 0.25, localR = 0.30;
        weights = {
          preference: preferenceTargetWeight,
          price: remainder * priceR,
          distance: remainder * distanceR,
          rating: remainder * ratingR,
          local: remainder * localR,
        };
      } else {
        const priceR = 0.45, distanceR = 0.30, ratingR = 0.15, localR = 0.10;
        weights = {
          preference: preferenceTargetWeight,
          price: remainder * priceR,
          distance: remainder * distanceR,
          rating: remainder * ratingR,
          local: remainder * localR,
        };
      }
    } else {
      // 旧ロジック（ユーザー設定比率に基づく）
      const baseOtherSum = preferences.distanceWeight + preferences.ratingWeight + preferences.priceWeight + preferences.localWeight || 1;
      if (safetyFirst) {
        // 安全第一時は local と rating をやや強めに、distance と price を抑える
        const d = preferences.distanceWeight / baseOtherSum;
        const r = preferences.ratingWeight / baseOtherSum;
        const p = preferences.priceWeight / baseOtherSum;
        const l = preferences.localWeight / baseOtherSum;
        weights = {
          preference: preferenceTargetWeight,
          distance: remainder * (d * 0.7),
          rating: remainder * (r * 1.2),
          price: remainder * (p * 0.8),
          local: remainder * (l * 1.3),
        };
      } else {
        weights = {
          preference: preferenceTargetWeight,
          distance: remainder * (preferences.distanceWeight / baseOtherSum),
          rating: remainder * (preferences.ratingWeight / baseOtherSum),
          price: remainder * (preferences.priceWeight / baseOtherSum),
          local: remainder * (preferences.localWeight / baseOtherSum),
        };
      }
    }
    const weightSum = 1; // 既に正規化済み(合計1)
    const diversityPenalty = Number(process.env.EXPO_PUBLIC_DIVERSITY_PENALTY ?? '0.1'); // 同種の並びを抑制
    const enableDiversity = (process.env.EXPO_PUBLIC_RERANK_DIVERSITY ?? '1') !== '0';
    const chainFilterMode = (process.env.EXPO_PUBLIC_CHAIN_FILTER ?? 'penalize').toLowerCase(); // 'exclude' | 'penalize' | 'off'
    const chainPenalty = Number(process.env.EXPO_PUBLIC_CHAIN_PENALTY ?? '1.5'); // 総合スコアから減点

    if (debug) {
      printHeaderDebug({
        currentPrefecture,
        places: places.length,
        weights,
        diversityPenalty,
        enableDiversity,
        chainFilterMode,
        chainPenalty,
        safetyFirst,
      });
    }

    // チェーン除外モード & ローカル厳格モードなら事前に間引く
    const localStrict = options?.localStrict ?? (process.env.EXPO_PUBLIC_LOCAL_STRICT === '1');
    let basePlaces = chainFilterMode === 'exclude' ?
      places.filter(p => !isChainPlace(p)) :
      places;
    // アレルギー該当店舗の除外（ユーザー要望によりハード除外）
    if (preferences.allergies && preferences.allergies.length > 0) {
      basePlaces = basePlaces.filter(p => !hasAllergyRisk(p, preferences.allergies!));
    }
    // 非一致ジャンル除外オプション
    if (excludeNonMatch) {
      const activeGenres = preferences.favoriteGenres.map(g => (g || '').toLowerCase());
      basePlaces = basePlaces.filter(p => {
        const text = `${p.name || ''} ${p.cuisineType || ''}`.toLowerCase();
        return activeGenres.some(g => g && text.includes(g));
      });
    }
    if (localStrict) {
      basePlaces = basePlaces.filter(p => isLocalPlace(p, currentPrefecture));
    }
    if (debug && basePlaces.length !== places.length) {
      const removed = places.length - basePlaces.length;
      console.log(`🚫 事前フィルタで ${removed} 件除外 (chain=${chainFilterMode === 'exclude'} localStrict=${localStrict})`);
    }

    // 距離減衰スケールをユーザー希望距離やENVで調整
    const preferredDistanceOverride = Number((userPrefOverride as any)?.preferredDistance || 0);
    const baseDecay = Number(process.env.EXPO_PUBLIC_DISTANCE_DECAY_M ?? '1500');
    const distanceDecayScale = preferredDistanceOverride > 0 ? Math.max(600, preferredDistanceOverride / 2) : baseDecay;

    const scoredPlaces = basePlaces.map(place => {
      // 1. 距離スコア (0-10): 近いほど高得点（指数減衰）
      const distance = getDistance(currentLocation, { lat: place.lat, lng: place.lng });
      const distanceScore = clamp01(Math.exp(-distance / distanceDecayScale)) * 10;

      // 2. 評価スコア (0-10): ベイズ補正
      const rating = place.rating ?? 0;
      const count = (place as any).user_ratings_total ?? (place as any).userRatingCount ?? place.userRatingsTotal ?? 0;
      const bayes = bayesianRating(rating, count, 4.0, 50); // C=4.0, m=50
      const ratingScore = (bayes / 5) * 10 || 5;

      // 3. 価格スコア (0-10): ユーザーの予算に合わせて
      const priceScore = calculatePriceScoreSmart(place, preferences.budgetRange);

      // 4. 嗜好スコア (0-10)
      const preferenceScore = calculatePreferenceScore(place, preferences);

      // 5. ご当地度スコア (0-10)
      const localScore = calculateLocalScore(place, currentPrefecture);

      // 重み付け総合スコア
      const aiComponentScore = (
        distanceScore * weights.distance +
        ratingScore * weights.rating +
        priceScore * weights.price +
        preferenceScore * weights.preference
      );
      const localComponentScore = (localScore * weights.local);
      const totalScore = (aiComponentScore + localComponentScore) / weightSum;

      // 営業状況による微調整（オープン:+0.3 / クローズ:-0.7）
      const openNow = (place as any).openNow;
      const availabilityAdj = (openNow === true) ? 0.3 : (openNow === false ? -0.7 : 0);
      const totalWithAvailability = totalScore + availabilityAdj;

      // チェーン減点適用
      const chain = isChainPlace(place);
      const adjustedTotal = (chainFilterMode === 'penalize' && chain)
        ? Math.max(0, totalWithAvailability - chainPenalty)
        : totalWithAvailability;

      // 理由文
      const reasoning = generateReasoning(
        place, distanceScore, ratingScore, priceScore, preferenceScore, localScore, preferences
      );

      if (debug) {
        let localHits: string[] | undefined;
        if (currentPrefecture && LOCAL_SPECIALTIES_KEYWORDS[currentPrefecture]) {
          const keys = LOCAL_SPECIALTIES_KEYWORDS[currentPrefecture];
          localHits = keys.filter(k => place.name.includes(k) || (place.cuisineType?.includes(k) ?? false));
        }
        printSpotDebug({
          name: place.name,
          cuisineType: place.cuisineType ?? undefined,
          distanceMeters: Math.round(distance),
          openNow,
          rating: place.rating ?? undefined,
          priceRange: place.priceRange ?? undefined,
          distanceScore,
          ratingScore,
          priceScore,
          preferenceScore,
          localScore,
          totalRaw: totalScore,
          totalAfterChain: adjustedTotal,
          availabilityAdj,
          aiScore5: mapToFiveInt(aiComponentScore / weightSum),
          localScore5: mapToFiveInt(localScore),
          weights,
          distanceDecayScale,
          localHits,
          isChain: chain,
        });
      }

      return {
        place,
        totalScore: Math.round(adjustedTotal * 100) / 100,
        aiTotalScore: Math.round((aiComponentScore / weightSum) * 100) / 100,
        localTotalScore: Math.round(localScore * 100) / 100,
        distanceScore: Math.round(distanceScore * 100) / 100,
        ratingScore: Math.round(ratingScore * 100) / 100,
        priceScore: Math.round(priceScore * 100) / 100,
        preferenceScore: Math.round(preferenceScore * 100) / 100,
        localScore: Math.round(localScore * 100) / 100,
        aiScore5: mapToFiveInt(aiComponentScore / weightSum),
        localScore5: mapToFiveInt(localScore),
        uiScore5: mapToFiveInt(aiComponentScore / weightSum), // 初期はAIランキング前提
        uiScore5Label: mapToFiveIntLabel(mapToFiveInt(aiComponentScore / weightSum)),
        reasoning,
      };
    });

    // ご当地度優先のローカルランキング用重み付け（localStrict時のみ適用）
    if (localStrict) {
      const localRankingWeights = { local: 0.4, rating: 0.3, distance: 0.2, price: 0.1 };
      scoredPlaces.forEach(s => {
        const composite = (
          (s.localScore) * localRankingWeights.local +
          (s.ratingScore) * localRankingWeights.rating +
          (s.distanceScore) * localRankingWeights.distance +
          (s.priceScore) * localRankingWeights.price
        );
        // 1桁小数でローカル総合を再定義
        s.localTotalScore = Math.round(composite * 10) / 10;
        // ローカルランキング表示時に5段階指標をローカル総合へ差し替えたいケースに備え、uiScore5は呼び出し側で mode により上書きされる前提
      });
      if (debug) {
        printLocalWeightsApplied(scoredPlaces);
      }
    }

    // ソート: localStrict時はローカル総合 → ご当地度 → 評価 → 距離 → 価格 の優先順位
    let ranked = localStrict
      ? scoredPlaces.sort((a, b) => {
          if (b.localTotalScore !== a.localTotalScore) return b.localTotalScore - a.localTotalScore;
          if (b.localScore !== a.localScore) return b.localScore - a.localScore;
          if (b.ratingScore !== a.ratingScore) return b.ratingScore - a.ratingScore;
          if (b.distanceScore !== a.distanceScore) return b.distanceScore - a.distanceScore;
          return b.priceScore - a.priceScore;
        })
      : scoredPlaces.sort((a, b) => b.totalScore - a.totalScore);

    // ===== ご当地度ランキング専用表示モード =====
    const localRankingOnly = options?.localStrict === false && (process.env.EXPO_PUBLIC_LOCAL_RANKING_ONLY === '1');
    // localStrict とは別に表示だけをローカルスコアに絞りたい場合
    if (localRankingOnly) {
      if (debug) console.log('🏯 ご当地度表示モード: reasoning を local のみに絞ります');
      ranked = ranked.map(r => {
        return {
          ...r,
          reasoning: generateLocalOnlyReasoning(r.place, r.localScore, currentPrefecture)
        };
      });
      // UI表示5段階スコアをご当地度へ差し替え
      ranked = ranked.map(r => ({
        ...r,
        uiScore5: mapToFiveInt(r.localScore),
        uiScore5Label: mapToFiveIntLabel(mapToFiveInt(r.localScore)),
      }));
    }

    // 多様性リランク（同じジャンル/タイプの連続を抑制）
    if (enableDiversity && ranked.length > 2) {
      ranked = diversify(ranked, diversityPenalty, debug);
    }

    return ranked;

  } catch (error) {
    console.error('AIスコア計算エラー:', error);
    // エラー時は距離順でフォールバック
    return places.map(place => ({
      place,
      totalScore: 5.0,
      aiTotalScore: 5.0,
      localTotalScore: 5.0,
      distanceScore: 5.0,
      ratingScore: place.rating ? (place.rating / 5) * 10 : 5.0,
      priceScore: 5.0,
      preferenceScore: 5.0,
      localScore: 5.0,
      aiScore5: 3,
      localScore5: 3,
      uiScore5: 3,
      uiScore5Label: '普通',
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
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(pos1.lat * Math.PI / 180) * Math.cos(pos2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// 価格スコア計算（priceLevel(0-4) or priceRange文字列の両対応）
const calculatePriceScoreSmart = (place: Place, userBudget?: string): number => {
  const userPrice = budgetToLevel(userBudget);
  const placeLevel = inferPlacePriceLevel(place);
  if (userPrice === null || placeLevel === null) return 5;

  // ユーザー予算内: 高得点、安いほどボーナス
  if (placeLevel <= userPrice) {
    return clamp01(0.6 + 0.1 * (userPrice - placeLevel + 1)) * 10; // 6〜10点レンジ
  }
  // 予算超過: 強めに減点
  return clamp01(1 - 0.25 * (placeLevel - userPrice)) * 10; // 0〜7.5点程度
};

// Place からジャンルトークンを抽出
function extractGenreTokens(place: Place): string[] {
  const tokens: string[] = [];
  const rawName = (place.name || '').toLowerCase();
  const rawCuisine = (place.cuisineType || '').toLowerCase();
  // 基本: name / cuisineType を形態素なしで単純分割（記号で粗く）
  rawName.split(/[\s・,、/()]/).forEach(t => { if (t) tokens.push(t); });
  rawCuisine.split(/[\s・,、/()]/).forEach(t => { if (t) tokens.push(t); });
  // Google types から正規化
  (place.types || []).forEach(tp => {
    const lower = (tp || '').toLowerCase();
    if (TYPE_TO_GENRE[lower]) tokens.push(TYPE_TO_GENRE[lower]);
    tokens.push(lower);
  });
  return Array.from(new Set(tokens));
}

// 嗜好スコア計算（ジャンル正規化 + strict + 非一致ペナルティ + 同義語展開）
const calculatePreferenceScore = (place: Place, preferences: UserPreferences): number => {
  const activeGenres = preferences.favoriteGenres || [];
  if (activeGenres.length === 0) return 5; // 未設定なら中立
  const strictMode = (process.env.EXPO_PUBLIC_PREFERENCE_STRICT === '1');
  const tokens = extractGenreTokens(place).map(t => t.toLowerCase());

  // 同義語展開
  const expandedPrefs = new Set<string>();
  activeGenres.forEach(g => {
    expandedPrefs.add(g.toLowerCase());
    GENRE_SYNONYMS[g]?.forEach(s => expandedPrefs.add(s.toLowerCase()));
  });

  const matched = Array.from(expandedPrefs).some(p => tokens.some(t => t.includes(p)));

  let base = matched ? 7 : (strictMode ? 1 : 3);
  const bonus = matched ? (strictMode ? 3 : 2) : 0;
  let score = base + bonus;

  // アレルギー減点（名称/料理タイプ簡易チェック）
  if (preferences.allergies.length > 0) {
    const allergyRisk = preferences.allergies.some(a => {
      const low = (a || '').toLowerCase();
      return tokens.some(t => t.includes(low));
    });
    if (allergyRisk) score -= 5;
  }

  return Math.max(0, Math.min(10, score));
};

// ご当地度スコア計算
const calculateLocalScore = (place: Place, currentPrefecture?: string): number => {
  if (!currentPrefecture || !LOCAL_SPECIALTIES_KEYWORDS[currentPrefecture]) return 5;

  // ENV でチューニング可能なパラメータ
  const baseScore = Number(process.env.EXPO_PUBLIC_LOCAL_BASE_SCORE ?? '3');
  const keywordWeight = Number(process.env.EXPO_PUBLIC_LOCAL_KEYWORD_WEIGHT ?? '2');
  const anchorWeight = Number(process.env.EXPO_PUBLIC_LOCAL_ANCHOR_WEIGHT ?? '1.5');
  const boostFactor = Number(process.env.EXPO_PUBLIC_LOCAL_BOOST_FACTOR ?? '1.25'); // 全体倍率で底上げ（デフォルト1.25）

  const localKeywords = LOCAL_SPECIALTIES_KEYWORDS[currentPrefecture];
  let raw = 0;
  const name = (place.name || '').toLowerCase();
  const cuisine = (place.cuisineType || '').toLowerCase();

  localKeywords.forEach(k => {
    const keyword = (k || '').toLowerCase();
    if (!keyword) return;
    if (name.includes(keyword) || cuisine.includes(keyword)) raw += keywordWeight;
  });
  LOCAL_ANCHOR_KEYWORDS.forEach(a => {
    if (name.includes(a) || cuisine.includes(a)) raw += anchorWeight;
  });

  const boosted = (raw + baseScore) * boostFactor;
  return Math.min(10, boosted);
};

// AI判断理由生成（詳細版）
const generateReasoning = (
  place: Place,
  distanceScore: number,
  ratingScore: number,
  priceScore: number,
  preferenceScore: number,
  localScore: number,
  preferences?: UserPreferences,
  currentPrefecture?: string
): string[] => {
  const reasons: string[] = [];
  const lowerName = (place.name || '').toLowerCase();
  const lowerCuisine = (place.cuisineType || '').toLowerCase();
  const distanceMeters = (() => {
    // generateReasoningに距離そのものは渡していないため、距離スコアから逆算は難しいので省略可能。
    return undefined;
  })();

  // 嗜好一致詳細
  const matchedGenres: string[] = [];
  if (preferences?.favoriteGenres?.length) {
    for (const g of preferences.favoriteGenres) {
      const gl = (g || '').toLowerCase();
      if (!gl) continue;
      if (lowerName.includes(gl) || lowerCuisine.includes(gl)) matchedGenres.push(g);
      if (matchedGenres.length >= 3) break;
    }
  }
  if (preferenceScore >= 7) {
    if (matchedGenres.length > 0) {
      // ★ ここだけ5段階表示
      reasons.push(`❤️ 好み一致: ${matchedGenres.join(', ')} (嗜好スコア${to5Display(preferenceScore)}/5)`);
    } else if (preferences?.favoriteGenres?.length) {
      reasons.push(`❤️ 嗜好ジャンル(${preferences.favoriteGenres.slice(0,2).join(', ')})と高い関連性`);
    } else {
      reasons.push('❤️ 嗜好に適合');
    }
  } else if (preferenceScore < 5 && preferences?.favoriteGenres?.length) {
    reasons.push(`🌀 好み外ジャンル (設定: ${preferences.favoriteGenres.slice(0,2).join(', ')})`);
  }

  // 価格詳細
  const userBudget = preferences?.budgetRange;
  const placeBudget = place.priceRange || (typeof place.priceLevel === 'number' ? `Lv${place.priceLevel}` : undefined);
  if (priceScore >= 8) {
    reasons.push(`💰 予算内でコスパ良好 (あなた:${userBudget || '不明'} 店:${placeBudget || '不明'})`);
  } else if (priceScore < 5) {
    reasons.push(`💰 予算超えの可能性 (あなた:${userBudget || '不明'} 店:${placeBudget || '不明'})`);
  } else {
    // ★ ここも5段階表示
    reasons.push(`💰 価格許容範囲 (スコア${to5Display(priceScore)}/5)`);
  }

  // 距離（距離スコアから簡易分類）
  if (distanceScore >= 8) {
    reasons.push(`📍 近距離アクセス (距離スコア${to5Display(distanceScore)}/5)`);
  } else if (distanceScore < 5) {
    reasons.push(`📍 やや遠め (距離スコア${to5Display(distanceScore)}/5)`);
  } else {
    reasons.push(`📍 適度な距離 (距離スコア${to5Display(distanceScore)}/5)`);
  }

  // 評価詳細（rawRatingは元々★5段階なのでそのまま）
  const rawRating = place.rating ?? null;
  const count = (place as any).user_ratings_total ?? (place as any).userRatingCount ?? place.userRatingsTotal ?? null;
  if (rawRating) {
    if (ratingScore >= 8) {
      reasons.push(`⭐ 高評価 ${rawRating.toFixed(1)} (${count ? `口コミ${count}件` : '件数不明'})`);
    } else if (ratingScore < 6) {
      reasons.push(`⭐ 評価平均的 ${rawRating.toFixed(1)}${count ? ` / ${count}件` : ''}`);
    } else {
      reasons.push(`⭐ まずまずの評価 ${rawRating.toFixed(1)}${count ? ` / ${count}件` : ''}`);
    }
  } else {
    reasons.push('⭐ 評価データなし');
  }

  // 営業状況
  const openNow = (place as any).openNow;
  if (openNow === true) reasons.push('⏰ 現在営業中');
  else if (openNow === false) reasons.push('⏰ 現在は営業時間外');

  // ご当地詳細
  if (localScore >= 7) {
    const localHits: string[] = [];
    if (currentPrefecture && LOCAL_SPECIALTIES_KEYWORDS[currentPrefecture]) {
      for (const k of LOCAL_SPECIALTIES_KEYWORDS[currentPrefecture]) {
        const kl = (k || '').toLowerCase();
        if (kl && (lowerName.includes(kl) || lowerCuisine.includes(kl))) {
          localHits.push(k);
          if (localHits.length >= 4) break;
        }
      }
    }
    LOCAL_ANCHOR_KEYWORDS.forEach(a => {
      if (lowerName.includes(a) || lowerCuisine.includes(a)) {
        if (!localHits.includes(a)) localHits.push(a);
      }
    });
    const listText = localHits.length ? localHits.slice(0,4).join(', ') : '名物要素';
    reasons.push(`🏯 ご当地度高: ${listText}`);
  }

  // チェーン判定
  if (isChainPlace(place)) {
    reasons.push('🏢 チェーン店 (独自性低め)');
  }

  // 安全第一モードの案内
  if ((preferences?.allergies?.length ?? 0) > 0) {
    reasons.unshift('🛡️ 安全第一: 入力されたアレルギーを優先して最適化');
  }
  // 文字数過多回避: 最大8件に絞る
  return reasons.slice(0, 8);
};


export default { calculateAIScore };

// ========= ここから内部ユーティリティ =========

function clamp01(v: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ベイズ推定による評価補正
function bayesianRating(R: number, v: number, C: number, m: number): number {
  if (!R || v <= 0) return C;
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

// 予算文字列→レベル(1〜5相当)を0〜4に正規化
function budgetToLevel(budget?: string): number | null {
  if (!budget) return null;
  const map: { [k: string]: number } = {
    '～1000円': 0,
    '～2000円': 1,
    '～3000円': 2,
    '～5000円': 3,
    '5000円～': 4,
  };
  return map[budget] ?? null;
}

// 10点スコアを表示用5段階（小数1桁）へ変換
function to5Display(score10: number): string {
  return (Math.round((clamp01(score10 / 10) * 10 / 2) * 10) / 10).toFixed(1);
  // clamp → /10 正規化 → /2 で 0-5 → 四捨五入1桁
}

// 10点→整数5段階(1-5)への変換（UIアイコン向け）
function mapToFiveInt(score10: number): number {
  const s = clamp01(score10 / 10) * 10; // 0-10
  if (s >= 8) return 5;
  if (s >= 6.5) return 4;
  if (s >= 5) return 3;
  if (s >= 3.5) return 2;
  return 1;
}

function mapToFiveIntLabel(v: number): string {
  switch (v) {
    case 5: return '最高';
    case 4: return '良';
    case 3: return '普通';
    case 2: return '低め';
    default: return '低';
  }
}

// 店の価格レベル推定（priceLevel優先、無ければpriceRange）
function inferPlacePriceLevel(place: Place): number | null {
  if (typeof place.priceLevel === 'number') return place.priceLevel;
  if (typeof place.priceLevel === 'string') {
    const lvl = (place.priceLevel || '').toString().toUpperCase();
    const map: { [k: string]: number } = {
      'PRICE_LEVEL_INEXPENSIVE': 1,
      'PRICE_LEVEL_MODERATE': 2,
      'PRICE_LEVEL_EXPENSIVE': 3,
      'PRICE_LEVEL_VERY_EXPENSIVE': 4,
      'PRICE_LEVEL_FREE': 0,
      'PRICE_LEVEL_CHEAP': 1,
    };
    if (lvl in map) return map[lvl];
  }
  const pr = place.priceRange;
  if (!pr) return null;
  // 日本語帯表記 or 記号表記(¥〜¥¥¥¥) 両対応
  const mapJpy: { [k: string]: number } = {
    '～1000円': 0,
    '～2000円': 1,
    '～3000円': 2,
    '～5000円': 3,
    '5000円～': 4,
    '無料': 0,
  };
  if (pr in mapJpy) return mapJpy[pr];
  const yenCount = (pr.match(/¥/g) || []).length;
  if (yenCount > 0) return Math.min(4, Math.max(1, yenCount));
  return null;
}

// 多様性を重視した貪欲リランク
function diversify(items: SpotScore[], penalty: number, debug: boolean): SpotScore[] {
  const selected: SpotScore[] = [];
  const remaining = [...items];
  const typeCounts: Record<string, number> = {};

  const getTypeKey = (it: SpotScore) => {
    const t = (it.place.cuisineType || '').toLowerCase();
    const types = (it.place.types || []).map(x => (x || '').toLowerCase());
    return t || types[0] || '';
  };

  while (remaining.length > 0) {
    // 現在の多様性ペナルティを考慮したスコアで最大のものを選ぶ
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const it = remaining[i];
      const key = getTypeKey(it);
      const count = key ? (typeCounts[key] || 0) : 0;
      const adjusted = it.totalScore * (1 - penalty * count);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIdx = i;
      }
    }

    const picked = remaining.splice(bestIdx, 1)[0];
    const pickedKey = getTypeKey(picked);
    if (pickedKey) typeCounts[pickedKey] = (typeCounts[pickedKey] || 0) + 1;
    selected.push({ ...picked, totalScore: Math.round(bestScore * 100) / 100 });
  }

  if (debug) {
    printDiversifyDebug(selected, penalty);
  }

  return selected;
}

// チェーン店判定
function isChainPlace(place: Place): boolean {
  const text = `${place.name || ''} ${place.cuisineType || ''} ${(place.types || []).join(' ')}`.toLowerCase();
  return CHAIN_KEYWORDS.some(k => text.includes(k));
}

// ご当地性判定（キーワード or アンカーのいずれかにマッチ）
export function isLocalPlace(place: Place, prefecture?: string): boolean {
  const text = `${place.name || ''} ${place.cuisineType || ''} ${(place.types || []).join(' ')}`.toLowerCase();
  const anchorsHit = LOCAL_ANCHOR_KEYWORDS.some(k => text.includes(k));
  if (!prefecture) return anchorsHit;
  const keys = LOCAL_SPECIALTIES_KEYWORDS[prefecture] || [];
  const localHit = keys.some(k => text.includes((k || '').toLowerCase()));
  return anchorsHit || localHit;
}

// ==== DB嗜好オーバーライド用マッピング ====
// バックエンドの返却(JSON)をフロント内部形式へ合わせる
export function mapBackendPreferences(raw: Partial<UserPreferences & {
  priceRange?: string;
  dietaryRestrictions?: string[];
  preferredDistance?: number;
}>): Partial<UserPreferences> {
  const mapped: Partial<UserPreferences> = {};
  if (raw.favoriteGenres) mapped.favoriteGenres = raw.favoriteGenres.filter(Boolean);
  if (raw.priceRange) mapped.budgetRange = raw.priceRange; // バック側: priceRange → 内部: budgetRange
  if ((raw as any).dietaryRestrictions) mapped.allergies = (raw as any).dietaryRestrictions?.filter(Boolean) || [];
  // 重みは既存を維持（必要なら将来ここで調整）
  return mapped;
}

// ご当地度ランキング専用理由生成
function generateLocalOnlyReasoning(place: Place, localScore: number, prefecture?: string): string[] {
  const reasons: string[] = [];
  const lowerName = (place.name || '').toLowerCase();
  const lowerCuisine = (place.cuisineType || '').toLowerCase();
  const hits: string[] = [];
  if (prefecture && LOCAL_SPECIALTIES_KEYWORDS[prefecture]) {
    for (const k of LOCAL_SPECIALTIES_KEYWORDS[prefecture]) {
      const kl = (k || '').toLowerCase();
      if (kl && (lowerName.includes(kl) || lowerCuisine.includes(kl))) {
        hits.push(k);
        if (hits.length >= 5) break;
      }
    }
  }
  LOCAL_ANCHOR_KEYWORDS.forEach(a => {
    if (lowerName.includes(a) || lowerCuisine.includes(a)) {
      const orig = a; // そのまま英/和混在
      if (!hits.includes(orig) && hits.length < 5) hits.push(orig);
    }
  });
  const listText = hits.length ? hits.join(', ') : 'ご当地要素';
  reasons.push(`🏯 ご当地度 ${localScore.toFixed(1)}/10 (${listText})`);
  return reasons;
}

// 店がアレルギー食材に触れている可能性の簡易判定
function hasAllergyRisk(place: Place, allergies: string[]): boolean {
  if (!allergies || allergies.length === 0) return false;
  const text = `${place.name || ''} ${place.cuisineType || ''} ${(place.types || []).join(' ')}`.toLowerCase();
  const types = (place.types || []).map(t => (t || '').toLowerCase());

  // アレルゲン→高リスクキーワード/タイプ辞書（簡易版）
  const RISK_MAP: Record<string, { keywords: string[]; types: string[] }> = {
    '小麦': {
      keywords: ['ラーメン', 'うどん', 'そば', '焼きそば', 'パスタ', 'スパゲッティ', 'パン', 'ベーカリー', 'ピザ', 'クッキー', 'ケーキ', 'たい焼き', 'お好み焼き', 'たこ焼き', '揚げ物', 'フライ'],
      types: ['ramen', 'bakery', 'pizza', 'meal_takeaway', 'restaurant']
    },
    '乳': {
      keywords: ['ミルク', 'チーズ', 'バター', 'クリーム', 'アイス', 'ジェラート', 'ヨーグルト', 'ラッシー'],
      types: ['ice_cream_shop', 'bakery', 'cafe']
    },
    '卵': {
      keywords: ['卵', 'オムレツ', 'プリン', 'シフォン', 'マヨネーズ'],
      types: ['bakery', 'cafe']
    },
    'そば': {
      keywords: ['蕎麦', 'そば'],
      types: ['restaurant']
    },
    '甲殻類': {
      keywords: ['エビ', 'カニ', 'シュリンプ', 'ロブスター'],
      types: ['restaurant']
    },
    '落花生': {
      keywords: ['ピーナッツ', '落花生'],
      types: ['confectionery', 'bakery']
    },
  };

  // 直接一致（店名/料理タイプ/Types）
  const directHit = allergies.some(a => {
    const low = (a || '').toLowerCase();
    return low && (text.includes(low) || types.some(t => t.includes(low)));
  });
  if (directHit) return true;

  // 辞書による間接一致
  for (const a of allergies) {
    const key = (a || '').toLowerCase();
    const entry = RISK_MAP[a] || RISK_MAP[key];
    if (!entry) continue;
    const hitKeyword = entry.keywords.some(k => k && text.includes((k || '').toLowerCase()));
    const hitType = entry.types.some(tp => types.includes(tp));
    if (hitKeyword || hitType) return true;
  }
  return false;
}

// ===== デバッグ出力補助（読みやすい整形） =====
function printHeaderDebug(info: {
  currentPrefecture?: string;
  places: number;
  weights: { preference: number; distance: number; rating: number; price: number; local: number };
  diversityPenalty: number;
  enableDiversity: boolean;
  chainFilterMode: string;
  chainPenalty: number;
  safetyFirst: boolean;
}) {
  const w = info.weights;
  console.log(
    `🧮 計算開始 | 件数:${info.places} 県:${info.currentPrefecture ?? '-'} ` +
    `| 安全第一:${info.safetyFirst ? 'ON' : 'OFF'} | 多様性:${info.enableDiversity ? 'ON' : 'OFF'} (penalty ${info.diversityPenalty})\n` +
    `   weights → preference:${w.preference.toFixed(2)} price:${w.price.toFixed(2)} distance:${w.distance.toFixed(2)} rating:${w.rating.toFixed(2)} local:${w.local.toFixed(2)}\n` +
    `   chain → mode:${info.chainFilterMode} penalty:${info.chainPenalty}`
  );
}

function printSpotDebug(args: {
  name: string;
  cuisineType?: string;
  distanceMeters: number;
  openNow?: boolean;
  rating?: number;
  priceRange?: string;
  distanceScore: number;
  ratingScore: number;
  priceScore: number;
  preferenceScore: number;
  localScore: number;
  totalRaw: number;
  totalAfterChain: number;
  availabilityAdj: number;
  aiScore5: number;
  localScore5: number;
  weights: { preference: number; distance: number; rating: number; price: number; local: number };
  distanceDecayScale: number;
  localHits?: string[];
  isChain: boolean;
}) {
  const meta = `距離:${args.distanceMeters}m  営業:${args.openNow === true ? '営業中' : args.openNow === false ? '営業時間外' : '不明'}  ` +
               `評価:${args.rating ?? '-'}  価格:${args.priceRange ?? '-'}` +
               (args.cuisineType ? `  種別:${args.cuisineType}` : '');
  const scoreLine = `dist:${args.distanceScore.toFixed(2)} rate:${args.ratingScore.toFixed(2)} price:${args.priceScore.toFixed(2)} pref:${args.preferenceScore.toFixed(2)} local:${args.localScore.toFixed(2)}`;
  const totalLine = `total(raw):${args.totalRaw.toFixed(2)} → chain:${args.totalAfterChain.toFixed(2)} (availAdj ${args.availabilityAdj}) | ai5:${args.aiScore5} local5:${args.localScore5}`;
  const hits = (args.localHits && args.localHits.length) ? ` localHits:[${args.localHits.join(', ')}]` : '';
  console.log(`📊 ${args.name}${args.isChain ? ' [チェーン]' : ''}\n   ${meta}\n   ${scoreLine}\n   ${totalLine}\n   decay:${args.distanceDecayScale}${hits}`);
}

function printLocalWeightsApplied(items: SpotScore[]) {
  const top = items.slice(0, 5).map(p => ({
    name: p.place.name,
    localScore: p.localScore,
    ratingScore: p.ratingScore,
    distanceScore: p.distanceScore,
    priceScore: p.priceScore,
    localTotalScore: p.localTotalScore,
  }));
  console.log('🏯 ローカル重み適用TOP5', top);
}

function printDiversifyDebug(selected: SpotScore[], penalty: number) {
  const ordered = selected.slice(0, 5).map(s => ({ name: s.place.name, totalScore: s.totalScore, cuisineType: s.place.cuisineType }));
  console.log('🔁 多様性リランク', { penalty, ordered });
}