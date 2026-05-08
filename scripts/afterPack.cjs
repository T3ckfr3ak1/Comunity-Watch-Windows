"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Patch the packaged Windows executable with Electron fuses after electron-builder unpacks it.
 * @see https://www.electronjs.org/docs/latest/tutorial/fuses
 */
module.exports = async function afterPack(context) {
  if (process.env.CW_SKIP_FUSES === "1") {
    console.info("[afterPack] CW_SKIP_FUSES=1 — skipping fuse hardening.");
    return;
  }
  if (context.electronPlatformName !== "win32") return;

  const productExe = `${context.packager.appInfo.productFilename}.exe`;
  const exeAbs = path.join(context.appOutDir, productExe);
  if (!fs.existsSync(exeAbs)) {
    console.warn("[afterPack] Executable not found, skip fuses:", exeAbs);
    return;
  }

  let flipFuses;
  let FuseVersion;
  let FuseV1Options;
  try {
    const mod = await import("@electron/fuses");
    flipFuses = mod.flipFuses;
    FuseVersion = mod.FuseVersion;
    FuseV1Options = mod.FuseV1Options;
  } catch (err) {
    console.warn("[afterPack] @electron/fuses not available — fuse hardening skipped:", err.message);
    return;
  }

  const config = {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: false,
    resetAdHocDarwinSignature: false,
    /* Block “Electron as ordinary Node.js” impersonation tricks. */
    [FuseV1Options.RunAsNode]: false,
    /* Helps keep disk cookie stores less trivially readable offline. */
    [FuseV1Options.EnableCookieEncryption]: true,
    /* Neutralize NODE_OPTIONS / --inspect*-style escalation via env + CLI embedding. */
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    /*
     * Intentionally INHERIT defaults for integrity / WASM / file-privilege fuses —
     * toggling blindly has caused startup regressions depending on Electron + builder versions.
     */
  };

  try {
    await flipFuses(exeAbs, config);
    console.info("[afterPack] Electron fuses patched:", exeAbs);
  } catch (err) {
    console.warn("[afterPack] flipFuses failed — build continues without fuse patch:", err?.message || err);
  }
};
