function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function nowIso() {
  return new Date().toISOString();
}

function setLog(obj) {
  $("log").textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

function setLanStatus(text) {
  $("lanStatus").textContent = text;
}

function normalizeBaseUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  return trimmed;
}

function buildBlindPayload() {
  // blind bark: no category, no location, no device info
  return {
    schema: "cw.bark.v1",
    mode: "blind",
    nonce: crypto.randomUUID(),
    sentAt: nowIso()
  };
}

function buildOptinPayload(category, country, region) {
  return {
    schema: "cw.bark.v1",
    mode: "optin",
    nonce: crypto.randomUUID(),
    sentAt: nowIso(),
    category,
    coarse_location: {
      country: String(country || "").trim().toUpperCase(),
      region: String(region || "").trim()
    }
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

async function init() {
  $("versionPill").textContent = `v${await window.cw.app.getVersion()}`;

  const bundled = await window.cw.intel.getBundledRules();
  $("intelSummary").textContent = `${bundled.version} (${bundled.rules?.length ?? 0} rules)`;

  const settings = await window.cw.settings.get();
  settings.apiBaseUrl = normalizeBaseUrl(settings.apiBaseUrl);

  $("apiBaseUrl").value = settings.apiBaseUrl;
  $("openSiteBtn").addEventListener("click", async () => {
    await window.cw.app.openSite();
  });

  const categories = bundled.categories || [
    "ai_related",
    "gov_foreign",
    "gov_domestic",
    "hacking_criminal",
    "university_scanning",
    "other",
    "unknown"
  ];
  const sel = $("category");
  sel.innerHTML = "";
  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }

  $("category").value = settings.optin?.category ?? "unknown";
  $("country").value = settings.optin?.coarseLocation?.country ?? "";
  $("region").value = settings.optin?.coarseLocation?.region ?? "";

  function applyMode(mode) {
    const isOptin = mode === "optin";
    $("optinToggle").checked = isOptin;
    $("optinPanel").style.display = isOptin ? "block" : "none";
  }

  applyMode(settings.barkMode);

  $("optinToggle").addEventListener("change", async () => {
    settings.barkMode = $("optinToggle").checked ? "optin" : "blind";
    applyMode(settings.barkMode);
    await window.cw.settings.set(settings);
    $("settingsSummary").textContent = `mode=${settings.barkMode}, api=${settings.apiBaseUrl}`;
  });

  $("saveBtn").addEventListener("click", async () => {
    settings.apiBaseUrl = normalizeBaseUrl($("apiBaseUrl").value);
    settings.optin = settings.optin || {};
    settings.optin.category = $("category").value;
    settings.optin.coarseLocation = {
      country: $("country").value,
      region: $("region").value
    };
    await window.cw.settings.set(settings);
    $("settingsSummary").textContent = `saved ${nowIso()}`;
    setLog({ ok: true, saved: settings });
  });

  $("testBtn").addEventListener("click", async () => {
    const base = normalizeBaseUrl(settings.apiBaseUrl);
    if (!base) return setLog({ ok: false, error: "Missing API base URL" });
    // Simple POST to /api/bark with blind payload.
    const url = `${base}/api/bark`;
    const payload = buildBlindPayload();
    setLog({ sendingTo: url, payload });
    const res = await postJson(url, payload);
    setLog({ sendingTo: url, payload, response: res });
  });

  $("sendBtn").addEventListener("click", async () => {
    const base = normalizeBaseUrl(settings.apiBaseUrl);
    if (!base) return setLog({ ok: false, error: "Missing API base URL" });

    if (settings.barkMode === "blind") {
      const url = `${base}/api/bark`;
      const payload = buildBlindPayload();
      setLog({ sendingTo: url, payload });
      const res = await postJson(url, payload);
      setLog({ sendingTo: url, payload, response: res });
      return;
    }

    const category = $("category").value;
    const country = $("country").value;
    const region = $("region").value;

    if (!category) return setLog({ ok: false, error: "Missing category" });
    if (!country) return setLog({ ok: false, error: "Missing coarse country" });

    const url = `${base}/api/bark/optin`;
    const payload = buildOptinPayload(category, country, region);
    setLog({ sendingTo: url, payload });
    const res = await postJson(url, payload);
    setLog({ sendingTo: url, payload, response: res });
  });

  $("settingsSummary").textContent = `mode=${settings.barkMode}, api=${settings.apiBaseUrl}`;
  setLog("Ready.");

  // Defaults: active scan ON unless user explicitly turned it off.
  const activeDefault =
    settings?.lan?.activeScanDefault === false ? false : true;
  $("activeScanToggle").checked = activeDefault;

  $("activeScanToggle").addEventListener("change", async () => {
    settings.lan = settings.lan || {};
    settings.lan.activeScanDefault = $("activeScanToggle").checked;
    await window.cw.settings.set(settings);
  });

  async function scanLan() {
    setLanStatus("scanning…");
    const active = $("activeScanToggle").checked;
    const res = await window.cw.lan.scan({ active });
    if (!res || res.ok === false) {
      setLanStatus("error");
      $("lanSubnets").textContent = "";
      $("lanDevices").textContent = JSON.stringify(res, null, 2);
      return;
    }
    setLanStatus(`ok @ ${new Date().toLocaleTimeString()}`);
    $("lanSubnets").textContent = JSON.stringify(res.subnets || [], null, 2);
    $("lanDevices").textContent = JSON.stringify(res.devices || [], null, 2);
  }

  $("scanLanBtn").addEventListener("click", scanLan);
  scanLan();
  setInterval(scanLan, 30_000);
}

init().catch((e) => {
  setLog({ ok: false, error: String(e?.stack || e) });
});

