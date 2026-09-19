FROM node:22-alpine

WORKDIR /app

# 先装依赖(利用 Docker 层缓存:改代码不会重装依赖)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 再复制源码
COPY server.js index.html ./

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
