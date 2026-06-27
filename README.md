# TEMPO — Training Tracker

A React + Vite build of the TEMPO workout tracker: programs, per-set logging,
progression suggestions, goals, milestones, notes, and a periodized
plan/calendar engine. Data is stored in the browser via `localStorage`.

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer (`node -v` to check).

```bash
npm install      # install dependencies (first time only)
npm run dev      # start the dev server
```

Open the URL it prints (usually http://localhost:5173). The app saves your
data to that browser's `localStorage`.

```bash
npm run build    # production build into dist/
npm run preview  # preview the production build locally
```

## Put it on GitHub

```bash
git init
git add .
git commit -m "Initial commit: TEMPO training tracker"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<your-username>/tempo.git
git branch -M main
git push -u origin main
```

## Deploy (pick one)

Both auto-build on every push to `main` and give you a live HTTPS URL.

### Vercel
1. Go to https://vercel.com, sign in with GitHub, **Add New → Project**.
2. Import the `tempo` repo. It auto-detects Vite — no config needed.
   (Build command `npm run build`, output directory `dist`.)
3. **Deploy.** You get a `*.vercel.app` URL.

### Netlify
1. Go to https://netlify.com, sign in with GitHub, **Add new site → Import an existing project**.
2. Pick the repo. Build command `npm run build`, publish directory `dist`.
3. **Deploy.** You get a `*.netlify.app` URL.

## About the data layer (read this before adding accounts)

All persistence runs through two functions near the top of
`src/WorkoutTracker.jsx`:

```js
async function loadKey(key, fallback) { ... }   // read
async function saveKey(key, value)   { ... }     // write
```

Right now they read/write `localStorage`, so data is **per-browser and
single-user** — it does not sync across devices and there are no accounts.

This is the **seam** for going multi-user: to add login + cloud sync, you swap
the bodies of these two functions for Supabase calls (queries scoped to the
signed-in user's id) and the rest of the app stays the same. That's the next
step after this is deployed.

## Stack
- React 18 + Vite
- Tailwind CSS v3
- recharts (charts), lucide-react (icons)
