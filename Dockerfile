# =============================================================================
# Medipol Envanter — üretim imajı (nginx, statik ESM ön yüz). Kılavuz: DOCKER_GUIDE.md
#
# [WHY]: Faz 4 · J5 (SEC-03, OPS) — imaj "COPY ." ile proje kökünü kopyalıyordu: yedekler, betikler, belgeler ve yapılandırma
#        web köküne giriyor, engelleri nginx regex sırası yüzünden aşılabiliyordu.
# [HOW]: Yalnız uygulama dosyaları açıkça kopyalanır (.dockerignore beyaz liste). nginx yapılandırması parçalı (nginx/);
#        güvenlik başlıkları açılışta şablondan üretilir. Taban imaj ARG ile sabitlenebilir:
#        docker build --build-arg NGINX_IMAGE=nginx:1.30-alpine …  (05.10.2026: stable = 1.30.5)
# =============================================================================
ARG NGINX_IMAGE=nginx:stable-alpine
FROM ${NGINX_IMAGE}

# Şablon çıktısı conf.d yerine ayrı klasöre (ana yapılandırma conf.d'yi okumaz). CSP_CONNECT_EXTRA yalnız yerel geliştirme.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/generated \
    CSP_CONNECT_EXTRA=""

RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d \
    && mkdir -p /etc/nginx/generated /etc/nginx/sites /etc/nginx/snippets

COPY nginx/nginx.conf               /etc/nginx/nginx.conf
COPY nginx/sites/                   /etc/nginx/sites/
COPY nginx/snippets/                /etc/nginx/snippets/
COPY nginx/templates/               /etc/nginx/templates/

# Uygulama: iki sayfa + 404, kök CSS/JS, src/ ve pdf-fonts/. Başka hiçbir şey web köküne girmez.
# pdf-fonts/ (Faz 5 · K1): zimmet tutanağı Türkçe fontları, pdf-generator.js PDF üretirken tembel yükler; yoksa 404.
COPY index.html admin.html 404.html /usr/share/nginx/html/
COPY *.css *.js                     /usr/share/nginx/html/
COPY src/                           /usr/share/nginx/html/src/
COPY pdf-fonts/                     /usr/share/nginx/html/pdf-fonts/

# Derleme anında doğrulama: şablon varsayılan değerle üretilir, yapılandırma sözdizimi denetlenir (çalışırken yeniden üretilir).
RUN envsubst '${CSP_CONNECT_EXTRA}' < /etc/nginx/templates/security-headers.inc.template > /etc/nginx/generated/security-headers.inc \
    && nginx -t

EXPOSE 80 443

LABEL org.opencontainers.image.title="medipol-envanter" \
      org.opencontainers.image.description="Medipol Envanter Takip Sistemi — statik ön yüz (nginx)"

CMD ["nginx", "-g", "daemon off;"]
