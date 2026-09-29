# Member-facing app (Expo / React Native)

The card-member-facing app described in the root `CLAUDE.md` — separate from
`public/`, which is the internal judge-facing simulator control panel.

## Setup

```
cd mobile
npm install
cp .env.example .env   # only if missing; set API URL to your machine's LAN IP
npx expo start
```

Or from the repo root: `npm run mobile`. Either way, **always run Expo/npm
commands from inside `mobile/`** (or via that root script) — running `npx
expo start` or `npm install expo` from the repo root has previously
installed `expo` into the *backend's* `node_modules` and/or picked up the
wrong SDK version, breaking the Expo Go connection.

Scan the QR code with the **Expo Go** app on your phone (same Wi-Fi network
as the machine running the backend). `localhost` in `.env` will not work on
a physical device — it needs your machine's actual LAN IP (`hostname -I` on Ubuntu, `ipconfig` on
Windows), because the phone is a separate device on the network making its
own HTTP requests to your dev machine.

The backend (`../`) must be running (`npm run dev` from the repo root) and
reachable at that address before signup, search, booking or tracking will work.

## What's here

Four bottom tabs:

- **Home:** public Flights/Hotels/Cabs search, results, filters, sorting and
  details. Flights use Duffel sandbox offers; hotels/cabs use mock search data.
  Signed-in members can still see recent searches here. No History tab.
- **Trips:** signed-in Protected Trips saved by the backend. Refresh on focus
  or pull; open details to see the booking reference, passenger name and fare.
- **Track:** signed-in saved-flight selector. Calls Duffel on focus, selection
  and manual refresh for order status and airline-initiated schedule changes.
  No invented boarding/landed status, flight-number lookup or mock fallback.
- **You:** signed-in account, local autonomy/notification preferences and logout.
  These preferences do not yet govern backend recovery.

Flight checkout is connected to Duffel **test orders**. Search → choose a flight
→ Review & book → sign in if needed → **Use test passenger** → confirm. It
supports one adult aged 18+, with passport fields when the offer requires them.
The server refreshes the fare, requires review of changes, creates the order,
checks it independently and automatically saves the booking in Protected Trips.
A timeout or pending outcome offers **Check status** instead of another purchase.
There is no real charge or usable ticket; hotel/cab checkout is not connected.

From Trips, open a booking and tap **Track this trip**. Track reads the real
Duffel sandbox order and change APIs. It does not accept changes or trigger
recovery. Saved trips are persistent; automatic monitoring/recovery is still
separate future work. See the root [README](../README.md) for API/setup details.

After starting the backend and Expo, reload Expo Go and check all four tabs,
checkout's sign-in return, confirmation, trip persistence and tracking refresh.
Physical-device verification is separate from an Android bundle build.

## Structure

```
src/
  api/client.js        axios instance + bearer-token interceptor
  api/endpoints.js       thin wrappers matching the backend's routes
  context/AuthContext.js  token persistence (expo-secure-store) + auth state
  config/categories.js     drives SearchScreen fields + ResultsScreen fetch/sort/render per category
  components/               per-category result row components
  screens/                   one screen per feature
App.js                  four tabs; Trips/Track/You swap in auth when signed out
```

## Known environment notes

- Uses **Expo SDK 57** to match the test phone's Expo Go, following the user's
  upgrade request on 2026-09-12. SDK 57 uses React Native 0.86 and React 19.2.3;
  see the [versioned SDK reference](https://docs.expo.dev/versions/v57.0.0/).
- SDK 57 requires Node.js 22.13 or newer. The Ubuntu workstation has Node.js
  24.20.0 installed.
- Run `npm ci` inside `mobile/` to restore the versions in the lockfile. For
  an SDK upgrade, update Expo and align the other packages together, then check
  the result and restart Metro with a clean cache:

  ```bash
  npx expo install 'expo@~57.0.0' --fix
  npx expo-doctor
  npx expo start --lan --clear
  ```

  Changing only the `expo` entry in `package.json` leaves React Native and native
  modules on incompatible versions. Follow the
  [upgrade guide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)
  and review the release notes when moving to another SDK. This app uses Expo Go
  and has no checked-in `android/` or `ios/` project to migrate.

Current verification results and device checks are kept in
[SESSION_STATUS.md](../SESSION_STATUS.md).
