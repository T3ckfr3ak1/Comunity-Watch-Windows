"use strict";

/**
 * Copies a built NSIS installer + SHA256 + consumer README into a separate
 * directory (normally a clone of your minimal PUBLIC GitHub repo).
 *
 * Usage (after npm run dist:nsis):
 *   set PUBLIC_RELEASE_DIR=C:\path\to\public-repo-clone
 *   npm run release:public
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const templatePath = path.join(__dirname, "public-release", "README.md.template");

function die(msg) {
  console.error("[release:public]", msg);
  process.exit(1);
}

function findInstallerExe(version) {
  const hits = [];

  function scanDir(rel) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
    for (const name of fs.readdirSync(abs)) {
      if (!/^CommunityWatch Setup .+\.exe$/i.test(name)) continue;
      if (name.includes("__uninstaller")) continue;
      hits.push(path.join(abs, name));
    }
  }

  scanDir("dist-eb");
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (name.startsWith("dist-eb-")) scanDir(name);
  }

  if (!hits.length) return null;
  const exact = hits.find((p) => p.endsWith(`CommunityWatch Setup ${version}.exe`));
  const pick = exact || hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return pick;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const version = pkg.version || die("package.json missing version");

  const outRootRaw = process.env.PUBLIC_RELEASE_DIR || path.join(root, "..", "CommunityWatch-Windows-Public");
  const outRoot = path.resolve(outRootRaw);
  const relDir = path.join(outRoot, "releases");

  const srcExe = findInstallerExe(version);
  if (!srcExe) {
    die(
      `No "CommunityWatch Setup ${version}.exe" found under dist-eb or dist-eb-*. Run: npm run dist:nsis`
    );
  }

  fs.mkdirSync(relDir, { recursive: true });
  const outName = `CommunityWatch-Setup-${version}.exe`;
  const destExe = path.join(relDir, outName);

  fs.copyFileSync(srcExe, destExe);
  const hex = sha256File(destExe);
  const shaPath = `${destExe}.sha256`;
  fs.writeFileSync(
    shaPath,
    `${hex}  ${outName}\n`,
    "utf8"
  );

  if (!fs.existsSync(templatePath)) die(`Missing template: ${templatePath}`);
  let tmpl = fs.readFileSync(templatePath, "utf8");
  tmpl = tmpl.replace(/\{\{VERSION\}\}/g, version);

  fs.writeFileSync(path.join(outRoot, "README.md"), tmpl, "utf8");

  console.info("[release:public] Wrote:");
  console.info(" ", path.join(outRoot, "README.md"));
  console.info(" ", shaPath);
  console.info(" ", destExe);
  console.info("");
  console.info("Next: cd \"" + outRoot + "\" && git status");
  console.info("(commit and push ONLY this public repo)");
}

main();
