# ---- Builder ----
FROM node:lts-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY ./app ./app
COPY ./public ./public
COPY ./lib ./lib
COPY ./next.config.js .
COPY ./tsconfig.json .
COPY ./proxy.ts .
COPY ./.env.local .

# Build the app
RUN npm run build

# ---- Runner ----
FROM node:lts-alpine AS runner

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built output and required files from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/.env.local ./.env.local

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
