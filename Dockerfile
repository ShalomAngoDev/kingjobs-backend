# KingJOBS API — image de développement locale
FROM node:20.19-bookworm-slim

WORKDIR /app

# argon2 (node-gyp) + Prisma
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

ENV NODE_ENV=development
ENV PORT=3001
EXPOSE 3001

CMD ["npm", "run", "dev"]
