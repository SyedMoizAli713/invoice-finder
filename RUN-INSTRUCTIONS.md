# Invoice Finder — Standalone React/Vite

This is a standalone version of the Invoice Finder source package.
The original Replit/monorepo `catalog:` and `workspace:*` dependency references
have been removed so the app can be installed with normal npm.

## Requirements

- Node.js 20+ recommended
- npm 10+

## Run

Open a terminal in this folder:

```powershell
npm install
npm run dev
```

Then open:

http://localhost:5173

## Production build

```powershell
npm run build
npm run preview
```

## Notes

- `node_modules` is intentionally not included.
- `dist`/generated build output is intentionally not included.
- PDF parsing and selected-invoice PDF creation run in the browser.
- The app does not require Replit environment variables such as `PORT` or `BASE_PATH`.
