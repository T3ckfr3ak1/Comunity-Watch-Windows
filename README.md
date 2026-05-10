## CommunityWatch Windows

This repo contains the Windows desktop client.

### Download
- Latest installer (versioned): `releases/CommunityWatch-Setup-<version>.exe`
- SHA256: `releases/CommunityWatch-Setup-<version>.exe.sha256`

### Privacy
- LAN discovery runs locally.
- MAC addresses are never displayed in the UI and are not sent to any server.

### Home / shared Wi‑Fi
By default the app uses **passive** LAN discovery only (no recurring probes). Optional **probe LAN** pings the subnet and may trigger notifications from some routers or antivirus products—it is off unless the user enables it.

### Update manifest (`https://comunitywatch.com/upload`)

Serve **JSON** (body starts with `{`) so packaged builds can compare versions at startup:

```json
{
  "latestVersion": "0.3.1",
  "downloadUrl": "https://comunitywatch.com/path/CommunityWatch-Setup-0.3.1.exe",
  "notes": "Optional short release note."
}
```

Supported aliases: `version` / `app_version`, `installerUrl` / `url`. Relative `downloadUrl` paths resolve against `https://comunitywatch.com`. HTTPS downloads are only accepted from **comunitywatch.com**, **GitHub**, **objects.githubusercontent.com**, or **\*.githubusercontent.com**.

Packaged apps check **~2.8s after launch** unless **Check for updates when the app starts** is turned off. For **`npm start`**, set **`CW_UPDATE_CHECK_DEV=1`** once if you need the same check in development.

### Build (developers)

Install dependencies (**use `npm run deps`** so TLS can pick up `.certs/npm-extra-ca.pem` if your proxy inspects HTTPS — see `scripts/TLS-README.txt`):

```powershell
npm run deps
npm run dist:nsis
```

`dist:nsis` stops **`CommunityWatch.exe`**, waits, clears **`dist-eb`** when possible; if **`app.asar` is locked**, it builds to **`dist-eb-<timestamp>`** automatically so installs still succeed.

Direct `electron .` remains `npm start` after deps are installed.
