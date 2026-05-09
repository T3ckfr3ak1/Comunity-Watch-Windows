## CommunityWatch Windows

This repo contains the Windows desktop client.

### Download
- Latest installer (versioned): `releases/CommunityWatch-Setup-<version>.exe`
- SHA256: `releases/CommunityWatch-Setup-<version>.exe.sha256`

### Privacy
- LAN discovery runs locally.
- MAC addresses are never displayed in the UI and are not sent to any server.

### Build (developers)

Install dependencies (**use `npm run deps`** so TLS can pick up `.certs/npm-extra-ca.pem` if your proxy inspects HTTPS — see `scripts/TLS-README.txt`):

```powershell
npm run deps
npm run dist:nsis
```

`dist:nsis` stops **`CommunityWatch.exe`**, waits, clears **`dist-eb`** when possible; if **`app.asar` is locked**, it builds to **`dist-eb-<timestamp>`** automatically so installs still succeed.

Direct `electron .` remains `npm start` after deps are installed.
