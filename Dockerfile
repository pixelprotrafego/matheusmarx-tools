# Imagem do Matheus Marx Tools.
#
# O resultado é um servidor de arquivos estáticos e nada mais: como todo o
# processamento acontece no navegador de quem usa, o contêiner não tem backend,
# banco nem estado. Ele sobe, serve o site e não fala com ninguém.
#
#   docker build -t matheusmarx-tools .
#   docker run --rm -p 7767:7767 matheusmarx-tools
#
# As ferramentas de Áudio & Voz ficam desligadas nesta imagem por padrão, porque
# dependem de um Supabase próprio. Para ligá-las, veja o README.

# ------------------------------------------------------------------ construção
#
# Debian (`slim`) e não Alpine neste estágio, de propósito. Vários pacotes da
# árvore trazem binários compilados — rollup, swc, esbuild, canvas — e os
# pré-compilados para glibc são o caminho testado por todo mundo; os de musl,
# que o Alpine usa, faltam com mais frequência e a queda é para compilar na
# hora, o que exige compilador e bibliotecas que a imagem não tem.
#
# Não custa tamanho: este estágio inteiro é descartado, e o que vai para o
# registro é só a imagem final de nginx sobre Alpine.
FROM node:20-slim AS build

WORKDIR /app

# As dependências entram antes do código-fonte: enquanto o package-lock não
# mudar, o Docker reaproveita esta camada e o build seguinte pula o npm inteiro.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Argumentos de build, todos opcionais. O Vite grava o valor deles dentro do
# JavaScript gerado, então precisam existir aqui e não na hora de rodar.
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
ARG VITE_SUPABASE_PROJECT_ID=""
ARG VITE_ALLOWED_HOSTS=""
ARG VITE_META_PIXEL_ID=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    VITE_ALLOWED_HOSTS=$VITE_ALLOWED_HOSTS \
    VITE_META_PIXEL_ID=$VITE_META_PIXEL_ID

# O `prebuild` copia o motor do ffmpeg (~31 MB) do node_modules para public/,
# para o contêiner servir o WebAssembly do próprio domínio em vez de buscá-lo
# num CDN. É o que permite usar as ferramentas de vídeo sem internet.
RUN npm run build

# --------------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="Matheus Marx Tools" \
      org.opencontainers.image.description="Ferramentas de conversão de arquivos que rodam inteiramente no navegador" \
      org.opencontainers.image.source="https://github.com/pixelprotrafego/matheusmarx-tools" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Valida a configuração durante o build.
#
# Sem isto, um erro de sintaxe no nginx.conf gera uma imagem que parece pronta e
# só morre na hora de subir — e a mensagem fica escondida no log do contêiner,
# não no log do build. Com o `-t`, o build falha na hora, apontando arquivo e
# linha. Foi assim que um `include mime.types` duplicado passou despercebido.
RUN nginx -t

EXPOSE 7767

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:7767/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
