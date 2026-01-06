import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiCall } from './api';

export type SavedPlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number;
  photoUrl?: string;
  priceLevel?: string | number;
};

const FAVORITES_KEY = 'FAVORITES_V1';
const WISHLIST_KEY = 'WISHLIST_V1';

async function readList(key: string): Promise<SavedPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeList(key: string, items: SavedPlace[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(items));
  } catch {}
}

export async function getFavorites(): Promise<SavedPlace[]> {
  return readList(FAVORITES_KEY);
}

// ------------ サーバーに送るときの共通ボディ ------------
function buildServerBody(p: SavedPlace, listType: 'favorite' | 'wishlist') {
  return {
    place_id: p.id,
    place_name: p.name,
    place_address: p.address ?? null,
    latitude: p.lat ?? null,
    longitude: p.lng ?? null,
    rating:
      typeof p.rating === 'number' && Number.isFinite(p.rating)
        ? p.rating
        : null,
    // INTEGER カラムなので number だけ入れる（string は null にする）
    price_level:
      typeof p.priceLevel === 'number'
        ? p.priceLevel
        : null,
    // TEXT カラム。未指定なら null
    photo_url: p.photoUrl ?? null,
    list_type: listType,
  };
}

// ------------ お気に入り追加 ------------
export async function addFavorite(p: SavedPlace, token?: string): Promise<void> {
  if (token) {
    const body = buildServerBody(p, 'favorite');

    const res = await apiCall('/api/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    // 必要ならここでエラーチェック
    if (!res.ok) {
      let msg = '';
      try {
        const json = await res.json();
        msg = json.error || JSON.stringify(json);
      } catch {
        msg = await res.text();
      }
      console.error('❌ addFavorite 失敗:', res.status, msg);
      throw new Error(`お気に入り登録失敗 (${res.status})`);
    }

    return;
  }

  // 未ログイン時はローカル保存
  const list = await readList(FAVORITES_KEY);
  const exists = list.some(x => x.id === p.id);
  if (!exists) {
    list.unshift(p);
    await writeList(FAVORITES_KEY, list);
  }
}

// ------------ お気に入り削除（ローカルのみ） ------------
export async function removeFavorite(id: string): Promise<void> {
  const list = await readList(FAVORITES_KEY);
  const next = list.filter(x => x.id !== id);
  await writeList(FAVORITES_KEY, next);
}

export async function getWishlist(): Promise<SavedPlace[]> {
  return readList(WISHLIST_KEY);
}

// ------------ 行きたいリスト追加 ------------
export async function addWishlist(p: SavedPlace, token?: string): Promise<void> {
  if (token) {
    const body = buildServerBody(p, 'wishlist');

    const res = await apiCall('/api/favorites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let msg = '';
      try {
        const json = await res.json();
        msg = json.error || JSON.stringify(json);
      } catch {
        msg = await res.text();
      }
      console.error('❌ addWishlist 失敗:', res.status, msg);
      throw new Error(`行きたい登録失敗 (${res.status})`);
    }

    return;
  }

  // 未ログイン時はローカル保存
  const list = await readList(WISHLIST_KEY);
  const exists = list.some(x => x.id === p.id);
  if (!exists) {
    list.unshift(p);
    await writeList(WISHLIST_KEY, list);
  }
}

export async function removeWishlist(id: string): Promise<void> {
  const list = await readList(WISHLIST_KEY);
  const next = list.filter(x => x.id !== id);
  await writeList(WISHLIST_KEY, next);
}
