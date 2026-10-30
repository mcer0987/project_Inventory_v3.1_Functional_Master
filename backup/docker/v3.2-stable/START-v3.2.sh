#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"

docker info >/dev/null
docker load --input ./medipol-envanter-v3.2-stable.tar

if docker container inspect medipol-envanter-v3.2 >/dev/null 2>&1; then
  docker start medipol-envanter-v3.2
else
  docker run --detach --name medipol-envanter-v3.2 --restart unless-stopped \
    --publish 127.0.0.1:8088:80 medipol-envanter:v3.2-stable
fi

printf 'v3.2 hazır: http://localhost:8088\n'
