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

### Build (developers)

Install dependencies (**use `npm run deps`** so TLS can pick up `.certs/npm-extra-ca.pem` if your proxy inspects HTTPS — see `scripts/TLS-README.txt`):

```powershell
npm run deps
npm run dist:nsis
```

`dist:nsis` stops **`CommunityWatch.exe`**, waits, clears **`dist-eb`** when possible; if **`app.asar` is locked**, it builds to **`dist-eb-<timestamp>`** automatically so installs still succeed.

Direct `electron .` remains `npm start` after deps are installed.
