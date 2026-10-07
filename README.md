# Set & Rep Voice Counter

A lightweight browser-based exercise counter that announces sets, repetitions and timing cues aloud.

## Live app

Once GitHub Pages deployment is enabled, the app is available at:

**https://zenkoh.github.io/SetRepCounter/**

## Features

- Configurable sets and reps
- Configurable seconds per rep
- Configurable rest between sets
- Optional 3-2-1 start countdown
- Spoken set and rep announcements using the browser Web Speech API
- Optional spoken rep countdown and rest warnings
- Optional audio beep at phase changes
- Start, pause/resume and reset
- Large, responsive display for desktop, tablet and phone
- Settings saved locally in the browser
- Screen Wake Lock support when available
- Keyboard shortcuts: **Space** to pause/resume and **R** to reset
- No backend, login, database, API key or external dependency

## Privacy

The app does not send workout data anywhere. Settings are stored only in the browser with `localStorage`.

No patient-identifiable information should be entered because this version has no patient-record functionality.

## Browser support

The counter and timer work in modern browsers. Spoken voice depends on the browser/device implementation of the Web Speech API. Available voices and audio behaviour can therefore vary between Safari, Chrome, Edge, iOS and Android.

For best mobile reliability:

1. Open the page directly in Safari or Chrome.
2. Press **Start** yourself to allow speech/audio playback.
3. Keep device media volume audible.
4. Use **Test voice** before starting if needed.

## Development

This is deliberately dependency-free:

- `index.html`
- `style.css`
- `app.js`

Run locally by opening `index.html`, or use any static web server.

Example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deployment

A GitHub Actions workflow in `.github/workflows/pages.yml` deploys the repository root to GitHub Pages on each push to `main`.

## Roadmap ideas

Future versions could add exercise names, configurable up/hold/down phases, per-set rep targets, saved programmes, session history, clinician workflows and camera/sensor-based automatic rep detection.
