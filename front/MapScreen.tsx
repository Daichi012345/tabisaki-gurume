import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, Modal, Alert, Keyboard, TouchableWithoutFeedback, Image, Dimensions, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { getDistance } from 'geolib';
import { Magnetometer } from 'expo-sensors';
import RecommendationScreen from './RecommendationScreen';
import MyPageScreen from './MyPageScreen';
import AIRankingModal from './AIRankingModal';
import { recommendationSystem, UserAction, SpotData } from '../utils/recommendation';
import { useAuth } from '../utils/auth';
import { apiCall } from '../utils/api';
import { calculateAIScore, SpotScore, GENRE_SYNONYMS } from '../utils/aiScoring';
import { ensureGoogleApiKey } from '../utils/config';
import { addFavorite } from '../utils/favorites';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';

const API_KEY: string = ensureGoogleApiKey();
// Undo機能は使用しない（簡潔化）

// 画面サイズに応じてカード/画像/下部リストのサイズを調整
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// 一覧をもう少し大きめに（端末幅の約78%）
const CARD_WIDTH = Math.min(380, Math.max(240, Math.floor(SCREEN_WIDTH * 0.78)));
// 下部リストもやや高めに（端末高さの約30%）
const BOTTOM_LIST_HEIGHT = Math.min(320, Math.max(220, Math.floor(SCREEN_HEIGHT * 0.30)));
// 画像高さはカード幅の約54%を目安に、コンテナに収まる上限まで
const IMAGE_HEIGHT_BASE = Math.floor(CARD_WIDTH * 0.54);
const IMAGE_MAX_BY_CONTAINER = Math.max(100, BOTTOM_LIST_HEIGHT - 125); // テキスト・余白分を考慮
const IMAGE_HEIGHT = Math.min(IMAGE_HEIGHT_BASE, IMAGE_MAX_BY_CONTAINER);
// ルート情報パネルのおおよその高さ（FABの重なり回避用）
// 案内中の時間表示を見やすくするため少し高めに設定
const BOTTOM_PANEL_HEIGHT = 180;

// ※ナビ矢印（SVG）は非表示化のため削除

// ---------- 型定義 ----------
type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number;
  userRatingCount?: number;
  photoUrl?: string;
  priceRange?: string;
  priceLevel?: string | number;
  cuisineType?: string;
  reasons?: string[];
  types?: string[]; // Google Places types（ジャンル補完用）
  openNow?: boolean; // 現在営業中か
};

type RouteInfo = {
  coords: { latitude: number; longitude: number }[];
  distanceText: string; // 総距離(表示用)
  durationText: string; // 総所要時間(表示用)
  totalDistanceMeters: number; // 総距離(数値)
  totalDurationSec: number; // 総所要時間(秒)
  cumulativeDistances: number[]; // 各点までの累積距離[m]
};

type TravelMode = 'WALK' | 'DRIVE' | 'BICYCLE';

const MODE_EMOJI: Record<TravelMode, string> = {
  WALK: '🚶',
  BICYCLE: '🚴',
  DRIVE: '🚗',
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
    // 行政区（都道府県）に結果を絞り込み、言語は日本語
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

    // フォールバック: JPに限定して再試行 + locality/political から推測
    const resFallback = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}&language=ja&components=country:JP`
    );
    const fb = await resFallback.json();
    if (fb.results && fb.results.length > 0) {
      for (const result of fb.results) {
        for (const component of result.address_components) {
          if (component.types.includes('administrative_area_level_1')) {
            return component.long_name;
          }
        }
      }
      for (const result of fb.results) {
        for (const component of result.address_components) {
          if (component.types.includes('locality') || component.types.includes('political')) {
            const name: string = component.long_name || component.short_name;
            if (name && (name.endsWith('都') || name.endsWith('道') || name.endsWith('府') || name.endsWith('県'))) {
              return name;
            }
          }
        }
      }
    }

    return '不明';
  } catch (error) {
    console.error('都道府県取得エラー:', error);
    return '不明';
  }
}

// ---------- ご当地グルメデータ ----------
const LOCAL_SPECIALTIES: { [key: string]: string[] } = {
  '北海道': ['札幌ラーメン', '海鮮丼', 'ジンギスカン', '白い恋人', 'スープカレー', '毛ガニ'],
  '青森県': ['りんご', '大間マグロ', 'せんべい汁', 'りんごパイ'],
  '岩手県': ['わんこそば', '冷麺', '前沢牛', 'じゃじゃ麺'],
  '宮城県': ['牛タン', 'ずんだ餅', '笹かまぼこ', 'はらこ飯'],
  '秋田県': ['きりたんぽ', '比内地鶏', 'いぶりがっこ', '稲庭うどん'],
  '山形県': ['米沢牛', 'さくらんぼ', '芋煮', 'ラ・フランス'],
  '福島県': ['喜多方ラーメン', '白河ラーメン', 'ままどおる', '桃'],
  '茨城県': ['納豆', 'あんこう鍋', 'ほしいも', 'メロン'],
  '栃木県': ['宇都宮餃子', 'いちご', '湯波', 'しもつかれ'],
  '群馬県': ['上州牛', 'こんにゃく', '焼きまんじゅう', 'だるま弁当'],
  '埼玉県': ['川越いも', '秩父そば', '草加せんべい', '十万石まんじゅう'],
  '千葉県': ['落花生', 'なめろう', 'びわ', '勝浦タンタンメン'],
  '東京都': ['もんじゃ焼き', '寿司', 'どじょう鍋', '人形焼'],
  '神奈川県': ['シウマイ', '湘南しらす', 'サンマーメン', '鎌倉野菜'],
  '新潟県': ['コシヒカリ', '日本酒', 'のっぺ', 'へぎそば', 'タレカツ丼'],
  '富山県': ['白エビ', 'ホタルイカ', '富山ブラック', 'ます寿司'],
  '石川県': ['金沢カレー', '加賀野菜', 'のどぐろ', '治部煮'],
  '福井県': ['越前そば', '越前がに', 'ソースカツ丼', '羽二重餅'],
  '山梨県': ['ほうとう', 'ぶどう', '甲州ワイン', '桃'],
  '長野県': ['信州そば', 'おやき', 'りんご', '野沢菜'],
  '岐阜県': ['飛騨牛', '朴葉味噌', '五平餅', '鮎'],
  '静岡県': ['浜松餃子', 'うなぎ', 'わさび', '静岡おでん', 'みかん'],
  '愛知県': ['味噌カツ', 'ひつまぶし', '手羽先', 'きしめん', 'あんかけスパ'],
  '三重県': ['松阪牛', '伊勢うどん', '赤福', 'てこね寿司'],
  '滋賀県': ['近江牛', 'ふな寿司', '鮒ずし', '湖魚料理'],
  '京都府': ['京料理', '湯豆腐', 'おばんざい', '抹茶スイーツ', '京野菜'],
  '大阪府': ['たこ焼き', 'お好み焼き', '串カツ', 'イカ焼き', '551蓬莱'],
  '兵庫県': ['神戸牛', '明石焼き', 'いかなごのくぎ煮', '淡路島玉ねぎ'],
  '奈良県': ['柿の葉寿司', '奈良漬', '三輪そうめん', '吉野葛'],
  '和歌山県': ['梅干し', 'みかん', '和歌山ラーメン', 'めはり寿司'],
  '鳥取県': ['松葉ガニ', '二十世紀梨', '鳥取牛', 'あごちくわ'],
  '島根県': ['宍道湖しじみ', 'のどぐろ', '出雲そば', 'あご野焼き'],
  '岡山県': ['きびだんご', '白桃', 'ばら寿司', 'デミカツ丼'],
  '広島県': ['お好み焼き', '牡蠣', 'もみじ饅頭', '広島つけ麺'],
  '山口県': ['ふぐ', '萩焼', 'ういろう', '長州鶏'],
  '徳島県': ['阿波踊り', 'すだち', '徳島ラーメン', 'たらいうどん'],
  '香川県': ['讃岐うどん', 'オリーブ', '骨付鳥', 'しょうゆ豆'],
  '愛媛県': ['みかん', '鯛めし', 'じゃこ天', '坊っちゃん団子'],
  '高知県': ['カツオのたたき', 'ゆず', '皿鉢料理', 'ちりめんじゃこ'],
  '福岡県': ['博多ラーメン', 'もつ鍋', '明太子', '博多通りもん'],
  '佐賀県': ['佐賀牛', '呼子のイカ', 'シシリアンライス', '有田焼'],
  '長崎県': ['ちゃんぽん', 'カステラ', '皿うどん', '角煮まんじゅう'],
  '熊本県': ['馬刺し', '熊本ラーメン', 'いきなり団子', '阿蘇牛'],
  '大分県': ['関サバ', '関アジ', 'とり天', '別府冷麺'],
  '宮崎県': ['宮崎牛', 'チキン南蛮', 'マンゴー', '冷や汁'],
  '鹿児島県': ['黒豚', 'さつまいも', '焼酎', 'きびなご'],
  '沖縄県': ['ゴーヤチャンプルー', 'ソーキそば', 'サーターアンダギー', '泡盛', 'ちんすこう']
};

// ---------- Google API呼び出し ----------
async function searchPlaces(query: string, lat: number, lng: number): Promise<Place[]> {
  if (!API_KEY) throw new Error('Google Maps API キーが設定されていません');

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.name',
        'places.displayName',
        'places.location',
        'places.formattedAddress',
        'places.rating',
        'places.userRatingCount',
        'places.priceLevel',
        'places.types',
        'places.currentOpeningHours.openNow',
        'places.photos'
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } },
      maxResultCount: 10,
      languageCode: 'ja',
    }),
  });

  const json = await res.json();
  return (json.places ?? []).map((p: any) => {
    const id = (p.name && typeof p.name === 'string' && p.name.startsWith('places/')) ? p.name.replace(/^places\//, '') : p.id;
    const photoName = p.photos?.[0]?.name; // e.g. "places/PLACE_ID/photos/PHOTO_ID"
    const photoUrl = photoName ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&key=${API_KEY}` : undefined;
    return {
      id,
      name: p.displayName?.text ?? 'Unknown',
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      address: p.formattedAddress,
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      priceLevel: p.priceLevel,
      types: p.types,
      openNow: p.currentOpeningHours?.openNow,
      photoUrl,
    } as Place;
  });
}

// 足りない写真を個別に補完（Place Details）
async function fetchPhotoUrlByPlaceId(placeId: string): Promise<string | undefined> {
  if (!API_KEY) return undefined;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'photos',
      },
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    const photoName = data?.photos?.[0]?.name; // e.g. places/PLACE_ID/photos/PHOTO_ID
    return photoName ? `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=640&key=${API_KEY}` : undefined;
  } catch {
    return undefined;
  }
}

// ---------- 経路 ----------
async function computeRoute(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  mode: TravelMode,
  opts?: { departureTime?: number; arrivalTime?: number }
): Promise<RouteInfo> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
      travelMode: mode,
      computeAlternativeRoutes: false,
      languageCode: 'ja',
      units: 'METRIC',
    }),
  });

  const json = await res.json();
  if (!json.routes || json.routes.length === 0) {
    throw new Error('経路が見つかりませんでした（Routes API）');
  }
  const r = json.routes[0];
  if (!r?.polyline?.encodedPolyline) {
    throw new Error('経路ポリラインを取得できませんでした');
  }
  const coords = decodePolyline(r.polyline.encodedPolyline);
  // 累積距離を計算
  const cumulativeDistances: number[] = [];
  let acc = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i === 0) {
      cumulativeDistances.push(0);
    } else {
      const d = getDistance(
        { latitude: coords[i - 1].latitude, longitude: coords[i - 1].longitude },
        { latitude: coords[i].latitude, longitude: coords[i].longitude }
      );
      acc += d;
      cumulativeDistances.push(acc);
    }
  }
  const totalMeters: number = r.distanceMeters ?? (cumulativeDistances[cumulativeDistances.length - 1] || 0);
  const durationSec: number = r.duration ? Math.round(Number(String(r.duration).replace('s', ''))) : 0;
  return {
    coords,
    distanceText: `${(totalMeters / 1000).toFixed(1)} km`,
    durationText: durationSec ? `${Math.round(durationSec / 60)} 分` : '-',
    totalDistanceMeters: totalMeters,
    totalDurationSec: durationSec,
    cumulativeDistances,
  };
}

// （電車関連のフォールバック処理は削除しました）

// ---------- ポリラインデコード ----------
function decodePolyline(encoded: string) {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

// ---------- ルート上の最近傍点インデックスを求める ----------
function findNearestRouteIndex(
  coords: { latitude: number; longitude: number }[],
  current: { latitude: number; longitude: number }
): number {
  if (!coords || coords.length === 0) return 0;
  let minD = Number.POSITIVE_INFINITY;
  let minIdx = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = getDistance(current, coords[i]);
    if (d < minD) {
      minD = d;
      minIdx = i;
    }
  }
  return minIdx;
}

// ---------- メインコンポーネント ----------
export default function MapScreen({ navigation }: { navigation?: any }) {
  const { user, token } = useAuth();
  const [region, setRegion] = useState<Region>({
    latitude: 35.681236,
    longitude: 139.767125,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [routeProgressIndex, setRouteProgressIndex] = useState<number | null>(null);
  const [remainingDistanceMeters, setRemainingDistanceMeters] = useState<number | null>(null);
  const [remainingDurationSec, setRemainingDurationSec] = useState<number | null>(null);
  const [deviceHeading, setDeviceHeading] = useState(0);
  const [showRecommendationScreen, setShowRecommendationScreen] = useState(false);
  const [showMyPage, setShowMyPage] = useState(false);
  const prevShowMyPageRef = useRef<boolean>(false);
  const [userPreferences, setUserPreferences] = useState<any>(null);
  const [recommendedSpots, setRecommendedSpots] = useState<Place[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [showRecommendedList, setShowRecommendedList] = useState(false);
  const [currentPrefecture, setCurrentPrefecture] = useState<string>('');
  const [localSpecialties, setLocalSpecialties] = useState<Place[]>([]);
  const [showLocalSpecialties, setShowLocalSpecialties] = useState(false);
  const [aiScores, setAiScores] = useState<SpotScore[]>([]);
  const [showAIRanking, setShowAIRanking] = useState(false);
  const [loadingAIRanking, setLoadingAIRanking] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>('WALK');
  const mapRef = useRef<MapView | null>(null);
  const navInterval = useRef<NodeJS.Timeout | null>(null);
  const locationWatcher = useRef<Location.LocationSubscription | null>(null);
  const passiveWatcher = useRef<Location.LocationSubscription | null>(null);
  const autoStartNavRef = useRef<boolean>(false);
  const lastMeRef = useRef<{ lat: number; lng: number } | null>(null);
  const prevMeRef = useRef<{ lat: number; lng: number } | null>(null);
  // コース方位の上書きは使用しない

  // 共通: placesを更新（必要なら選択もクリア）
  const applyPlacesWithUndo = (
    newPlaces: Place[],
    _label: string,
    opts: { clearSelection?: boolean } = {}
  ) => {
    const { clearSelection = true } = opts;
    setPlaces(newPlaces);
    if (clearSelection) setSelectedPlace(null);
  };

  // 共通: ルートと選択をクリア
  const clearRouteAndSelection = () => {
    setRoute(null);
    setSelectedPlace(null);
  };

  // 共通: ルート全体が収まるようにフィット
  const fitRoute = (coords?: { latitude: number; longitude: number }[]) => {
    if (!coords || !coords.length || !mapRef.current) return;
    try {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, bottom: 220, left: 40, right: 40 },
        animated: true,
      });
    } catch {}
  };

  // 選択中スポットの写真が未取得なら取得して反映
  useEffect(() => {
    const run = async () => {
      if (selectedPlace && !selectedPlace.photoUrl) {
        try {
          const url = await fetchPhotoUrlByPlaceId(selectedPlace.id);
          if (url) {
            setSelectedPlace((sp) => (sp && sp.id === selectedPlace.id) ? { ...sp, photoUrl: url } : sp);
            setPlaces((arr) => arr.map((p) => p.id === selectedPlace.id ? { ...p, photoUrl: url } : p));
          }
        } catch {}
      }
    };
    run();
  }, [selectedPlace]);

  // meが更新されたら最後の現在地を保存（描画フォールバック用）
  useEffect(() => {
    if (me && typeof me.lat === 'number' && typeof me.lng === 'number') {
      lastMeRef.current = { lat: me.lat, lng: me.lng };
    }
  }, [me]);

  // 表示用の補助関数
  const formatRating = (rating?: number, count?: number) => {
    if (!rating) return undefined;
    const r = Number(rating).toFixed(1);
    return count ? `⭐ ${r} (${count.toLocaleString()})` : `⭐ ${r}`;
  };
  const priceLevelToYen = (level?: string | number) => {
    // Maps Places API v1 の PriceLevel: PRICE_LEVEL_INEXPENSIVE/EXPENSIVE 等
    if (typeof level === 'number') {
      // 0〜4 を ¥〜¥¥¥¥ にマッピング（0は安価扱い）
      const map = ['¥', '¥', '¥¥', '¥¥¥', '¥¥¥¥'];
      return map[Math.max(0, Math.min(4, Math.floor(level)))] ?? undefined;
    } else {
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
  };

  // 速度のフォールバック（m/s）
  const getFallbackSpeed = (mode: TravelMode) => {
    switch (mode) {
      case 'BICYCLE':
        return 4.5; // 約16km/h
      case 'DRIVE':
        return 13.9; // 約50km/h
      case 'WALK':
      default:
        return 1.3; // 歩行
    }
  };

  // 時間表示をGoogleマップ風に整形（例: 1時間5分 / 8分 など）
  const formatDurationText = (sec?: number | null): string | undefined => {
    if (sec == null || !isFinite(sec)) return undefined;
    const totalMin = Math.max(1, Math.round(sec / 60));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`;
    return `${totalMin}分`;
  };

  // 到着予定時刻（例: 12:34）
  const formatArrivalTime = (sec?: number | null): string | undefined => {
    if (sec == null || !isFinite(sec)) return undefined;
    const eta = new Date(Date.now() + sec * 1000);
    const hh = String(eta.getHours()).padStart(2, '0');
    const mm = String(eta.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  // 一貫したナビ表示文字列を生成
  const buildNavInfo = (
    r: RouteInfo | null,
    nav: boolean,
    remainM: number | null,
    remainSec: number | null
  ): string => {
    if (!r) return '';
    if (nav) {
      const m = remainM ?? r.totalDistanceMeters;
      const s = remainSec ?? r.totalDurationSec;
      const km = (m / 1000).toFixed(1);
      const dur = formatDurationText(s) ?? r.durationText;
      const eta = formatArrivalTime(s);
      return `⏱ ${dur}（${km} km）${eta ? `・到着 ${eta}` : ''}`;
    } else {
      const km = (r.totalDistanceMeters / 1000).toFixed(1);
      const dur = formatDurationText(r.totalDurationSec) ?? r.durationText;
      return `⏱ ${dur}（${km} km）`;
    }
  };

  // 価格記号→内部価格帯 (AIスコア用) 変換
  const mapPriceToRange = (priceSymbol: string): string => {
    const priceMap: Record<string, string> = {
      '¥': '～1000円',
      '¥¥': '～2000円',
      '¥¥¥': '～3000円',
      '¥¥¥¥': '5000円～'
    };
    return priceMap[priceSymbol] || '～2000円';
  };

  // --- 方位センサー ---
  useEffect(() => {
    // 端末のHeadingが取得できる場合は優先（より安定）
    let headingSub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        headingSub = await Location.watchHeadingAsync((h) => {
          // trueHeading が利用可能ならそれを使用、なければ magHeading を採用
          const deg = typeof h.trueHeading === 'number' && !isNaN(h.trueHeading)
            ? h.trueHeading
            : (typeof h.magHeading === 'number' ? h.magHeading : deviceHeading);
          const normalized = ((deg % 360) + 360) % 360;
          setDeviceHeading(normalized);
        });
      } catch {
        // フォールバック：Magnetometer を使用
        const subscription = Magnetometer.addListener((data) => {
          const { x, y } = data;
          let angle = Math.atan2(y, x) * (180 / Math.PI);
          angle = (angle + 360) % 360;
          setDeviceHeading(angle);
        });
        Magnetometer.setUpdateInterval(300);
        headingSub = {
          remove: () => subscription.remove(),
        } as unknown as Location.LocationSubscription;
      }
    })();
    return () => {
      try { headingSub?.remove?.(); } catch {}
    };
  }, []);

  // --- 初回の現在地取得 ---
  useEffect(() => {
    (async () => {
      try {
        // WebではGeolocationのポリフィルを導入
        try { if (Platform.OS === 'web') Location.installWebGeolocationPolyfill?.(); } catch {}

        // 位置情報サービスが有効か確認
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
          setMsg('端末の位置情報サービスがオフです。設定で有効にしてください');
          return;
        }

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setMsg('位置情報の許可が必要です');
          return;
        }

        setMsg('📡 位置情報を取得中...');

        const quickLocation = await getLocationFast();


        if (quickLocation?.coords) {
          const { latitude, longitude } = quickLocation.coords;

          setMe({ lat: latitude, lng: longitude });
          setRegion({
            latitude,
            longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
          setMsg('🔵 現在地を取得しました');

          // 都道府県を取得
          try {
            const prefecture = await getPrefectureFromCoords(latitude, longitude);
            setCurrentPrefecture(prefecture);

          } catch (error) {
            console.error('都道府県取得失敗:', error);
          }
        } else {
          setMsg('⚠️ 位置情報の取得に失敗しました。周辺を測位中...');
        }

        // パッシブな位置情報ウォッチを開始（ナビ中は別ウォッチを使用）
        try {
          passiveWatcher.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              distanceInterval: 10,
              timeInterval: 5000,
            },
            (pos) => {
              const { latitude, longitude } = pos.coords || ({} as any);
              if (typeof latitude === 'number' && typeof longitude === 'number') {
                setMe({ lat: latitude, lng: longitude });
                setRegion((r) => ({
                  latitude,
                  longitude,
                  latitudeDelta: r?.latitudeDelta ?? 0.01,
                  longitudeDelta: r?.longitudeDelta ?? 0.01,
                }));
              }
            }
          );
        } catch {}
      } catch (err) {
        console.error('位置情報取得エラー:', err);
        setMsg('位置情報の取得に失敗しました');
      }
    })();
    return () => {
      try { passiveWatcher.current?.remove?.(); } catch {}
      passiveWatcher.current = null;
    };
  }, []);

  // --- ユーザー設定取得 ---
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

    }
  };

  // --- ユーザー設定を初期化時とユーザー変更時に取得 ---
  useEffect(() => {
    loadUserPreferences();
  }, [user, token]);

  // --- 検索 ---
  const handleSearch = async () => {
    if (!query.trim()) return;

    // 現在地が無い場合は再取得
    if (!me) {
      setMsg('📡 現在地を取得中...');
      try {
        const location = await getLocationFast();
        if (location?.coords) {
          const { latitude, longitude } = location.coords;
          setMe({ lat: latitude, lng: longitude });

        } else {
          setMsg('⚠️ 現在地の取得に失敗しました');
          return;
        }
      } catch (error) {
        setMsg('⚠️ 現在地の取得に失敗しました');
        return;
      }
    }

    try {
      const currentLocation = me || await (async () => {
        const location = await getLocationFast();
        if (location?.coords) {
          const { latitude, longitude } = location.coords;
          setMe({ lat: latitude, lng: longitude });
          return { lat: latitude, lng: longitude };
        }
        return null;
      })();

      if (!currentLocation) {
        setMsg('⚠️ 現在地の取得に失敗しました');
        return;
      }

      const results = await searchPlaces(query, currentLocation.lat, currentLocation.lng);
      // places を更新（undo 対応）
      applyPlacesWithUndo(results, '検索結果');
      setMsg('');
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  // --- 検索テキスト変更の監視 ---
  const handleQueryChange = (text: string) => {
    setQuery(text);

    // 検索テキストが空になったら経路とスポットをクリア
    if (!text.trim()) {
      // クリアは undo 可能にする
      applyPlacesWithUndo([], '検索クリア');
      setRoute(null);

      // 案内中だった場合は案内も停止
      if (navigating) {
        stopNavigation();
      }

      setMsg('');
    }
  };

  // --- ご当地グルメ検索（ランキング風一覧表示） ---
  const searchLocalSpecialties = async () => {
    if (!me || !currentPrefecture) {
      Alert.alert('位置情報が必要', '現在地を取得してからお試しください');
      return;
    }

    // 案内中なら一旦停止
    if (navigating) {
      stopNavigation();
      clearRouteAndSelection();
    }

    const specialties = LOCAL_SPECIALTIES[currentPrefecture];
    if (!specialties || specialties.length === 0) {
      Alert.alert('ご当地グルメ', `${currentPrefecture}のご当地グルメ情報がありません`);
      return;
    }

    setMsg(`🍽️ ${currentPrefecture}のご当地グルメを検索中...`);

    try {
      const allResults: Place[] = [];

      // 各ご当地グルメを検索
      for (const specialty of specialties.slice(0, 3)) { // 最初の3つだけ検索
        try {
          const results = await searchPlaces(`${specialty} ${currentPrefecture}`, me.lat, me.lng);
          allResults.push(...results.slice(0, 2)); // 各グルメから2件まで
        } catch (error) {

        }
      }

      if (allResults.length > 0) {
        // 重複を除去
        const uniqueResults = allResults.filter((place, index, self) =>
          index === self.findIndex(p => p.id === place.id)
        );

        // ランキング風に並べ替え（評価→件数）
        uniqueResults.sort((a, b) => {
          const ra = a.rating ?? 0;
          const rb = b.rating ?? 0;
          if (rb !== ra) return rb - ra;
          const ca = a.userRatingCount ?? 0;
          const cb = b.userRatingCount ?? 0;
          return cb - ca;
        });

        // 写真がないスポットは詳細から補完
        const enriched = await Promise.all(
          uniqueResults.map(async (pl) => {
            if (pl.photoUrl) return pl;
            const url = await fetchPhotoUrlByPlaceId(pl.id);
            return { ...pl, photoUrl: url } as Place;
          })
        );

        // 通常検索と同じ横スライド一覧で表示（下部リスト）
        applyPlacesWithUndo(enriched, 'ご当地グルメ');
        setShowLocalSpecialties(false);
        setMsg(`🍽️ ${currentPrefecture}のご当地グルメ ${enriched.length}件を表示中`);
      } else {
        setMsg(`${currentPrefecture}のご当地グルメが見つかりませんでした`);
      }
    } catch (error) {
      console.error('ご当地グルメ検索エラー:', error);
      Alert.alert('エラー', 'ご当地グルメの検索に失敗しました');
    }
  };

  // --- AIランキング計算 ---
  const calculateAIRanking = async () => {
    let currentLocation = me;

    // 位置情報がない場合は改めて取得を試行
    if (!currentLocation) {
      setMsg('📡 位置情報を取得中...');
      try {
        const quickLocation = await getLocationFast();
        if (quickLocation?.coords) {
          const { latitude, longitude } = quickLocation.coords;
          currentLocation = { lat: latitude, lng: longitude };
          setMe(currentLocation);
          setRegion({
            latitude,
            longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        }
      } catch (error) {
        console.error('位置情報取得エラー:', error);
      }
    }

    if (!currentLocation) {
      Alert.alert('位置情報が必要', '位置情報の取得に失敗しました。端末の位置情報設定を確認してください。');
      return;
    }

    try {
      setLoadingAIRanking(true);

      let targetPlaces = places;

      // placesが空の場合は自動的に周辺のレストランを検索
      if (places.length === 0) {
        setMsg('🔍 周辺のレストランを検索中...');
        try {
          const nearbyRestaurants = await searchPlaces('レストラン', currentLocation.lat, currentLocation.lng);
          if (nearbyRestaurants.length === 0) {
            // レストランが見つからない場合は飲食店で検索
            const nearbyFood = await searchPlaces('飲食店', currentLocation.lat, currentLocation.lng);
            targetPlaces = nearbyFood;
          } else {
            targetPlaces = nearbyRestaurants;
          }

          if (targetPlaces.length === 0) {
            Alert.alert('スポット不足', '周辺にレストランが見つかりませんでした。別の場所で試してください。');
            return;
          }

          // 検索結果をmapに表示（undo 対応）
          applyPlacesWithUndo(targetPlaces, '周辺検索', { clearSelection: false });
        } catch (searchError) {
          console.error('周辺レストラン検索エラー:', searchError);
          Alert.alert('エラー', '周辺のレストラン検索に失敗しました');
          return;
        }
      }

      setMsg('🤖 AIが総合スコアを計算中...');

      // AIスコアリング実行
      // ジャンル補完: favoriteGenres 先頭ジャンルの同義語で最低件数確保
      if (userPreferences?.favoriteGenres?.length) {
        const active = userPreferences.favoriteGenres[0];
        const synonyms = GENRE_SYNONYMS[active] || [active];
        const minNeeded = Number(process.env.EXPO_PUBLIC_GENRE_MIN ?? '3');
        const lowerSyns = synonyms.map(s => s.toLowerCase());
        const currentGenreCount = targetPlaces.filter(p => {
          const text = `${p.name || ''} ${(p.types || []).join(' ')}`.toLowerCase();
          return lowerSyns.some(s => text.includes(s));
        }).length;
        if (currentGenreCount < minNeeded) {
          const extra: any[] = [];
          for (const syn of synonyms.slice(0, 5)) {
            try {
              const r = await searchPlaces(syn, currentLocation.lat, currentLocation.lng);
              extra.push(...r);
            } catch { }
            if (extra.length + currentGenreCount >= minNeeded) break;
          }
          if (extra.length) {
            targetPlaces = [...targetPlaces, ...extra].filter((pl, idx, arr) => idx === arr.findIndex(x => x.id === pl.id));
          }
        }
      }

      const scores = await calculateAIScore(
        targetPlaces,
        currentLocation,
        currentPrefecture,
        process.env.EXPO_PUBLIC_DEBUG_SCORING === '1',
        { localStrict: false },
        {
          favoriteGenres: userPreferences?.favoriteGenres || [],
          budgetRange: mapPriceToRange(userPreferences?.priceRange || '¥¥'),
          allergies: userPreferences?.dietaryRestrictions || [],
          preferredDistance: userPreferences?.preferredDistance || 0
        } as any
      );
      const top10 = scores.slice(0, 10);
      setAiScores(top10);
      setShowAIRanking(true);
      setMsg(`🤖 AIランキング計算完了！ Top10を表示中 (${top10.length}件)`);
    } catch (error) {
      console.error('AIランキング計算エラー:', error);
      Alert.alert('エラー', 'AIランキングの計算に失敗しました');
      setMsg('');
    } finally {
      setLoadingAIRanking(false);
    }
  };

  // --- AIランキングからスポット選択 ---
  const handleAISpotSelect = (score: SpotScore) => {
    // 選択されたスポットをマップ中央に表示してルート計算
    drawRoute(score.place);
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: score.place.lat,
        longitude: score.place.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }
    // ランキングモーダルは閉じる（UI衝突回避）
    setShowAIRanking(false);
    setMsg(`📍 ${score.place.name} への経路を表示中`);
  };

  // --- 周辺のおすすめスポット取得 ---
  const loadRecommendedSpots = async () => {
    if (!me) {
      Alert.alert('位置情報が必要', '現在地を取得してからお試しください');
      return;
    }

    setLoadingRecommendations(true);
    try {


      // ユーザー設定に基づくパラメータを構築
      const params = new URLSearchParams({
        lat: me.lat.toString(),
        lng: me.lng.toString(),
        count: '15',
        radius: (userPreferences?.preferredDistance || 3000).toString()
      });

      if (userPreferences?.favoriteGenres?.length > 0) {
        params.append('genres', userPreferences.favoriteGenres.join(','));
      }

      if (userPreferences?.priceRange) {
        params.append('priceRange', userPreferences.priceRange);
      }

      if (userPreferences?.dietaryRestrictions?.length > 0) {
        params.append('dietary', userPreferences.dietaryRestrictions.join(','));
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await apiCall(`/api/recommend?${params.toString()}`, {
        method: 'GET',
        headers
      });

      const data = await response.json();

      if (data.success && data.spots) {
        const spots: Place[] = data.spots.map((spot: any) => ({
          id: spot.id,
          name: spot.name,
          lat: spot.lat,
          lng: spot.lng,
          address: spot.address,
          rating: spot.rating,
          priceRange: spot.priceRange,
          cuisineType: spot.cuisineType,
          reasons: spot.reasons
        }));

        setRecommendedSpots(spots);
        applyPlacesWithUndo(spots, 'おすすめ取得', { clearSelection: false });
        setShowRecommendedList(true); // リスト表示

        setMsg(`🎯 あなたの好みに基づく${spots.length}件のおすすめスポットを表示中`);
      } else {

        setMsg('周辺におすすめスポットが見つかりませんでした');
      }
    } catch (error) {
      console.error('❌ おすすめスポット取得エラー:', error);
      Alert.alert('エラー', 'おすすめスポットの取得に失敗しました');
    } finally {
      setLoadingRecommendations(false);
    }
  };

  // --- 経路描画 ---
  const drawRoute = async (p: Place): Promise<RouteInfo | null> => {
    try {
      // 現在地が未設定・古い可能性があるため、その場で取得を試行
      let origin = me;
      if (!origin) {
        const quick = await getLocationFast();
        if (quick?.coords) {
          origin = { lat: quick.coords.latitude, lng: quick.coords.longitude };
          setMe(origin);
          setRegion({
            latitude: origin.lat,
            longitude: origin.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        } else {
          throw new Error('現在地が取得できませんでした');
        }
      }
      setSelectedPlace(p);
      setPlaces([p]);
      const r = await computeRoute(origin, { lat: p.lat, lng: p.lng }, travelMode);
      setRoute(r);
      // ルート全体が収まるようにフィット
      fitRoute(r?.coords);
      setMsg(null);
      return r;
    } catch (e: any) {
      setMsg(`経路取得失敗: ${e.message}`);
      return null;
    }
  };

  // 移動手段変更時にルート再計算
  useEffect(() => {
    (async () => {
      if (!navigating && selectedPlace && me) {
        try {
          setMsg('🔄 ルート再計算中...');
          const r = await computeRoute(me, { lat: selectedPlace.lat, lng: selectedPlace.lng }, travelMode);
          setRoute(r);
          setMsg('');
        } catch (e: any) {
          setMsg(`経路再計算失敗: ${e.message}`);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelMode]);

  // --- 案内開始 ---
  const startNavigation = async () => {
    if (!route || !me) return;
    // 初期の現在地を即時反映して、描画の空白時間をなくす
    try {
      const initPos = await Location.getCurrentPositionAsync({});
      if (initPos?.coords) {
        setMe({ lat: initPos.coords.latitude, lng: initPos.coords.longitude });
      }
    } catch {}
    // ナビ中はパッシブウォッチを停止
    try { passiveWatcher.current?.remove?.(); } catch {}
    passiveWatcher.current = null;
    setNavigating(true);
    setMsg('🚶 案内を開始しました');
    // 初期進捗リセット
    setRouteProgressIndex(0);
    setRemainingDistanceMeters(route.totalDistanceMeters ?? null);
    setRemainingDurationSec(route.totalDurationSec ?? null);

    locationWatcher.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 2,
        timeInterval: 1000,
      },
      (pos) => {
        if (!pos?.coords) return;
        const { latitude, longitude } = pos.coords;

        // 現在地を確実に更新

        setMe({ lat: latitude, lng: longitude });

        // 進捗を更新
        try {
          if (route && route.cumulativeDistances?.length) {
            const idx = findNearestRouteIndex(route.coords, { latitude, longitude });
            setRouteProgressIndex(idx);
            const total = route.totalDistanceMeters || (route.cumulativeDistances[route.cumulativeDistances.length - 1] ?? 0);
            const covered = route.cumulativeDistances[idx] ?? 0;
            const remain = Math.max(0, total - covered);
            setRemainingDistanceMeters(remain);
            const avgSpeed = route.totalDurationSec && route.totalDistanceMeters
              ? (route.totalDistanceMeters / route.totalDurationSec)
              : getFallbackSpeed(travelMode); // m/s
            setRemainingDurationSec(Math.round(remain / avgSpeed));
          }
        } catch (e) {
          // ignore
        }

        if (mapRef.current) {
          mapRef.current.animateCamera({
            center: { latitude, longitude },
            heading: deviceHeading,
            zoom: 17,
          });
        }
      }
    );

    const dest = route.coords[route.coords.length - 1];
    navInterval.current = setInterval(async () => {
      const pos = await Location.getCurrentPositionAsync({});
      if (!pos?.coords) return;
      const distance = getDistance(
        { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        { latitude: dest.latitude, longitude: dest.longitude }
      );
      if (distance < 20) {
        stopNavigation();
        setMsg('🎉 目的地に到着しました');

        // 5秒後にメッセージを消す
        setTimeout(() => {
          setMsg('');
        }, 5000);
      } else {
        // ナビ中のETAは上部表示で統一的に描画するため、ここではmsgを更新しない
      }
    }, 4000);
  };

  // --- 案内終了 ---
  const stopNavigation = async () => {
    // 現在の位置を保存
    const currentMe = me;

    if (navInterval.current) clearInterval(navInterval.current);
    if (locationWatcher.current) {
      locationWatcher.current.remove();
      locationWatcher.current = null;
    }
    setNavigating(false);
    setRoute(null); // ルートをクリア
    setRouteProgressIndex(null);
    setRemainingDistanceMeters(null);
    setRemainingDurationSec(null);
    // 検索欄もクリア
    setQuery('');
    // スポットをクリア
    setPlaces([]);
    setSelectedPlace(null);

    // 現在地を確実に保持
    if (currentMe) {
      setMe(currentMe);

    }

    setMsg('🚫 案内を終了しました');

    // ナビ終了後にパッシブウォッチを再開
    try {
      passiveWatcher.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 10,
          timeInterval: 5000,
        },
        (pos) => {
          const { latitude, longitude } = pos.coords || ({} as any);
          if (typeof latitude === 'number' && typeof longitude === 'number') {
            setMe({ lat: latitude, lng: longitude });
            setRegion((r) => ({
              latitude,
              longitude,
              latitudeDelta: r?.latitudeDelta ?? 0.01,
              longitudeDelta: r?.longitudeDelta ?? 0.01,
            }));
          }
        }
      );
    } catch {}

    // 追加で現在地を再取得（バックアップ）
    setTimeout(async () => {
      try {
        const location = await getLocationFast();
        if (location?.coords) {
          const { latitude, longitude } = location.coords;
          setMe({ lat: latitude, lng: longitude });

        }
      } catch (error) {
        console.error('案内終了後の現在地取得エラー:', error);
        // エラーの場合は元の位置を維持
        if (currentMe) {
          setMe(currentMe);
        }
      }
    }, 100);

    // 3秒後にメッセージを消す
    setTimeout(() => {
      setMsg('');
    }, 3000);
  };


  // --- 推薦ボタンを押した時の処理 ---
  const handleRecommendationPress = () => {



    if (!me) {
      Alert.alert('位置情報が必要', '現在地を取得してから推薦機能をお使いください');
      return;
    }


    setShowRecommendationScreen(true);
  };

  // --- MyPageモーダルを閉じた直後にも openPlace を処理 ---
  const handleOpenPlaceFromStorage = async () => {
    try {
      const raw = await AsyncStorage.getItem('openPlace');
      if (!raw) return false;
      await AsyncStorage.removeItem('openPlace');
      const data = JSON.parse(raw);
      const openPlace: Place = {
        id: data.place_id || data.id || `${data.lat},${data.lng}`,
        name: data.place_name || data.name || '目的地',
        lat: Number(data.lat ?? data.latitude),
        lng: Number(data.lng ?? data.longitude),
        address: data.address,
        rating: data.rating,
        photoUrl: data.photo_url || data.photoUrl,
        priceLevel: data.priceLevel,
      };
      setPlaces([openPlace]);
      setSelectedPlace(openPlace);
      if (!me) {
        const loc = await getLocationFast();
        if (loc?.coords) {
          const { latitude, longitude } = loc.coords;
          setMe({ lat: latitude, lng: longitude });
          setRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 });
        }
      }
      const r = await drawRoute(openPlace);
      setMsg(`📍 ${openPlace.name} への経路を表示中`);
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: openPlace.lat,
          longitude: openPlace.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
        fitRoute(r?.coords);
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  useEffect(() => {
    // true -> false（モーダルを閉じた瞬間）だけ処理する
    if (prevShowMyPageRef.current && !showMyPage) {
      handleOpenPlaceFromStorage();
    }
    prevShowMyPageRef.current = showMyPage;
  }, [showMyPage]);

  // --- MyPageからの「地図で開く」連携 ---
  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;

      (async () => {
        try {
          const raw = await AsyncStorage.getItem('openPlace');
          if (!raw || !isActive) return;

          await AsyncStorage.removeItem('openPlace');
          const data = JSON.parse(raw);
          const openPlace: Place = {
            id: data.place_id || data.id || `${data.lat},${data.lng}`,
            name: data.place_name || data.name || '目的地',
            lat: Number(data.lat ?? data.latitude),
            lng: Number(data.lng ?? data.longitude),
            address: data.address,
            rating: data.rating,
            photoUrl: data.photo_url || data.photoUrl,
            priceLevel: data.priceLevel,
          };

          // マーカーを即座に表示し、選択状態にしておく
          setPlaces([openPlace]);
          setSelectedPlace(openPlace);

          // 現在地が未取得ならここで quietly 取得
          if (!me) {
            const loc = await getLocationFast();
            if (loc?.coords) {
              const { latitude, longitude } = loc.coords;
              if (!isActive) return;
              setMe({ lat: latitude, lng: longitude });
              setRegion({
                latitude,
                longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              });
            }
          }

          // 経路だけ表示（ナビ自動開始はしない）
          const routeInfo = await drawRoute(openPlace);
          if (!isActive) return;

          setMsg(`📍 ${openPlace.name} への経路を表示中`);

          if (mapRef.current && isFinite(openPlace.lat) && isFinite(openPlace.lng)) {
            mapRef.current.animateToRegion({
              latitude: openPlace.lat,
              longitude: openPlace.lng,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            });
            // ルートのポリライン全体が収まるようにフィット
            fitRoute(routeInfo?.coords);
          }
        } catch (e) {
          // 失敗しても画面クラッシュしないように
          console.log('openPlace 読み出しエラー', e);
        }
      })();

      // アンフォーカス時のクリーンアップ
      return () => {
        isActive = false;
      };
    }, []) // ★ここを [] にする！
  );


  // --- 推薦Screenでスポットが選ばれた時の処理 ---
  const handleRecommendationSpotPress = (spot: SpotData) => {


    // 推薦Screenを閉じる
    setShowRecommendationScreen(false);

    // スポットをPlaceに変換
    const newPlace: Place = {
      id: spot.id,
      name: spot.name,
      lat: spot.lat,
      lng: spot.lng,
      address: spot.address || '',
      rating: spot.rating
    };

    // 推薦からスポットを選択して表示
    applyPlacesWithUndo([newPlace], '推薦で選択');

    // 地図の中心を移動
    setRegion({
      latitude: spot.lat,
      longitude: spot.lng,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });

    // 経路を描画
    drawRoute(newPlace);
  };

  // Undo機能は削除

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={{ flex: 1 }}>
        {/** 下部リストの可視状態（FABの位置調整に利用） */}
        {/** listVisible: 検索リストが表示されている時のみ true */}
        {/** ナビ中やご当地モーダル表示中は false */}
        {/** places にアイテムがある時のみ true */}
        {/** この値でFABのbottomを可変にして重なりを回避 */}
        {(() => null)()}
        {/* 検索バー */}
        <View style={styles.searchBar}>
          <TextInput
            style={styles.input}
            placeholder="例：カフェ 京都駅"
            value={query}
            onChangeText={handleQueryChange}
            onSubmitEditing={handleSearch}
          />
          {query.trim() && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => handleQueryChange('')}
            >
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.btn} onPress={handleSearch}>
            <Text style={styles.btnText}>検索</Text>
          </TouchableOpacity>
        </View>

        {/* 旧: 右側縦スタックFABを廃止し、下部パネル内に横並びへ移動 */}

        {/* 上部の時間/距離表示は非表示にする。通常メッセージのみ（非ナビ時）表示 */}
        {!navigating && msg && <Text style={styles.msg}>{msg}</Text>}



        {/* 推薦Screen */}
        <Modal
          visible={showRecommendationScreen}
          animationType="slide"
          presentationStyle="fullScreen"
        >
          <RecommendationScreen
            initialLocation={me}
            onClose={() => setShowRecommendationScreen(false)}
            onSpotPress={handleRecommendationSpotPress}
            userPreferences={userPreferences}
            token={token}
          />
        </Modal>

        {/* マイページモーダル */}
        <Modal
          visible={showMyPage}
          animationType="slide"
          presentationStyle="fullScreen"
        >
          <MyPageScreen
            onClose={() => setShowMyPage(false)}
          />
        </Modal>

        {/* おすすめスポットリストモーダル */}
        <Modal
          visible={showRecommendedList}
          animationType="slide"
          presentationStyle="pageSheet"
        >
          <View style={styles.recommendedListContainer}>
            <View style={styles.recommendedListHeader}>
              <Text style={styles.recommendedListTitle}>
                🎯 あなたへのおすすめスポット ({recommendedSpots.length}件)
              </Text>
              <TouchableOpacity
                onPress={() => setShowRecommendedList(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={recommendedSpots}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.recommendedSpotItem}
                  onPress={() => {
                    setShowRecommendedList(false);
                    drawRoute(item);
                    // マップの中心をそのスポットに移動
                    if (mapRef.current) {
                      mapRef.current.animateToRegion({
                        latitude: item.lat,
                        longitude: item.lng,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                      });
                    }
                  }}
                >
                  {item.photoUrl && (
                    <View style={{ marginBottom: 10 }}>
                      <Image source={{ uri: item.photoUrl }} style={styles.placeImage} />
                    </View>
                  )}
                  <View style={styles.spotHeader}>
                    <Text style={styles.spotName}>{item.name}</Text>
                    {item.rating && (
                      <View style={styles.ratingContainer}>
                        <Text style={styles.ratingText}>{formatRating(item.rating, item.userRatingCount)}</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.spotAddress}>{item.address}</Text>

                  <View style={styles.spotDetails}>
                    {item.cuisineType && (
                      <Text style={styles.cuisineType}>{item.cuisineType}</Text>
                    )}
                    {priceLevelToYen(item.priceLevel) && (
                      <Text style={styles.priceRange}>{priceLevelToYen(item.priceLevel)}</Text>
                    )}
                  </View>

                  {item.reasons && (
                    <View style={styles.reasonsContainer}>
                      {item.reasons.slice(0, 2).map((reason: string, index: number) => (
                        <Text key={index} style={styles.reasonText}>• {reason}</Text>
                      ))}
                    </View>
                  )}
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.recommendedListContent}
            />
          </View>
        </Modal>

        {/* ご当地グルメリストモーダル */}
        <Modal
          visible={showLocalSpecialties}
          animationType="slide"
          presentationStyle="fullScreen"
        >
          <View style={styles.recommendedListContainer}>
            <View style={styles.recommendedListHeader}>
              <Text style={styles.recommendedListTitle}>
                🍽️ {currentPrefecture}のご当地グルメ ({localSpecialties.length}件)
              </Text>
              <TouchableOpacity
                onPress={() => setShowLocalSpecialties(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.specialtyInfo}>
              <Text style={styles.specialtyInfoText}>
                {currentPrefecture}の代表的なご当地グルメ: {LOCAL_SPECIALTIES[currentPrefecture]?.slice(0, 5).join('、')}
              </Text>
            </View>

            <FlatList
              data={localSpecialties}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={styles.recommendedSpotItem}
                  onPress={() => {
                    setShowLocalSpecialties(false);
                    drawRoute(item);
                    if (mapRef.current) {
                      mapRef.current.animateToRegion({
                        latitude: item.lat,
                        longitude: item.lng,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                      });
                    }
                  }}
                >
                  {/* ランクバッジ */}
                  <View style={styles.rankRow}>
                    <Text style={[styles.rankBadge, index === 0 && styles.rank1, index === 1 && styles.rank2, index === 2 && styles.rank3]}>
                      {index + 1}
                    </Text>
                  </View>
                  {item.photoUrl && (
                    <View style={{ marginBottom: 10 }}>
                      <Image source={{ uri: item.photoUrl }} style={styles.placeImage} />
                    </View>
                  )}
                  <View style={styles.spotHeader}>
                    <Text style={styles.spotName}>{item.name}</Text>
                    {item.rating && (
                      <View style={styles.ratingContainer}>
                        <Text style={styles.ratingText}>{formatRating(item.rating, item.userRatingCount)}</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.spotAddress}>{item.address}</Text>

                  <View style={styles.spotDetails}>
                    {item.cuisineType && (
                      <Text style={styles.cuisineType}>{item.cuisineType}</Text>
                    )}
                    {priceLevelToYen(item.priceLevel) && (
                      <Text style={styles.priceRange}>{priceLevelToYen(item.priceLevel)}</Text>
                    )}
                    {me && (
                      <Text style={styles.distanceChip}>
                        {(() => {
                          try {
                            const d = getDistance(
                              { latitude: me.lat, longitude: me.lng },
                              { latitude: item.lat, longitude: item.lng }
                            );
                            return `${(d / 1000).toFixed(1)}km`;
                          } catch { return ''; }
                        })()}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.recommendedListContent}
            />
          </View>
        </Modal>

        {/* AIランキングモーダル */}
        <AIRankingModal
          visible={showAIRanking}
          onClose={() => setShowAIRanking(false)}
          scores={aiScores}
          onSelectSpot={handleAISpotSelect}
        />

        {/* 地図（標準デザイン） */}
        <MapView
          key="map"
          ref={mapRef}
          style={{ flex: 1 }}
          provider={PROVIDER_GOOGLE}
          region={region}
          showsUserLocation={true}
        >
          {places.map((p) => (
            <Marker
              key={p.id}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              title={p.name}
              description={p.address}
              onPress={() => drawRoute(p)}
            />
          ))}

          {route && routeProgressIndex != null ? (
            <Polyline
              coordinates={route.coords.slice(Math.max(0, routeProgressIndex))}
              strokeWidth={6}
              strokeColor="#007AFF" // これから: ブルー（通過部分は非表示）
            />
          ) : (
            route && <Polyline coordinates={route.coords} strokeWidth={5} strokeColor="#007AFF" />
          )}

          {/* 現在地カスタムマーカーは非表示化（デフォルトのshowsUserLocationのみ使用） */}
        </MapView>

        {/* 右下縦並びアイコン群（店舗表示・経路案内中は非表示） */}
        {(!selectedPlace && !route && !navigating && !showAIRanking && places.length === 0) && (
          <View style={styles.floatingControls} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.fab, { backgroundColor: '#007AFF' }]}
              onPress={async () => {
                setMsg('📡 位置情報を更新中...');
                const location = await getLocationFast();
                if (location?.coords) {
                  const { latitude, longitude } = location.coords;
                  setMe({ lat: latitude, lng: longitude });
                  setRegion({
                    latitude,
                    longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  });
                  try {
                    const prefecture = await getPrefectureFromCoords(latitude, longitude);
                    setCurrentPrefecture(prefecture);
                    setMsg(`🔵 更新しました (${prefecture})`);
                  } catch {
                    setMsg('🔵 位置は更新されました');
                  }
                } else setMsg('⚠️ 更新に失敗しました');
              }}
            >
              <Text style={styles.fabIcon}>🔵</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.fab, { backgroundColor: '#FF6B35' }]}
              onPress={() => navigation?.navigate?.('RecommendationRanking', {
                currentLocation: me,
                onPlacesUpdate: setPlaces,
              })}
              disabled={!me}
            >
              <Text style={styles.fabIcon}>🤖</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.fab, { backgroundColor: '#6C5CE7' }]}
              onPress={() => setShowMyPage(true)}
            >
              <Text style={styles.fabIcon}>⚙️</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 下部パネル */}
        <View style={styles.bottom}>
          {route && (
            <>
              {/* 走行モード切替（案内前のみ表示） */}
              {!navigating && (
                <View style={styles.modeBar}>
                  {([
                    { key: 'WALK', label: '徒歩', emoji: MODE_EMOJI.WALK },
                    { key: 'BICYCLE', label: '自転車', emoji: MODE_EMOJI.BICYCLE },
                    { key: 'DRIVE', label: '車', emoji: MODE_EMOJI.DRIVE },
                  ] as { key: TravelMode; label: string; emoji: string }[]).map(({ key, label, emoji }) => (
                    <TouchableOpacity
                      key={key}
                      style={[styles.modeBtn, travelMode === key && styles.modeBtnActive]}
                      onPress={() => setTravelMode(key)}
                    >
                      <View style={styles.modeBtnRow}>
                        <Text style={[styles.modeEmoji, travelMode === key && styles.modeEmojiActive]}>{emoji}</Text>
                        <Text style={[styles.modeBtnText, travelMode === key && styles.modeBtnTextActive]}>{label}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* 目的地の写真カード（ナビ中に店舗がわかるように表示） */}
              {selectedPlace && (
                <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
                  {selectedPlace.photoUrl && (
                    <Image source={{ uri: selectedPlace.photoUrl }} style={styles.navPlaceImage} />
                  )}
                  <Text style={styles.navPlaceName} numberOfLines={1} allowFontScaling={false}>{selectedPlace.name}</Text>
                  {selectedPlace.address && (
                    <Text style={styles.navPlaceAddr} numberOfLines={1} allowFontScaling={false}>{selectedPlace.address}</Text>
                  )}
                </View>
              )}

              <View style={styles.routeInfoRow}>
                <Text style={styles.routeEmoji}>{MODE_EMOJI[travelMode]}</Text>
                <Text style={styles.routeText}>
                  {buildNavInfo(route, navigating, remainingDistanceMeters, remainingDurationSec)}
                </Text>
              </View>
              <View style={styles.navBtns}>
                {!navigating ? (
                  <TouchableOpacity style={[styles.navBtn, { backgroundColor: '#007AFF' }]} onPress={startNavigation}>
                    <Text style={styles.navBtnText}>案内開始</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.navBtn, { backgroundColor: '#FF3B30' }]}
                    onPress={() => {

                      stopNavigation();
                    }}
                  >
                    <Text style={styles.navBtnText}>案内終了</Text>
                  </TouchableOpacity>
                )}
                {/* Googleマップ連携は非表示 */}
              </View>
            </>
          )}
          {!showLocalSpecialties && !navigating && !route && places.length > 0 && (
            <View style={styles.bottomListContainer}>
              <FlatList
                horizontal
                data={places}
                keyExtractor={(i) => i.id}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.card} onPress={() => drawRoute(item)}>
                    {item.photoUrl && (
                      <Image source={{ uri: item.photoUrl }} style={styles.placeImageSmall} />
                    )}
                    <Text style={styles.name} numberOfLines={1} allowFontScaling={false}>{item.name}</Text>
                    {item.address && <Text style={styles.addr} numberOfLines={1} allowFontScaling={false}>{item.address}</Text>}
                    {item.rating && <Text style={styles.cardRating} allowFontScaling={false}>{formatRating(item.rating, item.userRatingCount)}</Text>}
                    <View style={styles.saveRow}>
                      <TouchableOpacity
                        style={[styles.saveBtn, { backgroundColor: '#ff4d4f' }]}
                        onPress={async () => {
                          await addFavorite({
                            id: item.id,
                            name: item.name,
                            lat: item.lat,
                            lng: item.lng,
                            address: item.address,
                            rating: item.rating,
                            photoUrl: item.photoUrl,
                            priceLevel: item.priceLevel,
                          }, token || undefined);
                          setMsg('❤️ お気に入りに保存しました');
                          setTimeout(() => setMsg(''), 2000);
                        }}
                      >
                        <Text style={styles.saveIcon}>❤️</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                )}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recommendedListContent}
              />
            </View>
          )}
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

// ---------- スタイル ----------
const styles = StyleSheet.create({
  searchBar: {
    position: 'absolute', top: 50, left: 10, right: 10, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 8, minHeight: 50,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
  },
  input: { flex: 1, fontSize: 17, paddingHorizontal: 10, paddingVertical: 8 },
  clearBtn: { padding: 8, justifyContent: 'center' },
  clearBtnText: { color: '#666', fontSize: 17 },
  btn: { backgroundColor: '#007AFF', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  msg: { position: 'absolute', top: 100, left: 12, right: 12, backgroundColor: '#e8f4ff', padding: 12, borderRadius: 10, zIndex: 10, textAlign: 'center', color: '#0066cc', fontSize: 20, fontWeight: '700' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.95)', paddingVertical: 12 },
  modeBar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 8 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#eef2f7' },
  modeBtnActive: { backgroundColor: '#007AFF22', borderWidth: 1, borderColor: '#007AFF' },
  modeBtnText: { color: '#41546b', fontWeight: '600' },
  modeBtnTextActive: { color: '#007AFF' },
  modeBtnRow: { flexDirection: 'row', alignItems: 'center' },
  routeInfoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  modeEmoji: { marginRight: 6, fontSize: 14 },
  modeEmojiActive: { marginRight: 6, fontSize: 14 },
  routeEmoji: { marginRight: 6, fontSize: 18 },
  bottomListContainer: { height: BOTTOM_LIST_HEIGHT },
  routeText: { textAlign: 'center', fontWeight: '700', marginBottom: 12, fontSize: 22, color: '#1a1a1a' },
  navBtns: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8 },
  navBtn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 40 },
  navBtnText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
  card: { width: CARD_WIDTH, marginHorizontal: 10, padding: 12, paddingBottom: 14, backgroundColor: '#fff', borderRadius: 10, elevation: 3, overflow: 'hidden' },
  name: { fontWeight: '700', fontSize: 16 },
  addr: { color: '#555', marginTop: 2, fontSize: 14 },
  // ナビ用 目的地カード
  navPlaceImage: { width: '100%', height: 140, borderRadius: 10, backgroundColor: '#eee', marginBottom: 6 },
  navPlaceName: { fontWeight: '800', fontSize: 18, color: '#1a1a1a' },
  navPlaceAddr: { color: '#6c757d', marginTop: 2, fontSize: 13 },
  placeImage: { width: '100%', height: 140, borderRadius: 8, backgroundColor: '#eee' },
  placeImageSmall: { width: '100%', height: Math.max(70, IMAGE_HEIGHT - 24), borderRadius: 10, backgroundColor: '#eee', marginBottom: 6 },
  cardRating: { marginTop: 2, color: '#1a1a1a' },
  saveRow: { flexDirection: 'row', alignSelf: 'flex-end', gap: 6, marginTop: 6, marginBottom: 2 },
  saveBtn: { width: 28, height: 28, borderRadius: 7, justifyContent: 'center', alignItems: 'center' },
  saveIcon: { color: '#fff', fontSize: 13, fontWeight: '700' },
  // 旧: 単独の現在地ボタンは非使用（fab群に統合）
  // 浮遊ボタンコンテナ
  floatingControls: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    zIndex: 5,
    alignItems: 'center',
    justifyContent: 'center',
    // pointerEventsはJSXで設定
  },
  // 共通FABスタイル
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  fabIcon: { fontSize: 22, color: 'white' },
  localSpecialtyLabel: {
    fontSize: 22, color: 'white', fontWeight: '600', marginTop: 0
  },
  modalContainer: { flex: 1, backgroundColor: '#fff' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e9ecef',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a' },
  closeBtn: { padding: 8 },
  closeBtnText: { fontSize: 18, color: '#6c757d' },
  // Undoバーは非使用

  // おすすめスポットリスト用スタイル
  recommendedListContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  recommendedListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    backgroundColor: '#f8f9fa',
  },
  recommendedListTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    flex: 1,
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#e9ecef',
  },
  closeButtonText: {
    fontSize: 16,
    color: '#6c757d',
    fontWeight: '600',
  },
  recommendedListContent: {
    padding: 16,
  },
  recommendedSpotItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  spotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  spotName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    flex: 1,
  },
  ratingContainer: {
    backgroundColor: '#fff3cd',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  ratingText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '600',
  },
  // ランキング用
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontWeight: '800',
    color: '#343a40',
    backgroundColor: '#f1f3f5',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  // 上位3件は背景は共通のまま、枠線だけアクセントにして視認性と落ち着きを両立
  rank1: { borderColor: '#4C9AFF' },
  rank2: { borderColor: '#7AA2E3' },
  rank3: { borderColor: '#A7C0F2' },
  spotAddress: {
    fontSize: 14,
    color: '#6c757d',
    marginBottom: 8,
  },
  spotDetails: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  distanceChip: {
    backgroundColor: '#eef2f7',
    color: '#41546b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  cuisineType: {
    backgroundColor: '#e7f3ff',
    color: '#0066cc',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  priceRange: {
    backgroundColor: '#d4edda',
    color: '#155724',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  reasonsContainer: {
    marginTop: 8,
  },
  reasonText: {
    fontSize: 12,
    color: '#6c757d',
    marginBottom: 2,
    lineHeight: 16,
  },
  specialtyInfo: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    marginHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  specialtyInfoText: {
    fontSize: 14,
    color: '#6c757d',
    textAlign: 'center',
    lineHeight: 20,
  },
  // 下部アクションバーは非使用
});
