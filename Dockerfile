# syntax=docker/dockerfile:1

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

COPY . .

# devDependencies included: codegen and the Vite build both need them.
RUN npm ci

# The GraphQL schema is generated from the Drizzle schema, so codegen imports
# @cubicecho/engrafo-db — which refuses to load without a DATABASE_URL.
# postgres-js does not connect until a query runs, so a placeholder is enough.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
RUN npm run codegen && npm run build:app

# ── Stage 2: test ─────────────────────────────────────────────────────────────
# `docker build --target test -t engrafo-test . && docker run --rm engrafo-test`.
# This is the only place the OCR integration test actually runs: it needs
# ocrmypdf, which a dev host usually lacks, and ImageMagick to draw the page of
# text it feeds in. Everywhere else that test reports as skipped.
FROM builder AS test

# Same OCR packages as the runtime stage, plus ImageMagick to draw the test's
# page of text. font-dejavu and fontconfig are for ImageMagick, not OCR: Alpine
# ships it without a single font, and `-annotate` then fails with
# "unable to read font ''".
RUN apk add --no-cache ocrmypdf tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-osd ghostscript \
      imagemagick font-dejavu fontconfig

CMD ["npm", "test"]

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /app

# OCR is what Paperless-ngx does: ocrmypdf driving Tesseract, with Ghostscript
# writing the PDF/A. The server only shells out to it. Add more
# tesseract-ocr-data-<lang> packages here and list them in OCR_LANGUAGES.
#
# -data-osd is not a language: it is the orientation and script model, and
# Alpine packages it separately. `--rotate-pages` and `--deskew` — two of the
# flags every run passes — load it, so without it every document fails with
# "Tesseract couldn't load any languages".
RUN apk add --no-cache ocrmypdf tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-osd ghostscript

# Only the runtime workspaces are installed; Vite and its plugins exist to
# produce app/dist and are useless once it exists.
COPY package.json package-lock.json ./
COPY db/package.json db/
COPY server/package.json server/
COPY app/package.json app/
RUN npm ci --omit=dev --include-workspace-root --workspace @cubicecho/engrafo-db --workspace @cubicecho/engrafo-server \
 && npm cache clean --force

# The server is not compiled: it runs its TypeScript sources directly under
# --experimental-strip-types, so the sources are the build output.
COPY db/src db/src
COPY db/drizzle db/drizzle
COPY server/src server/src
COPY --from=builder /app/app/dist app/dist

ENV NODE_ENV=production
ENV PORT=3004

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3004)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No --preserve-symlinks: it would resolve @cubicecho/engrafo-db to its path
# inside node_modules, and Node refuses to strip types from anything under there.
CMD ["node", "--experimental-strip-types", "server/src/index.ts"]
