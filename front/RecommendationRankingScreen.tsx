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
import { LOCAL_SPECIALTIES_KEYWORDS, GENRE_SYNONYMS } from '../utils/aiScoring';
import { calculateAIScore, SpotScore, isLocalPlace } from '../utils/aiScoring';
import { ensureGoogleApiKey, buildApiUrl, BACKEND_BASE_URL, HOTPEPPER_PUBLIC_API_KEY } from '../utils/config';
import { useAuth } from '../utils/auth';
import { apiCall } from '../utils/api';

const API_KEY: string = ensureGoogleApiKey();

// priceLevel を表示用の記号に変換
const priceLevelToYen = (level?: string | number): string | undefined => {
  if (typeof level === 'number') {
    const map = ['¥', '¥', '¥¥', '¥¥¥', '¥¥¥¥'];
    return map[Math.max(0, Math.min(4, Math.floor(level)))] ?? undefined;
  } else if (typeof level === 'string') {
    switch (level) {
      case 'PRICE_LEVEL_FREE':
        return '無料';
      case 'PRICE_LEVEL_INEXPENSIVE':
        return '¥';
      case 'PRICE_LEVEL_MODERATE':
        return '¥¥';
      case 'PRICE_LEVEL_EXPENSIVE':
        return '¥¥¥';
      case 'PRICE_LEVEL_VERY_EXPENSIVE':
        return '¥¥¥¥';
      default:
        return undefined;
    }
  }
  return undefined;
};

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
  price_level?: number; // 旧互換
  priceLevel?: string | number; // Google Places v1 の priceLevel（enum or number）
  priceRange?: string; // 表示用（¥〜¥¥¥¥）
  hpGenre?: string; // HotPepperの種別（ジャンル名）
  hpUrl?: string; // HotPepper予約/詳細ページURL
  phoneNumber?: string; // 電話番号（Google Places Details）
  types?: string[]
  reasons?: string[];
  photoUrl?: string;
  openNow?: boolean;
};
// HotPepper検索用に店名を正規化
const normalizeNameForHotPepper = (name: string): string => {
  let s = name.trim();
  // 店名の一般的な後置語を削除（精度向上）
  s = s.replace(/[\s　]*(本場|本館|別館|関連棟|東部市場|中央市場|中央卸売市場|市場|スタンド|酒場|居酒屋|食堂|食事処|レストラン|カフェ|店|本店|支店|梅田店|大阪店)$/u, '');
  // 記号類を除去
  s = s.replace(/[\(\)\[\]【】『』“”"'・・]/g, '');
  return s;
};

// HotPepperの検索URLを作成（name優先、ダメならkeywordに切替）
const buildHotPepperUrl = (key: string, opts: { name?: string; keyword?: string; lat: number; lng: number; range?: number }) => {
  const base = 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/';
  const params = new URLSearchParams();
  params.set('key', key);
  if (opts.name) params.set('name', opts.name);
  if (opts.keyword) params.set('keyword', opts.keyword);
  params.set('lat', String(opts.lat));
  params.set('lng', String(opts.lng));
  params.set('range', String(opts.range ?? 3));
  params.set('count', '1');
  params.set('format', 'json');
  return `${base}?${params.toString()}`;
};

type UserPreferences = {
  budget?: string;
  cuisineTypes?: string[];
  dietaryRestrictions?: string[];
  atmospherePreference?: string;
  groupSize?: number;
  occasion?: string;
  favoriteGenres?: string[]; // DB返却に合わせ追加
  priceRange?: string; // DB側の価格記号
  preferredDistance?: number;
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
async function searchPlaces(
  query: string,
  lat: number,
  lng: number,
  opts?: { radius?: number; max?: number }
): Promise<Place[]> {
  if (!API_KEY) throw new Error('Google Maps API キーが設定されていません');

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.name,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.currentOpeningHours.openNow,places.formattedAddress,places.photos'
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: opts?.radius ?? 5000
        }
      },
      maxResultCount: opts?.max ?? 20
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
      priceLevel: p.priceLevel,
      priceRange: priceLevelToYen(p.priceLevel),
      types: p.types,
      openNow: p.currentOpeningHours?.openNow,
      photoUrl,
    } as Place;
  }) || [];
}

// Places Details から不足している priceLevel を補完
async function enrichPlacesWithPriceLevel(places: Place[]): Promise<Place[]> {
  const key = API_KEY;
  if (!key) return places;

  const targets = places.filter(p => p.priceLevel == null);
  if (targets.length === 0) return places;

  const fetchOne = async (pid: string) => {
    try {
      const bareId = pid.startsWith('places/') ? pid.replace(/^places\//, '') : pid;
      const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(bareId)}?languageCode=ja`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'priceLevel',
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.priceLevel ?? null;
    } catch {
      return null;
    }
  };

  // 直列でも可だが、軽く並列（同時5件）で取得
  const concurrency = 5;
  let idx = 0;
  const updateMap: Record<string, any> = {};
  const workers = new Array(concurrency).fill(0).map(async () => {
    while (idx < targets.length) {
      const cur = targets[idx++];
      const val = await fetchOne(cur.id);
      if (val != null) {
        updateMap[cur.id] = val;
      }
    }
  });
  await Promise.all(workers);

  if (Object.keys(updateMap).length === 0) return places;

  return places.map(p => {
    if (updateMap[p.id] == null) return p;
    const pl = updateMap[p.id];
    return { ...p, priceLevel: pl, priceRange: priceLevelToYen(pl) };
  });
}

// Hot Pepper API 経由で平均予算を補完
async function enrichPlacesWithHotPepperBudget(places: Place[], lat: number, lng: number): Promise<Place[]> {
  const enriched = [...places];
  const targets = enriched.filter(p => !p.priceRange);
  if (targets.length === 0) return enriched;
  const canCallBackend = !!BACKEND_BASE_URL;
  const canCallDirect = !!HOTPEPPER_PUBLIC_API_KEY;
  if (!canCallBackend && !canCallDirect) {
    console.warn('[HotPepper] BACKEND_BASE_URL と EXPO_PUBLIC_HOTPEPPER_API_KEY が未設定のため価格補完不可');
  }
  const fetchOne = async (p: Place) => {
    try {
      let pr: string | null = null;
      let genre: string | null = null;
      let hpUrl: string | null = null;
      let phone: string | null = null;
      if (canCallBackend) {
        const url = buildApiUrl(`/api/price?name=${encodeURIComponent(p.name)}&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
        const r = await fetch(url);
        if (r.ok) {
          const data = await r.json();
          pr = data?.priceRange || null;
          genre = data?.genre || null;
          hpUrl = data?.url || null;
        }
      }
      // バックエンドでpriceだけ取得できた場合、ジャンルが未設定なら軽く直接取得する
      if (pr && !genre && canCallDirect) {
        const normalized = normalizeNameForHotPepper(p.name);
        const hpUrlG = buildHotPepperUrl(HOTPEPPER_PUBLIC_API_KEY, { name: normalized || p.name, lat, lng, range: 4 });
        const rg = await fetch(hpUrlG);
        if (rg.ok) {
          const jg = await rg.json();
          const shopg = Array.isArray(jg.results?.shop) ? jg.results.shop[0] : undefined;
          genre = (shopg?.genre?.name as string | undefined) || (shopg?.genre?.catch as string | undefined) || null;
        }
      }
      // フォールバック: 直接 Hot Pepper API を叩く
      if (!pr && canCallDirect) {
        const normalized = normalizeNameForHotPepper(p.name);
        // 1回目: name検索（範囲やや広め）
        const hpUrl1 = buildHotPepperUrl(HOTPEPPER_PUBLIC_API_KEY, { name: normalized || p.name, lat, lng, range: 4 });
        const r1 = await fetch(hpUrl1);
        if (r1.ok) {
          const j1 = await r1.json();
          const shop1 = Array.isArray(j1.results?.shop) ? j1.results.shop[0] : undefined;
          pr = (shop1?.budget?.name as string | undefined) || null;
          genre = (shop1?.genre?.name as string | undefined) || (shop1?.genre?.catch as string | undefined) || null;
          hpUrl = (shop1?.urls?.pc as string | undefined) || hpUrl;
        }
        // 2回目: キーワード検索（市場系や一般名詞にもヒットさせる）
        if (!pr) {
          const keyword = normalized || p.name;
          const hpUrl2 = buildHotPepperUrl(HOTPEPPER_PUBLIC_API_KEY, { keyword, lat, lng, range: 5 });
          const r2 = await fetch(hpUrl2);
          if (r2.ok) {
            const j2 = await r2.json();
            const shop2 = Array.isArray(j2.results?.shop) ? j2.results.shop[0] : undefined;
            pr = (shop2?.budget?.name as string | undefined) || null;
            genre = (shop2?.genre?.name as string | undefined) || (shop2?.genre?.catch as string | undefined) || genre;
            hpUrl = (shop2?.urls?.pc as string | undefined) || hpUrl;
          }
        }
      }
      if (pr) {
        console.log(`[HotPepper] priceRange取得: ${p.name} -> ${pr}`);
      } else {
        console.log(`[HotPepper] 取得失敗/該当なし: ${p.name}`);
      }
      // 種別（ジャンル）のログは非表示
      if (pr) p.priceRange = pr;
      if (genre) p.hpGenre = genre;
      if (hpUrl) p.hpUrl = hpUrl;
      return p.priceRange || null;
    } catch { return null; }
  };
  for (let i = 0; i < targets.length; i++) {
    const pr = await fetchOne(targets[i]);
    if (pr) {
      targets[i].priceRange = pr;
    }
  }
  return enriched;
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
  // ランキングモード（AI / ご当地）
  const [rankingMode, setRankingMode] = useState<'ai' | 'local' | undefined>(undefined);

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

  // 価格記号→内部の価格帯表記へ変換（AIスコア用）
  const mapPriceToRange = (priceSymbol: string): string => {
    const priceMap: Record<string, string> = {
      '¥': '～1000円',
      '¥¥': '～2000円',
      '¥¥¥': '～3000円',
      '¥¥¥¥': '5000円～'
    };
    return priceMap[priceSymbol] || '～2000円';
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
      // 都道府県ごとの代表的なご当地キーワードに、汎用アンカーも加えて精度を上げる
      const keywords = LOCAL_SPECIALTIES_KEYWORDS[prefecture] || [];
      if (keywords.length === 0) {
        setLoadingLocalSpecialties(false);
        Alert.alert('ご当地グルメ', `${prefecture}のご当地グルメ情報がありません`);
        return;
      }

      const allResults: Place[] = [];
      
      // 代表的なキーワード上位 + ご当地アンカーから広めに検索（最大8ターム×各6件）
      const anchors = ['郷土料理','名物','市場','漁港','道の駅'];
      const terms = [...keywords.slice(0, 6), ...anchors].slice(0, 8);
      for (const term of terms) {
        try {
          const results = await searchPlaces(`${prefecture} ${term}`, loc.lat, loc.lng, { radius: 10000, max: 20 });
          allResults.push(...results.slice(0, 6)); // 各キーワードから6件まで
        } catch (error) {
          console.warn(`${term} の検索でエラー:`, error);
        }
      }
      
      if (allResults.length > 0) {
        // 重複を除去
        const uniqueResults = allResults.filter((place, index, self) => 
          index === self.findIndex(p => p.id === place.id)
        );

        // ご当地限定: 県の名物/アンカーにマッチする店のみ残す
        const strictLocal = uniqueResults.filter((p) => isLocalPlace({
          id: p.id,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          address: p.address,
          rating: p.rating,
          types: p.types,
        } as any, prefecture));

        if (strictLocal.length === 0) {
          setShowAIRanking(false);
          setLocalSpecialties([]);
          setMsg(`${prefecture}のご当地グルメ（その土地の名物）に該当するお店が見つかりませんでした`);
          Alert.alert('ご当地限定', `${prefecture}の名物に該当するお店が見つかりませんでした。検索範囲を広げるか、別の名物でお試しください。`);
          return;
        }

        // 価格レベル補完（不足分はDetailsで取得）
        let localWithPrice = await enrichPlacesWithPriceLevel(strictLocal);
        localWithPrice = await enrichPlacesWithHotPepperBudget(localWithPrice, loc.lat, loc.lng);

        // AIランキングと同様のモーダルで表示するため、AIスコアを計算してモーダルを開く
        setMsg('🍽️ ご当地グルメのスコアを計算中...');
        const scores = await calculateAIScore(
          localWithPrice,
          loc,
          prefecture,
          process.env.EXPO_PUBLIC_DEBUG_SCORING === '1',
          { localStrict: true },
          {
            favoriteGenres: userPreferences.favoriteGenres || [],
            budgetRange: mapPriceToRange(userPreferences.priceRange || '¥¥'),
            allergies: userPreferences.dietaryRestrictions || [],
            preferredDistance: userPreferences.preferredDistance || 0,
          } as any
        );
        const top10 = scores.slice(0, 10);
        setAiScores(top10);
  setRankingTitle(`🍽️ ${prefecture}のご当地グルメランキング`);
  setRankingDescription('ご当地度・距離・評価などを総合して並べ替えています');
  setRankingReasoningTitle('📝 おすすめ理由:');
  setShowAIRanking(true);
  setRankingMode('local');
        setShowLocalSpecialties(false);
        setLocalSpecialties(strictLocal);
        setMsg(`🍽️ ${prefecture}のご当地グルメ（その土地の名物のみ）Top10を表示しました (${top10.length}件)`);
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
        const nearbyRestaurants = await searchPlaces('レストラン', location.lat, location.lng, { radius: 8000, max: 20 });
        if (nearbyRestaurants.length === 0) {
          // レストランが見つからない場合は飲食店で検索
          const nearbyFood = await searchPlaces('飲食店', location.lat, location.lng, { radius: 8000, max: 20 });
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

      // ジャンル補完: 選択ジャンルがあるのに十分ヒットしていない場合、同義語で追加検索
      if (userPreferences.favoriteGenres && userPreferences.favoriteGenres.length > 0) {
        const active = userPreferences.favoriteGenres[0]; // 先頭ジャンルを代表とする
        const synonyms = GENRE_SYNONYMS[active] || [active];
        const minNeeded = Number(process.env.EXPO_PUBLIC_GENRE_MIN ?? '3');
        const lowerSyns = synonyms.map(s => s.toLowerCase());
        const currentGenreCount = targetPlaces.filter(p => {
          const text = `${p.name || ''} ${(p.types || []).join(' ')}`.toLowerCase();
          return lowerSyns.some(s => text.includes(s));
        }).length;
        if (currentGenreCount < minNeeded) {
          const extraResults: Place[] = [];
          for (const syn of synonyms.slice(0, 5)) { // 最大5クエリ
            try {
              const r = await searchPlaces(syn, location.lat, location.lng, { radius: 6000, max: 15 });
              extraResults.push(...r);
            } catch {}
            if (extraResults.length + currentGenreCount >= minNeeded) break;
          }
          if (extraResults.length) {
            // 既存 + 追加を重複除外
            const merged = [...targetPlaces, ...extraResults].filter((pl, idx, arr) => idx === arr.findIndex(p => p.id === pl.id));
            targetPlaces = merged;
          }
        }
      }

      // 価格レベル補完（不足分はDetailsで取得）
      targetPlaces = await enrichPlacesWithPriceLevel(targetPlaces);
      targetPlaces = await enrichPlacesWithHotPepperBudget(targetPlaces, location.lat, location.lng);

      // AIスコアリング実行
  const scores = await calculateAIScore(
    targetPlaces,
    location,
    currentPrefecture,
    process.env.EXPO_PUBLIC_DEBUG_SCORING === '1',
    { localStrict: false },
    {
      favoriteGenres: userPreferences.favoriteGenres || [],
      budgetRange: mapPriceToRange(userPreferences.priceRange || '¥¥'),
      allergies: userPreferences.dietaryRestrictions || [],
      preferredDistance: userPreferences.preferredDistance || 0
    } as any
  );
      const top10 = scores.slice(0, 10);
      setAiScores(top10);
  setRankingTitle(undefined);
  setRankingDescription(undefined);
  setRankingReasoningTitle(undefined);
      setShowAIRanking(true);
      setRankingMode('ai');
      setMsg(`🤖 AIランキング計算完了！ Top10を表示中 (${top10.length}件)`);
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
        mode={rankingMode}
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