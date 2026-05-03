# Dammen (Dutch Checkers)

A web-based Dutch checkers (dammen) game built with React + Vite, ported from a Python/tkinter original.

## Architecture

- **Frontend**: React 18 + Vite, single-page app
- **Entry point**: `src/main.jsx` → `src/App.jsx`
- **Game logic**: `src/gameLogic.js` (pure JS port of the original Python logic)

## Game Rules

- 10x10 board with 50 playable (dark) squares, numbered 1–50
- Black starts at positions 1–20, White at 31–50
- Special starting kings: White King at position 3, Black King at position 48
- Captures are mandatory; multi-jump captures are supported
- Pieces promote to kings when reaching the opposite back row

## Project Structure

```
src/
  main.jsx        # React entry point
  App.jsx         # Main game component (board rendering, click handling)
  App.css         # Game styling
  gameLogic.js    # All game logic (moves, captures, win detection)
  index.css       # Global styles
index.html
vite.config.js
package.json
```

## Running

The app runs on port 5000 via `npm run dev`.
