// データベース接続設定
const { Pool } = require('pg');

// PostgreSQL接続プール設定
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false, // ローカル開発環境ではSSLを無効にする
  max: 20, // 最大接続数
  idleTimeoutMillis: 30000, // アイドルタイムアウト
  connectionTimeoutMillis: 2000, // 接続タイムアウト
});

// 接続テスト
pool.on('connect', () => {
  console.log('📦 PostgreSQL database connected');
});

pool.on('error', (err) => {
  console.error('💥 Database connection error:', err);
  process.exit(-1);
});

// クエリ実行用のヘルパー関数
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log(`🔍 Executed query: ${text.slice(0, 50)}... (${duration}ms)`);
    return res;
  } catch (error) {
    console.error('💥 Database query error:', error);
    throw error;
  }
};

// トランザクション実行用のヘルパー関数
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  transaction
};