# 旅先グルメアプリ - バックエンドAPI用 Dockerfile
FROM node:20-alpine

# 作業ディレクトリを設定
WORKDIR /app

# 必要なシステムパッケージをインストール
RUN apk add --no-cache \
    postgresql-client \
    curl \
    wget \
    tini \
    && rm -rf /var/cache/apk/*

# package.json と package-lock.json をコピー（依存関係のキャッシュ最適化）
COPY package*.json ./

# 依存関係をインストール
RUN npm ci --omit=dev && npm cache clean --force

# アプリケーションのソースコードをコピー
COPY . .

# ログディレクトリを作成し、権限設定
RUN mkdir -p /app/logs && chown -R node:node /app
USER node

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || exit 1

# ポート8080を公開
EXPOSE 8080

# 環境変数を設定
ENV NODE_ENV=production
ENV PORT=8080
ENV TZ=Asia/Tokyo

# Graceful shutdownのためのtiniを使用
ENTRYPOINT ["/sbin/tini", "--"]

# アプリケーションを起動
CMD ["npm", "start"]
