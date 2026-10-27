# Builds the app and runs the standalone server (static files + game WebSocket).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# the server runs from TypeScript and shares rules code with the app
COPY server ./server
COPY src/chess ./src/chess
COPY src/online/protocol.ts ./src/online/protocol.ts
COPY src/puzzles ./src/puzzles
COPY src/analysis ./src/analysis
COPY src/engine ./src/engine
COPY src/explorer ./src/explorer
COPY src/learn/progress.ts ./src/learn/progress.ts
COPY src/daily ./src/daily
COPY src/account/flair.ts ./src/account/flair.ts
COPY --from=build /app/dist ./dist
# SQLite file location when DATABASE_URL isn't set (lost when the container is replaced)
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8787
CMD ["node", "server/index.ts"]
