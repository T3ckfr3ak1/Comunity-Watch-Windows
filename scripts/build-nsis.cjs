"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killComunityWatch() {
  if (process.platform !== "win32") return;
  spawnSync("taskkill", ["/IM", "ComunityWatch.exe", "/F"], {
    stdio: "ignore",
    shell: true,
    windowsHide: true
  });
  spawnSync("taskkill", ["/IM", "CommunityWatch.exe", "/F"], {
    stdio: "ignore",
    shell: true,
    windowsHide: true
  });
}

async function tryRemoveDir(dir, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return true;
    } catch {
      await sleep(700);
    }
  }
  return false;
}

function stampOutDir() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const s = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
  return `dist-eb-${s}`;
}

async function main() {
  process.chdir(root);

  const defaultOut = "dist-eb";
  let outDir = defaultOut;

  killComunityWatch();
  await sleep(1200);

  const distAbs = path.join(root, defaultOut);
  if (fs.existsSync(distAbs)) {
    const cleared = await tryRemoveDir(distAbs);
    if (!cleared) {
      outDir = stampOutDir();
      console.warn(
        `[dist:nsis] Could not remove "${defaultOut}" (file in use?). Building to ./${outDir} instead.\n` +
          "          Quit ComunityWatch / close folders under dist-eb, then delete stale output if you want.\n"
      );
    }
  }

  const r = spawnSync(
    "npx",
    ["electron-builder", "--win", "nsis", `--config.directories.output=${outDir}`, "--publish", "never"],
    {
      stdio: "inherit",
      shell: true,
      cwd: root,
      env: process.env
    }
  );
  process.exit(r.status !== 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[dist:nsis]", e);
  process.exit(1);
});
