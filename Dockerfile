# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm run worker:build

# Stage 3: Production image
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Copy standalone Next.js output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Copy Prisma schema + generated client for migrations
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/src/generated ./src/generated

# Copy worker entrypoint (compiled)
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "server.js"]
