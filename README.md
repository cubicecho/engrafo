# Engrafo

A minimal self-hostable document archive — the short path through Paperless-ngx,
and nothing else.

Upload a file. It goes straight into an S3-compatible bucket, a small pipeline
runs over it, the text it found lands in a second bucket, and what came out is on
the document's page. Postgres holds the metadata and nothing bulky. That is the
whole product.

- **Upload** — drag in a folder's worth of PDFs or scans, each with its own
  progress bar. The browser uploads directly to the bucket; the server only
  signs the URL.
- **OCR, optionally** — `ocrmypdf` with Paperless's own flags, so a scan becomes
  a searchable PDF/A plus the plain text it found. A born-digital PDF keeps the
  text layer it already has.
- **A pipeline you can watch** — every step is a row with a status, so a document
  says where it got to, and a failed one says why and offers a retry.
- **Preview, download, rename, delete** — the archived PDF where there is one,
  the original otherwise.
- **Sign-in by magic link**, or no link at all on a private instance.

No search, no tags, no correspondents, no mail ingestion. Those are what
Paperless is for.

## Quickstart

Four containers: Engrafo, Postgres, MinIO, and a one-shot job that creates the
two buckets. The app and the API are served from the same origin; the bucket is
its own, because browsers upload to it directly.

Nothing to clone and nothing to build —
[`docker-compose.quickstart.yml`](docker-compose.quickstart.yml) pulls a
published image. Its header comments are the install instructions, and they
repeat what is below.

```bash
mkdir engrafo && cd engrafo
curl -fsSLO https://raw.githubusercontent.com/cubicecho/engrafo/main/docker-compose.quickstart.yml

# The three secrets it refuses to start without, plus the address you reach it at.
printf 'ENGRAFO_HOST=%s\nJWT_SECRET=%s\nPOSTGRES_PASSWORD=%s\nMINIO_PASSWORD=%s\n' \
  "$(hostname -f)" "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .env

docker compose -f docker-compose.quickstart.yml up -d
```

**On TrueNAS SCALE or Portainer**, paste the file's contents instead of
downloading it — Portainer's *Stacks → Add stack → Web editor*, or TrueNAS's
*Apps → Discover → Custom App → Install via YAML* — and put the four variables in
the stack's environment-variables box.

`ENGRAFO_HOST` is the one to get right: your NAS's hostname or LAN IP, no scheme,
e.g. `truenas.local` or `192.168.1.50`. Your browser uploads files straight to
MinIO over a URL Engrafo signs, and **the signature covers the hostname** — so
`localhost` here fails as a signature mismatch the moment you browse from any
other machine, not as an error that names the real problem.

If something on that machine already owns the ports — 9000 is popular — set
`ENGRAFO_PORT`, `MINIO_PORT` or `MINIO_CONSOLE_PORT` rather than editing the
file. The signature covers the port too, so the addresses Engrafo signs are
built from these.

Engrafo is then on `http://ENGRAFO_HOST:3004`. Migrations run at boot and both
buckets — one for files, one for the text extracted from them — are created for
you, so there is no setup step. Sign in with any email address; Engrafo ships no
mail provider, so the magic link goes to the log, and that is the delivery
channel:

```bash
docker logs -f engrafo          # or the Logs tab in Portainer
```

Keep that `.env`. `JWT_SECRET` signs sessions, so changing it signs everyone out.
Your documents and their extracted text live in the `engrafo_minio` volume and
their metadata in `engrafo_pgdata`; both survive `docker compose down`, and a
backup needs both, because one without the other is not a working archive.
Upgrade with `docker compose -f docker-compose.quickstart.yml pull && docker
compose -f docker-compose.quickstart.yml up -d`.

Read [**Before you expose it**](#before-you-expose-it) before putting this on a
domain.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — | **Required.** Postgres connection string. |
| `JWT_SECRET` | — | **Required in production.** Signs session and magic-link tokens. `openssl rand -hex 32`. |
| `S3_ENDPOINT` | — | **Required.** Where the *server* reaches the bucket. |
| `S3_BUCKET` | — | **Required.** Bucket for uploaded files and OCR archives. Engrafo does not create it. |
| `S3_TEXT_BUCKET` | `$S3_BUCKET-text` | Bucket for extracted text. Must exist too. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | **Required.** Bucket credentials. |
| `S3_PUBLIC_ENDPOINT` | `S3_ENDPOINT` | Where the *browser* reaches the bucket. Presigned URLs are signed for this host. |
| `S3_REGION` | `us-east-1` | MinIO ignores it; AWS does not. |
| `APP_URL` | `http://localhost:$PORT` | Public URL; magic-link URLs are built from it. |
| `PORT` | `3004` | Port the server listens on. |
| `MAX_UPLOAD_BYTES` | `104857600` | Largest accepted upload, 100 MiB by default. |
| `OCR_ENABLED` | `true` | Set to `false` to turn OCR off. Also needs `ocrmypdf` on PATH — the image has it. |
| `OCR_DEFAULT` | `true` | Whether the upload form's OCR toggle starts on. |
| `OCR_LANGUAGES` | `eng` | Tesseract languages joined with `+` (`eng+deu`). Each needs its traineddata installed. |
| `OCR_CONCURRENCY` | `1` | Documents processed at once. OCR is CPU-bound. |
| `SECURE_LOCAL_NET` | `false` | `true` on a network with nothing hostile on it: an address alone signs you in, no link to fetch. |
| `AUTH_MAGIC_LINK` | `true` | The narrower spelling of the same thing: `false` turns the link off and leaves everything else alone. |
| `EXPOSE_MAGIC_LINK` | dev only | Return the magic link in the API response so the login page can show it. |

Accepted uploads are PDF, PNG, JPEG, TIFF and plain text — what the pipeline can
do something with.

Engrafo ships no mail provider. With magic links on, the link is written to the
server log, and that is the delivery channel — pipe the log somewhere you can
read, or run with `AUTH_MAGIC_LINK=false`.

## Before you expose it

Registration is **open**: any address that completes a sign-in gets an account.
That is the right default for an instance only you can reach, and the wrong one
for an instance on the public internet. Before putting Engrafo on a domain:

- **Put it behind something.** A reverse proxy with TLS, and — if the instance is
  yours alone — an allowlist, VPN, or auth in front of it. Engrafo rate-limits
  sign-in requests per address in process; per-IP limiting is the proxy's job,
  because the proxy is the only thing that reliably knows the client's address.
- **The bucket is reachable too.** Browsers upload and download directly, so
  MinIO's port is published. Terminate TLS in front of it and set
  `S3_PUBLIC_ENDPOINT` to that address — objects are only ever reached through
  short-lived presigned URLs, but those URLs travel over whatever you give them.
- **Never set `SECURE_LOCAL_NET=true` (or `AUTH_MAGIC_LINK=false`) on a reachable
  instance.** Either one makes an email address the entire credential: anyone who
  can load the login page can sign in as anyone. They are for a LAN you control,
  which is the only place "secure local net" is a true statement.
- **Never set `EXPOSE_MAGIC_LINK=true` on a reachable instance.** It hands the
  sign-in token to whoever asked for it, which is the same thing by another route.
- **Set a real `JWT_SECRET`** and keep it. Changing it signs everyone out; leaking
  it lets anyone mint a session.

## Development

```bash
git clone https://github.com/cubicecho/engrafo.git
cd engrafo

cp .env.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env

npm install
npm run db:up          # Postgres on 127.0.0.1:5436, MinIO on 9000 (console 9001)
npm run db:migrate
npm run codegen
npm run dev            # API on 3004, Vite dev server on 3000
```

Open <http://localhost:3000>. The dev server proxies `/graphql` to the API, and
outside production the magic link comes back in the response, so the login page
offers it as a link.

OCR in development needs `ocrmypdf` on your PATH (`apt install ocrmypdf`,
`brew install ocrmypdf`). Without it Engrafo starts anyway, says so once at boot,
and the upload form's OCR toggle is disabled — everything else works.

The OCR integration test skips itself unless ocrmypdf and ImageMagick are both
installed, so the image is where it really runs:

```bash
docker build --target test -t engrafo-test .
docker run --rm engrafo-test
```

`npm run check` runs codegen, Biome and `tsc --noEmit` across all three
workspaces; `npm test` runs the suite against an in-memory Postgres. See
[AGENTS.md](AGENTS.md) for how the pieces fit together.

If the server starts with `Cannot reach Postgres`, check whether your Docker
daemon is this machine:

```bash
docker context ls
```

A remote endpoint (`ssh://…`, `tcp://…`) means `npm run db:up` published Postgres
and MinIO on *that* host's `127.0.0.1`, where nothing else can reach them. Set
`DEV_BIND=0.0.0.0` in `.env`, point `DATABASE_URL` and `S3_ENDPOINT` at the
daemon's hostname, and re-run `npm run db:up`. Only on a network you trust — the
dev database and bucket have throwaway passwords and no TLS.

### Building the image

The repo ships its own `docker-compose.yml`, which builds the image rather than
pulling it:

```bash
export JWT_SECRET=$(openssl rand -hex 32) MINIO_PASSWORD=$(openssl rand -hex 24)
docker compose up --build
```

## License

[MIT](LICENSE) © Benjamin Van Treese
