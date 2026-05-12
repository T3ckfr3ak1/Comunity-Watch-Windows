"use strict";

/**
 * Copies NSIS installer + SHA256 + consumer README into a PUBLIC repo clone,
 * then resets that clone so ONLY those artifacts remain (plus .git).
 *
 * Usage (after npm run dist:nsis):
 *   set PUBLIC_RELEASE_DIR=C:\path\to\public-repo-clone
 *   npm run release:public
 *
 * If PUBLIC_RELEASE_DIR contains a .git directory, all other paths are deleted
 * from the working tree, then the three artifacts are written, then
 * `git add -A` is run so stray source never stays staged. See docs/DUAL-PUSH.md.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const templatePath = path.join(__dirname, "public-release", "README.md.template");

function die(msg) {
  console.error("[release:public]", msg);
  process.exit(1);
}

function git(outRoot, args) {
  return spawnSync("git", ["-C", outRoot, ...args], { encoding: "utf8", shell: false });
}

/** When target is a git clone: remove everything except .git, then caller re-writes allowlisted files. */
function resetPublicCloneWorkingTree(outRoot) {
  const gitDir = path.join(outRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    console.info("[release:public] Target has no .git — not resetting tree (copy files only).");
    return;
  }
  if (process.env.CW_PUBLIC_SKIP_RESET === "1") {
    console.info("[release:public] CW_PUBLIC_SKIP_RESET=1 — not wiping public working tree.");
    return;
  }
  for (const name of fs.readdirSync(outRoot)) {
    if (name === ".git") continue;
    fs.rmSync(path.join(outRoot, name), { recursive: true, force: true });
  }
  console.info("[release:public] Public clone working tree cleared (kept .git only).");
}

function stageAllInPublicClone(outRoot) {
  const gitDir = path.join(outRoot, ".git");
  if (!fs.existsSync(gitDir)) return;
  if (process.env.CW_PUBLIC_SKIP_GIT_ADD === "1") {
    console.info("[release:public] CW_PUBLIC_SKIP_GIT_ADD=1 — run git add yourself.");
    return;
  }
  const add = git(outRoot, ["add", "-A"]);
  if (add.status !== 0) {
    console.warn("[release:public] git add -A failed:", add.stderr || add.stdout);
    return;
  }
  console.info("[release:public] Ran: git add -A");
  const st = git(outRoot, ["status", "--short"]);
  if (st.stdout) console.info(st.stdout);
}

function findInstallerExe(version) {
  const hits = [];

  function scanDir(rel) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
    for (const name of fs.readdirSync(abs)) {
      if (!/^ComunityWatch Setup .+\.exe$/i.test(name)) continue;
      if (name.includes("__uninstaller")) continue;
      hits.push(path.join(abs, name));
    }
  }

  scanDir("dist-eb");
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (name.startsWith("dist-eb-")) scanDir(name);
  }

  if (!hits.length) return null;
  const exact = hits.find((p) => p.endsWith(`ComunityWatch Setup ${version}.exe`));
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

  const outRootRaw = process.env.PUBLIC_RELEASE_DIR || path.join(root, "..", "ComunityWatch-Windows-Public");
  const outRoot = path.resolve(outRootRaw);
  const relDir = path.join(outRoot, "releases");

  const srcExe = findInstallerExe(version);
  if (!srcExe) {
    die(
      `No "ComunityWatch Setup ${version}.exe" found under dist-eb or dist-eb-*. Run: npm run dist:nsis`
    );
  }

  resetPublicCloneWorkingTree(outRoot);

  fs.mkdirSync(relDir, { recursive: true });
  const outName = `ComunityWatch-Setup-${version}.exe`;
  const destExe = path.join(relDir, outName);

  fs.copyFileSync(srcExe, destExe);
  const hex = sha256File(destExe);
  const shaPath = `${destExe}.sha256`;
  fs.writeFileSync(shaPath, `${hex}  ${outName}\n`, "utf8");

  if (!fs.existsSync(templatePath)) die(`Missing template: ${templatePath}`);
  let tmpl = fs.readFileSync(templatePath, "utf8");
  tmpl = tmpl.replace(/\{\{VERSION\}\}/g, version);

  fs.writeFileSync(path.join(outRoot, "README.md"), tmpl, "utf8");

  stageAllInPublicClone(outRoot);

  console.info("[release:public] Wrote:");
  console.info(" ", path.join(outRoot, "README.md"));
  console.info(" ", shaPath);
  console.info(" ", destExe);
  console.info("");
  console.info("Next (public clone): git commit -m \"Release " + version + "\" && git push public main");
  console.info("Next (private source): git push private main");
  console.info("See docs/DUAL-PUSH.md");
}

main();
