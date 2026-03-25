# Demo: Computer Use — Autonomous iPhone App Review

Demonstrates Understudy's ability to orchestrate complex, multi-stage, cross-device workflows autonomously.

## Demo Scenario

**Prompt:** "Find an interesting photo editing app on the App Store, install it on my iPhone, explore it thoroughly, and create a review video for YouTube."

**6-stage pipeline:**
1. **App selection** — Browse Chrome App Store, evaluate candidates, select one
2. **iPhone install** — iPhone Mirroring: search, verify, install the app
3. **Deep exploration** — 3-round exploration with 13+ screenshots, structured notes
4. **Video production** — Compose review video with AI neural voiceover and subtitles
5. **YouTube publish** — Upload with metadata, thumbnail, and description
6. **Cleanup** — Delete app from device, restore state

**Stats:** ~42 minutes, 54 artifacts, zero human intervention.

## Prerequisites

- iPhone connected via iPhone Mirroring (macOS 15+)
- CapCut installed for video editing
- Google Chrome with App Store access
- YouTube account authenticated in Chrome
- edge-tts for neural voiceover

## How to Run

```bash
# Start the gateway
understudy gateway

# Send the prompt via webchat or any channel
# The pipeline is triggered by natural language — no special commands needed
```

## Pipeline Skills

The pipeline is orchestrated through modular skills in the `skills/` directory:
- `app-review-pipeline` — Main orchestrator
- `appstore-browser-package` — Chrome-based app selection
- `appstore-device-install` — iPhone Mirroring installation
- `app-explore` — Agentic deep exploration
- `capcut-edit` — Video composition
- `youtube-upload` — Publishing
- `app-review-cleanup` — Device restoration

## Demo Versions

- **Short (60-90s):** Fast-paced highlight reel of all 6 stages
- **Long (5-8min):** Full pipeline walkthrough with narration at decision points
