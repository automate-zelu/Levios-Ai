FROM node:20-alpine

WORKDIR /app

# Install root dependencies
COPY package*.json ./
RUN npm install

# Install client dependencies and build
COPY client/package*.json ./client/
RUN cd client && npm install

COPY . .
RUN cd client && npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
