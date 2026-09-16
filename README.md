<div align="center">

# Bakame

**Customized and enhanced by [Serge Benit (@Sergeb250)](https://github.com/Sergeb250)**

Based on OpenCluely by [TechyCSR](https://github.com/TechyCSR/OpenCluely) and contributors. Original credit and license are retained.

</div>

## Summary

Bakame is an enhanced version of OpenCluely and an open-source **alternative to Cluely**, featuring a floating desktop AI assistant, microphone/computer audio support, typed chat, live voice prompts, Interview Mode, and Exam Mode.


Prompts appear in white. Answers appear in green. Interview mode gives short, natural answers with examples when useful. Exam mode detects questions and answers directly.

## Main Features

- AI response window with typed chat and voice prompts.
- Live listening for microphone and Windows computer audio.
- Interview, exam, general, research, writing, and programming modes.
- Movable overlay and response window.
- Minimize button that collapses the app into a transparent movable dot.
- Windows capture protection for supported screen sharing and recording APIs.
- Normal user launch runs as a background app.
- Administrator launch installs and runs the Bakame Windows service.

## Windows Build

```powershell
npm ci
npm run build:win
node scripts/verify-windows-package.js
```

**Download executable from project github project  releases:**



| `bakame-Service-Setup-1.0.1-x64.exe` | Same installer with service filename. |


Run normally for background mode. Run as administrator to install and start the service.

## Setup

Add a Gemini API key in Settings, or place it in `.env`:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
SPEECH_PROVIDER=whisper
WHISPER_AUDIO_SOURCE=both
```

For local development:

```bash
npm start
```

## Voice

Bakame can use local Whisper or Azure Speech. On Windows, Local Whisper can listen to:

- microphone only
- computer audio only
- microphone and computer audio together

SoX and `arecord` are not required for Windows microphone capture.

## Floating Dot

Press `-` in the toolbar or AI Response window to hide Bakame into a small transparent dot. Click the dot to restore. Hold and drag the dot to move it.

The dot uses standard Windows always-on-top behavior. Kiosk or lockdown software may require Bakame to be allowed in that product's configuration.

## Privacy

Bakame uses Electron and Windows capture protection for supported screen capture APIs. Test with your meeting, recording, or POS environment before relying on it in production.

## Tests

```powershell
npm run test:mini-ui
npm run test:voice-ui
npm run test:privacy
npm run test:lifecycle
```

## Credit

Customized and enhanced by **Serge Benit**: https://github.com/Sergeb250

Original project: **OpenCluely** by TechyCSR and contributors: https://github.com/TechyCSR/OpenCluely

See [NOTICE](NOTICE) and [LICENSE](LICENSE).
