# =============================================================================
# Antigravity Frontend — Production Dockerfile
# Base: nginx:alpine (lightweight ~25MB, security-patched)
#
# [WHY]: Alpine-based Nginx has a minimal attack surface, ships with the latest
#         security patches, and produces the smallest possible image footprint.
# [HOW]: We copy the entire project into nginx's default web root, inject our
#         custom nginx.conf, and expose port 80 for container-internal traffic.
#         Port mapping (host:container) is handled in docker-compose.yml.
# =============================================================================

FROM nginx:alpine

# Remove the default Nginx welcome page and config to avoid conflicts
RUN rm -rf /usr/share/nginx/html/* \
    && rm /etc/nginx/nginx.conf

# Copy the project source files into the Nginx web root.
# .dockerignore will prevent node_modules, .firebase, .git, etc. from being
# copied, keeping the image lean and clean.
COPY . /usr/share/nginx/html

# Inject the production-ready custom Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Verify the Nginx config is syntactically valid at build time (fast feedback)
RUN nginx -t

# Expose port 80 (internal container port, mapped externally via compose)
EXPOSE 80

# Use the default nginx CMD (runs in foreground, required for Docker)
CMD ["nginx", "-g", "daemon off;"]
