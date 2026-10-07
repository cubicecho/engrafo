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
