# Local inference harness

This folder adds a small HTTP harness for the Fieldview demo:

- `POST /api/voice` accepts an audio file, sends it to an existing Whisper-compatible transcription endpoint, then routes the transcript.
- `POST /api/chat` routes text directly.
- Requests prefixed with `map:`, `geo:`, or `geospatial:` go to the existing Fieldview map-agent API when `MAP_API_URL` is set. Other requests go to the configured chat endpoint, defaulting to DeepSeek V4 Flash.
- `GET /api/health` reports which routes have configuration.

Neither this harness nor its setup scripts download model weights. DeepSeek V4 Flash is set up as the hosted DeepSeek API (`deepseek-v4-flash`). Whisper is an operator-supplied service. If you want local inference, point the chat variables at an already-running compatible server and point Whisper at an already-running transcription server.

## Start the harness on Windows

From PowerShell:

```powershell
Copy-Item .env.example .env
# Edit .env: set CHAT_API_KEY; set the URL of your Whisper-compatible /v1 service.
./run.ps1
```

The API listens on `http://127.0.0.1:8010`. Open `http://127.0.0.1:8010/docs` to try the voice upload and chat routes. A transcription service usually implements `POST /v1/audio/transcriptions` and accepts the `model` form field plus a multipart `file`.

Linux/macOS: copy `.env.example` to `.env`, edit it, then run `./run.sh`.

## Voice request example

```powershell
curl.exe -F "file=@sample.wav" http://127.0.0.1:8010/api/voice
```

The response contains `transcript`, `route`, and either `text` or a map proposal. This is speech-to-text followed by text response; it does not synthesize spoken audio.

## NemoClaw with DeepSeek V4 Flash

NemoClaw runs on its supported Linux/DGX/WSL environment with its runtime prerequisites. This folder only supplies a compatible endpoint configuration; it does not install NemoClaw, start containers, or download model files. DeepSeek V4 Flash is 285B total parameters, so a local deployment requires substantial multi-GPU memory and a serving stack that supports the model architecture. The API route below needs no local model weights.

On a supported Linux/DGX/WSL host, prepare the runtime prerequisites from NVIDIA's guide, set `DEEPSEEK_API_KEY` in that shell, and run the included onboarding helper. It selects the hosted custom provider for first-time onboarding:

```bash
export DEEPSEEK_API_KEY='your-key'
bash ./onboard-nemoclaw.sh
```

NemoClaw still retrieves its CLI and sandbox runtime/container assets. The selected custom hosted API route does not select or download local model weights. Check the current [NemoClaw quickstart](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/get-started/quickstart) and [custom endpoint guide](https://docs.nvidia.com/nemoclaw/latest/user-guide/openclaw/inference/custom-endpoints/set-up-openai-compatible-endpoint) for host preparation, current provider requirements, and onboarding changes. Keep API credentials in environment/secret storage; do not commit them.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CHAT_BASE_URL` | OpenAI-compatible chat API base URL |
| `CHAT_MODEL` | Defaults to `deepseek-v4-flash` |
| `CHAT_API_KEY` | Provider key; required for chat |
| `WHISPER_BASE_URL` | Base URL of an existing Whisper-compatible service |
| `WHISPER_MODEL` | Model alias known to that service |
| `WHISPER_API_KEY` | Optional transcription-service key |
| `MAP_API_URL` | Existing Fieldview backend origin; optional |

DeepSeek endpoint and model identifiers are listed in the [DeepSeek API changelog](https://api-docs.deepseek.com/updates/). NemoClaw checks tool-call behavior during onboarding, so the selected endpoint/model combination must support the capabilities required by its OpenClaw agent.
