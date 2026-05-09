"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function main() {
  process.chdir(root);
  const extra = path.join(root, ".certs", "npm-extra-ca.pem");
  const env = { ...process.env };
  if (fs.existsSync(extra)) {
    env.NODE_EXTRA_CA_CERTS = path.resolve(extra);
    console.info("[deps] Using NODE_EXTRA_CA_CERTS:", env.NODE_EXTRA_CA_CERTS);
  } else {
    console.info("[deps] No .certs/npm-extra-ca.pem — Node uses its default CA store.");
    console.info("[deps] If npm fails with certificate errors, add your org root PEM and run again.");
  }

  const argv = process.argv.slice(2);
  if (!argv.length) {
    console.error("Usage: npm run deps   (or: node scripts/npm-with-ca.cjs install [...])");
    process.exit(1);
  }

  const r = spawnSync("npm", argv, { stdio: "inherit", shell: true, env, cwd: root });
  process.exit(r.status === null ? 1 : r.status);
}

main();
