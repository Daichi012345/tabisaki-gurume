// カテゴリ別の雰囲気画像（UnsplashのSourceエンドポイントを使用）
// 著名タグでなるべく店舗の“感じ”が伝わる写真を取得
const getCategoryFallbackImage = (place: { name: string; address?: string; }): string => {
  const text = `${place.name} ${place.address || ''}`;
  const entries: Array<{ match: RegExp; query: string }> = [
  { match: /(ラーメン|ramen)/i, query: 'ramen,restaurant' },
  { match: /(寿司|鮨|sushi)/i, query: 'sushi,restaurant' },
  { match: /(焼肉|yakiniku|bbq)/i, query: 'barbecue,grill,restaurant' },
  { match: /(カレー|curry)/i, query: 'curry,restaurant' },
  { match: /(うどん|そば|蕎麦|udon|soba|noodle)/i, query: 'noodles,restaurant' },
  { match: /(天ぷら|天婦羅|tempura)/i, query: 'tempura,restaurant' },
  { match: /(居酒屋|izakaya)/i, query: 'izakaya,japanese,bar' },
  { match: /(和食|japanese)/i, query: 'japanese,restaurant' },
  { match: /(イタリアン|イタリア料理|italian|pizza|pasta)/i, query: 'italian,restaurant' },
  { match: /(フレンチ|フランス料理|french)/i, query: 'french,restaurant' },
  { match: /(中華|中国料理|chinese|餃子)/i, query: 'chinese,restaurant' },
  { match: /(焼鳥|焼き鳥|yakitori)/i, query: 'yakitori,grill,restaurant' },
  { match: /(カフェ|cafe|coffee)/i, query: 'cafe,coffee' },
  { match: /(バー|bar|pub)/i, query: 'bar,pub' },
  ];
  for (const e of entries) {
  if (e.match.test(text)) {
  return `https://source.unsplash.com/600x400/?${encodeURIComponent(e.query)}`;
    }
  }
  // 総合的な外観/内装の写真を狙う
  return 'https://source.unsplash.com/600x400/?restaurant,interior';
};

// プレースホルダーはURLでは返さず、UIで表示を切り替える（空文字）
const getPlaceholderImage = (): string => '';
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, Image } from 'react-native';
import { SpotScore } from '../utils/aiScoring';
import { ensureGoogleApiKey } from '../utils/config';

const GOOGLE_API_KEY = ensureGoogleApiKey();

// v1 Places Details API で photos を取得して最適な写真URLを返す
const fetchV1PhotoUrlByPlaceId = async (placeId: string): Promise<string | null> => {
  if (!GOOGLE_API_KEY) return null;
  try {
    // placeId が 'places/xxxx' 形式ならプレフィックスを除去
    const bareId = placeId.startsWith('places/') ? placeId.replace(/^places\//, '') : placeId;
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(bareId)}?languageCode=ja`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'photos',
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('Places Details photos error', res.status, txt);
      return null;
    }
    const data = await res.json();
    const photo = data?.photos?.[0];
    if (photo?.name) {
      // media エンドポイントで実画像URLにリダイレクト
      const mediaUrl = `https://places.googleapis.com/v1/${encodeURIComponent(photo.name)}/media?maxWidthPx=400&key=${GOOGLE_API_KEY}`;
      return mediaUrl;
    }
  } catch (e) {
    console.warn('v1 Place Details Photo 取得失敗:', e);
  }
  return null;
};

// v1 searchText で、名前+位置から正しい Place を引き当てる
const resolvePlaceIdByNameAndLocation = async (
  name: string,
  lat?: number,
  lng?: number,
  address?: string
): Promise<string | null> => {
  if (!GOOGLE_API_KEY) return null;
  try {
    // 検索クエリは店名 + 住所(任意)
    const textQuery = address ? `${name} ${address}` : name;
    const body: any = {
      textQuery,
      maxResultCount: 5,
      languageCode: 'ja',
    };
    if (typeof lat === 'number' && typeof lng === 'number') {
      body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 800 } };
    }
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.name,places.displayName,places.location',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('places:searchText error', res.status, txt);
      return null;
    }
    const json = await res.json();
  const candidates: any[] = json?.places || [];
    if (candidates.length === 0) return null;

    // 最も近い候補を採用（名前の近似も軽く見る）
    const normalized = (s: string) => s?.toLowerCase().replace(/\s/g, '') || '';
    const target = normalized(name);
    let bestId: string | null = null;
    let bestScore = -Infinity;
    candidates.forEach((c) => {
      const cid = (c.name && typeof c.name === 'string' && c.name.startsWith('places/')) ? (c.name as string).replace(/^places\//, '') : (c.id as string);
      const cname = c.displayName?.text || '';
      const clat = c.location?.latitude;
      const clng = c.location?.longitude;
      let score = 0;
      if (normalized(cname) === target) score += 2;
      else if (normalized(cname).includes(target) || target.includes(normalized(cname))) score += 1;
      if (typeof lat === 'number' && typeof lng === 'number' && typeof clat === 'number' && typeof clng === 'number') {
        const d = Math.hypot((clat - lat) * 111000, (clng - lng) * 111000); // 約m換算
        // 近いほど加点（~0mで+3、150mで+0）
        score += Math.max(0, 3 - d / 50);
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = cid;
      }
    });
    return bestId;
  } catch (e) {
    console.warn('v1 searchText による placeId 解決失敗:', e);
    return null;
  }
};

// 最良の写真URLを決める（v1 by id -> v1 resolve id -> カテゴリ雰囲気写真 -> Static Map -> 画像なし）
const getBestPhotoUrl = async (
  place: { id: string; name: string; address?: string; lat?: number; lng?: number }
): Promise<string> => {
  // v1 API: placeId から直接 photo 取得
  const v1 = await fetchV1PhotoUrlByPlaceId(place.id);
  if (v1) {
    // console.log('photo source: details by id', place.id);
    return v1;
  }

  // フォールバック: v1のsearchTextで正しいPlaceを特定し、そのidで再取得
  const resolvedId = await resolvePlaceIdByNameAndLocation(place.name, place.lat, place.lng, place.address);
  if (resolvedId) {
    const v1b = await fetchV1PhotoUrlByPlaceId(resolvedId);
    if (v1b) {
      // console.log('photo source: details by resolved id', resolvedId, 'from', place.name);
      return v1b;
    }
  }

  // さらにフォールバック: カテゴリベースの雰囲気写真
  const vibe = getCategoryFallbackImage({ name: place.name, address: place.address });
  if (vibe) return vibe;

  // さらにフォールバック: Static Map
  if (GOOGLE_API_KEY) {
    if (typeof place.lat === 'number' && typeof place.lng === 'number') {
      // console.log('photo source: static map by coords', place.lat, place.lng);
      return `https://maps.googleapis.com/maps/api/staticmap?center=${place.lat},${place.lng}&zoom=17&size=300x200&maptype=roadmap&markers=color:red%7C${place.lat},${place.lng}&key=${GOOGLE_API_KEY}`;
    }
    // console.log('photo source: static map by name', place.name);
    return getSimplePhotoUrl(place.name);
  }

  // 最終: 空（UI側で「画像なし」を表示）
  return '';
};

// シンプルな写真URL生成（Static Maps API使用）
const getSimplePhotoUrl = (placeName: string): string => {
  if (!GOOGLE_API_KEY) {
    return getPlaceholderImage();
  }
  
  return `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(placeName)}&zoom=17&size=300x200&maptype=roadmap&markers=color:red%7C${encodeURIComponent(placeName)}&key=${GOOGLE_API_KEY}`;
};

resolvePlaceIdByNameAndLocation// （重複定義削除）

interface AIRankingModalProps {
  visible: boolean;
  onClose: () => void;
  scores: SpotScore[];
  onSelectSpot: (score: SpotScore) => void;
  title?: string;
  description?: string;
  reasoningTitle?: string;
}

const AIRankingModal: React.FC<AIRankingModalProps> = ({
  visible,
  onClose,
  scores,
  onSelectSpot,
  title,
  description,
  reasoningTitle,
}) => {
  const [photoUrls, setPhotoUrls] = useState<{[key: string]: string}>({});
  
  // 写真URLを取得してキャッシュ
  useEffect(() => {
    const loadPhotos = async () => {
      const newPhotoUrls: {[key: string]: string} = {};
      
      for (const score of scores) {
        const cacheKey = score.place.id;
        if (!photoUrls[cacheKey]) {
          try {
            // v1 -> 旧API -> StaticMap の順で最適な写真URLを取得
            const photoUrl = await getBestPhotoUrl({
              id: score.place.id,
              name: score.place.name,
              address: score.place.address,
              lat: (score.place as any).lat,
              lng: (score.place as any).lng,
            });
            if (photoUrl) newPhotoUrls[cacheKey] = photoUrl;
          } catch (error) {
            // エラー時はプレースホルダーを使用
            // 何もしない（UIで「画像なし」表示）
          }
        }
      }
      
      if (Object.keys(newPhotoUrls).length > 0) {
        setPhotoUrls(prev => ({ ...prev, ...newPhotoUrls }));
      }
    };
    
    if (visible && scores.length > 0) {
      loadPhotos();
    }
  }, [visible, scores]);
  
  const getRankIcon = (index: number): string => {
    switch (index) {
      case 0: return '🥇';
      case 1: return '🥈';
      case 2: return '🥉';
      default: return `${index + 1}位`;
    }
  };
  
  const getScoreColor = (score: number): string => {
    if (score >= 8) return '#4CAF50'; // 緑
    if (score >= 6) return '#FF9800'; // オレンジ
    return '#F44336'; // 赤
  };
  
  const renderScoreBar = (label: string, score: number, color: string) => (
    <View style={styles.scoreBar}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <View style={styles.scoreBarContainer}>
        <View 
          style={[
            styles.scoreBarFill, 
            { width: `${score * 10}%`, backgroundColor: color }
          ]} 
        />
        <Text style={styles.scoreValue}>{score.toFixed(1)}</Text>
      </View>
    </View>
  );
  
  const renderSpotItem = ({ item, index }: { item: SpotScore; index: number }) => (
    <TouchableOpacity 
      style={styles.spotItem}
      onPress={() => {
        onSelectSpot(item);
        onClose();
      }}
    >
      {/* ランキングとスコア */}
      <View style={styles.spotHeader}>
        <View style={styles.rankContainer}>
          <Text style={styles.rankIcon}>{getRankIcon(index)}</Text>
        </View>
        
        {/* お店の写真 */}
        <View style={styles.photoContainer}>
          {photoUrls[item.place.id] ? (
            <Image 
              source={{ uri: photoUrls[item.place.id] }}
              style={styles.spotPhoto}
              resizeMode="cover"
              onError={() => {
                // 読み込み失敗時は雰囲気画像→StaticMapの順で再設定
                const vibeUrl = getCategoryFallbackImage({ name: item.place.name, address: item.place.address });
                if (vibeUrl) {
                  setPhotoUrls(prev => ({ ...prev, [item.place.id]: vibeUrl }));
                } else if (typeof (item.place as any).lat === 'number' && typeof (item.place as any).lng === 'number' && GOOGLE_API_KEY) {
                  const { lat, lng } = (item.place as any);
                  const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=300x200&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${GOOGLE_API_KEY}`;
                  setPhotoUrls(prev => ({ ...prev, [item.place.id]: mapUrl }));
                } else {
                  // 最終的に削除して「画像なし」表示へ
                  setPhotoUrls(prev => {
                    const next = { ...prev };
                    delete next[item.place.id];
                    return next;
                  });
                }
              }}
            />
          ) : (
            <View style={[styles.spotPhoto, styles.noPhoto]}>
              <Text style={styles.noPhotoText}>📷 画像なし</Text>
            </View>
          )}
        </View>
        
        <View style={styles.spotInfo}>
          <Text style={styles.spotName} numberOfLines={2}>{item.place.name}</Text>
          <Text style={styles.spotAddress} numberOfLines={1}>{item.place.address}</Text>
        </View>
        <View style={styles.totalScoreContainer}>
          <Text style={[styles.totalScore, { color: getScoreColor(item.totalScore) }]}>
            {item.totalScore.toFixed(1)}
          </Text>
          <Text style={styles.totalScoreLabel}>総合</Text>
        </View>
      </View>
      
      {/* 詳細スコア */}
      <View style={styles.detailScores}>
        {renderScoreBar('距離', item.distanceScore, '#2196F3')}
        {renderScoreBar('評価', item.ratingScore, '#FFD700')}
        {renderScoreBar('価格', item.priceScore, '#4CAF50')}
        {renderScoreBar('嗜好', item.preferenceScore, '#E91E63')}
        {renderScoreBar('ご当地', item.localScore, '#FF5722')}
      </View>
      
      {/* AI判断理由 */}
      <View style={styles.reasoningContainer}>
  <Text style={styles.reasoningTitle}>{reasoningTitle || '🤖 AIの判断理由:'}</Text>
        {item.reasoning.map((reason, idx) => (
          <Text key={idx} style={styles.reasoningText}>• {reason}</Text>
        ))}
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        {/* ヘッダー */}
        <View style={styles.header}>
          <Text style={styles.title}>{title || '🤖 AI おすすめランキング'}</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
        
        {/* 説明 */}
        <View style={styles.description}>
          <Text style={styles.descriptionText}>
            {description || '距離・評価・価格・あなたの嗜好・ご当地度を総合的に分析した結果です'}
          </Text>
        </View>
        
        {/* ランキングリスト */}
        <FlatList
          data={scores}
          keyExtractor={(item) => item.place.id}
          renderItem={renderSpotItem}
          style={styles.list}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        />
      </View>
    </Modal>
  );
};

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
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e9ecef',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    color: '#6c757d',
    fontWeight: '600',
  },
  description: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#e3f2fd',
  },
  descriptionText: {
    fontSize: 14,
    color: '#1976d2',
    textAlign: 'center',
    lineHeight: 20,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  spotItem: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  spotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  rankContainer: {
    width: 40,
    alignItems: 'center',
  },
  rankIcon: {
    fontSize: 24,
    fontWeight: '700',
  },
  photoContainer: {
    marginRight: 12,
  },
  spotPhoto: {
    width: 100,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  noPhoto: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  noPhotoText: {
    fontSize: 12,
    color: '#9e9e9e',
    fontWeight: '600',
  },
  spotInfo: {
    flex: 1,
    marginLeft: 8,
  },
  spotName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  spotAddress: {
    fontSize: 12,
    color: '#6c757d',
  },
  totalScoreContainer: {
    alignItems: 'center',
  },
  totalScore: {
    fontSize: 24,
    fontWeight: '700',
  },
  totalScoreLabel: {
    fontSize: 10,
    color: '#6c757d',
    fontWeight: '600',
  },
  detailScores: {
    marginBottom: 12,
  },
  scoreBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  scoreLabel: {
    width: 40,
    fontSize: 12,
    color: '#6c757d',
    fontWeight: '600',
  },
  scoreBarContainer: {
    flex: 1,
    height: 16,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    marginHorizontal: 8,
    position: 'relative',
    justifyContent: 'center',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 8,
    position: 'absolute',
    left: 0,
  },
  scoreValue: {
    fontSize: 10,
    color: '#495057',
    fontWeight: '600',
    textAlign: 'center',
  },
  reasoningContainer: {
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
  },
  reasoningTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 6,
  },
  reasoningText: {
    fontSize: 12,
    color: '#6c757d',
    lineHeight: 16,
    marginBottom: 2,
  },
});

export default AIRankingModal;