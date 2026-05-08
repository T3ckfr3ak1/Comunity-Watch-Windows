## Update mechanism plan (stub)

This MVP builds the app with a bundled rules DB (`intel/rules.bundled.json`).

Next step (implementation later):

- Add a website endpoint (or separate CDN) hosting:
  - `rules.latest.json`
  - `rules.latest.json.sig` (detached signature)
  - `rules.latest.json.meta` (version, publishedAt, keyId, sha256)
- App downloads meta + rules, validates sha256 and signature against a pinned public key, then writes
  the validated rules into the app's user data directory.

Safety requirements:

- Signed updates only; refuse unsigned.
- Rollback: keep last-known-good rules.
- Rate-limit update checks (e.g., once per day).

