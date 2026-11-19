FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY web ./web
COPY vite.config.js ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY --from=build /app/dist ./dist
RUN mkdir -p /data
EXPOSE 3001
CMD ["node", "src/server.js"]
