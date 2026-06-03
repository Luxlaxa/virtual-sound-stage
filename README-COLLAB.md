# Virtual Sound Stage — Collaborator Setup (Davinci)

This is the **still-220723** Virtual Sound Stage — a PlayCanvas-based 3D scene viewer
with a Gaussian splat environment and character models (Phop + Davinci).

Repo: **https://github.com/Luxlaxa/virtual-sound-stage**

---

## 1. Run the viewer (no build step needed)

The viewer is static HTML/JS/CSS that loads PlayCanvas from a CDN. You only need a
local static file server.

**Option A — Node (recommended):**
```bash
cd virtual-sound-stage     # the folder you unzipped / cloned
npx serve -l 8080 -s .
```

**Option B — Python (if you don't have Node):**
```bash
cd virtual-sound-stage
python3 -m http.server 8080
```

Then open **http://localhost:8080** in Chrome.

> No `npm install` required to RUN the viewer. PlayCanvas is loaded from
> `cdn.jsdelivr.net/npm/playcanvas@2`. The only dependency to serve it is `npx serve`
> (or Python's built-in server).

---

## 2. One-time setup: connect to GitHub as YOURSELF

Run the included setup script ONCE. It configures git so that all YOUR commits are
tagged as **you (Davinci)**, not Josh. This keeps our two copies identical in code but
clearly attributed to whoever made each change.

```bash
cd virtual-sound-stage
bash setup-davinci.sh
```

The script will:
1. Install / verify **Git LFS** (required — the 3D models & splats are stored in LFS)
2. Connect this folder to the GitHub repo as a remote
3. Set your **local** git identity (name + email) for THIS repo only
4. Pull the latest LFS assets

> IMPORTANT: This sets identity **locally** (only in this repo), so it never touches
> your global git config or any other projects.

---

## 3. Daily workflow — stay in sync

**Get the latest from Josh:**
```bash
git pull origin main
git lfs pull          # pulls any updated 3D models / splats
```

**Make a change and propose it (Pull Request — preferred):**
```bash
git checkout -b davinci/your-feature-name
# ... make your edits / swap in new 3D models ...
git add -A
git commit -m "describe what you changed"
git push origin davinci/your-feature-name
gh pr create          # opens a PR for Josh to review & merge
```

**Or push directly to main (if Josh says it's ok):**
```bash
git add -A
git commit -m "describe what you changed"
git push origin main
```

---

## 4. Who changed what?

Because each of us sets our own local identity:
- Josh's commits show **Josh / Luxlaxa**
- Your commits show **Davinci**

Run `git log --oneline --format='%h %an %s'` to see the author of every commit.

---

## 5. The 3D model task

The current build has Phop + Davinci as Hunyuan 3D `.glb` meshes. The goal is to swap
in **higher-fidelity 3D models** and eventually **animate them from video motion**.

Key files:
- `index.html` — slim shell
- `js/app.js` — main app: scene build, camera system, character mesh/splat toggle
- `phop.glb` / `davinci.glb` — character meshes (replace these with better models)
- `still-220723.compressed.ply` — the world Gaussian splat
- `collision.glb` — collision mesh for the world

To swap a character model: drop in a new `.glb`, keep the same filename (or update the
asset URL in `js/app.js` around the asset definitions near line 220).

Character transforms in `js/app.js`:
- Phop: `pos(-0.64, -0.50, 0.00)  rot(90, 90, 0)`
- Davinci: `pos(0.11, -0.47, -0.01)  rot(90, -90, 0)`

---

## Known issue: Gaussian splat layering

Toggling characters to "splat" mode currently makes them invisible — multiple gsplat
instances don't composite correctly in PlayCanvas (filed upstream:
github.com/playcanvas/engine/issues/8827). For now, use **mesh mode** for characters.
The high-fidelity model work is the path forward instead of splat characters.

A frozen backup of the splat-layering attempt lives on branch
`backup/v0.5.6-splat-layering` and tag `backup-v0.5.6-splat-layering` — don't delete it.
