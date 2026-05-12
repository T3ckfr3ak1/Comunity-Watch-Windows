## ComunityWatch™ Windows

This folder is the **full development tree** for the Electron client (`main.js`, `renderer/`, installers from `npm run dist:nsis`, etc.).  

**Hosting policy:** Keep this codebase in a **private** Git repo. Maintain a **separate minimal public repo** that only receives the installer + customer README via:

```powershell
npm run dist:nsis
$env:PUBLIC_RELEASE_DIR="C:\path\to\your-public-repo-clone"
npm run release:public
```

Details: **`scripts/public-release/INSTRUCTIONS.txt`** and **`docs/DUAL-PUSH.md`** (private source vs public installer-only).

**License:** proprietary (see **`LICENSE`**); third-party deps keep their own licenses.

### Installers in this repo

Do not commit installers here. Build output lives under **`dist-eb`** (ignored by Git). Publish with **`npm run release:public`** into your minimal **public** clone — see **`scripts/public-release/INSTRUCTIONS.txt`**.

### Privacy
- LAN discovery runs locally.
- MAC addresses are never displayed in the UI and are not sent to any server.

### Home / shared Wi‑Fi
By default the app uses **passive** LAN discovery only (no recurring probes). Optional **probe LAN** pings the subnet and may trigger notifications from some routers or antivirus products—it is off unless the user enables it.

### Update manifest (production)

The Windows client requests **`GET https://comunitywatch.com/upload`** (trailing slash redirects are fine). No client change is needed if nothing points at an HTML upload page for updates.

- **`GET /upload`** is **API-only**: **`200`**, **`Content-Type: application/json`**, body must be valid JSON starting with **`{`**. If parsing fails or status is not OK, the app **skips** the update prompt (startup is silent; **Check now** may say it could not read version info).
- **Human upload UI** lives at **`/upload.html`** only—not `/upload`.
- The worker may duplicate fields with the same values for compatibility: **`latestVersion`**, **`version`**, **`app_version`** (semver-ish **`x.y.z`**, from installer filename or GitHub tag); **`downloadUrl`**, **`installerUrl`**, **`url`** (direct GitHub **`browser_download_url`** is allowed); **`notes`**, **`changelog`**, **`message`** (optional release text).
- **Caching:** **`Cache-Control: public, max-age=60`** on the manifest; backend resolution of “latest installer” may be cached (**~5 minutes**), so a new GitHub release can lag briefly—no Windows change required.
- **Failure:** **`502`** with JSON **`error`** (and possibly no version)—client treats as **no usable update**.

Relative `downloadUrl` paths resolve against `https://comunitywatch.com`. HTTPS installers are only downloaded from **comunitywatch.com**, **GitHub**, **objects.githubusercontent.com**, or **\*.githubusercontent.com**.

Packaged apps check **~2.8s after launch** unless **Check for updates when the app starts** is turned off. For **`npm start`**, set **`CW_UPDATE_CHECK_DEV=1`** once if you need the same check in development.

### Build (developers)

Install dependencies (**use `npm run deps`** so TLS can pick up `.certs/npm-extra-ca.pem` if your proxy inspects HTTPS — see `scripts/TLS-README.txt`):

```powershell
npm run deps
npm run dist:nsis
```

`dist:nsis` stops **`ComunityWatch.exe`**, waits, clears **`dist-eb`** when possible; if **`app.asar` is locked**, it builds to **`dist-eb-<timestamp>`** automatically so installs still succeed.

Direct `electron .` remains `npm start` after deps are installed.
