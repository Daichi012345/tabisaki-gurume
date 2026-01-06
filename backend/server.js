// 旅先グルメアプリ バックエンドAPI サーバー
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

// 自作モジュール
const { query, transaction } = require('./db');
const { generateToken, authenticate, optionalAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 8080;

// =======================
// 🧱 ミドルウェア設定
// =======================
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:19000', 'http://localhost:19006'],
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'リクエストが多すぎます。しばらく待ってください。' }
});
app.use('/api/', limiter);

// =======================
// 🧭 基本ルート
// =======================
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/debug', (req, res) => {
  res.json({ status: 'ok', message: 'デバッグルート動作中' });
});

// =======================
// 👤 認証系
// =======================
app.post('/api/auth/register', [
  body('name').isLength({ min: 1 }),
  body('email').isEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: '入力エラー', details: errors.array() });

  const { name, email, password } = req.body;
  const exist = await query('SELECT id FROM users WHERE email=$1', [email]);
  if (exist.rows.length > 0) return res.status(409).json({ error: 'メールが既に登録済みです' });

  const hash = await bcrypt.hash(password, 10);
  const result = await query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id,name,email',
    [name, email, hash]
  );
  const token = generateToken({ userId: result.rows[0].id, email });
  res.json({ success: true, token, user: result.rows[0] });
});

app.post('/api/auth/login', [
  body('email').isEmail(),
  body('password').isLength({ min: 1 })
], async (req, res) => {
  const { email, password } = req.body;
  const result = await query('SELECT * FROM users WHERE email=$1', [email]);
  if (result.rows.length === 0) return res.status(401).json({ error: 'ユーザーが存在しません' });
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'パスワードが不正です' });
  const token = generateToken({ userId: user.id, email });
  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email } });
});

// ユーザープロファイル取得
app.get('/api/auth/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId; // 元に戻す
    const result = await query('SELECT id, name, email, created_at FROM users WHERE id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }
    
    const user = result.rows[0];
    res.json({ 
      success: true, 
      user: { 
        id: user.id, 
        name: user.name, 
        email: user.email,
        created_at: user.created_at
      } 
    });
  } catch (error) {
    console.error('❌ プロファイル取得エラー:', error);
    res.status(500).json({ error: 'プロファイルの取得に失敗しました' });
  }
});

// トークン検証エンドポイント（認証状態確認）
app.get('/api/auth/verify', authenticate, async (req, res) => {
  try {
    // authenticateミドルウェアを通過した時点でトークンは有効
    // JWTペイロードの一貫性に合わせて最小情報を返す
    const payload = req.user;
    res.json({
      success: true,
      valid: true,
      user: {
        userId: payload.userId,
        email: payload.email
      }
    });
  } catch (error) {
    console.error('❌ トークン検証エラー:', error);
    res.status(500).json({ error: 'トークンの検証に失敗しました' });
  }
});

// ルート一覧の簡易デバッグ用（404調査）
app.get('/debug/routes', (req, res) => {
  try {
    const routes = [];
    app._router.stack.forEach((middleware) => {
      if (middleware.route) {
        const methods = Object.keys(middleware.route.methods)
          .filter((m) => middleware.route.methods[m])
          .map((m) => m.toUpperCase());
        routes.push({ path: middleware.route.path, methods });
      } else if (middleware.name === 'router' && middleware.handle.stack) {
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            const methods = Object.keys(handler.route.methods)
              .filter((m) => handler.route.methods[m])
              .map((m) => m.toUpperCase());
            routes.push({ path: handler.route.path, methods });
          }
        });
      }
    });
    res.json({ count: routes.length, routes });
  } catch (e) {
    console.error('❌ ルート一覧取得エラー:', e);
    res.status(500).json({ error: 'ルート一覧の取得に失敗しました' });
  }
});

// =======================
// 💴 価格取得（Hot Pepper API）
// =======================
// 使い方: GET /api/price?name=店名&lat=..&lng=..
// 環境変数: HOTPEPPER_API_KEY
app.get('/api/price', async (req, res) => {
  try {
    const apiKey = process.env.HOTPEPPER_API_KEY;
    const { name, lat, lng } = req.query;
    if (!apiKey) return res.status(400).json({ success: false, error: 'HOTPEPPER_API_KEY not set' });
    if (!name || !lat || !lng) return res.status(400).json({ success: false, error: 'Missing name/lat/lng' });
    const range = 3; // 300m程度
    const url = `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?key=${apiKey}&format=json&name=${encodeURIComponent(name)}&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&range=${range}`;
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(502).json({ success: false, error: `HotPepper error ${r.status}: ${t}` });
    }
    const data = await r.json();
    const shop = (data.results?.shop || [])[0];
    if (!shop) return res.json({ success: true, priceRange: null });
    const budgetName = shop.budget?.name || null; // 例: '2001～3000円'
    return res.json({ success: true, priceRange: budgetName, source: 'hotpepper' });
  } catch (e) {
    console.error('❌ HotPepper API 価格取得エラー:', e);
    return res.status(500).json({ success: false, error: 'Internal error fetching price' });
  }
});

// ユーザープロファイル更新
app.put('/api/auth/profile', [
  authenticate,
  body('name').optional().isLength({ min: 1 }),
  body('email').optional().isEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: '入力データが不正です', details: errors.array() });
  }

  try {
    const userId = req.user.userId; // 元に戻す
    const { name, email } = req.body;
    
    // 更新するフィールドを準備
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex}`);
      updateValues.push(name);
      paramIndex++;
    }
    
    if (email !== undefined) {
      // メールアドレスが既に使用されていないかチェック
      const existingUser = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
      if (existingUser.rows.length > 0) {
        return res.status(409).json({ error: 'このメールアドレスは既に使用されています' });
      }
      updateFields.push(`email = $${paramIndex}`);
      updateValues.push(email);
      paramIndex++;
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: '更新するデータがありません' });
    }
    
    // updated_atフィールドを追加
    updateFields.push(`updated_at = NOW()`);
    updateValues.push(userId); // WHERE条件用
    
    const updateQuery = `
      UPDATE users 
      SET ${updateFields.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, name, email, created_at
    `;
    
    const result = await query(updateQuery, updateValues);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }
    
    const updatedUser = result.rows[0];
    console.log('✅ ユーザー情報更新完了:', { userId, updateFields });
    
    res.json({
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        created_at: updatedUser.created_at
      }
    });
  } catch (error) {
    console.error('❌ プロファイル更新エラー:', error);
    res.status(500).json({ error: 'プロファイルの更新に失敗しました' });
  }
});

// =======================
// 📍 AIスポット推薦API
// =======================

app.get('/api/recommend', async (req, res) => {
  try {
    const { lat, lng, genres, priceRange, dietary } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat/lngが必要です' });
    }

    console.log('📡 推薦APIリクエスト:', { 
      lat, lng, 
      genres: genres || 'なし', 
      priceRange: priceRange || 'なし',
      dietary: dietary || 'なし'
    });

    // --- Google Places APIで周辺飲食店を取得 ---
    const API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    console.log('🔑 APIキー確認:', API_KEY ? `${API_KEY.substring(0, 10)}...` : '未設定');
    
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.priceLevel,places.primaryType,places.photos'
      },
      body: JSON.stringify({
        includedTypes: ['restaurant', 'cafe', 'bakery', 'meal_takeaway'],
        maxResultCount: parseInt(req.query.count) || 15,
        locationRestriction: {
          circle: {
            center: { latitude: parseFloat(lat), longitude: parseFloat(lng) },
            radius: parseFloat(req.query.radius) || 3000
          }
        },
        languageCode: 'ja'
      })
    });

    console.log('🌐 Google Places API レスポンスステータス:', response.status);
    const data = await response.json();
    console.log('📍 Google Places API応答:', JSON.stringify(data, null, 2));
    
    if (!data.places) {
      console.log('⚠️ Google Places APIからplacesが返されませんでした');
      return res.status(200).json({ spots: [], message: '該当スポットなし' });
    }

    // --- ユーザー設定を考慮したスコアリング ---
    const userGenres = genres ? genres.split(',') : [];
    const userPriceRange = priceRange || '¥¥';
    const userDietary = dietary ? dietary.split(',') : [];
    
    const spots = data.places.map((p) => {
      const distance = Math.sqrt(
        (p.location.latitude - parseFloat(lat)) ** 2 +
        (p.location.longitude - parseFloat(lng)) ** 2
      ) * 111000;
      
      let score = (p.rating || 3) * (1 / (1 + distance / 1000));
      let reasons = [
        `${p.displayName.text} は人気の ${getCuisineType(p.primaryType)} です。`,
        `評価 ${p.rating || '不明'}、距離 ${(distance / 1000).toFixed(1)}km。`
      ];
      
      // ユーザー好みジャンルボーナス
      const cuisineType = getCuisineType(p.primaryType);
      if (userGenres.length > 0) {
        const matchingGenres = userGenres.filter(genre => 
          cuisineType.includes(genre) || 
          genre === 'カフェ' && p.primaryType === 'cafe' ||
          genre === 'レストラン' && p.primaryType === 'restaurant'
        );
        if (matchingGenres.length > 0) {
          score *= 1.5; // 1.5倍のボーナス
          reasons.push(`あなたの好きな${matchingGenres.join('・')}です！`);
        }
      }
      
      // 価格帯マッチボーナス
      const spotPriceRange = getPriceRange(p.priceLevel);
      if (spotPriceRange === userPriceRange) {
        score *= 1.2; // 1.2倍のボーナス
        reasons.push(`希望価格帯（${userPriceRange}）にマッチしています。`);
      }
      
      // 高評価ボーナス
      if (p.rating && p.rating >= 4.5) {
        score *= 1.3;
        reasons.push(`高評価（${p.rating}★）の優良店です！`);
      }
      
      return {
        id: p.id,
        name: p.displayName.text,
        lat: p.location.latitude,
        lng: p.location.longitude,
        address: p.formattedAddress,
        rating: p.rating,
        cuisineType: getCuisineType(p.primaryType),
        priceRange: getPriceRange(p.priceLevel),
        photos: p.photos?.map(photo =>
          `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=400&key=${API_KEY}`
        ) || [],
        reasons,
        score,
        distance
      };
    });

    const ranked = spots.sort((a, b) => b.score - a.score).slice(0, parseInt(req.query.count) || 15);

    res.json({
      success: true,
      count: ranked.length,
      spots: ranked
    });
  } catch (error) {
    console.error('❌ 推薦APIエラー:', error);
    res.status(500).json({ error: '推薦APIでエラーが発生しました', message: error.message });
  }
});

// =======================
// ⭐ お気に入り/行きたい API
// =======================

// 取得
app.get('/api/favorites', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const type = (req.query.type === 'wishlist') ? 'wishlist' : 'favorite';
    const result = await query(
      'SELECT place_id, place_name, place_address, latitude, longitude, rating, price_level, photo_url, list_type, created_at FROM favorites WHERE user_id=$1 AND list_type=$2 ORDER BY created_at DESC',
      [userId, type]
    );
    res.json({ success: true, items: result.rows });
  } catch (error) {
    console.error('❌ お気に入り取得エラー:', error);
    res.status(500).json({ error: 'お気に入りの取得に失敗しました' });
  }
});

// 追加
app.post('/api/favorites', [
  authenticate,
  body('place_id').isLength({ min: 1 }),
  body('place_name').isLength({ min: 1 }),
  body('list_type').optional().isIn(['favorite', 'wishlist'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: '入力エラー', details: errors.array() });
  try {
    const userId = req.user.userId;
    const {
      place_id,
      place_name,
      place_address,
      latitude,
      longitude,
      rating,
      price_level,
      photo_url,
      list_type = 'favorite'
    } = req.body;
    // デバッグログ（500調査用）
    if (process.env.LOG_FAVORITES_DEBUG === 'true') {
      console.log('🛠 favorites POST debug payload:', {
        userId,
        place_id,
        place_name,
        place_address,
        latitude,
        longitude,
        rating,
        price_level,
        photo_url,
        list_type
      });
    }
    const sql = `INSERT INTO favorites (user_id, place_id, place_name, place_address, latitude, longitude, rating, price_level, photo_url, list_type)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                 ON CONFLICT (user_id, place_id, list_type) DO UPDATE SET
                   place_name=EXCLUDED.place_name,
                   place_address=EXCLUDED.place_address,
                   latitude=EXCLUDED.latitude,
                   longitude=EXCLUDED.longitude,
                   rating=EXCLUDED.rating,
                   price_level=EXCLUDED.price_level,
                   photo_url=EXCLUDED.photo_url
                 RETURNING *`;
    const result = await query(sql, [userId, place_id, place_name, place_address, latitude, longitude, rating, price_level, photo_url, list_type]);
    res.json({ success: true, item: result.rows[0] });
  } catch (error) {
    // 詳細エラー分類
    console.error('❌ お気に入り追加エラー:', error.message, error.stack);
    if (error.code === '23503') { // 外部キー制約
      return res.status(400).json({ error: 'ユーザーが存在しません (FK)', code: error.code });
    }
    if (error.code === '22P02') { // 型変換エラー
      return res.status(400).json({ error: '数値型の値が不正です', code: error.code });
    }
    if (error.code === '23505') { // ユニーク制約（通常はUPSERTで出ないはず）
      return res.status(409).json({ error: 'ユニーク制約違反', code: error.code });
    }
    if (error.code === '22001') { // 文字列長オーバー
      return res.status(400).json({ error: '文字列が長すぎます (photo_url など)', code: error.code });
    }
    res.status(500).json({ error: 'お気に入りの追加に失敗しました', message: error.message });
  }
});

// デバッグ: 現在ユーザーのお気に入り行をそのまま返す（調査用）
app.get('/debug/favorites/raw', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const r = await query('SELECT * FROM favorites WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [userId]);
    res.json({ count: r.rowCount, rows: r.rows });
  } catch (e) {
    console.error('❌ favorites raw debug error:', e.message);
    res.status(500).json({ error: 'raw取得失敗', message: e.message });
  }
});

// 削除
app.delete('/api/favorites/:placeId', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const placeId = req.params.placeId;
    const type = (req.query.type === 'wishlist') ? 'wishlist' : 'favorite';
    const result = await query('DELETE FROM favorites WHERE user_id=$1 AND place_id=$2 AND list_type=$3 RETURNING *', [userId, placeId, type]);
    res.json({ success: true, deleted: result.rowCount });
  } catch (error) {
    console.error('❌ お気に入り削除エラー:', error);
    res.status(500).json({ error: 'お気に入りの削除に失敗しました' });
  }
});

// =======================
// 📊 ヘルパー関数
// =======================
function getPriceRange(priceLevel) {
  switch (priceLevel) {
    case 1: return '¥';
    case 2: return '¥¥';
    case 3: return '¥¥¥';
    case 4: return '¥¥¥¥';
    default: return '¥¥';
  }
}

function getCuisineType(primaryType) {
  const map = {
    restaurant: 'レストラン',
    cafe: 'カフェ',
    bakery: 'ベーカリー',
    meal_takeaway: 'テイクアウト'
  };
  return map[primaryType] || '飲食店';
}

// =======================

// =======================
// � ユーザー設定API
// =======================

// ユーザー設定を取得
app.get('/api/user/preferences', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.userId; // 元に戻す
    
    if (!userId) {
      // 未認証の場合はデフォルト設定を返す
      return res.json({
        success: true,
        preferences: {
          favoriteGenres: [],
          favoriteFoods: [],
          priceRange: '¥¥',
          dietaryRestrictions: [],
          preferredDistance: 2000
        }
      });
    }

    const result = await query(
      'SELECT preferences FROM user_preferences WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // 設定が存在しない場合はデフォルトを返す
      return res.json({
        success: true,
        preferences: {
          favoriteGenres: [],
          favoriteFoods: [],
          priceRange: '¥¥',
          dietaryRestrictions: [],
          preferredDistance: 2000
        }
      });
    }

    res.json({
      success: true,
      preferences: result.rows[0].preferences
    });
  } catch (error) {
    console.error('❌ ユーザー設定取得エラー:', error);
    res.status(500).json({ error: 'ユーザー設定の取得に失敗しました' });
  }
});

// ユーザー設定を保存・更新
app.post('/api/user/preferences', [
  authenticate,
  body('favoriteGenres').isArray(),
  body('favoriteFoods').isArray(),
  body('priceRange').isString(),
  body('dietaryRestrictions').isArray(),
  body('preferredDistance').isNumeric()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: '設定データが不正です', details: errors.array() });
  }

  try {
    const userId = req.user.userId; // JWTペイロードからのuserIdを使用
    console.log('🔍 ユーザー設定保存 - userId:', userId, 'user:', req.user);
    const preferences = {
      favoriteGenres: req.body.favoriteGenres,
      favoriteFoods: req.body.favoriteFoods,
      priceRange: req.body.priceRange,
      dietaryRestrictions: req.body.dietaryRestrictions,
      preferredDistance: req.body.preferredDistance
    };

    // UPSERT（存在すれば更新、存在しなければ挿入）
    await query(`
      INSERT INTO user_preferences (user_id, preferences, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET 
        preferences = $2,
        updated_at = NOW()
    `, [userId, JSON.stringify(preferences)]);

    console.log('✅ ユーザー設定保存完了:', { userId, preferences });
    res.json({ success: true, message: '設定を保存しました' });
  } catch (error) {
    console.error('❌ ユーザー設定保存エラー:', error);
    res.status(500).json({ error: 'ユーザー設定の保存に失敗しました' });
  }
});

// ユーザー行動履歴記録API
app.post('/api/user/action', [
  body('type').isIn(['visit', 'favorite', 'review', 'search']),
  body('spotId').isString(),
  body('spotName').optional().isString(),
  body('rating').optional().isNumeric(),
  body('duration').optional().isNumeric()
], async (req, res) => {
  try {
    const { type, spotId, spotName, rating, duration } = req.body;
    const userId = req.user?.userId || null;

    await query(`
      INSERT INTO user_actions (user_id, action_type, spot_id, spot_name, rating, duration, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [userId, type, spotId, spotName, rating, duration]);

    console.log('📝 ユーザー行動記録:', { userId, type, spotId });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ ユーザー行動記録エラー:', error);
    res.json({ success: false, error: error.message });
  }
});

// =======================
// �🚀 起動
// =======================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Tabisaki Gurume API Server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
