# Engrafo

A minimal self-hostable document archive — the short path through Paperless-ngx,
and nothing else.

**[cubicecho.github.io/engrafo](https://cubicecho.github.io/engrafo/)**

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
- **EPUB** — an ebook's text is read in-process, no extra tools, with each
  chapter named from the book's table of contents.
- **Search** — by meaning and by exact words at once, over every document's
  text and title, with the passage that matched. Runs on this machine: a small
  embedding model (granite-embedding-small, about 50 MB, baked into the image)
  and Postgres's full-text search, fused the way mcp-ragdown does it. Each
  person searches only their own documents. A search can be narrowed to a
  folder (and everything in it), a kind of file (PDF, image, text, ebook), a
  range of document dates, or receipts only.
- **Document dates** — the date printed on a receipt, letter or invoice is read
  from its text (ISO, `12.03.2025`, `03/12/2025`, `12 March 2025`), shown on the
  document, and yours to correct. A date you set or clear is never replaced
  when the document is processed again.
- **Receipts** — a receipt's vendor, total and currency are read from its text
  by plain rules (no AI model), shown on the document and editable there, and
  exported as a CSV (`date,vendor,total,currency,title,folder`) for a date
  range or a folder. Fields it is unsure of are left empty rather than guessed:
  a bare `$` is several currencies, and a document with no labelled total is
  not taken for a receipt.
- **Folders** — file documents into folders, nested as deep as you like, and
  see the archive as a tree in the sidebar, on every page. Drag a document or a folder onto another folder,
  or use "Move to…". Names are unique within a folder, ignoring case, the way
  files are: a second upload of `scan.pdf` becomes `scan (2)`, and a rename or
  move onto a taken name is refused rather than overwriting. Deleting a folder
  deletes everything in it, once you have typed its name.
- **Duplicate warnings** — upload a file you already have and Engrafo says so,
  on the upload's row and on the document's page, with a link to the other
  copy and a way to delete this one. It warns rather than refuses, since the
  same file in two folders is sometimes what you meant. Files are compared by
  their SHA-256, and only against your own documents.
- **MCP for AI agents** — share a folder from its menu, make an API key in
  Settings, and an MCP client (Claude Code, Claude Desktop, any other) can
  list, search and read what is in it. Sharing a folder shares the folders
  inside it; nothing else is visible, and the tools are read-only. See
  [Connecting an agent](#connecting-an-agent).
- **A watched folder** — point a scanner's network share at `WATCH_DIR` and
  whatever lands there is filed into one account's archive, its subfolders
  as folders, then removed. Paperless's consume folder. See
  [The watched folder](#the-watched-folder).
- **A pipeline you can watch** — every step is a row with a status, so a document
  says where it got to, and a failed one says why and offers a retry.
- **Preview, download, rename, delete** — the archived PDF where there is one,
  the original otherwise.
- **Sign-in by magic link**, through an OpenID Connect provider such as
  heautou, or with no link at all on a private instance.

No tags, no correspondents, no mail ingestion. Folders are the one way to
organise. Those are what Paperless is for.

## Quickstart

Four containers: Engrafo, Postgres, [RustFS](https://rustfs.com), and a one-shot job that creates the
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
printf 'ENGRAFO_HOST=%s\nBETTER_AUTH_SECRET=%s\nPOSTGRES_PASSWORD=%s\nRUSTFS_PASSWORD=%s\n' \
  "$(hostname -f)" "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .env

docker compose -f docker-compose.quickstart.yml up -d
```

**On TrueNAS SCALE or Portainer**, paste the file's contents instead of
downloading it — Portainer's *Stacks → Add stack → Web editor*, or TrueNAS's
*Apps → Discover → Custom App → Install via YAML* — and put the four variables in
the stack's environment-variables box.

`ENGRAFO_HOST` is the one to get right: your NAS's hostname or LAN IP, no scheme,
e.g. `truenas.local` or `192.168.1.50`. Your browser uploads files straight to
RustFS over a URL Engrafo signs, and **the signature covers the hostname** — so
`localhost` here fails as a signature mismatch the moment you browse from any
other machine, not as an error that names the real problem.

If something on that machine already owns the ports — 9000 is popular — set
`ENGRAFO_PORT`, `RUSTFS_PORT` or `RUSTFS_CONSOLE_PORT` rather than editing the
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

Keep that `.env`. `BETTER_AUTH_SECRET` signs sessions, so changing it signs everyone out.
Your documents and their extracted text live in the `engrafo_rustfs` volume and
their metadata in `engrafo_pgdata`; both survive `docker compose down`, and a
backup needs both, because one without the other is not a working archive.
Upgrade with `docker compose -f docker-compose.quickstart.yml pull && docker
compose -f docker-compose.quickstart.yml up -d`.

**Upgrading to the release with search** also means a new Postgres image:
`pgvector/pgvector:pg17` instead of `postgres:17-alpine`, on the same volume.
Take the new compose file (or change that one line) before you pull. On its first
boot Engrafo rebuilds its database indexes, because the two images order text
differently, then indexes every document it already has, in the background; a
large archive takes a while, and search answers from what is done so far. On a
Postgres you run yourself, install pgvector and run `CREATE EXTENSION vector;`
as a superuser first.

### Coming from a MinIO install

Earlier versions of this file ran MinIO. RustFS cannot read a MinIO data
directory, so the new stack starts on an empty `engrafo_rustfs` volume and
leaves `engrafo_minio` untouched beside it — your files are not lost, but
Engrafo will list documents it cannot open until they are copied across.

```bash
docker compose -f docker-compose.quickstart.yml down      # the old file; volumes stay
curl -fsSLO https://raw.githubusercontent.com/cubicecho/engrafo/main/docker-compose.quickstart.yml
sed -i 's/^MINIO_/RUSTFS_/' .env                          # same password, same ports, new names

# RustFS and its buckets only, so nobody uploads halfway through the copy.
docker compose -f docker-compose.quickstart.yml up -d rustfs rustfs-init

# The old MinIO, read from its volume, on the stack's network.
set -a && . ./.env && set +a
docker run -d --name engrafo-minio-old --network engrafo_default \
  -v engrafo_engrafo_minio:/data \
  -e MINIO_ROOT_USER=engrafo -e MINIO_ROOT_PASSWORD="$RUSTFS_PASSWORD" \
  quay.io/minio/minio:latest server /data

docker run --rm --network engrafo_default -e PW="$RUSTFS_PASSWORD" --entrypoint sh quay.io/minio/mc:latest -c '
  mc alias set old http://engrafo-minio-old:9000 engrafo "$PW" &&
  mc alias set new http://rustfs:9000 engrafo "$PW" &&
  mc mirror old/engrafo new/engrafo &&
  mc mirror old/engrafo-text new/engrafo-text'

docker rm -f engrafo-minio-old
docker compose -f docker-compose.quickstart.yml up -d
```

The volume and network names assume the stack is called `engrafo`, which is what
the file names it; `docker volume ls` and `docker network ls` show yours if a
platform renamed it. Remove `engrafo_engrafo_minio` only once you have opened a
few documents from the new stack.

Read [**Before you expose it**](#before-you-expose-it) before putting this on a
domain.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — | **Required.** Postgres connection string. |
| `BETTER_AUTH_SECRET` | — | **Required in production**, at least 32 characters. Signs sessions and hashes magic-link tokens. `openssl rand -hex 32`. |
| `S3_ENDPOINT` | — | **Required.** Where the *server* reaches the bucket. |
| `S3_BUCKET` | — | **Required.** Bucket for uploaded files and OCR archives. Engrafo does not create it. |
| `S3_TEXT_BUCKET` | `$S3_BUCKET-text` | Bucket for extracted text. Must exist too. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | **Required.** Bucket credentials. |
| `S3_PUBLIC_ENDPOINT` | `S3_ENDPOINT` | Where the *browser* reaches the bucket. Presigned URLs are signed for this host, and the bucket has to answer CORS for the page's origin. |
| `S3_REGION` | `us-east-1` | RustFS ignores it; AWS does not. |
| `S3_FORCE_PATH_STYLE` | `true` | Address buckets as `host/bucket` (RustFS, MinIO). Set `false` for AWS S3, which prefers `bucket.host`. |
| `APP_URL` | the request's own address | Public URL; magic-link URLs and the OIDC redirect URI are built from it. Unset, each request uses the scheme and host the browser came in on (forwarded ones only through a `TRUST_PROXY` hop). |
| `PORT` | `3004` | Port the server listens on. |
| `DB_CONNECT_TIMEOUT_MS` | `60000` | How long boot waits for Postgres before giving up. |
| `MAX_UPLOAD_BYTES` | `104857600` | Largest accepted upload, 100 MiB by default. |
| `MAX_IMPORT_BYTES` | `5368709120` | Largest archive **Settings → Backup** imports, 5 GiB by default (S3's limit for one PUT). |
| `OCR_ENABLED` | `true` | Set to `false` to turn OCR off. Also needs `ocrmypdf` on PATH — the image has it. |
| `OCR_DEFAULT` | `true` | Whether the upload form's OCR toggle starts on. |
| `OCR_LANGUAGES` | `eng` | Tesseract languages joined with `+` (`eng+deu`). Each needs its traineddata installed. |
| `OCR_CONCURRENCY` | `1` | Documents processed at once. OCR and indexing are CPU-bound. |
| `DATE_ORDER` | `DMY` | How a numeric date that reads either way (`03/04/2025`) is read from a document's text: `DMY`, `MDY` (US) or `YMD`. A dotted date is always day first, and a part over 12 is always the day. |
| `MODELS_DIR` | `/models` in the image | Where the search model is cached. Unset on a dev host, it is downloaded (about 50 MB) on first use. |
| `WATCH_DIR` | — | A directory to file from, such as a scanner's share mounted into the container. Unset, there is no watched folder. See [The watched folder](#the-watched-folder). |
| `WATCH_OWNER` | — | The email address of the account the watched folder files into. Required with `WATCH_DIR`; until that account exists, nothing is filed. |
| `WATCH_POLL_SECONDS` | `5` | How often the watched folder is listed. |
| `WATCH_STABLE_SECONDS` | `10` | How long a file's size and modification time must hold still before it counts as written. Raise it for a slow scanner. |
| `SECURE_LOCAL_NET` | `false` | `true` on a network with nothing hostile on it: an address alone signs you in, no link to fetch. |
| `AUTH_MAGIC_LINK` | `true` | Deprecated. The older spelling of the same switch, still read: `false` means what `SECURE_LOCAL_NET=true` means. |
| `EXPOSE_MAGIC_LINK` | dev only | Return the magic link in the API response so the login page can show it. |
| `OIDC_ISSUER` | — | Turns on sign-in through an OpenID Connect provider, with `OIDC_CLIENT_ID`. The issuer URL; for heautou it ends in `/oidc`. |
| `OIDC_CLIENT_ID` | — | The client ID registered with the provider. |
| `OIDC_CLIENT_SECRET` | — | The client's secret. Leave it unset for a public client. |
| `OIDC_CLIENT_AUTH` | `client_secret_basic` | How the secret is sent: `client_secret_basic` (heautou's default) or `client_secret_post`. |
| `OIDC_NAME` | `SSO` | The provider's name on the login button ("Sign in with …"). |
| `SESSION_STORE` | `memory` | Where sessions are kept. `memory` signs everyone out when the server restarts; `database` keeps them, and is what more than one replica needs. |
| `TRUST_PROXY` | `false` | Which proxy hops may set `X-Forwarded-For`: a hop count (`1`) or a subnet list behind a reverse proxy. The sign-in throttle counts by client address. |

Accepted uploads are PDF, PNG, JPEG, TIFF, WebP, GIF, plain text, Markdown, CSV,
HTML and EPUB — what the pipeline can do something with. Markdown is searched
section by section, under its headings. An EPUB's text is read chapter by
chapter, and search knows which chapter a passage is from. DRM-protected books
cannot be read. A CSV (a bank or card statement, say) is searched row by row, with
its header row kept with every passage. An HTML file (a saved order confirmation)
is kept as uploaded, but what is searched and shown is its text; the page itself
is never displayed in the app, since it could run scripts or load trackers. An
animated GIF is read from its first frame.

Engrafo ships no mail provider. With magic links on, the link is written to the
server log, and that is the delivery channel — pipe the log somewhere you can
read, or run with `SECURE_LOCAL_NET=true`.

### The watched folder

Set `WATCH_DIR` to a directory and `WATCH_OWNER` to an account's email address,
and Engrafo files whatever lands in that directory into that account's archive,
then deletes it from the directory: Paperless's consume folder. Point a
scanner's "scan to SMB" at a share, mount the share into the container, and the
scans file themselves.

- **One owner.** Everything in the folder goes into `WATCH_OWNER`'s archive.
  The account has to exist: until someone signs in with that address once,
  the log says so and nothing is filed. Without `WATCH_OWNER` the folder is
  not watched at all.
- **Subdirectories are folders.** `Taxes/2026/receipt.pdf` is filed in the
  folder `Taxes` → `2026`, made if it is missing and reused if it exists, in any
  case. A directory whose name could not be a folder's (letters, digits,
  spaces, `_`, `.` and `-`) is left alone, and so is a name a document already
  has. A file whose name is taken in its folder is numbered, `scan (2)`, as an
  upload is.
- **A file is filed once it has stopped changing.** The folder is listed every
  `WATCH_POLL_SECONDS`, and a file is taken once its size and modification time
  have held still for `WATCH_STABLE_SECONDS`. It is polled, not watched, because
  file-change events do not cross a network share or, reliably, a Docker bind
  mount.
- **It is deleted only once it is in the bucket.** The file is uploaded, the
  upload is checked against the file's size, the document goes to the pipeline,
  and only then is the file removed. A file Engrafo cannot take (a type it does
  not accept, over `MAX_UPLOAD_BYTES`, empty) stays where it is, and the log says
  why, once. It is tried again when it changes or the server restarts. A
  storage or database failure is retried on the next pass.
- **The same bytes are not filed twice.** A file whose content is already in the
  owner's archive is removed without adding a copy, and the log names the
  document that has it. That is also what makes a restart in the middle of
  filing harmless.
- **Skipped without a word:** dotfiles (`.DS_Store`, `._scan.pdf`,
  `.~lock…`), `~$` files, `*.tmp`, `*.part` and the like, and the directories
  NASes keep for themselves (`@eaDir`, `#recycle`, `$RECYCLE.BIN`, anything
  starting with a dot). Symlinks are not followed.

The container has to be able to delete files in the directory. If it cannot,
each file is filed once and then stays, and the log says it could not be
removed. In compose:

```yaml
    environment:
      WATCH_DIR: /consume
      WATCH_OWNER: you@example.com
    volumes:
      - /mnt/scans:/consume
```

### Signing in with an OIDC provider

Engrafo can sign people in through any OpenID Connect provider, next to magic
links.

**Pairing (the easy way).** With a provider that supports Dynamic Client
Registration, such as heautou:

1. In heautou, make a setup URL for Engrafo. It looks like
   `https://<heautou>/oidc#setup=…&name=heautou`, and works once, for a short while.
2. Paste it into Engrafo. On a new instance, with no accounts yet, that is the
   login page's **Set up sign-in** tab; after that it is **Settings → Sign-in**,
   which only the admin sees. The first account ever created is the admin.
3. The login page shows "Sign in with heautou" straight away, with no restart.

Disconnecting in Settings removes the button and deletes Engrafo's client at the
provider. Accounts stay, and can still sign in with an emailed link.

**From the environment.** For a provider without registration, or to pin the
provider so it cannot be changed from the app:

1. In heautou, add a client whose redirect URI is exactly
   `<APP_URL>/api/auth/callback/oidc`. Its `allowedGroups` decide who may
   sign in.
2. Set `OIDC_ISSUER=https://<heautou>/oidc`, `OIDC_CLIENT_ID`,
   `OIDC_CLIENT_SECRET` and, for the button, `OIDC_NAME=heautou`.
3. Restart. The login page shows "Sign in with heautou", and the server logs
   the redirect URI it expects.

Someone signing in this way gets the account with the email address the
provider vouches for, or a new one if there is none. Setting only one of
`OIDC_ISSUER` and `OIDC_CLIENT_ID` stops the server at boot. `OIDC_ISSUER` wins
over a pairing, and Settings then shows the provider read-only.

## Backups

**Settings → Backup** exports your whole archive as one `.tar`: every original
you uploaded, the searchable PDF and extracted text where there are any, and a
`metadata.json` with titles, folder paths, dates, receipt fields and checksums.
It streams straight from the bucket to your browser, so its size is never held
on the server. The tree inside reads like your folders
(`originals/Taxes/2026/invoice.pdf`), so it is useful without Engrafo too.

The same tab imports one back, into this instance or a new one. Folders are made
where missing, a document whose checksum is already in your archive is skipped
(so importing the same export twice adds nothing), a name already taken in its
folder is numbered, and dates and receipts you corrected by hand are kept. Each
imported document is processed again like a new upload, so OCR and the search
index run with this instance's settings; a large import takes a while to settle.
The importer also takes a `.tar.gz`. Folder sharing with MCP is not restored:
share again what you want an agent to read.

An export is per account, and the database dump plus bucket sync remains the way
to back up the instance itself (accounts, API keys, sign-in settings).

## Connecting an agent

Engrafo serves one MCP endpoint, `/mcp` (Streamable HTTP), next to the app.

1. On the documents page, open a folder's ⋯ menu and choose **Share with MCP**.
   The folders inside it are shared too. Everything else, including documents
   at the top level, stays out of reach.
2. In **Settings → MCP**, make an API key. It is shown once, with the command
   to paste:

   ```bash
   claude mcp add --transport http engrafo http://your-host:3004/mcp \
     --header "Authorization: Bearer engr_…"
   ```

   Any other client takes the same URL and header (`x-api-key` works too).

The tools are `engrafo_folders`, `engrafo_search` (the same hybrid search as
the app), `engrafo_list` and `engrafo_read`, which returns a document's
extracted text a page at a time. A document is named by its path in the tree,
`Taxes/2026/invoice`. Turning a folder off takes effect on the agent's next
call. Revoking a key in Settings refuses it from then on. A key always works
as its owner, and only a session can make one, so a key cannot make another.

## Before you expose it

Registration is **open**: any address that completes a sign-in gets an account.
That is the right default for an instance only you can reach, and the wrong one
for an instance on the public internet. Before putting Engrafo on a domain:

- **Put it behind something.** A reverse proxy with TLS, and — if the instance is
  yours alone — an allowlist, VPN, or auth in front of it. Engrafo rate-limits
  sign-in in process, by email address and by client address. Set `TRUST_PROXY`
  to the number of proxies in front, or every visitor counts as the proxy and
  shares one budget.
- **The bucket is reachable too.** Browsers upload and download directly, so
  RustFS's port is published. Terminate TLS in front of it and set
  `S3_PUBLIC_ENDPOINT` to that address — objects are only ever reached through
  short-lived presigned URLs, but those URLs travel over whatever you give them.
- **Never set `SECURE_LOCAL_NET=true` (or `AUTH_MAGIC_LINK=false`) on a reachable
  instance.** Either one makes an email address the entire credential: anyone who
  can load the login page can sign in as anyone. They are for a LAN you control,
  which is the only place "secure local net" is a true statement.
- **Never set `EXPOSE_MAGIC_LINK=true` on a reachable instance.** It hands the
  sign-in token to whoever asked for it, which is the same thing by another route.
- **`/mcp` needs an API key even with `SECURE_LOCAL_NET`**, because the key is what
  says whose archive it reads. Treat a key like a password: anyone with it reads
  the folders you shared.
- **Set a real `BETTER_AUTH_SECRET`** and keep it. Changing it signs everyone out; leaking
  it lets anyone mint a session.

## Development

```bash
git clone https://github.com/cubicecho/engrafo.git
cd engrafo

cp .env.example .env
sed -i "s/^BETTER_AUTH_SECRET=.*/BETTER_AUTH_SECRET=$(openssl rand -hex 32)/" .env

npm install
npm run db:up          # Postgres on 127.0.0.1:5436, RustFS on 9000 (console 9001)
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
and RustFS on *that* host's `127.0.0.1`, where nothing else can reach them. Set
`DEV_BIND=0.0.0.0` in `.env`, point `DATABASE_URL` and `S3_ENDPOINT` at the
daemon's hostname, and re-run `npm run db:up`. Only on a network you trust — the
dev database and bucket have throwaway passwords and no TLS.

### Building the image

The repo ships its own `docker-compose.yml`, which builds the image rather than
pulling it:

```bash
export BETTER_AUTH_SECRET=$(openssl rand -hex 32) RUSTFS_PASSWORD=$(openssl rand -hex 24)
docker compose up --build
```

## License

[MIT](LICENSE) © Benjamin Van Treese
