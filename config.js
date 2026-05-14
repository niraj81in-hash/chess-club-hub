// ============================================================
// Firebase & app config (Phase A — single source of truth)
// Copy to config.local.js and adjust if you use env-specific values.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyAWjhow8Kc-XCrX6YL_nU836hew0MqrsAo",
  authDomain: "chess-club-hub-4cd54.firebaseapp.com",
  projectId: "chess-club-hub-4cd54",
  storageBucket: "chess-club-hub-4cd54.firebasestorage.app",
  messagingSenderId: "29589197031",
  appId: "1:29589197031:web:4bebff77c932b967939242",
  measurementId: "G-E4DMY1ZPZ0"
};

/** Same region you deploy Cloud Functions to */
export const functionsRegion = 'us-central1';
