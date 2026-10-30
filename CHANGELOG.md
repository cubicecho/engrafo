# [4.18.0](https://github.com/cubicecho/engrafo/compare/v4.17.0...v4.18.0) (2026-10-30)


### Features

* upload a whole folder ([467e402](https://github.com/cubicecho/engrafo/commit/467e402d628ced47e199fd88f37d65a4ede2c925))

# [4.17.0](https://github.com/cubicecho/engrafo/compare/v4.16.1...v4.17.0) (2026-10-27)


### Features

* **app:** run the document's preview and text to the bottom of the window ([bbbef28](https://github.com/cubicecho/engrafo/commit/bbbef2833b6c6394a9b13eb030ba8a1d9cc2de98))

## [4.16.1](https://github.com/cubicecho/engrafo/compare/v4.16.0...v4.16.1) (2026-10-27)


### Bug Fixes

* **vision:** fail a page whose reply stopped at the reply limit ([8baa362](https://github.com/cubicecho/engrafo/commit/8baa3626df14b72a8d4cc96376e80cdaa69ff01a)), closes [#58](https://github.com/cubicecho/engrafo/issues/58)

# [4.16.0](https://github.com/cubicecho/engrafo/compare/v4.15.1...v4.16.0) (2026-10-27)


### Features

* **vision:** let the admin set top P, top K, min P and the penalties ([0c7ad3c](https://github.com/cubicecho/engrafo/commit/0c7ad3ceb437210c36b861d46ff4bd46817c7e8e)), closes [agent-core#159](https://github.com/agent-core/issues/159) [#59](https://github.com/cubicecho/engrafo/issues/59)
* **vision:** send the sampler fields the admin set with every page ([3b46876](https://github.com/cubicecho/engrafo/commit/3b46876a825e8717bb33f6faa9a95d04164dce14)), closes [#59](https://github.com/cubicecho/engrafo/issues/59)

## [4.15.1](https://github.com/cubicecho/engrafo/compare/v4.15.0...v4.15.1) (2026-10-27)


### Bug Fixes

* **vision:** read a page with a 4,096-token reply limit by default ([912564d](https://github.com/cubicecho/engrafo/commit/912564daef8a1660b8e33261c3f27b0234a20156)), closes [#57](https://github.com/cubicecho/engrafo/issues/57)

# [4.15.0](https://github.com/cubicecho/engrafo/compare/v4.14.1...v4.15.0) (2026-10-26)


### Features

* **vision:** read pages as Markdown, and show Markdown text formatted ([3ee1902](https://github.com/cubicecho/engrafo/commit/3ee190205253453e39a620e07d9c5fc0973ccb09))
* **vision:** show which page the vision model is reading ([b368eac](https://github.com/cubicecho/engrafo/commit/b368eac955cf761f5eaf943b1693cec5f29adbb7))

## [4.14.1](https://github.com/cubicecho/engrafo/compare/v4.14.0...v4.14.1) (2026-10-26)


### Bug Fixes

* **app:** delete and retry update the page at once ([e939095](https://github.com/cubicecho/engrafo/commit/e939095709a937d838caadef8d0c375c2b0a182c)), closes [#4](https://github.com/cubicecho/engrafo/issues/4)

# [4.14.0](https://github.com/cubicecho/engrafo/compare/v4.13.0...v4.14.0) (2026-10-26)


### Features

* **vision:** set the longest reply and the image detail in Settings ([4974964](https://github.com/cubicecho/engrafo/commit/4974964d286f0715bb9fc4f6eee895524e99c76e))
* **vision:** set the sampling temperature in Settings, 0.6 by default ([935c68b](https://github.com/cubicecho/engrafo/commit/935c68bdd85cbcf51112f0a227ccfcbc3c347f69))

# [4.13.0](https://github.com/cubicecho/engrafo/compare/v4.12.0...v4.13.0) (2026-10-24)


### Features

* trash with restore and purge ([e37a7ac](https://github.com/cubicecho/engrafo/commit/e37a7acd4563f9a2e6452d58f00f1aeec2dbfc49)), closes [#35](https://github.com/cubicecho/engrafo/issues/35)

# [4.12.0](https://github.com/cubicecho/engrafo/compare/v4.11.0...v4.12.0) (2026-10-24)


### Features

* reset a document's date or receipt to automatic ([02e4dc2](https://github.com/cubicecho/engrafo/commit/02e4dc2bcaeef162faf4996345197c687b33e761)), closes [#42](https://github.com/cubicecho/engrafo/issues/42)

# [4.11.0](https://github.com/cubicecho/engrafo/compare/v4.10.0...v4.11.0) (2026-10-24)


### Features

* thumbnails in lists and saved searches in the sidebar ([da88207](https://github.com/cubicecho/engrafo/commit/da882079041fba5620421bd9a5c5a89686efd039)), closes [#36](https://github.com/cubicecho/engrafo/issues/36)

# [4.10.0](https://github.com/cubicecho/engrafo/compare/v4.9.0...v4.10.0) (2026-10-23)


### Features

* export the whole archive as a tar, and import one back ([dc4c789](https://github.com/cubicecho/engrafo/commit/dc4c78909389ec3127c678baf7f5840ee38d4408)), closes [#35](https://github.com/cubicecho/engrafo/issues/35)

# [4.9.0](https://github.com/cubicecho/engrafo/compare/v4.8.0...v4.9.0) (2026-10-23)


### Features

* read scanned pages with a vision model, set up in the app ([1831d73](https://github.com/cubicecho/engrafo/commit/1831d7340d88f2d958edc52561e1a30aab25595e))

# [4.8.0](https://github.com/cubicecho/engrafo/compare/v4.7.1...v4.8.0) (2026-10-23)


### Features

* list documents by filter alone, without a search ([270dbe5](https://github.com/cubicecho/engrafo/commit/270dbe55ac8ad7ae7140873ec860e0630620d6de)), closes [#43](https://github.com/cubicecho/engrafo/issues/43)

## [4.7.1](https://github.com/cubicecho/engrafo/compare/v4.7.0...v4.7.1) (2026-10-23)


### Bug Fixes

* OCR a PNG with transparency, and read text uploads in their own encoding ([3a1d9f6](https://github.com/cubicecho/engrafo/commit/3a1d9f619fa819b3dc2512b4bdafc0569865a2a8))

# [4.7.0](https://github.com/cubicecho/engrafo/compare/v4.6.0...v4.7.0) (2026-10-23)


### Features

* file whatever lands in a watched folder ([0cacdc3](https://github.com/cubicecho/engrafo/commit/0cacdc3e59faca38666e4e1d808b790fbe05535a))

# [4.6.0](https://github.com/cubicecho/engrafo/compare/v4.5.0...v4.6.0) (2026-10-23)


### Features

* accept CSV, HTML, WebP and GIF uploads ([3b008b0](https://github.com/cubicecho/engrafo/commit/3b008b0d42c909d7868c18679ebf6d118a82c2cb))

# [4.5.0](https://github.com/cubicecho/engrafo/compare/v4.4.0...v4.5.0) (2026-10-23)


### Features

* accept Markdown uploads, searched by heading ([c92602c](https://github.com/cubicecho/engrafo/commit/c92602cc2086d9d4a76a2bede000e331b50eacc7))
* narrow a search by folder, kind, document date and receipts ([15a9107](https://github.com/cubicecho/engrafo/commit/15a91078c503bf3d8cf308a878bf609c71dee297))
* read a receipt's vendor, total and currency, edit them, and export them as CSV ([933e341](https://github.com/cubicecho/engrafo/commit/933e3419c1618a832d1c45122eae5bcfe9879874))
* read the date on a document from its text, and let the user correct it ([b7a1345](https://github.com/cubicecho/engrafo/commit/b7a1345c32e028df489933af181fc300ceff74c2))
* warn when an upload duplicates a document the user already has ([7cd42b8](https://github.com/cubicecho/engrafo/commit/7cd42b85a221410826b2b8fc7f5e6c47fbb5d9d9))

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
