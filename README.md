# Fieldview local agent demo

A CesiumJS map workspace with a small local agent that proposes map edits as GeoJSON. The browser renders the map; the Python API sends prompts to an OpenAI-compatible model endpoint on the local GB10. The agent returns a proposal, and the user chooses when to add that layer to the map.

## Stack

- React, TypeScript, Vite, CesiumJS
- FastAPI + Pydantic for the local agent API and GeoJSON validation
- OpenAI-compatible local inference endpoint (configure the server/model that is supported by your GB10 setup)
- Local files and browser memory for the demo; no database or cloud agent framework
- Optional Cesium ion for terrain, hosted 3D Tiles, and photogrammetry tiling

## Run the app

1. Install Node.js and Python 3.11+.
2. Copy `.env.example` to `.env` and configure `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`, and any API key required by your local inference server. Both Vite and the API read the root `.env` file.
3. In one terminal, start the API:

   ```powershell
   cd backend
   py -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app:app --reload --port 8000
   ```

4. In a second terminal, from the repository root:

   ```powershell
   npm install
   npm run dev
   ```

Open the Vite URL shown in the terminal. The agent API is available at `http://localhost:8000/api/health`.

## Map data

- Import `.kmz`, `.kml`, `.geojson`, or `.json` from the layer panel.
- Use **3D scene data → Stream Google 3D area** to load Google Photorealistic 3D Tiles from Cesium ion asset `2275207`; this requires `VITE_CESIUM_ION_TOKEN`. The provider is Google's photogrammetric mesh, not OSM building geometry.
- Paste a `tileset.json` URL under **3D scene data** to load another accessible 3D Tiles tileset.
- Set `VITE_CESIUM_ION_TOKEN` in the Vite environment to enable Cesium ion content and World Terrain. A token is not needed to view local GeoJSON/KML data.

## Agent boundary

The model receives the prompt and layer names/types only. It returns a concise summary plus a GeoJSON FeatureCollection. The API validates feature count, geometry types, and longitude/latitude bounds. The UI renders it as a proposal; it does not reach into Cesium or modify map state until **Review and add to map** is clicked.

This first cut is an agent-assisted authoring demo. It does not yet inspect the contents of imported files, run photogrammetry, persist edits, or support multi-user collaboration. Those can be added as explicit tools after the basic flow is working.

The local model runs on the configured endpoint. Cesium ion terrain, imagery, and hosted 3D assets make network requests. Google Photorealistic 3D Tiles are streamed on demand; do not build a persistent/offline tile cache or prefetch an area. Follow Google's `Cache-Control` headers and attribution requirements. The local model can run without network access, while map baselayers and hosted 3D data cannot.
