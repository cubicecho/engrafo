# [4.4.0](https://github.com/cubicecho/engrafo/compare/v4.3.0...v4.4.0) (2026-10-23)


### Features

* read EPUB uploads, chapter by chapter ([2f7e758](https://github.com/cubicecho/engrafo/commit/2f7e758e33a7ff435ce3f451b2695913cc467939))

# [4.3.0](https://github.com/cubicecho/engrafo/compare/v4.2.0...v4.3.0) (2026-10-23)


### Features

* serve shared folders over MCP, and move the archive tree to the sidebar ([224d68c](https://github.com/cubicecho/engrafo/commit/224d68cb1e103ca1490279663eec71388c26feb5))

# [4.2.0](https://github.com/cubicecho/engrafo/compare/v4.1.0...v4.2.0) (2026-10-23)


### Features

* file documents in nested folders, shown as a tree ([cc9b8ad](https://github.com/cubicecho/engrafo/commit/cc9b8ad566b9a929af009e9ef5cb80cac7849c3f))
* **storage:** add S3_FORCE_PATH_STYLE for buckets that want virtual-hosted addressing ([79c4da3](https://github.com/cubicecho/engrafo/commit/79c4da39e90486f21e16f6b889950064bea643d8))

# [4.1.0](https://github.com/cubicecho/engrafo/compare/v4.0.0...v4.1.0) (2026-10-23)


### Features

* **app:** move to the current cubeui registry and tidy the pages on it ([27df689](https://github.com/cubicecho/engrafo/commit/27df689ad68def014f9acfbeaeca474f7dfacafe))

# [4.0.0](https://github.com/cubicecho/engrafo/compare/v3.3.0...v4.0.0) (2026-10-20)


### Features

* **search:** hybrid local search over every document's text ([487fd21](https://github.com/cubicecho/engrafo/commit/487fd21f8f7812509457098ebf66ea57b72351e6))


### BREAKING CHANGES

* **search:** Postgres needs the pgvector extension. The compose files move
from postgres:17-alpine to pgvector/pgvector:pg17 on the same volume; the
migration rebuilds existing indexes, since the two images order text
differently. A server booted against Postgres without pgvector stops and says
so.

# [3.3.0](https://github.com/cubicecho/engrafo/compare/v3.2.0...v3.3.0) (2026-10-20)


### Features

* **app:** let every page fill the space beside the sidebar ([2580ffc](https://github.com/cubicecho/engrafo/commit/2580ffcaffdbd613bca09d67ab00c2225b70cf1f))

# [3.2.0](https://github.com/cubicecho/engrafo/compare/v3.1.4...v3.2.0) (2026-10-20)


### Features

* **documents:** re-run processing on a finished or failed document ([a8b7887](https://github.com/cubicecho/engrafo/commit/a8b78870764f0eda3b80f9d898ac04c9b01aca3e))

## [3.1.4](https://github.com/cubicecho/engrafo/compare/v3.1.3...v3.1.4) (2026-10-20)


### Bug Fixes

* **pipeline:** keep the text of a PDF that already has some ([5735667](https://github.com/cubicecho/engrafo/commit/573566700464b51ee763423ba8333b5e256fed2c))

## [3.1.3](https://github.com/cubicecho/engrafo/compare/v3.1.2...v3.1.3) (2026-10-20)


### Bug Fixes

* **ocr:** convert unusual colour spaces instead of failing PDF/A ([d40206c](https://github.com/cubicecho/engrafo/commit/d40206cabc5569fd965a3c6eedd66b7a8056db96))

## [3.1.2](https://github.com/cubicecho/engrafo/compare/v3.1.1...v3.1.2) (2026-10-20)


### Bug Fixes

* **auth:** keep the OIDC state cookie on plain http ([bc7ac28](https://github.com/cubicecho/engrafo/commit/bc7ac287c1f2b689eeacb0af70362bf3602aeb87))

## [3.1.1](https://github.com/cubicecho/engrafo/compare/v3.1.0...v3.1.1) (2026-10-19)


### Bug Fixes

* **app:** put Settings at the foot of the sidebar ([bbefc52](https://github.com/cubicecho/engrafo/commit/bbefc52c2cdceafdc912cf0c621a44786b075252))
* **auth:** build the OIDC redirect URI from the request, not localhost ([6a57639](https://github.com/cubicecho/engrafo/commit/6a57639fb3ac684f706eb698db57a7aa5a821342))

# [3.1.0](https://github.com/cubicecho/engrafo/compare/v3.0.0...v3.1.0) (2026-10-17)


### Features

* sign in through an OIDC provider, set in the environment or paired from a setup URL ([2d8d541](https://github.com/cubicecho/engrafo/commit/2d8d541a4ce98aaa2e0ce67b8782d79e7aa7431d))

# [3.0.0](https://github.com/cubicecho/engrafo/compare/v2.0.1...v3.0.0) (2026-10-17)


* feat!: store files in RustFS instead of MinIO ([4fafc76](https://github.com/cubicecho/engrafo/commit/4fafc7690ada38492457872af928500808ba97e4))


### BREAKING CHANGES

* the quickstart's MINIO_PASSWORD, MINIO_PORT and
MINIO_CONSOLE_PORT are now RUSTFS_PASSWORD, RUSTFS_PORT and
RUSTFS_CONSOLE_PORT, and files live in a new engrafo_rustfs volume. RustFS
cannot read a MinIO data directory; the README's "Coming from a MinIO
install" section copies the old volume across.

## [2.0.1](https://github.com/cubicecho/engrafo/compare/v2.0.0...v2.0.1) (2026-10-07)


### Bug Fixes

* **app:** keep the session when the browser blocks storage ([af27e12](https://github.com/cubicecho/engrafo/commit/af27e12160e95ebdbf6fb4b83da8b1683e6cc81e))
* **app:** report a delete or a retry the server refused ([031467b](https://github.com/cubicecho/engrafo/commit/031467b3f44d6713f61f71a9cfc9329bc4574dcb))
* **app:** say so when the text or the preview cannot be loaded ([694a3b3](https://github.com/cubicecho/engrafo/commit/694a3b3e93e93724d5a698baaf3f728909a6c84e))
* **app:** survive a magic link that is not a URL ([88ad0e3](https://github.com/cubicecho/engrafo/commit/88ad0e3b20e0a0db6a731bd88460cecb0212acc3))
* **server:** accept only whole positive numbers for numeric settings ([b387cc9](https://github.com/cubicecho/engrafo/commit/b387cc946c0f4c87a1c3ca14c0034ca1cd61fe05))
* **server:** keep the database error out of the /healthz body ([8907569](https://github.com/cubicecho/engrafo/commit/8907569b215fbbd62a05f61f4366550778988b9a))
* **server:** let only one of two simultaneous retries start a run ([d97799b](https://github.com/cubicecho/engrafo/commit/d97799b75c217c07cf9fb93dd4e41eda05a98710))

# [2.0.0](https://github.com/cubicecho/engrafo/compare/v1.5.0...v2.0.0) (2026-10-07)


* build!: run on Node 26 and the Debian slim image ([d25512b](https://github.com/cubicecho/engrafo/commit/d25512bd5b8d6eb31c5bbe0493763b0e781d831e))
* feat(auth)!: sign in through better-auth ([7ce13ec](https://github.com/cubicecho/engrafo/commit/7ce13ecb02418f25eda139dac2c14856ff3d6cf0))


### Bug Fixes

* **app:** say when a document's text is empty instead of "too large" ([15370c2](https://github.com/cubicecho/engrafo/commit/15370c250b0d1fafa2322325303e12e2d350ff8a))
* **compose:** pass SECURE_LOCAL_NET rather than the variable it replaced ([39894f8](https://github.com/cubicecho/engrafo/commit/39894f83ab6643bb530762c9188051228c5722e1))
* **db:** do not force TLS on .lan, .local, .internal and .home.arpa hosts ([f28e57a](https://github.com/cubicecho/engrafo/commit/f28e57aab5f96e3667dbeef17dc21036c4c9c546))
* **server:** stop answering CORS for every origin ([e50b74c](https://github.com/cubicecho/engrafo/commit/e50b74cf983175c3a5560e65ddb93fe2f5f7f691))


### Features

* **db:** name the unique indexes and stamp step rows when they change ([524df55](https://github.com/cubicecho/engrafo/commit/524df55a468fc8d459d90c1c62dc20a38b7fdbd1))
* **server:** /healthz reports the database and the version ([f6999f2](https://github.com/cubicecho/engrafo/commit/f6999f2797e244597f6bbccfc604ff6af211a35e))
* wait for Postgres at boot and shut down cleanly ([b3a898e](https://github.com/cubicecho/engrafo/commit/b3a898e4a579dee0de7e344b7e84e5f25dbaaebb))


### BREAKING CHANGES

* JWT_SECRET is no longer read. Set BETTER_AUTH_SECRET
to at least 32 characters; the server refuses to start in production
without it. Everyone is signed out once by the upgrade. Sessions are
held in memory by default, so a restart signs everyone out unless
SESSION_STORE=database. Behind a reverse proxy set TRUST_PROXY, or all
visitors share one sign-in budget. In the API, requestMagicLink is now
requestSignIn and returns the session under `session`.
* running from source needs Node 26 or newer.

# [1.5.0](https://github.com/cubicecho/engrafo/compare/v1.4.0...v1.5.0) (2026-10-06)


### Bug Fixes

* **ci:** keep the browser stories out of the Alpine test image ([39bfa47](https://github.com/cubicecho/engrafo/commit/39bfa47a0506c1812149f3b0783d68dbd5f1b8bf))


### Features

* **app:** move the frontend onto the cubeui registry ([0ed2565](https://github.com/cubicecho/engrafo/commit/0ed256568a949bf201a1428b47556a8f40d22bcf)), closes [cubicecho/cubeui#265](https://github.com/cubicecho/cubeui/issues/265)

# [1.4.0](https://github.com/cubicecho/engrafo/compare/v1.3.0...v1.4.0) (2026-09-16)


### Features

* **app:** test the frontend through Storybook instead of a browser script ([84f9618](https://github.com/cubicecho/engrafo/commit/84f9618c1bd0a605b507ccf1e5cba3426af6b11d))

# [1.3.0](https://github.com/cubicecho/engrafo/compare/v1.2.1...v1.3.0) (2026-09-16)


### Features

* add a sidebar shell and a settings screen ([76fa0f1](https://github.com/cubicecho/engrafo/commit/76fa0f11e6f1b63c3886542f8e95ae0515573802))

## [1.2.1](https://github.com/cubicecho/engrafo/compare/v1.2.0...v1.2.1) (2026-09-16)


### Bug Fixes

* upload panel crashed where crypto.randomUUID does not exist ([10ba9c9](https://github.com/cubicecho/engrafo/commit/10ba9c9ac6b43f6991699943f7dc2edfb578dbfa))

# [1.2.0](https://github.com/cubicecho/engrafo/compare/v1.1.0...v1.2.0) (2026-09-15)


### Features

* add SECURE_LOCAL_NET, the ecosystem's name for a trusted network ([5996ad2](https://github.com/cubicecho/engrafo/commit/5996ad25000555bd824547d77ce97588fd6ebca4))

# [1.1.0](https://github.com/cubicecho/engrafo/compare/v1.0.1...v1.1.0) (2026-09-15)


### Features

* let the quickstart stack's published ports be overridden ([49ea9ac](https://github.com/cubicecho/engrafo/commit/49ea9ac19577ce42f49be610814bba2296591b92))

## [1.0.1](https://github.com/cubicecho/engrafo/compare/v1.0.0...v1.0.1) (2026-09-15)


### Bug Fixes

* print APP_URL in the boot banner, not localhost ([8a62431](https://github.com/cubicecho/engrafo/commit/8a6243101102d11e4cbdf18adfd4c8542bc21147))

# 1.0.0 (2026-09-15)


### Features

* a minimal self-hostable document archive ([dd1e2ce](https://github.com/cubicecho/engrafo/commit/dd1e2ce568ac1741354eb2f5735e5866bb8c79bd))
