# PgVideoEditor

Desktop-style video studio with two main screens:

1. **YouTube Downloader** — paste a link, pick a resolution, choose a folder, download.
2. **VN-style editor** — create a project and edit on a timeline (trim, split, text, filters, audio, export).

## Run

```bash
npm install
npm run dev
```

- App: http://localhost:5173
- API: http://127.0.0.1:8787

YouTube downloads use `yt-dlp` (`python3 -m yt_dlp`) and `ffmpeg` for merging video + audio.

## Advance Search

1. Open **Advance Search**
2. Upload an Excel sheet of keywords
3. Select a keyword and search YouTube — the top video description fills the second dropdown
4. Download the top viewed video into that keyword’s folder
5. Open **Merge in editor** to line the clips up from most viewed to least viewed
6. Copy the generated YouTube title, description, tags, and thumbnail

Each keyword folder also has `ranking.xlsx` for the top-viewers order.

## Editor shortcuts

- Space — play / pause
- S — split at playhead
- Delete — remove selected clip
- Ctrl/Cmd + Z — undo
- Ctrl/Cmd + Shift + Z — redo
- Ctrl/Cmd + D — duplicate
