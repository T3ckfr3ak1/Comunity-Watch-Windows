# Private source + public installer-only

## One-time Git setup (from `Windows App/`)

1. **Private repo** (full source): create empty repo on GitHub, then:

   ```powershell
   git remote add private git@github.com:YOUR_ORG/ComunityWatch-Windows-private.git
   ```

2. **Public repo** (installer + README only): create **empty** repo, clone it to a folder, e.g.  
   `C:\dev\releases\ComunityWatch-Windows-public`

   ```powershell
   git remote add public git@github.com:YOUR_ORG/ComunityWatch-Windows-public.git
   ```

   If your current `origin` still points at the old public URL, rename it so you do not push source there by mistake:

   ```powershell
   git remote rename origin public
   git remote add private git@github.com:YOUR_ORG/ComunityWatch-Windows-private.git
   ```

## Every release

From **`Windows App/`** (after `npm run dist:nsis`):

```powershell
$env:PUBLIC_RELEASE_DIR = "C:\path\to\ComunityWatch-Windows-public-clone"
npm run release:public
```

`release:public` copies **only** `README.md` + `releases/ComunityWatch-Setup-<ver>.exe` + `.sha256`, then **sanitizes** the public clone: any other **tracked** file is `git rm`’d and **untracked** junk is removed (`git clean -fdx`). To skip sanitize (not recommended): `CW_PUBLIC_SKIP_SANITIZE=1`.

Then in the **public clone**:

```powershell
cd C:\path\to\ComunityWatch-Windows-public-clone
git add README.md releases
git status   # should show ONLY those paths
git commit -m "Release 0.x.y"
git push public main
```

Push **full source** to the private remote (from `Windows App/`):

```powershell
git push private main
```

Or use **`scripts/push-dual.ps1`** (sets `PUBLIC_RELEASE_DIR`, runs `release:public`, prints the public `git` commands).

## Public repo must never contain

Source (`*.js` except nothing), `node_modules/`, `.github/workflows` that build from source, API keys, `.env`, `intel/`, `renderer/`, `main.js`, etc.  
If anything slipped in before, run `npm run release:public` once with `PUBLIC_RELEASE_DIR` set — sanitization strips it from the index (then commit).

## GitHub.com settings

- **Private** repo: default branch `main`, no public visibility.
- **Public** repo: disable **Issues/Wiki/Projects** if you want a downloads-only façade; consider **branch protection** so only you can push `main`.
