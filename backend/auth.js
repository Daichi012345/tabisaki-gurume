// JWT認証ミドルウェア
const jwt = require('jsonwebtoken');
const { query } = require('./db');

// JWT秘密鍵（環境変数から取得）
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_change_in_production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// JWTトークン生成
const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// JWTトークン検証
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};

// 認証ミドルウェア
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'アクセストークンが必要です',
        code: 'TOKEN_REQUIRED'
      });
    }

    const token = authHeader.substring(7); // "Bearer " を除去
    const decoded = verifyToken(token);

    // ユーザー情報をデータベースから取得
    const userResult = await query(
      'SELECT id, name, email, is_verified, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'ユーザーが見つかりません',
        code: 'USER_NOT_FOUND'
      });
    }

    // リクエストオブジェクトにユーザー情報を追加
    req.user = {
      ...userResult.rows[0],
      userId: decoded.userId // JWTペイロードからのuserIdも追加
    };
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      error: 'トークンが無効です',
      code: 'INVALID_TOKEN'
    });
  }
};

// オプショナル認証ミドルウェア（トークンがなくても通す）
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    const userResult = await query(
      'SELECT id, name, email, is_verified, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    req.user = userResult.rows.length > 0 ? {
      ...userResult.rows[0],
      userId: decoded.userId // JWTペイロードからのuserIdも追加
    } : null;
    next();
  } catch (error) {
    // エラーが発生してもリクエストを通す
    req.user = null;
    next();
  }
};

module.exports = {
  generateToken,
  verifyToken,
  authenticate,
  optionalAuth
};