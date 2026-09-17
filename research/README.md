# Voice study — model research v0.1.0

A separate, static listening page from Electric Creative. Compare eight speech models reading the same Apothecary passage, with word highlighting and the actual costs from our September 17, 2026 test round.

## Open it

Unzip the download, keep the folder together, and open **index.html** in your browser. No install, account, API key, microphone, or model download is needed. All eight recordings and the fonts are included.

If your browser restricts local files, start the included static server from this folder with Node.js 22 or later:

```sh
node serve.mjs
```

Open the `http://127.0.0.1:PORT/` address printed in the terminal, using its actual port number. The server chooses an available port automatically. `node serve.mjs --port 4183` requests a specific port; use one appropriate for your machine. Press Ctrl+C to stop the server. You can also host this whole folder on a static web host, including under a subdirectory. Choose hosting that supports HTTP byte ranges for reliable audio seeking.

## Try it

- Choose a model name to load its sample, or its play icon to listen immediately.
- Pause, start over, seek through the recording, or change playback speed. Highlighting follows the audio position.
- Hover or focus an icon for its label. Keyboard users can Tab between controls and use arrow keys on the seek slider. Escape dismisses a tooltip.
- Use the download icon for the selected recording, or a model's open-audio link to hear its file directly.
- Expand **Request & recording details** for exact model/voice IDs, usage, billing, price snapshots, and word timings.

Kokoro Heart is selected initially. Starting another sample replaces the current recording. The page is independent of the TTS + STT starter; no link or integration into that app has been added.

## What the research shows

All eight calls returned decodable audio. The total recorded inference cost was **$0.053303**, about 5.33 cents. Flux and Fish were free; Kokoro was the cheapest paid sample. Default routing sent Kokoro and Orpheus to Together, which was more expensive than the quoted DeepInfra alternatives.

These are historical sample charges, not current price promises. The measured request time includes downloading the complete audio. Provider generation time was not reported. A single request per model is not a performance benchmark.

Highlights use locally generated, approximate word alignments. They may be slightly early or late. Alignment and successful decoding do not establish perfect pronunciation, completeness, or voice quality; those listening judgments remain open.

## Share it

Share the entire folder or its ZIP. Audio, fonts, styles, scripts, and evidence use relative paths. Playback does not contact OpenRouter. No keys or account identifiers are included in the shared receipt extracts.

For implementation details and integration boundaries, see [AGENTS.md](AGENTS.md).
