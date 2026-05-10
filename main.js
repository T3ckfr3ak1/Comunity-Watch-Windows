const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const crypto = require("crypto");

const APP_VERSION = "0.3.0";

if (app.isPackaged && process.platform === "win32") {
  for (const sw of ["inspect-brk", "inspect", "inspect-port", "remote-debugging-port", "expose-internals"]) {
    try {
      app.commandLine.removeSwitch(sw);
    } catch {}
  }
}
const SITE_URL = "https://comunitywatch.com";
/** Server JSON describing latest Windows build (see README “Update manifest”). */
const UPDATE_MANIFEST_URL = `${SITE_URL}/upload`;

let mainWindow = null;
let tray = null;
let isQuitting = false;

function userDataPath(...segments) {
  return path.join(app.getPath("userData"), ...segments);
}

const SETTINGS_FILE = "settings.json";
const INSTALL_SALT_FILE = "install_salt.txt";

function readJsonSafe(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function getOrCreateInstallSalt() {
  const fp = userDataPath(INSTALL_SALT_FILE);
  try {
    const raw = fs.readFileSync(fp, "utf8").trim();
    if (raw && raw.length >= 16) return raw;
  } catch {}
  const salt = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, salt, "utf8");
  return salt;
}

function anonymizeMacToId(mac) {
  // MAC must never leave the app. We only derive a stable local-only ID using a per-install salt.
  const salt = getOrCreateInstallSalt();
  const norm = String(mac || "")
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
  if (norm.length < 12) return null;
  const h = crypto.createHash("sha256").update(`${salt}:${norm}`).digest("hex");
  return `dev_${h.slice(0, 12)}`;
}

function defaultSettings() {
  return {
    apiBaseUrl: SITE_URL,
    barkMode: "blind", // blind | optin
    optin: {
      category: "unknown",
      coarseLocation: { country: "", region: "" },
      allowedCategories: "all"
    },
    lan: {
      // Passive only by default: active ping sweeps look like “network scans” on home routers/AV.
      activeScanDefault: false
    },
    intel: {
      rulesVersion: "bundled",
      lastUpdateIso: ""
    },
    updates: {
      checkOnStartup: true
    }
  };
}

function semverParts(v) {
  const s = String(v || "")
    .trim()
    .replace(/^v/i, "");
  const core = s.split(/[-+]/)[0] || "";
  return core.split(".").map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** True if a is strictly newer than b (numeric semver segments). */
function semverGt(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

function isTrustedDownloadUrl(href) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "comunitywatch.com" || h.endsWith(".comunitywatch.com")) return true;
  if (h === "github.com" || h.endsWith(".github.com")) return true;
  if (h === "objects.githubusercontent.com") return true;
  if (h.endsWith(".githubusercontent.com")) return true;
  return false;
}

function resolveDownloadUrl(manifestUrl, urlStr) {
  const u = String(urlStr || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  try {
    const base = new URL(manifestUrl);
    return new URL(u, base.origin).href;
  } catch {
    return "";
  }
}

/**
 * Parse JSON from /upload. Expected keys: latestVersion|version, downloadUrl|installerUrl|url, notes (optional).
 */
function parseUpdateManifest(text, manifestUrl) {
  const raw = String(text || "").trim();
  if (!raw || raw[0] !== "{") return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  const ver =
    obj.latestVersion != null
      ? String(obj.latestVersion).trim()
      : obj.version != null
        ? String(obj.version).trim()
        : obj.app_version != null
          ? String(obj.app_version).trim()
          : "";
  if (!ver || !semverParts(ver).length) return null;

  const urlRaw =
    obj.downloadUrl != null
      ? obj.downloadUrl
      : obj.installerUrl != null
        ? obj.installerUrl
        : typeof obj.url === "string"
          ? obj.url
          : "";
  const downloadUrl = resolveDownloadUrl(manifestUrl, urlRaw);

  const notes =
    obj.notes != null
      ? String(obj.notes)
      : obj.changelog != null
        ? String(obj.changelog)
        : obj.message != null
          ? String(obj.message)
          : "";

  return { version: ver, downloadUrl, notes };
}

async function fetchUpdateManifest() {
  const res = await fetch(UPDATE_MANIFEST_URL, {
    redirect: "follow",
    headers: {
      Accept: "application/json, text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": `CommunityWatch/${APP_VERSION} (Windows; Electron)`
    }
  });
  if (!res.ok) return null;
  const text = await res.text();
  return parseUpdateManifest(text, UPDATE_MANIFEST_URL);
}

async function downloadInstallerToTemp(urlStr, versionTag) {
  if (!isTrustedDownloadUrl(urlStr)) {
    throw new Error("Update download URL is not from an allowed host (HTTPS only).");
  }
  const safeVer = String(versionTag || "latest").replace(/[^0-9a-z._-]/gi, "_");
  const dest = path.join(app.getPath("temp"), `CommunityWatch-Setup-${safeVer}.exe`);
  const res = await fetch(urlStr, {
    redirect: "follow",
    headers: { "User-Agent": `CommunityWatch/${APP_VERSION} (Windows)` }
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("Downloaded file does not look like a Windows installer (.exe).");
  }
  await fs.promises.writeFile(dest, buf);
  return dest;
}

let updateDialogLock = false;

async function offerDownloadAndInstall(latestVersion, downloadUrl, notes) {
  if (updateDialogLock) return;
  updateDialogLock = true;
  try {
    const detailLines = [
      `You are running ${APP_VERSION}.`,
      notes ? String(notes).slice(0, 800) : ""
    ].filter(Boolean);
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const choice = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: "info",
      title: "CommunityWatch update",
      message: `Version ${latestVersion} is available.`,
      detail: detailLines.join("\n\n"),
      buttons: ["Download and install", "Not now"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (choice.response !== 0) return;

    if (!downloadUrl) {
      await shell.openExternal(SITE_URL);
      return;
    }

    const dest = await downloadInstallerToTemp(downloadUrl, latestVersion);
    const err = await shell.openPath(dest);
    if (err) {
      await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: "warning",
        title: "CommunityWatch",
        message: "Could not start the installer automatically.",
        detail: err + "\n\nThe file was saved to:\n" + dest,
        buttons: ["OK"]
      });
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: "error",
      title: "Update failed",
      message: "Could not download the update.",
      detail: msg,
      buttons: ["OK"]
    });
  } finally {
    updateDialogLock = false;
  }
}

/** Startup: quiet on errors; prompt only when a newer semver is published. */
async function checkForUpdatesOnStartup() {
  const settings = loadSettings();
  if (settings.updates && settings.updates.checkOnStartup === false) return;
  if (!app.isPackaged && process.env.CW_UPDATE_CHECK_DEV !== "1") return;
  try {
    const m = await fetchUpdateManifest();
    if (!m || !semverGt(m.version, APP_VERSION)) return;
    setTimeout(() => {
      offerDownloadAndInstall(m.version, m.downloadUrl, m.notes).catch(() => {});
    }, 2800);
  } catch {
    /* offline or bad payload */
  }
}

/** User invoked: show outcome (errors, or already latest). */
async function checkForUpdatesInteractive() {
  try {
    const m = await fetchUpdateManifest();
    if (!m) {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: "warning",
        title: "CommunityWatch",
        message: "Could not check for updates.",
        detail: `No valid version information was returned from\n${UPDATE_MANIFEST_URL}`,
        buttons: ["OK"]
      });
      return { ok: false, error: "no_manifest" };
    }
    if (!semverGt(m.version, APP_VERSION)) {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: "info",
        title: "CommunityWatch",
        message: "You’re up to date.",
        detail: `Current version: ${APP_VERSION}\nLatest reported: ${m.version}`,
        buttons: ["OK"]
      });
      return { ok: true, upToDate: true, current: APP_VERSION, latest: m.version };
    }
    await offerDownloadAndInstall(m.version, m.downloadUrl, m.notes);
    return { ok: true, offered: true, latest: m.version };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: "warning",
      title: "CommunityWatch",
      message: "Update check failed.",
      detail: msg,
      buttons: ["OK"]
    });
    return { ok: false, error: msg };
  }
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(base)) return isPlainObject(patch) ? { ...patch } : patch;
  if (!isPlainObject(patch)) return { ...base };
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    if (isPlainObject(pv) && isPlainObject(base[k])) out[k] = deepMerge(base[k], pv);
    else out[k] = pv;
  }
  return out;
}

function loadSettings() {
  const fp = userDataPath(SETTINGS_FILE);
  return deepMerge(defaultSettings(), readJsonSafe(fp, {}));
}

function saveSettings(next) {
  const fp = userDataPath(SETTINGS_FILE);
  writeJsonAtomic(fp, next);
  return next;
}

function getTrayIcon() {
  // Windows tray is happiest with a real .ico.
  const candidates = [
    // packaged app
    path.join(process.resourcesPath || "", "assets", "tray.ico"),
    // dev / unpackaged
    path.join(__dirname, "assets", "tray.ico"),
    // fallback: square png
    path.join(process.resourcesPath || "", "assets", "icon-square.png"),
    path.join(__dirname, "assets", "icon-square.png")
  ];

  for (const p of candidates) {
    try {
      if (!p) continue;
      if (!fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    } catch {}
  }

  // Last resort: attempt to derive something from the executable.
  try {
    const img = nativeImage.createFromPath(process.execPath);
    if (!img.isEmpty()) return img;
  } catch {}

  return nativeImage.createEmpty();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "Show CommunityWatch",
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { label: "Open comunitywatch.com", click: () => shell.openExternal(SITE_URL) },
    {
      label: "Check for updates...",
      click: () => {
        checkForUpdatesInteractive().catch(() => {});
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function ensureTray() {
  if (tray) return tray;
  tray = new Tray(getTrayIcon());
  tray.setToolTip("CommunityWatch");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
  return tray;
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#0a0f14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (app.isPackaged) {
    win.webContents.on("before-input-event", (_e, input) => {
      if (input.type !== "keyDown") return;
      if (input.code === "F12") {
        _e.preventDefault();
        return;
      }
      if (input.control && input.shift && (input.code === "KeyI" || input.code === "KeyJ" || input.code === "KeyC")) {
        _e.preventDefault();
      }
    });
    win.webContents.on("devtools-opened", () => {
      win.webContents.closeDevTools();
    });
  }

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => {
    if (isQuitting) return;
    e.preventDefault();
    ensureTray();
    win.hide();
  });

  return win;
}

app.whenReady().then(() => {
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  }
  mainWindow = createMainWindow();
  ensureTray();
  checkForUpdatesOnStartup();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    else mainWindow?.show();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") return;
});

ipcMain.handle("app:getVersion", async () => APP_VERSION);
ipcMain.handle("app:openSite", async () => shell.openExternal(SITE_URL));

ipcMain.handle("settings:get", async () => loadSettings());
ipcMain.handle("settings:set", async (_evt, next) => saveSettings(next));

ipcMain.handle("intel:getBundledRules", async () => {
  const fp = path.join(__dirname, "intel", "rules.bundled.json");
  return readJsonSafe(fp, { version: "bundled", categories: [], rules: [] });
});

ipcMain.handle("updates:checkNow", async () => checkForUpdatesInteractive());

function runPowerShellJson(script) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message || "PowerShell failed"));
          return;
        }
        const text = String(stdout || "").trim();
        try {
          resolve(text ? JSON.parse(text) : null);
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${String(e)}\nRaw:\n${text.slice(0, 2000)}`));
        }
      }
    );
  });
}

ipcMain.handle("lan:scan", async (_evt, opts) => {
  const active = Boolean(opts && opts.active === true);
  // Returns an inventory of devices on the current LAN based on Windows neighbor/ARP data.
  // Note: This discovers devices on the local broadcast domain; it does not capture traffic of other devices.
  const script = `
$ErrorActionPreference = 'SilentlyContinue'

function ConvertTo-UInt32([string]$ip) {
  $bytes = [System.Net.IPAddress]::Parse($ip).GetAddressBytes()
  [Array]::Reverse($bytes)
  return [BitConverter]::ToUInt32($bytes, 0)
}
function ConvertFrom-UInt32([uint32]$n) {
  $bytes = [BitConverter]::GetBytes($n)
  [Array]::Reverse($bytes)
  return ([System.Net.IPAddress]::new($bytes)).ToString()
}
function PrefixToMask([int]$prefix) {
  if ($prefix -le 0) { return [uint32]0 }
  if ($prefix -ge 32) { return [uint32]0xFFFFFFFF }
  return [uint32]((0xFFFFFFFF -shl (32 - $prefix)) -band 0xFFFFFFFF)
}
function Get-HostRange([string]$ip, [int]$prefix) {
  $ipN = ConvertTo-UInt32 $ip
  $mask = PrefixToMask $prefix
  $net = $ipN -band $mask
  $bcast = $net + (0xFFFFFFFF -bxor $mask)
  $start = $net + 1
  $end = $bcast - 1
  return [pscustomobject]@{ start = $start; end = $end; count = ($end - $start + 1) }
}

$cfgs = Get-NetIPConfiguration | Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' }
$subnets = @()
foreach ($c in $cfgs) {
  foreach ($ip in $c.IPv4Address) {
    $subnets += [pscustomobject]@{
      ifIndex = $c.NetAdapter.ifIndex
      interfaceAlias = $c.InterfaceAlias
      ipv4 = $ip.IPAddress
      prefixLength = $ip.PrefixLength
    }
  }
}

# Optional active scan: ping a capped set of addresses to populate ARP/neighbor table.
${active ? `
foreach ($s in $subnets) {
  try {
    $range = Get-HostRange $s.ipv4 $s.prefixLength
    # Cap to avoid huge /16 scans: max 512 probes.
    if ($range.count -gt 512) { continue }
    for ($n = $range.start; $n -le $range.end; $n++) {
      $addr = ConvertFrom-UInt32 ([uint32]$n)
      if ($addr -eq $s.ipv4) { continue }
      Test-Connection -Quiet -Count 1 -TimeoutSeconds 1 $addr | Out-Null
    }
  } catch {}
}
` : ""}

# Prime neighbor table (best-effort)
try { Get-NetNeighbor -AddressFamily IPv4 | Out-Null } catch {}

$neighbors = @()
try {
  $neighbors = Get-NetNeighbor -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -and $_.LinkLayerAddress -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' } |
    Select-Object IPAddress, LinkLayerAddress, State, InterfaceIndex
} catch {
  $neighbors = @()
}

# Fallback to arp -a parsing if needed
if (-not $neighbors -or $neighbors.Count -eq 0) {
  $arp = arp -a 2>$null
  $neighbors = @()
  foreach ($line in $arp) {
    if ($line -match '^(\\s*)(\\d+\\.\\d+\\.\\d+\\.\\d+)\\s+([0-9a-fA-F-]{17})\\s+(dynamic|static)') {
      $neighbors += [pscustomobject]@{ IPAddress=$Matches[2]; LinkLayerAddress=$Matches[3]; State=$Matches[4]; InterfaceIndex=$null }
    }
  }
}

[pscustomobject]@{
  ok = $true
  scannedAt = (Get-Date).ToString('o')
  subnets = $subnets
  devices = $neighbors
} | ConvertTo-Json -Depth 6 -Compress
`;

  try {
    const raw = await runPowerShellJson(script);
    if (!raw || raw.ok === false) return raw;

    // Privacy: MAC addresses must never leave the app process.
    // Convert to anonymized device IDs and drop LinkLayerAddress entirely.
    const devices = Array.isArray(raw.devices) ? raw.devices : [];
    const sanitized = devices
      .map((d) => {
        const ip = d && d.IPAddress ? String(d.IPAddress) : "";
        const mac = d && d.LinkLayerAddress ? String(d.LinkLayerAddress) : "";
        const deviceId = anonymizeMacToId(mac) || null;
        return {
          deviceId,
          ip,
          state: d && d.State ? String(d.State) : "",
          interfaceIndex: d && d.InterfaceIndex != null ? d.InterfaceIndex : null
        };
      })
      .filter((d) => d.ip);

    return {
      ok: true,
      scannedAt: raw.scannedAt,
      subnets: raw.subnets || [],
      devices: sanitized,
      privacy: {
        macsExposed: false,
        note: "MAC addresses are never returned to the UI; deviceId is derived locally using a per-install salt."
      }
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

/** Established TCP on this PC (what the OS exposes). Not payload inspection; LAN-wide mirror is separate. */
ipcMain.handle("traffic:getPcTcpFlows", async () => {
  const psLines = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$flows=@()",
    "try {",
    "  $procMap=@{}",
    "  Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $procMap[$_.Id]=$_.ProcessName }",
    "  $conns = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Select-Object -First 650 LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess",
    "  foreach ($c in $conns) {",
    "    $ownId=$c.OwningProcess",
    "    $pn=$null",
    "    if ($null -ne $ownId -and $ownId -gt 0) { try { $pn=$procMap[[int]$ownId] } catch {} }",
    "    $la=$c.LocalAddress; $ra=$c.RemoteAddress",
    "    $pidOut=$null",
    "    if ($null -ne $ownId -and $ownId -gt 0) { try { $pidOut=[int]$ownId } catch {} }",
    "    $flows += [pscustomobject]@{ local=($la.ToString()+':'+[int]$c.LocalPort); remote=($ra.ToString()+':'+[int]$c.RemotePort); pid=$pidOut; proc=$pn }",
    "  }",
    "} catch {}",
    "@{ ok=$true; at=(Get-Date).ToUniversalTime().ToString('o'); flows=$flows } | ConvertTo-Json -Depth 6 -Compress"
  ];
  const script = psLines.join("\n");

  try {
    const raw = await runPowerShellJson(script);
    if (!raw || raw.ok === false) return raw || { ok: false, error: "traffic query failed" };

    let flows = raw.flows;
    if (!flows) flows = [];
    if (!Array.isArray(flows)) flows = [flows];

    const seen = new Set();
    const deduped = [];
    for (const f of flows) {
      const local = f.local != null ? String(f.local) : "";
      const remote = f.remote != null ? String(f.remote) : "";
      const key = `${local}->${remote}`;
      if (!local || seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        local,
        remote,
        pid: f.pid != null ? Number(f.pid) : null,
        proc: f.proc != null ? String(f.proc) : null
      });
      if (deduped.length >= 420) break;
    }

    return {
      ok: true,
      at: raw.at,
      flows: deduped,
      scope: "This PC only: established TCP sockets the OS reports (no packet capture; HTTPS payloads not visible)."
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

