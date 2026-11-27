# Kelvinet Smart IT Helpdesk — Official Logo & PWA Icon Update

## Included
- `index.html` — authentication shield icon replaced with the official `logo.png`.
- `chatbot.css` — responsive sizing and alignment for the authentication logo.
- `logo.png` — original logo supplied in the project ZIP, preserved.
- `manifest.webmanifest` — PWA metadata using the new official icon set.
- `service-worker.js` — updated PWA cache version and shell asset list.
- `icons/` — generated app icons from the supplied official logo:
  - `icon-192.png`
  - `icon-512.png`
  - `icon-512-maskable.png`
  - `apple-touch-icon.png`

## Deployment
1. Back up the current deployed project.
2. Replace `index.html` and `chatbot.css` in the project root.
3. Keep the supplied `logo.png` in the project root (the ZIP includes the same uploaded file).
4. Put `manifest.webmanifest` and `service-worker.js` in the project root.
5. Upload the complete `icons` folder to the project root.
6. Deploy the updated project to Vercel.

The app shell is cached for offline loading where available. Firebase authentication/data, Gemini AI requests, and EmailJS still require an internet connection. This service worker deliberately does not cache private user records or API responses.

## Important after deployment
- Open the site in Chrome and allow the new service worker to activate.
- If the old icon remains installed, remove the existing home-screen shortcut and install the PWA again; Android may retain previously installed icon artwork.
- Test the authentication logo on a narrow mobile screen and confirm sign-in/sign-up still work.
- The service worker precaches optional support modules if present. Keep the existing `chatbot.js`, `kb-seed.js`, `kb-engine.js`, and `founder-profile.js` files in the project root as applicable.
