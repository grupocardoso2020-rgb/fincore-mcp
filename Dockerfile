FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm install -g typescript
RUN tsc --noEmitOnError 2>&1 || (echo "TypeScript compilation failed" && exit 1)

EXPOSE 3000

CMD ["node", "dist/index.js"]
