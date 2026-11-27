# Data and devices — what works in this frame and how

The page runs in a sandboxed frame without an origin of its own. The platform connects the browser APIs below to the person viewing the page, so write them the standard way. Everything here works in the chat preview and on the published page unless a line says otherwise.

## Files the user attached, files you generated

- An attachment or a generated image, sound or video appears in the conversation as an `https://` address. Use that exact address as `<img src>`, `<audio src>`, `<video src>` or CSS `url()`. It keeps working after publishing. Never invent or guess an address; with no file, draw with code.
- To read its pixels, use it as a WebGL or three.js texture, or decode it with Web Audio, load it with CORS: set `img.crossOrigin = 'anonymous'` before `src` (three.js `TextureLoader` does this itself), or `fetch(url)` → `arrayBuffer()` → `decodeAudioData`. If that load fails, fall back to showing the picture or playing the sound with a plain element instead of stopping.

## A photo from the viewer — no permission needed

- `<input type="file" accept="image/*">` lets the viewer pick a photo. Add `capture="environment"` (or `"user"`) to open the phone camera directly. Read it with `createImageBitmap(file)` or `URL.createObjectURL(file)` and draw it on a canvas.
- To keep a photo, shrink it first: draw it at most 480 px on the long side and take `canvas.toDataURL('image/jpeg', 0.6)`; while `dataUrl.length > 60000` lower the quality and try again. Save each one under its own key with `window.junis.storage.set('photos/<id>', dataUrl)` (64 KB per key). Do not put photos in `localStorage`.

## Live camera and microphone

- `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })` works. The platform asks the viewer to allow this page on each visit, then gives you a normal `MediaStream`: `video.srcObject`, `AudioContext.createMediaStreamSource` with an `AnalyserNode`, `MediaRecorder`. Video is at most 1280 px and 30 frames a second. Use `facingMode: 'environment'` for the back camera.
- Give the `<video>` the attributes `playsinline muted`. Call `getUserMedia` from a button when you can.
- Handle the refusal: on `NotAllowedError` or `NotFoundError` show a message and keep the app usable — for photos, offer the file input above.
- Stop the tracks when you are done (`stream.getTracks().forEach(t => t.stop())`); the viewer sees "Camera on" until you do. The viewer can turn it off at any time: listen for the track's `ended` event.
- Not available: speech recognition (`SpeechRecognition`), screen capture, choosing a device by id, location (`geolocation`).
- Speaking text works after a tap: `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`.

## Saving a file to the viewer's device

- The standard download works: `a.href = URL.createObjectURL(blob)` (or a `data:` address), `a.download = 'name.ext'`, `a.click()`. The platform asks the viewer to confirm and then saves it. One file at a time, up to 50 MB. Use it for exports (CSV, a JSON backup) and for pictures (`canvas.toBlob`).
- An app that holds data people care about should offer Export, and Import through a file input that reads the JSON back.

## Motion, vibration, screen

- Tilt: `deviceorientation` or `devicemotion` after a tap. On iPhone call `DeviceOrientationEvent.requestPermission()` (and `DeviceMotionEvent.requestPermission()`) inside that tap when the function exists. Handle allowed, denied and no sensor, and keep touch control in all three.
- Vibration: `navigator.vibrate?.(20)` after a tap. Android only — iPhone has none, so never rely on it.
- Keep the screen on (timers, recipes, dashboards): `navigator.wakeLock?.request('screen')` after a tap, and request it again on `visibilitychange` when the page is visible.
- Fullscreen: `element.requestFullscreen?.()` after a tap. iPhone has none.

## Data that lasts — apps people keep using

- Settings and a few dozen records: `localStorage` is fine (256 KB for a signed-in viewer, 64 KB for a guest). The whole store is sent on each change, so keep it small.
- Records that keep growing (ledger, journal, notes, habit log): use `window.junis.storage` — read `references/window-junis.md`. One key per record or per month (`entries/2026-11`), 64 KB per key, 8 MB and 1,024 keys per viewer for this app. At start `list({prefix})` then `get` each key, keep the data in memory, and write only the key that changed.
- Each viewer has their own private data. Signed-in viewers keep it on their account on every device; guests keep 64 KB on that device until they sign in.
- Data everyone sees and changes (votes, a shared list, a team board) goes in `{scope:'shared'}`: 16 KB per key, only signed-in viewers write. Read it again every few seconds or on a Refresh button. `localStorage` is never shared between viewers.
- Show "Saved" from the result of the write, and tell the user when it returns `quota` (storage full).
