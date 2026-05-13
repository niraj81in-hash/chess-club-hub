# chess-club-hub

A chess platform for school clubs — play, review, and run tournaments.

## Run locally

Serve the folder over HTTP (ES modules do not work from `file://`):

```bash
python3 -m http.server 8080
```

Then open `http://127.0.0.1:8080/`.

## Firebase (online clubs, rooms, server ELO)

1. In the [Firebase console](https://console.firebase.google.com), enable **Anonymous** sign-in under Authentication.
2. Install the [Firebase CLI](https://firebase.google.com/docs/cli), then from this repo run `firebase login` and `firebase use <your-project-id>`.
3. Deploy rules and functions: `firebase deploy --only database,functions`
4. Optional static hosting: `firebase deploy --only hosting`

`config.js` holds the web client config. Club data lives under Realtime Database paths `clubs/{clubId}/…`. Creating or joining a club uses Cloud Functions `createClub` and `joinClub`; finishing an online game calls `recordOnlineGameResult` to update `clubs/{clubId}/ratings/{uid}`.
