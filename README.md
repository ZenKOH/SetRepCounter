# Set & Rep Tempo Trainer

A dependency-free browser workout counter for sets, reps, four-phase rep tempo and circuit training.

## Live app

https://zenkoh.github.io/SetRepCounter/

## Main features

- Single-exercise mode
- Circuit mode with multiple exercise blocks
- Each circuit block can define its own sets, reps, tempo and rest
- Four-phase rep tempo: eccentric/lowering → bottom hold → concentric/lifting → top hold
- Tempo examples: `3-1-1-1`, `4-0-2-0`, and `X-1-1-0`
- `0` skips a phase
- `X` means explosive/as-fast-as-possible; the deterministic timer gives it a 1-second cue window
- Visual active-phase highlighting
- Spoken exercise, set, rep and phase cues where browser speech is available
- Optional beeps
- Live overall elapsed workout time
- Estimated programme duration before starting
- Pause/resume excludes paused time from elapsed workout time
- Local browser persistence only
- Responsive layout for desktop, tablet and mobile
- Screen Wake Lock support where available

## Circuit training

Each circuit row contains:

- exercise name
- sets
- reps per set
- rep tempo
- rest time

Rows can be moved, duplicated or removed. Duplicating the same exercise is a simple way to prescribe different reps or tempo for later sets.

## Tempo definition

The four positions always use this order:

1. Eccentric / lowering
2. Bottom hold / isometric
3. Concentric / lifting
4. Top hold / isometric

For example, `3-1-1-1` means 3 seconds lowering, 1 second at the bottom, 1 second lifting, and 1 second at the top.

## Privacy

No sign-in, backend or database is used. Workout settings stay in local browser storage.

## Files

- `index.html`
- `style.css`
- `app.js`
- `.github/workflows/pages.yml`

GitHub Pages deploys automatically from `main`.
