FROM python:3.11-slim

# Install nginx + Docker CLI + tailscale + openssh-client
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl openssh-client kmod procps systemd nginx && \
    rm -rf /var/lib/apt/lists/* && \
    curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz -o /tmp/docker.tgz && \
    tar xzf /tmp/docker.tgz -C /tmp/ && \
    mv /tmp/docker/docker /usr/local/bin/docker && \
    rm -rf /tmp/docker.tgz /tmp/docker && \
    chmod +x /usr/local/bin/docker && \
    docker --version && \
    curl -fsSL https://pkgs.tailscale.com/stable/tailscale_1.80.3_amd64.tgz -o /tmp/ts.tgz && \
    tar xzf /tmp/ts.tgz -C /tmp/ && \
    cp /tmp/tailscale_1.80.3_amd64/tailscale /usr/local/bin/tailscale && \
    cp /tmp/tailscale_1.80.3_amd64/tailscaled /usr/local/bin/tailscaled && \
    rm -rf /tmp/ts.tgz /tmp/tailscale_1.80.3_amd64 && \
    tailscale version

WORKDIR /app

# Python deps
RUN pip install --no-cache-dir fastapi uvicorn python-dotenv httpx

# Backend
COPY backend.py .

# Frontend
COPY assets/ /usr/share/nginx/html/assets/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Auto cache-buster: hash all assets and inject into index.html
COPY index.html /tmp/index.html
RUN HASH=$(find /usr/share/nginx/html/assets -type f -exec md5sum {} \; | sort | md5sum | cut -c1-8) && \
    sed -i "s/__CACHEBUSTER__/$HASH/g" /tmp/index.html && \
    echo "Cache-buster hash: $HASH" && \
    cp /tmp/index.html /usr/share/nginx/html/index.html && \
    chown -R www-data:www-data /usr/share/nginx/html && chmod -R 755 /usr/share/nginx/html

# Entrypoint: start nginx, then run backend
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
CMD ["/entrypoint.sh"]
