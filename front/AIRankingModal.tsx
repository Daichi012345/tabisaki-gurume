// プレースホルダーはURLでは返さず、UIで表示を切り替える（空文字）
const getPlaceholderImage = (): string => '';
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, Image } from 'react-native';
import { Linking } from 'react-native';
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

// 最良の写真URLを決める（v1 by id -> v1 resolve id -> Static Map -> 画像なし）
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

  // さらにフォールバック: Static Map
  if (GOOGLE_API_KEY) {
    if (typeof place.lat === 'number' && typeof place.lng === 'number') {
      // console.log('photo source: static map by coords', place.lat, place.lng);
      return `https://maps.googleapis.com/maps/api/staticmap?center=${place.lat},${place.lng}&zoom=17&size=300x200&maptype=roadmap&markers=color:red%7C${place.lat},${place.lng}&key=${GOOGLE_API_KEY}`;
    }
    // console.log('photo source: static map by name', place.name);
    return `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(place.name)}&zoom=17&size=300x200&maptype=roadmap&markers=color:red%7C${encodeURIComponent(place.name)}&key=${GOOGLE_API_KEY}`;
  }

  // 最終: 空（UI側で「画像なし」を表示）
  return '';
};


interface AIRankingModalProps {
  visible: boolean;
  onClose: () => void;
  scores: SpotScore[];
  onSelectSpot: (score: SpotScore) => void;
  title?: string;
  description?: string;
  reasoningTitle?: string;
  mode?: 'ai' | 'local'; // 追加: 呼び出し側でランキング種別指定
}

const AIRankingModal: React.FC<AIRankingModalProps> = ({
  visible,
  onClose,
  scores,
  onSelectSpot,
  title,
  description,
  reasoningTitle,
  mode,
}) => {
  const [photoUrls, setPhotoUrls] = useState<{[key: string]: string}>({});
  // ランキングモード判定（props優先。未指定なら環境変数で後方互換）
  const isLocalRanking = mode === 'local' || (mode == null && process.env.EXPO_PUBLIC_LOCAL_RANKING_ONLY === '1');
  
  // 写真URLを取得してキャッシュ
  useEffect(() => {
    const loadPhotos = async () => {
      const newPhotoUrls: {[key: string]: string} = {};
      
      for (const score of scores) {
        const cacheKey = score.place.id;
        if (!photoUrls[cacheKey]) {
          // 先に place に既に photoUrl がある場合はそれを使う（Places:searchTextで取得済みの最短ルート）
          const preset = (score.place as any).photoUrl as string | undefined;
          if (preset) {
            newPhotoUrls[cacheKey] = preset;
            continue;
          }
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
                // 読み込み失敗時は StaticMap（Google）にフォールバック
                if (typeof (item.place as any).lat === 'number' && typeof (item.place as any).lng === 'number' && GOOGLE_API_KEY) {
                  const { lat, lng } = (item.place as any);
                  const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=300x200&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${GOOGLE_API_KEY}`;
                  setPhotoUrls(prev => ({ ...prev, [item.place.id]: mapUrl }));
                } else if (GOOGLE_API_KEY) {
                  const mapUrlByName = `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(item.place.name)}&zoom=17&size=300x200&maptype=roadmap&markers=color:red%7C${encodeURIComponent(item.place.name)}&key=${GOOGLE_API_KEY}`;
                  setPhotoUrls(prev => ({ ...prev, [item.place.id]: mapUrlByName }));
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
          {(() => {
            // ご当地タグ（🏯除去後のキーワード）をバッジ表示（最大4件）
            const localReasons = item.reasoning.filter(r => r.startsWith('🏯'))
              .map(r => r.replace(/^🏯\s*/, ''));
            const tags: string[] = [];
            localReasons.forEach(text => {
              text.split(/[、,]/).forEach(tok => {
                const t = tok.trim();
                if (t && !tags.includes(t) && tags.length < 4) tags.push(t);
              });
            });
            // 補助タグ: 評価/営業中/価格帯
            const rating = (item.place as any).rating as number | undefined;
            const openNow = (item.place as any).openNow as boolean | undefined;
            const priceRange = (item.place as any).priceRange as string | undefined;
            const hpGenre = (item.place as any).hpGenre as string | undefined;
            type TagKind = 'local' | 'rating' | 'open' | 'price';
            type TagObj = { label: string; kind: TagKind | 'genre' };
            const extraTags: TagObj[] = [];
            const safetyFirst = item.reasoning.some(r => r.startsWith('🛡️'));
            if (safetyFirst) extraTags.push({ label: '🛡️ アレルギー優先', kind: 'open' });
            if (typeof rating === 'number') extraTags.push({ label: `⭐ ${rating.toFixed(1)}`, kind: 'rating' });
            if (openNow === true) extraTags.push({ label: '⏰ 営業中', kind: 'open' });
            if (priceRange) extraTags.push({ label: priceRange, kind: 'price' });
            if (hpGenre) extraTags.push({ label: hpGenre, kind: 'genre' });
            // 表示上限に余白があれば補助タグを追加（最大合計6件）
            // ジャンルがある場合は優先的に含める
            const capacity = 6 - tags.length;
            const merged: TagObj[] = tags.slice(0, 6).map(t => ({ label: t, kind: 'local' }));
            // まずジャンルを入れる
            const genreTag = extraTags.find(e => e.kind === 'genre');
            const restTags = extraTags.filter(e => e.kind !== 'genre');
            if (genreTag && capacity > 0) {
              merged.push(genreTag);
            }
            const remainingCapacity = 6 - merged.length;
            restTags.slice(0, Math.max(0, remainingCapacity)).forEach(et => merged.push(et));
            if (merged.length === 0) return null;
            return (
              <View style={styles.tagRow}>
                {merged.map((tagObj, i) => (
                  <View key={i} style={[
                    styles.tagChip,
                    tagObj.kind === 'rating' ? { backgroundColor: '#fffbe6', borderColor: '#ffe58f' } :
                    tagObj.kind === 'open' ? { backgroundColor: '#e6fffb', borderColor: '#87e8de' } :
                    tagObj.kind === 'price' ? { backgroundColor: '#f0fff4', borderColor: '#c6f6d5' } :
                    tagObj.kind === 'genre' ? { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' } :
                    {}
                  ]}>
                    <Text style={[
                      styles.tagText,
                      tagObj.kind === 'rating' ? { color: '#ad6800' } :
                      tagObj.kind === 'open' ? { color: '#006d75' } :
                      tagObj.kind === 'price' ? { color: '#2f855a' } :
                      tagObj.kind === 'genre' ? { color: '#3730a3' } :
                      {}
                    ]}>{tagObj.label}</Text>
                  </View>
                ))}
              </View>
            );
          })()}
        </View>
        {isLocalRanking ? (
          <View style={styles.dualScoreContainer}>
            <View style={styles.totalScoreContainer}>
              <Text style={[styles.totalScore, { color: '#FF5722' }]}>
                {item.localScore.toFixed(1)}
              </Text>
              <Text style={styles.totalScoreLabel}>ご当地</Text>
            </View>
          </View>
        ) : (
          <View style={styles.dualScoreContainer}>
            <View style={styles.totalScoreContainer}>
              <Text style={[styles.totalScore, { color: getScoreColor(item.aiTotalScore || item.totalScore) }]}>
                {(item.aiTotalScore || item.totalScore).toFixed(1)}
              </Text>
              <Text style={styles.totalScoreLabel}>AI</Text>
            </View>
          </View>
        )}
      </View>
      
      {/* 詳細スコア：ローカルランキング時はご当地のみ */}
      <View style={styles.detailScores}>
        {isLocalRanking ? (
          <>
            {renderScoreBar('ご当地', item.localScore, '#FF5722')}
            {renderScoreBar('距離', item.distanceScore, '#2196F3')}
            {renderScoreBar('評価', item.ratingScore, '#FFD700')}
            {renderScoreBar('価格', item.priceScore, '#4CAF50')}
          </>
        ) : (
          <>
            {renderScoreBar('距離', item.distanceScore, '#2196F3')}
            {renderScoreBar('評価', item.ratingScore, '#FFD700')}
            {renderScoreBar('価格', item.priceScore, '#4CAF50')}
            {renderScoreBar('嗜好', item.preferenceScore, '#E91E63')}
            {/* ご当地スコアはAIランキングでは非表示 */}
          </>
        )}    
      </View>
      {/* 予約/詳細リンク（HotPepper） */}
      {(() => {
        const hpUrl = (item.place as any).hpUrl as string | undefined;
        const phone = (item.place as any).phoneNumber as string | undefined;
        // Googleマップへのフォールバッ        // Googleマップは座標ではなく店名で検索する
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.place.name)}`;
        return (
          <View style={styles.actionRow}>
            {hpUrl ? (
              <TouchableOpacity
                style={styles.reserveButton}
                onPress={() => Linking.openURL(hpUrl)}
              >
                <Text style={styles.reserveButtonText}>🔗 HotPepperで予約/詳細</Text>
              </TouchableOpacity>
            ) : null}
            {!hpUrl && phone ? (
              <TouchableOpacity
                style={[styles.reserveButton, { backgroundColor: '#2e7d32' }]}
                onPress={() => Linking.openURL(`tel:${phone.replace(/\s/g,'')}`)}
              >
                <Text style={styles.reserveButtonText}>📞 電話する</Text>
              </TouchableOpacity>
            ) : null}
            {!hpUrl && !phone ? (
              <TouchableOpacity
                style={[styles.reserveButton, { backgroundColor: '#64748b' }]}
                onPress={() => Linking.openURL(mapsUrl)}
              >
                <Text style={styles.reserveButtonText}>🗺️ Googleマップで開く</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })()}
      
      {/* AI判断理由 */}
      {(() => {
        // ご当地理由とAI理由を分離（🏯 から始まるものをご当地タグとみなす）
        const localReasons = item.reasoning.filter(r => r.startsWith('🏯'));
        const aiReasons = item.reasoning.filter(r => !r.startsWith('🏯'));
        return (
          <View style={styles.reasoningOuter}>
            {/* ご当地ランキング時は、店名下のバッジを優先し重複表示を避けるため、テキスト列挙は省略 */}
            {isLocalRanking && (
              <View style={styles.reasoningContainer}>
                <Text style={styles.localReasoningTitle}>🍽️ ご当地タグ</Text>
                {(() => {
                  const expl: { label: string; color: string; bg: string; border: string }[] = [];
                  const ds = item.distanceScore;
                  const rs = item.ratingScore;
                  const ps = item.priceScore;
                  // 距離の説明
                  if (ds >= 8) expl.push({ label: '📍 近距離', color: '#1e3a8a', bg: '#e0f2fe', border: '#bae6fd' });
                  else if (ds >= 5) expl.push({ label: '📍 適距離', color: '#1e40af', bg: '#e0f2fe', border: '#bae6fd' });
                  else expl.push({ label: '📍 やや遠め', color: '#1f2937', bg: '#f3f4f6', border: '#e5e7eb' });
                  // 評価の説明
                  if (rs >= 8) expl.push({ label: '⭐ 高評価', color: '#ad6800', bg: '#fffbe6', border: '#ffe58f' });
                  else if (rs >= 6) expl.push({ label: '⭐ まずまず', color: '#795548', bg: '#f5efe6', border: '#e8ded1' });
                  else expl.push({ label: '⭐ 平均的', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' });
                  // 価格の説明
                  if (ps >= 8) expl.push({ label: '💰 予算内', color: '#2f855a', bg: '#f0fff4', border: '#c6f6d5' });
                  else if (ps >= 5) expl.push({ label: '💰 許容範囲', color: '#065f46', bg: '#ecfdf5', border: '#d1fae5' });
                  else expl.push({ label: '💰 予算超過', color: '#b91c1c', bg: '#fee2e2', border: '#fecaca' });
                  return (
                    <View style={styles.tagRow}>
                      {expl.slice(0, 3).map((e, idx) => (
                        <View key={`local-expl-${idx}`} style={[styles.tagChip, { backgroundColor: e.bg, borderColor: e.border }]}> 
                          <Text style={[styles.tagText, { color: e.color }]}>{e.label}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}
                <Text style={[styles.reasoningTitle, { marginTop: 6 }]}>📝 ご当地の判断理由:</Text>
                {(() => {
                  // 既存のご当地理由がない場合のフォールバック表示
                  const localReasonsRaw = item.reasoning.filter(r => r.startsWith('🏯'));
                  const fallback = localReasonsRaw.length === 0
                    ? [`ご当地度スコア: ${item.localScore.toFixed(1)}`]
                    : localReasonsRaw.map(r => r.replace(/^🏯\s*/, ''));
                  return fallback.map((reason, idx) => (
                    <Text key={`local-reason-${idx}`} style={styles.localReasoningText}>• {reason}</Text>
                  ));
                })()}
              </View>
            )}
            {/* AIランキング時はタグ + 残りの理由を列挙（タグで表示済みの上位3件は重複除外） */}
            {!isLocalRanking && aiReasons.length > 0 && (
              <View style={styles.reasoningContainer}>
                <Text style={styles.reasoningTitle}>{reasoningTitle || '🤖 AIの判断理由:'}</Text>
                {(() => {
                  // AIモード用の説明タグ（距離/評価/価格/嗜好の要約）
                  const ds = item.distanceScore;
                  const rs = item.ratingScore;
                  const ps = item.priceScore;
                  const hs = item.preferenceScore;
                  const chips: { label: string; color: string; bg: string; border: string }[] = [];
                  const safetyFirst = item.reasoning.some(r => r.startsWith('🛡️'));
                  if (safetyFirst) chips.push({ label: '🛡️ アレルギー優先', color: '#0f5132', bg: '#d1e7dd', border: '#badbcc' });
                  // 距離
                  if (ds >= 8) chips.push({ label: '📍 近距離', color: '#1e3a8a', bg: '#e0f2fe', border: '#bae6fd' });
                  else if (ds >= 5) chips.push({ label: '📍 適距離', color: '#1e40af', bg: '#e0f2fe', border: '#bae6fd' });
                  else chips.push({ label: '📍 やや遠め', color: '#1f2937', bg: '#f3f4f6', border: '#e5e7eb' });
                  // 評価
                  if (rs >= 8) chips.push({ label: '⭐ 高評価', color: '#ad6800', bg: '#fffbe6', border: '#ffe58f' });
                  else if (rs >= 6) chips.push({ label: '⭐ まずまず', color: '#795548', bg: '#f5efe6', border: '#e8ded1' });
                  else chips.push({ label: '⭐ 平均的', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' });
                  // 価格
                  if (ps >= 8) chips.push({ label: '💰 予算内', color: '#2f855a', bg: '#f0fff4', border: '#c6f6d5' });
                  else if (ps >= 5) chips.push({ label: '💰 許容範囲', color: '#065f46', bg: '#ecfdf5', border: '#d1fae5' });
                  else chips.push({ label: '💰 予算超過', color: '#b91c1c', bg: '#fee2e2', border: '#fecaca' });
                  // 嗜好
                  if (hs >= 7) chips.push({ label: '❤️ 好み一致', color: '#9d174d', bg: '#fde7f3', border: '#f8c9e4' });
                  else if (hs >= 5) chips.push({ label: '❤️ 近い嗜好', color: '#be185d', bg: '#fde7f3', border: '#f8c9e4' });
                  else chips.push({ label: '❤️ 好み外', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' });
                  return (
                    <View style={styles.tagRow}>
                      {chips.slice(0, 4).map((c, idx) => (
                        <View key={`ai-expl-${idx}`} style={[styles.tagChip, { backgroundColor: c.bg, borderColor: c.border }]}> 
                          <Text style={[styles.tagText, { color: c.color }]}>{c.label}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}
                {/* 重複回避のため、AI理由のタグ化は削除。説明チップ＋箇条書きのみ表示 */}
                {aiReasons.slice(3).map((reason, idx) => (
                  <Text key={`ai-${idx}`} style={styles.reasoningText}>• {reason}</Text>
                ))}
              </View>
            )}
          </View>
        );
      })()}

    </TouchableOpacity>
  );

  return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        {/* ヘッダー */}
          <View style={styles.header}>
            <Text style={styles.title}>{title || (isLocalRanking ? '🏯 ご当地度ランキング' : '🤖 AI おすすめランキング')}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        
        {/* 説明 */}
        <View style={styles.description}>
          <Text style={styles.descriptionText}>
            {description || (isLocalRanking
              ? 'この地域の名物・ご当地要素をスコア化したランキングです'
              : '距離・評価・価格・あなたの嗜好・ご当地度を総合的に分析した結果です')}
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
  dualScoreContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  totalScore: {
    fontSize: 24,
    fontWeight: '700',
  },
  totalScoreSmall: {
    fontSize: 18,
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
  reasoningOuter: {
    gap: 8,
    marginBottom: 4,
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
  localReasoningTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#d9480f',
    marginBottom: 6,
  },
  localReasoningText: {
    fontSize: 12,
    color: '#d9480f',
    lineHeight: 16,
    marginBottom: 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  tagChip: {
    backgroundColor: '#fff5e6',
    borderColor: '#ffd8a8',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  tagText: {
    fontSize: 11,
    color: '#d9480f',
    fontWeight: '600',
  },
  actionRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  reserveButton: {
    backgroundColor: '#1976d2',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  reserveButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default AIRankingModal;