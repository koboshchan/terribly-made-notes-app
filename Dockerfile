# ---- Builder ----
FROM node:lts-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci

# Public build-time vars (not secrets — safe to bake into the image)
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL

# Copy source code
COPY ./app ./app
COPY ./public ./public
COPY ./lib ./lib
COPY ./next.config.js .
COPY ./tsconfig.json .
COPY ./middleware.ts .

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
# Runtime secrets (CLERK_SECRET_KEY, MONGODB_URI, etc.) are injected by docker-compose, not baked in

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
