# Member-facing app (Expo / React Native)

The card-member-facing app described in the root `CLAUDE.md` — separate from
`public/`, which is the internal judge-facing simulator control panel.

## Setup

```
cd mobile
npm install
cp .env.example .env   # set EXPO_PUBLIC_API_BASE_URL to your machine's LAN IP
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone (same Wi-Fi network
as the machine running the backend). `localhost` in `.env` will not work on
a physical device — it needs your machine's actual LAN IP (`ipconfig` on
Windows), because the phone is a separate device on the network making its
own HTTP requests to your dev machine.

The backend (`../`) must be running (`npm run dev` from the repo root) and
reachable at that address before signup/search/tracking/history will work.

## What's here

- **Search** tab — segmented Flights/Hotels/Cabs search, submits into a
  shared **Results** screen with filter-by-text and sort chips. Flights are
  real Sabre data; hotels/cabs are backend-served mock data (see the root
  `CLAUDE.md` for why).
- **Track** tab — look up a flight by number; falls back to clearly-labeled
  sample data if Sabre's status product isn't available (it isn't, on this
  project's trial account).
- **History** tab — gated behind login; shows a signed-in user's past
  searches. Search/Track stay open to everyone — only History needs an
  account.

## Structure

```
src/
  api/client.js        axios instance + bearer-token interceptor
  api/endpoints.js       thin wrappers matching the backend's routes
  context/AuthContext.js  token persistence (expo-secure-store) + auth state
  config/categories.js     drives SearchScreen fields + ResultsScreen fetch/sort/render per category
  components/               per-category result row components
  screens/                   one screen per feature
App.js                  navigation shell (bottom tabs; History tab is a stack that swaps in Login/Signup when signed out)
```

## Known environment note

This machine's Node.js (v20.14.0) is below what Expo SDK 57 / React Native
0.86 officially require (`>=20.19.4`) — Expo prints a warning on every
command. In practice Metro still boots and bundles correctly (verified: the
full app bundle compiles clean, 1020 modules, no errors), but if anything
odd shows up, upgrading Node is the first thing to try.
