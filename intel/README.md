# Intel rules (self-updating database)

This folder holds the app's classification intelligence.

- **`rules.bundled.json`**: shipped with the app so it can categorize activity even on first run.

**Planned:** host `rules.latest.json` + detached signature + meta (version, `publishedAt`, `keyId`, sha256) from a website or CDN; validate sha256 and signature against a pinned key; write into user data; keep last-known-good; rate-limit checks (e.g. once per day). Refuse unsigned updates.

Privacy: rules are for **local classification**. The default bark is blind and includes no category/location/device info.

