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

function buildOptinPayload(country, region) {
  return {
    schema: "cw.bark.v1",
    mode: "optin",
    nonce: crypto.randomUUID(),
    sentAt: nowIso(),
    // Category is determined by the app's classifier; user does not pick it.
    // For manual testing until the classifier is wired, we send "unknown".
    category: "unknown",
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

  $("country").value = settings.optin?.coarseLocation?.country ?? "";
  $("region").value = settings.optin?.coarseLocation?.region ?? "";

  let persistLocTimer = null;
  async function persistCoarseLocation() {
    settings.optin = settings.optin || {};
    settings.optin.coarseLocation = {
      country: $("country").value,
      region: $("region").value
    };
    await window.cw.settings.set(settings);
    $("settingsSummary").textContent = `mode=${settings.barkMode}, api=${settings.apiBaseUrl}`;
  }
  function schedulePersistCoarseLocation() {
    clearTimeout(persistLocTimer);
    persistLocTimer = setTimeout(() => persistCoarseLocation(), 380);
  }
  $("country").addEventListener("input", schedulePersistCoarseLocation);
  $("region").addEventListener("input", schedulePersistCoarseLocation);
  $("country").addEventListener("change", () => persistCoarseLocation());
  $("region").addEventListener("change", () => persistCoarseLocation());

  function applyMode(mode) {
    const isOptin = mode === "optin";
    $("optinToggle").checked = isOptin;
    $("optinPanel").style.display = isOptin ? "block" : "none";
  }

  applyMode(settings.barkMode);

  $("optinToggle").addEventListener("change", async () => {
    settings.barkMode = $("optinToggle").checked ? "optin" : "blind";
    settings.optin = settings.optin || {};
    settings.optin.coarseLocation = {
      country: $("country").value,
      region: $("region").value
    };
    applyMode(settings.barkMode);
    clearTimeout(persistLocTimer);
    await window.cw.settings.set(settings);
    $("settingsSummary").textContent = `mode=${settings.barkMode}, api=${settings.apiBaseUrl}`;
  });

  $("saveBtn").addEventListener("click", async () => {
    settings.apiBaseUrl = normalizeBaseUrl($("apiBaseUrl").value);
    settings.optin = settings.optin || {};
    settings.optin.coarseLocation = {
      country: $("country").value,
      region: $("region").value
    };
    clearTimeout(persistLocTimer);
    await window.cw.settings.set(settings);
    $("settingsSummary").textContent = `saved ${nowIso()}`;
    setLog({ ok: true, saved: settings });
  });

  const liveEvents = [];
  const liveScrollWrap = /** @type {HTMLDivElement} */ ($("liveScrollWrap"));
  const LIVE_BOTTOM_SLACK_PX = 28;
  /** When true, append new lines scroll the feed to the newest entry (bottom). */
  let liveStickToBottom = true;

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function syncLiveStickFromScroll() {
    const gap = liveScrollWrap.scrollHeight - liveScrollWrap.clientHeight - liveScrollWrap.scrollTop;
    liveStickToBottom = gap <= LIVE_BOTTOM_SLACK_PX;
  }

  liveScrollWrap.addEventListener("scroll", syncLiveStickFromScroll, { passive: true });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!liveStickToBottom) return;
      requestAnimationFrame(() => {
        liveScrollWrap.scrollTop = liveScrollWrap.scrollHeight;
      });
    });
    ro.observe(liveScrollWrap);
  }

  function scrollLiveIfPinned() {
    if (!liveStickToBottom) return;
    liveScrollWrap.scrollTop = liveScrollWrap.scrollHeight;
  }

  function refreshLiveDOM() {
    $("liveView").innerHTML = liveEvents
      .map((e) => {
        const prefix =
          e.kind === "bark" ? "[BARK]" : e.kind === "tcp" ? "[PC-TCP]" : `[${e.kind.toUpperCase()}]`;
        let msg =
          typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload);
        if ((e.kind === "tcp" || e.kind === "web") && e.payload && typeof e.payload === "object") {
          const p = /** @type {any} */ (e.payload);
          if (p.lines && Array.isArray(p.lines))
            msg = `${p.summary || ""}\n${p.lines.join("\n")}`;
          else if (p.summary) msg = p.summary;
        }
        const cls =
          e.kind === "bark" ? "evt bark" : e.kind === "tcp" ? "evt tcp" : "evt";
        return `<div class="${cls}">${escapeHtml(`${e.ts} ${prefix} ${msg}`)}</div>`;
      })
      .join("");
    requestAnimationFrame(() => {
      scrollLiveIfPinned();
    });
  }

  function pushLive(kind, payload) {
    liveEvents.push({
      ts: new Date().toLocaleTimeString(),
      kind,
      payload
    });
    while (liveEvents.length > 150) liveEvents.shift();
    refreshLiveDOM();
  }

  /** Established TCP on this PC (OS socket table; not payloads). */
  async function pollPcTcpTraffic() {
    const res = await window.cw.traffic.getPcTcpFlows();
    if (!res || res.ok === false) {
      pushLive("tcp", { summary: String(res?.error || "traffic unavailable"), lines: [] });
      return;
    }
    const flows = res.flows || [];
    if (flows.length === 0) {
      pushLive("tcp", {
        summary: "(this PC) 0 established TCP flows listed by the OS right now.",
        lines: []
      });
      return;
    }
    const lines = flows.slice(0, 72).map((f) => {
      const pn = f.proc || "?";
      const pid = f.pid != null ? f.pid : "?";
      return `${pn}:${pid}  ${f.local} → ${f.remote}`;
    });
    const capNote = flows.length >= 420 ? "+ (truncated)" : "";
    pushLive("tcp", { summary: `this PC: ${flows.length} TCP flows ${capNote}`.trim(), lines });
  }

  $("testBtn").addEventListener("click", async () => {
    const base = normalizeBaseUrl(settings.apiBaseUrl);
    if (!base) return setLog({ ok: false, error: "Missing API base URL" });
    // Simple POST to /api/bark with blind payload.
    const url = `${base}/api/bark`;
    const payload = buildBlindPayload();
    setLog({ sendingTo: url, payload });
    const res = await postJson(url, payload);
    setLog({ sendingTo: url, payload, response: res });
    pushLive("bark", { mode: "blind", sendingTo: url, status: res.status, ok: res.ok });
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
      pushLive("bark", { mode: "blind", sendingTo: url, status: res.status, ok: res.ok });
      return;
    }

    const country = $("country").value;
    const region = $("region").value;

    if (!country) return setLog({ ok: false, error: "Missing coarse country" });

    const url = `${base}/api/bark/optin`;
    const payload = buildOptinPayload(country, region);
    setLog({ sendingTo: url, payload });
    const res = await postJson(url, payload);
    setLog({ sendingTo: url, payload, response: res });
    pushLive("bark", { mode: "optin", sendingTo: url, status: res.status, ok: res.ok, category: payload.category });
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
    pushLive("lan", { active, devices: (res.devices || []).length });
  }

  $("scanLanBtn").addEventListener("click", scanLan);
  scanLan();
  setInterval(scanLan, 30_000);

  pollPcTcpTraffic();
  setInterval(pollPcTcpTraffic, 3500);
}

init().catch((e) => {
  setLog({ ok: false, error: String(e?.stack || e) });
});

