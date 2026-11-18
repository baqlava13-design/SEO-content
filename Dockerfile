FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 3001
CMD ["node", "src/server.js"]
