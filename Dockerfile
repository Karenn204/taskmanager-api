# ---------- Etapa 1: instalar dependencias de producción ----------
# La imagen completa trae python, make y g++ por si better-sqlite3 necesita compilarse
FROM node:22 AS deps
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Etapa 2: imagen final ligera ----------
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/app.db
WORKDIR /usr/src/app

# Solo copiamos lo necesario para ejecutar la API (sin pruebas ni devDependencies)
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY package.json server.js ./

# Carpeta de la BD (se monta como volumen en la EC2) y usuario sin privilegios
RUN mkdir -p /data && chown -R node:node /data /usr/src/app
USER node

# 3000 = API REST (en la EC2 se mapea al puerto 80), 6061 = socket TCP
EXPOSE 3000 6061

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
