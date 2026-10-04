#!/usr/bin/env bash
# 在本机 Docker 里启动/种子 PocketBase(幂等, 可重复执行)。
# 和 ensure-pb.sh 同版本、同账号、同集合;端口默认 8091, 不跟原生实例(8090)打架。
# 产出:http://127.0.0.1:8091 —— 数据持久化在 named volume pb-demo-data。
set -euo pipefail

PORT="${PB_DOCKER_PORT:-8091}"
NAME="pb-demo"
VERSION="0.40.4"
BASE="http://127.0.0.1:$PORT"
ARCH="$(uname -m)"; case "$ARCH" in arm64 | aarch64) ARCH="arm64" ;; *) ARCH="amd64" ;; esac

if curl -s "$BASE/api/health" | grep -q '"code":200'; then
  echo "Docker PocketBase 已在运行:$BASE"
else
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" \
    -p "127.0.0.1:$PORT:8090" \
    -v pb-demo-data:/pb/pb_data \
    alpine:3.20 sh -c "
      apk add --no-cache unzip >/dev/null &&
      cd /tmp &&
      wget -q https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/pocketbase_${VERSION}_linux_${ARCH}.zip &&
      unzip -oq pocketbase_${VERSION}_linux_${ARCH}.zip -d /pb &&
      exec /pb/pocketbase serve --http 0.0.0.0:8090 --dir /pb/pb_data
    " >/dev/null
  for _ in $(seq 1 60); do
    curl -s "$BASE/api/health" | grep -q '"code":200' && break
    sleep 0.5
  done
  echo "Docker PocketBase 已启动:$BASE(container=$NAME)"
fi

docker exec "$NAME" /pb/pocketbase superuser upsert test@cornworld.dev 1234567890 --dir /pb/pb_data >/dev/null 2>&1

TOKEN=$(curl -s -X POST "$BASE/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"test@cornworld.dev","password":"1234567890"}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')
[ -n "$TOKEN" ] || { echo "superuser token 获取失败" >&2; exit 1; }

if ! curl -s "$BASE/api/collections/notes" -H "Authorization: $TOKEN" | grep -q '"name":"notes"'; then
  curl -s -X POST "$BASE/api/collections" -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    -d '{"name":"notes","type":"base","fields":[{"name":"title","type":"text","required":true},{"name":"body","type":"text"},{"name":"doc","type":"file","maxSelect":1}],"listRule":"","viewRule":"","createRule":"","updateRule":"","deleteRule":""}' >/dev/null
  echo "已创建集合 notes"
fi

USER_COUNT=$(curl -s "$BASE/api/collections/users/records?filter=$(python3 -c "import urllib.parse;print(urllib.parse.quote(\"email='u@cornworld.dev'\"))")" \
  -H "Authorization: $TOKEN" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("totalItems",0))')
if [ "$USER_COUNT" = "0" ]; then
  curl -s -X POST "$BASE/api/collections/users/records" -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    -d '{"email":"u@cornworld.dev","password":"1234567890","passwordConfirm":"1234567890","name":"测试用户"}' >/dev/null
  echo "已创建测试用户 u@cornworld.dev"
fi

echo "种子数据就绪:$BASE(superuser/user 见 ensure-pb.sh 同款)"
