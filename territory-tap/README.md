# Territory Tap 📍

A simple GPS territory-control web game built as a static app — no backend, no API keys, no login required.

## What is it?

Walk around in the real world, tap **Claim Tile**, and watch your territory grow on the mini-map. Tiles are small squares of Earth (≈ 111 m × 111 m by default). Revisit owned tiles to rack up bonus points.

### Scoring

| Action | Points |
|---|---|
| Claim a brand-new tile | **+10** |
| Revisit / re-claim an owned tile | **+1** |

---

## How to run locally

1. **Clone the repo** (or download the zip):
   ```bash
   git clone https://github.com/<your-username>/ar-test.git
   cd ar-test/territory-tap
   ```

2. **Open in browser** — just double-click `index.html`, or serve the file with any static server:
   ```bash
   # Python 3
   python -m http.server 8080
   # then visit http://localhost:8080/territory-tap/
   ```
   > **Note:** Some browsers block Geolocation on `file://` URLs. Use a local server or GitHub Pages for the best experience.

3. Allow location access when the browser prompts you.

---

## How to deploy to GitHub Pages

1. Push the repo to GitHub (if you haven't already).
2. Go to **Settings → Pages** in your repository.
3. Under **Source**, select `Deploy from a branch`.
4. Choose **Branch: `main`** (or whichever branch has the code) and **Folder: `/ (root)`**.
5. Click **Save**. After a minute or two your site will be live at:
   ```
   https://<your-username>.github.io/<repo-name>/territory-tap/
   ```

No build step needed — everything is plain HTML/CSS/JS.

---

## Controls

| Button | What it does |
|---|---|
| 📡 **Get Current Location** | Request a fresh GPS fix and restart position watching |
| 🚩 **Claim Tile** | Claim (or revisit) the tile you're currently standing on |
| 💾 **Export Save JSON** | Download your save as a `.json` file |
| 📂 **Import Save JSON** | Load a previously exported `.json` save file |
| 🗑️ **Reset Local Save** | Wipe all data from localStorage (irreversible) |

---

## Save format

All data lives in `localStorage` under the key `territoryTapSave`:

```json
{
  "playerName": "Local Player",
  "tiles": {
    "37001:-122002": {
      "tileId": "37001:-122002",
      "claimedAt": "2025-01-01T12:00:00.000Z",
      "lastVisitedAt": "2025-01-02T09:30:00.000Z",
      "claimCount": 3
    }
  }
}
```

---

## Tile size

Tiles default to **0.001°** lat/lng per side (~111 m). To change the grid resolution, edit the `TILE_SIZE` constant at the top of `app.js`.

---

## Current limitations

- **Single player only** — no server, so tiles can't be contested between players.
- **No real map background** — the mini-map is a canvas grid, not a street map.
- **localStorage only** — data is tied to the device and browser; clearing browser data wipes your progress (use Export to back up).
- **GPS accuracy** — indoor or urban canyon environments may show inaccurate positions.
- **No tile expiry** — once claimed, a tile stays yours forever.

---

## Planned future improvements

- **Backend / database** — a simple REST API (e.g. Supabase or Firebase) to store tiles server-side and enable multiplayer.
- **Real map tiles** — integrate Leaflet.js + OpenStreetMap for a proper map background (no API key needed).
- **Player accounts** — anonymous sessions via a UUID, shareable leaderboard.
- **Tile expiry / decay** — tiles could expire after N days to encourage revisits.
- **Tile contesting** — two players at the same tile — whoever has more claims wins.
- **Power-ups / events** — double-point weekends, rare mega-tiles, etc.

---

## Tech stack

| Layer | Choice |
|---|---|
| Language | Plain HTML5, CSS3, Vanilla JS (ES5-compatible) |
| Persistence | `localStorage` |
| Maps | `<canvas>` grid (built-in) |
| GPS | `navigator.geolocation` |
| Hosting | GitHub Pages (static) |
