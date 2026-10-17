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
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
CMD ["node", "server/index.ts"]
