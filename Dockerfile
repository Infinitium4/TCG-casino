FROM node:22-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY plinko.js ./
COPY dice.js ./
COPY build-crs ./build-crs
COPY public ./public
COPY underground ./underground

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5500 \
    DATA_DIR=/data

WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server.js ./server.js
COPY --from=build --chown=node:node /app/plinko.js ./plinko.js
COPY --from=build --chown=node:node /app/dice.js ./dice.js
COPY --from=build --chown=node:node /app/build-crs ./build-crs
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/underground ./underground
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 5500
CMD ["node", "server.js"]
