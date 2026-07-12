# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# Static ffmpeg with libfdk_aac (AAC-ELD) from the Homebridge project
ARG TARGETARCH
ARG FFMPEG_VERSION=v2.2.2
RUN apk add --no-cache curl \
  && case "${TARGETARCH}" in \
       amd64) FFARCH=x86_64 ;; \
       arm64) FFARCH=aarch64 ;; \
       *) echo "unsupported arch ${TARGETARCH}" && exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/homebridge/ffmpeg-for-homebridge/releases/download/${FFMPEG_VERSION}/ffmpeg-alpine-${FFARCH}.tar.gz" \
     | tar xz -C / \
  && apk del curl \
  && /usr/local/bin/ffmpeg -version | head -1

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# HAP, health; SRTP uses ephemeral UDP ports (hostNetwork in k8s)
EXPOSE 51826/tcp 9891/tcp

CMD ["node", "dist/index.js"]
