# 05 — Multimodal: image input

Ask Chrome's on-device Gemini Nano about a picture. Drop, paste, or pick an
image, type a question, and the answer streams in underneath — no upload, no
API key, nothing leaving the machine.

Lesson: **[Multimodal: image input](https://danduh.me/courses/chrome-built-in-ai/multimodal)**
· Hosted demo: **[windowai.danduh.me/multimodal/multimodal-demo](https://windowai.danduh.me/multimodal/multimodal-demo)**

## What it shows

- Probing multimodal support with `LanguageModel.availability({ expectedInputs: [{ type: 'image' }] })`, wrapped in try/catch (older builds throw on the option).
- Opting a session into images with `expectedInputs` at `create()` — the option that loads the vision tower — plus a `monitor` for first-run download progress and `outputLanguage: 'en'`.
- Getting a `Blob` three ways: a file picker, drag-and-drop, and clipboard paste.
- Downsampling to a 512px tile with a canvas and `canvas.toBlob` (null-checked).
- Prompting with role-wrapped content parts — `[{ role: 'user', content: [{ type: 'text', value }, { type: 'image', value: blob }] }]` — and streaming the reply as deltas.
- Reusing one session and calling `destroy()` on teardown.

## Files

- `index.html` — the runnable demo. Plain browser JavaScript, inline, no frameworks, no build step, no dependencies.
- `demo.ts` — a TypeScript reference mirror of the same logic (types added). Not built or loaded by the page; read it for the typed shape.

## Run it

Open `index.html` in desktop Chrome. That works in most cases.

If the demo reports the API is unavailable, serve the folder over `localhost`
(the APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in desktop Chrome, drop in an
image, and ask.

## Requirements

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- Built-in AI available, with **image input** supported. The first question may
  trigger the one-time Gemini Nano download (several GB) — the demo shows a
  progress bar while it runs.
- If image input isn't available, the demo says so and links to
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

## Notes

Gemini Nano is a generalist. It's good at "roughly what's in this picture" and
weak at dense or handwritten text, counting past ~10, and faces. For exact
counts, precise coordinates, OCR of handwriting, or recognising a specific
person, use a specialised model.
