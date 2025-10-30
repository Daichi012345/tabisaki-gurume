-- 旅先グルメアプリ用のデータベーススキーマ
-- PostgreSQL初期化スクリプト

-- ユーザーテーブル
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(500),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255),
    reset_password_token VARCHAR(255),
    reset_password_expires TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- お気に入りレストランテーブル
CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    place_id VARCHAR(255) NOT NULL, -- Google Places API ID
    place_name VARCHAR(255) NOT NULL,
    place_address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    rating DECIMAL(2, 1),
    price_level INTEGER,
    photo_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, place_id)
);

-- レビューテーブル
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    place_id VARCHAR(255) NOT NULL,
    place_name VARCHAR(255) NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    photos TEXT[], -- 写真URLの配列
    visit_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 訪問履歴テーブル
CREATE TABLE IF NOT EXISTS visit_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    spot_id VARCHAR(255) NOT NULL,
    spot_name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    duration INTEGER, -- 滞在時間（分）
    visited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ユーザー行動記録テーブル（推薦システム用）
CREATE TABLE IF NOT EXISTS user_actions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL, -- 'visit', 'favorite', 'review', 'search'
    spot_id VARCHAR(255) NOT NULL,
    spot_name VARCHAR(255) NOT NULL,
    metadata JSONB, -- 追加のメタデータ（評価、コメントなど）
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- スポット情報キャッシュテーブル
CREATE TABLE IF NOT EXISTS spots_cache (
    id VARCHAR(255) PRIMARY KEY, -- Google Places API の place_id
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    address TEXT,
    cuisine_type VARCHAR(100),
    price_range VARCHAR(20),
    atmosphere VARCHAR(50),
    rating DECIMAL(3, 2),
    review_count INTEGER DEFAULT 0,
    photos JSONB, -- 写真URLの配列
    metadata JSONB, -- その他の情報
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ユーザー嗜好プロファイルテーブル
CREATE TABLE IF NOT EXISTS user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    cuisine_preferences JSONB, -- 料理ジャンル別スコア
    price_preferences JSONB, -- 価格帯別スコア
    atmosphere_preferences JSONB, -- 雰囲気別スコア
    time_preferences JSONB, -- 時間帯別スコア
    location_preferences JSONB, -- エリア別スコア
    last_calculated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ユーザー設定テーブル
CREATE TABLE IF NOT EXISTS user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}', -- JSON形式で設定を保存
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ユーザー行動履歴テーブル
CREATE TABLE IF NOT EXISTS user_actions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- NULL許可（匿名ユーザー対応）
    action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('visit', 'favorite', 'review', 'search')),
    spot_id VARCHAR(255) NOT NULL,
    spot_name VARCHAR(255),
    rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
    duration INTEGER, -- 滞在時間（分）
    metadata JSONB DEFAULT '{}', -- 追加データ用
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_place_id ON favorites(place_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_place_id ON reviews(place_id);
CREATE INDEX IF NOT EXISTS idx_visit_history_user_id ON visit_history(user_id);
CREATE INDEX IF NOT EXISTS idx_visit_history_spot_id ON visit_history(spot_id);
CREATE INDEX IF NOT EXISTS idx_user_actions_user_id ON user_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_actions_type ON user_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_user_actions_spot_id ON user_actions(spot_id);
CREATE INDEX IF NOT EXISTS idx_spots_cache_location ON spots_cache(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_spots_cache_cuisine ON spots_cache(cuisine_type);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- updated_atを自動更新するトリガー関数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- usersテーブルのupdated_atトリガー
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- reviewsテーブルのupdated_atトリガー
DROP TRIGGER IF EXISTS update_reviews_updated_at ON reviews;
CREATE TRIGGER update_reviews_updated_at
    BEFORE UPDATE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 初期データの挿入（開発用）
-- パスワードは 'password123' をbcryptでハッシュ化したもの
INSERT INTO users (name, email, password_hash, is_verified) 
VALUES 
    ('テストユーザー', 'test@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeM0/w23sK5JHdkTy', true),
    ('山田太郎', 'yamada@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeM0/w23sK5JHdkTy', true)
ON CONFLICT (email) DO NOTHING;

COMMIT;