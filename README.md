## CommunityWatch Windows

This repo contains the Windows desktop client.

### Download
- Latest installer (versioned): `releases/CommunityWatch-Setup-<version>.exe`
- SHA256: `releases/CommunityWatch-Setup-<version>.exe.sha256`

### Privacy
- LAN discovery runs locally.
- MAC addresses are never displayed in the UI and are not sent to any server.

### Build (developers)

```powershell
npm install
npm run dist:nsis
```
