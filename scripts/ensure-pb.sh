#!/usr/bin/env bash
# 下载 / 启动 / 播种 本地 PocketBase(幂等,可重复执行)。
# 产出:http://127.0.0.1:${PB_PORT:-8090} 运行中的 PB,含 notes 集合与测试用户。
#   superuser: test@cornworld.dev / 1234567890
#   user:      u@cornworld.dev   / 1234567890
set -euo pipefail

PORT="${PB_PORT:-8090}"
VERSION="0.40.4"  # JS SDK(npm pocketbase)最新为 0.28.1;服务端跟进 0.40.x
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.pb"
mkdir -p "$DIR"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64 | aarch64) ARCH="arm64" ;;
  *) ARCH="amd64" ;;
esac

BIN="$DIR/pocketbase"
if [ ! -x "$BIN" ]; then
  echo "下载 PocketBase v$VERSION ($OS/$ARCH)…"
  curl -sL -o "$DIR/pb.zip" \
    "https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/pocketbase_${VERSION}_${OS}_${ARCH}.zip"
  unzip -o -q "$DIR/pb.zip" -d "$DIR"
  chmod +x "$BIN"
fi

BASE="http://127.0.0.1:$PORT"

if curl -s "$BASE/api/health" | grep -q '"code":200'; then
  echo "PocketBase 已在运行:$BASE"
else
  "$BIN" superuser upsert test@cornworld.dev 1234567890 --dir "$DIR/data" >/dev/null 2>&1
  "$BIN" serve --http "127.0.0.1:$PORT" --dir "$DIR/data" >"$DIR/serve.log" 2>&1 &
  echo $! >"$DIR/pb.pid"
  for _ in $(seq 1 40); do
    curl -s "$BASE/api/health" | grep -q '"code":200' && break
    sleep 0.5
  done
  echo "PocketBase 已启动:$BASE"
fi

TOKEN=$(curl -s -X POST "$BASE/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"test@cornworld.dev","password":"1234567890"}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')

if [ -z "$TOKEN" ]; then
  echo "获取 superuser token 失败,查看 $DIR/serve.log" >&2
  exit 1
fi

# notes(base 集合:文本 + 文件,规则全开便于集成测试)
if ! curl -s "$BASE/api/collections/notes" -H "Authorization: $TOKEN" | grep -q '"name":"notes"'; then
  curl -s -X POST "$BASE/api/collections" -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    -d '{"name":"notes","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"body","type":"text"},{"name":"doc","type":"file","maxSelect":1}],"listRule":"","viewRule":"","createRule":"","updateRule":"","deleteRule":""}' >/dev/null
  echo "已创建集合 notes"
fi

# 测试用户(存在则跳过)
USER_COUNT=$(curl -s "$BASE/api/collections/users/records?filter=$(python3 -c "import urllib.parse;print(urllib.parse.quote(\"email='u@cornworld.dev'\"))")" \
  -H "Authorization: $TOKEN" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("totalItems",0))')
if [ "$USER_COUNT" = "0" ]; then
  curl -s -X POST "$BASE/api/collections/users/records" -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    -d '{"email":"u@cornworld.dev","password":"1234567890","passwordConfirm":"1234567890","name":"测试用户"}' >/dev/null
  echo "已创建测试用户 u@cornworld.dev"
fi

echo "种子数据就绪"
