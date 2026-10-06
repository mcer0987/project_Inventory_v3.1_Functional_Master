# Site konumları — HTTP (sites/default.conf) ve TLS (tls.conf) sunucuları aynı dosyayı kullanır.
# Not: nginx'te bir location kendi add_header'ını tanımlarsa üst düzeydeki add_header'lar MİRAS ALINMAZ; bu yüzden güvenlik
# başlıkları her location'da include edilir.

root   /usr/share/nginx/html;
index  index.html;
charset utf-8;

error_page  404  /404.html;
error_page  500 502 503 504  /404.html;

# ── 1. Engeller (SEC-03) ──────────────────────────────────────────────────────
# "^~" önekleri regex konumlarından ÖNCE kazanır: /backup/x.js artık statik varlık kuralına düşmez.
# (Bu dizinler .dockerignore beyaz listesiyle imaja zaten girmez; burası ikinci savunma hattı.)
location ^~ /backup/                    { return 404; }
location ^~ /backup_txt/                { return 404; }
location ^~ /scratch/                   { return 404; }
location ^~ /tests/                     { return 404; }
location ^~ /audits/                    { return 404; }
location ^~ /functions/                 { return 404; }
location ^~ /node_modules/              { return 404; }
location ^~ /nginx/                     { return 404; }
location ^~ "/Mimari ve Geliştirmeler/" { return 404; }

# Regex'ler tanım sırasıyla denenir; engeller statik varlık kurallarından önce gelir.
location ~ /\.                                           { return 404; }   # .git, .env, .firebaserc, .agents …
location ~* \.(?:md|json|rules|ya?ml|log|ps1|lock|txt)$  { return 404; }   # firebase.json, package.json, *.md, plan.json …
location ~* (?:^|/)(?:Dockerfile|docker-compose)         { return 404; }

# ── 2. Uygulama ───────────────────────────────────────────────────────────────
location / {
    include /etc/nginx/generated/security-headers.inc;
    add_header Cache-Control "no-cache" always;
    try_files $uri $uri/ =404;          # istemci tarafı rota yok; bilinmeyen yol gerçek 404
}

# Hash'siz JS/CSS: her istekte ETag ile doğrulanır (değişmediyse 304, gövde gelmez); yeni sürüm hemen yayılır.
location ~* \.(?:js|mjs|css)$ {
    include /etc/nginx/generated/security-headers.inc;
    add_header Cache-Control "no-cache" always;
    try_files $uri =404;
    access_log off;
}

location ~* \.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot)$ {
    include /etc/nginx/generated/security-headers.inc;
    add_header Cache-Control "public, max-age=604800" always;
    try_files $uri =404;
    access_log off;
}

location ~* \.html?$ {
    include /etc/nginx/generated/security-headers.inc;
    add_header Cache-Control "no-cache" always;
    try_files $uri =404;
}

location = /404.html {
    internal;
    include /etc/nginx/generated/security-headers.inc;
    add_header Cache-Control "no-store" always;
}
