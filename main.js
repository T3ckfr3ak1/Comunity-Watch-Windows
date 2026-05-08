const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const crypto = require("crypto");

const APP_VERSION = "0.2.7";

if (app.isPackaged && process.platform === "win32") {
  for (const sw of ["inspect-brk", "inspect", "inspect-port", "remote-debugging-port", "expose-internals"]) {
    try {
      app.commandLine.removeSwitch(sw);
    } catch {}
  }
}
const SITE_URL = "https://comunitywatch.com";

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
      activeScanDefault: true
    },
    intel: {
      rulesVersion: "bundled",
      lastUpdateIso: ""
    }
  };
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

