// =====================================================================
//  ECHO — auth.js
//  Sign in with Google, using Firebase Authentication.
//
//  Firebase is loaded from Google's CDN only when the game starts. If it
//  can't load (offline, blocked network, ad blocker) the game still works:
//  you can play as a guest.
//
//  These config values are meant to be public (they identify the Firebase
//  project, they are not passwords). Firebase protects the project with
//  its own rules and the list of "Authorized domains" in the console.
// =====================================================================
import { CONFIG } from './config.js';

const VERSION = CONFIG.login.firebaseVersion;
const CDN = `https://www.gstatic.com/firebasejs/${VERSION}`;

const firebaseConfig = {
  apiKey: 'AIzaSyD2StQjk5heUKowEAg2AwFZnT6cJkhYuIg',
  authDomain: 'echo-2ecc2.firebaseapp.com',
  projectId: 'echo-2ecc2',
  storageBucket: 'echo-2ecc2.firebasestorage.app',
  messagingSenderId: '746366431332',
  appId: '1:746366431332:web:fec9b28e9b44c69b5aef71',
  measurementId: 'G-KJ6XLNEBY4',
};

let fb = null;   // the loaded Firebase auth functions
let auth = null; // the Firebase Auth instance

// Load Firebase. Resolves true if sign-in is available, false if not.
export async function initAuth() {
  try {
    const [appMod, authMod] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    fb = authMod;
    auth = authMod.getAuth(app);
    if (CONFIG.login.analytics) startAnalytics(app);
    return true;
  } catch (err) {
    console.warn('[ECHO] Sign-in is not available:', err);
    return false;
  }
}

// Google Analytics for Firebase (only where the browser supports it).
async function startAnalytics(app) {
  try {
    const a = await import(`${CDN}/firebase-analytics.js`);
    if (await a.isSupported()) a.getAnalytics(app);
  } catch (err) { /* analytics is optional */ }
}

// Open Google's sign-in window. If the browser blocks pop-ups, use a
// full-page redirect instead.
export async function login() {
  const provider = new fb.GoogleAuthProvider();
  try {
    return await fb.signInWithPopup(auth, provider);
  } catch (err) {
    if (err && err.code === 'auth/popup-blocked') return fb.signInWithRedirect(auth, provider);
    throw err;
  }
}

export const logout = () => fb.signOut(auth);

// fn(user) is called now and whenever you sign in or out (user = null when signed out).
export const onUser = (fn) => fb.onAuthStateChanged(auth, fn);

// A friendly sentence for a sign-in error, or '' to say nothing.
export function loginErrorText(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'auth/unauthorized-domain') {
    return `This website (${location.hostname}) isn't allowed to sign in yet. In the Firebase console, add it under Authentication → Settings → Authorized domains.`;
  }
  if (code === 'auth/network-request-failed') return 'No connection to Google. Check your internet and try again.';
  if (code === 'auth/operation-not-allowed') return 'Google sign-in is turned off for this game (Firebase console → Authentication → Sign-in method).';
  return `Sign-in failed${code ? ` (${code})` : ''}. You can play as a guest.`;
}
