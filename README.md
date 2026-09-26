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

YouTube downloads need **yt-dlp** and **ffmpeg**.

Windows:

```powershell
python -m pip install -U yt-dlp
winget install Gyan.FFmpeg
```

Then stop `npm run dev` with Ctrl+C and start it again.

If the browser says localhost refused to connect, leftover Node processes are still holding the port. In PowerShell:

```powershell
taskkill /F /IM node.exe
npm run dev
```

Then open http://localhost:5173

## Editor shortcuts

- Space — play / pause
- S — split at playhead
- Delete — remove selected clip
- Ctrl/Cmd + Z — undo
- Ctrl/Cmd + Shift + Z — redo
- Ctrl/Cmd + D — duplicate
