# Third-party assets and dependencies

This source starter includes three unmodified fonts from the Electric Creative kit:

- Hanken Grotesk — `assets/fonts/LICENSE-hanken-grotesk.txt`
- Bricolage Grotesque — `assets/fonts/LICENSE-bricolage-grotesque.txt`
- Anton — `assets/fonts/LICENSE-anton.txt`

Their SIL Open Font License texts and copyright notices travel with the font files. The styling is adapted from Carlo Santiago's Electric Creative design system. The demo passage is supplied by Carlo Santiago; it is included only as the demo's sample content, not as a third-party model asset.

Installed by npm, not redistributed in this source folder:

| Package | Pinned/resolved version | Package-declared license |
| --- | --- | --- |
| kokoro-js | 1.2.1 | Apache-2.0 |
| @huggingface/transformers | 3.8.1 | Apache-2.0 |
| onnxruntime-web | 1.22.0-dev.20250409-89f8206ba4 | MIT |
| esbuild | 0.28.2 | MIT |

This is not a complete transitive dependency inventory. `package-lock.json` records that tree; preserve the license/notice files from installed packages when shipping compiled bundles or vendored runtimes.

The setup script downloads Kokoro model/voice assets from [this pinned Hugging Face revision](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/README.md), whose model card declares Apache-2.0. Model binaries are not inside the shared folder. Consult the upstream model/package notices if redistributing prepared assets. Font licenses do not license the Electric Creative name, branding, or sample manuscript.
