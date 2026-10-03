import { useEffect, useRef, useState } from 'react'
import { ArcType, Viewer, createWorldTerrainAsync, Cartesian2, Cartesian3, Cartographic, Color, Entity, GeoJsonDataSource, HeightReference, HorizontalOrigin, KmlDataSource, Cesium3DTileset, Ion, LabelStyle, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType, VerticalOrigin } from 'cesium'
import { Activity, Bot, Check, ChevronDown, CircleHelp, Compass, FileUp, ImagePlus, Layers3, MapPin, Plus, Send, Settings2, Sparkles, X } from 'lucide-react'

type FeatureCollection = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> }
type Proposal = { summary: string; geojson: FeatureCollection }
type SceneDetails = { longitude: number; latitude: number; altitude: number; heading: number; notes: string; imageUrl?: string; imageName?: string }
type Layer = { id: string; name: string; kind: string; visible: boolean; source?: unknown; scene?: SceneDetails }
type SceneDraft = { name: string; longitude?: number; latitude?: number; altitude: number; heading: number; notes: string; imageUrl?: string; imageName?: string }

const examples = ['Mark three access points near the center of the map', 'Add a search area around the Hult campus', 'Create a route connecting the current map layers']

export default function App() {
  const mapRoot = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const [layers, setLayers] = useState<Layer[]>([])
  const [prompt, setPrompt] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Local agent ready')
  const [tilesetUrl, setTilesetUrl] = useState('')
  const [showTilesInput, setShowTilesInput] = useState(false)
  const [modelName, setModelName] = useState('Local model')
  const [error, setError] = useState('')
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null)
  const [pickMode, setPickMode] = useState(false)
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [sceneError, setSceneError] = useState('')
  const pickModeRef = useRef(false)
  pickModeRef.current = pickMode

  useEffect(() => {
    let active = true
    const token = import.meta.env.VITE_CESIUM_ION_TOKEN
    if (token) Ion.defaultAccessToken = token
    if (!mapRoot.current) return
    const mapViewer = new Viewer(mapRoot.current, {
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      fullscreenButton: false, infoBox: true, selectionIndicator: true,
    })
    viewer.current = mapViewer
    mapViewer.scene.globe.baseColor = Color.fromCssColorString('#b5c8c1')
    mapViewer.camera.setView({ destination: Cartesian3.fromDegrees(-71.07065, 42.370061, 6500) })
    if (token) {
      void createWorldTerrainAsync().then((terrain) => { if (active) mapViewer.terrainProvider = terrain })
    }
    const clickHandler = new ScreenSpaceEventHandler(mapViewer.scene.canvas)
    clickHandler.setInputAction((event: { position: Cartesian2 }) => {
      if (pickModeRef.current) {
        const position = mapViewer.scene.pickPosition(event.position) ?? mapViewer.camera.pickEllipsoid(event.position, mapViewer.scene.globe.ellipsoid)
        if (position) {
          const cartographic = Cartographic.fromCartesian(position)
          setSceneDraft((draft) => draft ? { ...draft, longitude: Number(CesiumMath.toDegrees(cartographic.longitude).toFixed(6)), latitude: Number(CesiumMath.toDegrees(cartographic.latitude).toFixed(6)), altitude: Math.max(0, Math.round(cartographic.height)) } : draft)
          setPickMode(false)
        }
        return
      }
      const picked = mapViewer.scene.pick(event.position)?.id
      if (picked instanceof Entity) {
        const id = picked.properties?.scenePointId?.getValue(mapViewer.clock.currentTime)
        if (typeof id === 'string') setSelectedSceneId(id)
      }
    }, ScreenSpaceEventType.LEFT_CLICK)
    return () => { active = false; clickHandler.destroy(); mapViewer.destroy(); viewer.current = null }
  }, [])

  const addLayer = async (file: File) => {
    const mapViewer = viewer.current
    if (!mapViewer) return
    setError('')
    try {
      let source: unknown
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.kmz') || lower.endsWith('.kml')) {
        source = await KmlDataSource.load(new Blob([await file.arrayBuffer()]), { camera: mapViewer.scene.camera, canvas: mapViewer.scene.canvas })
        await mapViewer.dataSources.add(source as KmlDataSource)
      } else if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
        source = await GeoJsonDataSource.load(JSON.parse(await file.text()), { clampToGround: true, stroke: Color.fromCssColorString('#c6f36a'), fill: Color.fromCssColorString('#c6f36a').withAlpha(0.22), strokeWidth: 3 })
        await mapViewer.dataSources.add(source as GeoJsonDataSource)
      } else {
        throw new Error('Use a .kmz, .kml, .geojson, or .json file.')
      }
      setLayers((previous) => [...previous, { id: crypto.randomUUID(), name: file.name, kind: lower.endsWith('kmz') || lower.endsWith('kml') ? 'KML / KMZ' : 'GeoJSON', visible: true, source }])
      setStatus(`${file.name} added`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this file.') }
  }

  const requestProposal = async (text = prompt) => {
    if (!text.trim()) return
    setBusy(true); setError(''); setProposal(null); setStatus('Agent is preparing a map edit…')
    try {
      const response = await fetch('/api/agent/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, layers: layers.map(({ name, kind }) => ({ name, kind })) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Agent request failed')
      setProposal(data); setModelName(data.model || 'Local model'); setStatus('Proposal ready for review')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reach the local agent.'); setStatus('Agent unavailable') }
    finally { setBusy(false) }
  }

  const applyProposal = async () => {
    if (!proposal || !viewer.current) return
    try {
      const source = await GeoJsonDataSource.load(proposal.geojson, { clampToGround: true, stroke: Color.fromCssColorString('#c6f36a'), fill: Color.fromCssColorString('#c6f36a').withAlpha(0.2), strokeWidth: 3 })
      await viewer.current.dataSources.add(source)
      setLayers((previous) => [...previous, { id: crypto.randomUUID(), name: 'Agent proposal', kind: 'AI generated', visible: true, source }])
      setProposal(null); setPrompt(''); setStatus('Agent edit added to map')
    } catch { setError('The proposed map layer could not be displayed.') }
  }

  const toggleLayer = (layer: Layer) => {
    const visible = !layer.visible
    if (layer.source instanceof GeoJsonDataSource || layer.source instanceof KmlDataSource) layer.source.show = visible
    if (layer.source instanceof Cesium3DTileset) layer.source.show = visible
    if (layer.source instanceof Entity) layer.source.show = visible
    if (layer.kind === 'Google Photorealistic' && viewer.current) viewer.current.scene.globe.show = !visible
    setLayers((previous) => previous.map((entry) => entry.id === layer.id ? { ...entry, visible } : entry))
  }

  const addTileset = async () => {
    if (!viewer.current || !tilesetUrl.trim()) return
    try {
      const tileset = await Cesium3DTileset.fromUrl(tilesetUrl.trim())
      viewer.current.scene.primitives.add(tileset)
      setLayers((previous) => [...previous, { id: crypto.randomUUID(), name: 'Photogrammetry model', kind: '3D Tiles', visible: true, source: tileset }])
      viewer.current.flyTo(tileset); setTilesetUrl(''); setShowTilesInput(false); setStatus('3D Tiles added')
    } catch { setError('Could not load that 3D Tiles URL. Check that it points to a tileset.json or ion asset.') }
  }

  const addGoogleTiles = async () => {
    const mapViewer = viewer.current
    if (!mapViewer) return
    if (!import.meta.env.VITE_CESIUM_ION_TOKEN) {
      setError('Set VITE_CESIUM_ION_TOKEN in .env to stream Google Photorealistic 3D Tiles.')
      return
    }
    if (layers.some((layer) => layer.kind === 'Google Photorealistic')) {
      setError('Google Photorealistic 3D Tiles are already in the scene.')
      return
    }
    setError('')
    try {
      const tileset = await Cesium3DTileset.fromIonAssetId(2275207)
      mapViewer.scene.primitives.add(tileset)
      mapViewer.scene.globe.show = false
      setLayers((previous) => [...previous, { id: crypto.randomUUID(), name: 'Google Photorealistic 3D Tiles', kind: 'Google Photorealistic', visible: true, source: tileset }])
      setStatus('Google 3D area streaming from Cesium ion')
      mapViewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(-71.07065, 42.370061, 1900),
        orientation: { heading: CesiumMath.toRadians(15), pitch: CesiumMath.toRadians(-38), roll: 0 },
        duration: 2,
      })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message.replace(/access_token=[^&\s]+/gi, 'access_token=REDACTED').replace(/Bearer\s+[^&\s]+/gi, 'Bearer REDACTED') : ''
      setError(`Could not load Google Photorealistic 3D Tiles. ${detail.slice(0, 180) || 'Check the ion token and asset access.'}`)
    }
  }

  const beginScenePoint = () => {
    if (sceneDraft?.imageUrl) URL.revokeObjectURL(sceneDraft.imageUrl)
    setSceneError('')
    setSelectedSceneId(null)
    setSceneDraft({ name: 'Observation point', altitude: 0, heading: 0, notes: '' })
    setPickMode(true)
  }

  const cancelSceneDraft = () => {
    if (sceneDraft?.imageUrl) URL.revokeObjectURL(sceneDraft.imageUrl)
    setSceneDraft(null)
    setPickMode(false)
    setSceneError('')
  }

  const addScenePoint = () => {
    const mapViewer = viewer.current
    if (!mapViewer || !sceneDraft || sceneDraft.longitude === undefined || sceneDraft.latitude === undefined) {
      setSceneError('Select a point on the map first.')
      return
    }
    if (!sceneDraft.name.trim()) {
      setSceneError('Add a title for this scene point.')
      return
    }
    const id = crypto.randomUUID()
    const heading = ((Math.round(sceneDraft.heading) % 360) + 360) % 360
    const radians = CesiumMath.toRadians(heading)
    const latitudeRadians = CesiumMath.toRadians(sceneDraft.latitude)
    const arrowLength = 70
    const endLatitude = sceneDraft.latitude + Math.cos(radians) * arrowLength / 111320
    const endLongitude = sceneDraft.longitude + Math.sin(radians) * arrowLength / (111320 * Math.max(0.1, Math.cos(latitudeRadians)))
    const origin = Cartesian3.fromDegrees(sceneDraft.longitude, sceneDraft.latitude, sceneDraft.altitude)
    const end = Cartesian3.fromDegrees(endLongitude, endLatitude, sceneDraft.altitude)
    const entity = mapViewer.entities.add({
      position: origin,
      point: { pixelSize: 12, color: Color.fromCssColorString('#c6f36a'), outlineColor: Color.fromCssColorString('#172019'), outlineWidth: 2, heightReference: HeightReference.NONE },
      label: {
        text: `${sceneDraft.name.trim()}  ·  ${String(heading).padStart(3, '0')}°`,
        font: '11px DM Sans', fillColor: Color.WHITE, outlineColor: Color.fromCssColorString('#172019'), outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE, showBackground: true, backgroundColor: Color.fromCssColorString('#172019').withAlpha(0.8),
        verticalOrigin: VerticalOrigin.BOTTOM, horizontalOrigin: HorizontalOrigin.CENTER,
        pixelOffset: new Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      polyline: { positions: [origin, end], width: 3, material: Color.fromCssColorString('#c6f36a'), arcType: ArcType.NONE },
      properties: { scenePointId: id },
    })
    const details: SceneDetails = {
      longitude: sceneDraft.longitude, latitude: sceneDraft.latitude, altitude: sceneDraft.altitude,
      heading, notes: sceneDraft.notes.trim(), imageUrl: sceneDraft.imageUrl, imageName: sceneDraft.imageName,
    }
    setLayers((previous) => [...previous, { id, name: sceneDraft.name.trim(), kind: 'Scene point', visible: true, source: entity, scene: details }])
    setSelectedSceneId(id)
    setSceneDraft(null)
    setPickMode(false)
    setSceneError('')
    setStatus('Scene point added to map')
  }

  const chooseSceneImage = (file?: File) => {
    if (!file || !sceneDraft) return
    if (!file.type.startsWith('image/')) { setSceneError('Choose an image file.'); return }
    if (file.size > 8 * 1024 * 1024) { setSceneError('Choose an image smaller than 8 MB.'); return }
    if (sceneDraft.imageUrl) URL.revokeObjectURL(sceneDraft.imageUrl)
    setSceneDraft({ ...sceneDraft, imageUrl: URL.createObjectURL(file), imageName: file.name })
    setSceneError('')
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark"><Layers3 size={19} /></span><span>FIELDVIEW<span className="brand-dot">.</span></span></a>
      <div className="project-switch"><span className="project-glyph">H</span><span>Hult · Cambridge</span><ChevronDown size={14} /></div>
      <div className="topbar-right"><span className="runtime-pill"><span className="pulse" />LOCAL RUNTIME</span><button className="icon-button" title="Settings"><Settings2 size={17} /></button><div className="avatar">S</div></div>
    </header>
    <div className="workspace">
      <aside className="sidebar">
        <div className="side-heading"><div><span className="eyebrow">WORKSPACE</span><h1>Map studio</h1></div><button className="icon-button subtle" title="Workspace help"><CircleHelp size={16} /></button></div>
        <section className="side-section">
          <div className="section-head"><span className="eyebrow">LAYERS <span className="count">{layers.length}</span></span><button className="mini-button" onClick={() => document.getElementById('file-upload')?.click()} title="Add layer"><Plus size={15} /></button></div>
          <input id="file-upload" type="file" accept=".kmz,.kml,.geojson,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void addLayer(file); event.currentTarget.value = '' }} />
          <button className="upload-card" onClick={() => document.getElementById('file-upload')?.click()}><span className="upload-icon"><FileUp size={16} /></span><span><b>Import map data</b><small>KMZ, KML, GeoJSON</small></span><Plus className="upload-plus" size={15} /></button>
          <button className="upload-card tiles-card" onClick={() => setShowTilesInput((value) => !value)}><span className="upload-icon terrain-icon"><Layers3 size={16} /></span><span><b>3D scene data</b><small>Google 3D or custom tiles</small></span><Plus className="upload-plus" size={15} /></button>
          {showTilesInput && <div className="tiles-form"><button className="google-tiles-button" onClick={() => void addGoogleTiles()}><span className="google-g">G</span><span>Stream Google 3D area<small>Cesium ion · asset 2275207</small></span><Plus size={14} /></button><div className="inline-form"><input value={tilesetUrl} onChange={(event) => setTilesetUrl(event.target.value)} placeholder="Custom tileset.json URL" /><button onClick={() => void addTileset()}>Add</button></div></div>}
          {layers.length > 0 && <div className="layer-list">{layers.map((layer) => <div className={`layer-row ${selectedSceneId === layer.id ? 'is-selected' : ''}`} key={layer.id}><button className={`visibility ${layer.visible ? 'is-on' : ''}`} onClick={() => toggleLayer(layer)} aria-label={`Toggle ${layer.name}`} /><span className="layer-symbol"><MapPin size={14} /></span><button className="layer-name" onClick={() => layer.scene && setSelectedSceneId(layer.id)}>{layer.name}<small>{layer.kind}</small></button><button className="icon-button tiny" onClick={() => { if (layer.source instanceof GeoJsonDataSource || layer.source instanceof KmlDataSource) viewer.current?.dataSources.remove(layer.source, true); if (layer.source instanceof Cesium3DTileset) viewer.current?.scene.primitives.remove(layer.source); if (layer.source instanceof Entity) viewer.current?.entities.remove(layer.source); if (layer.kind === 'Google Photorealistic' && viewer.current) viewer.current.scene.globe.show = true; if (layer.scene?.imageUrl) URL.revokeObjectURL(layer.scene.imageUrl); if (selectedSceneId === layer.id) setSelectedSceneId(null); setLayers((previous) => previous.filter((item) => item.id !== layer.id)) }} aria-label={`Remove ${layer.name}`}><X size={14} /></button></div>)}</div>}
          {layers.length === 0 && <div className="empty-layers">No layers yet.<br />Import data or ask the agent to create some.</div>}
          <button className="scene-create-button" onClick={beginScenePoint}><Plus size={15} /><span>Add scene point</span><small>Point · heading · image</small></button>
          {pickMode && <div className="pick-banner"><MapPin size={14} /> Click the map to set the point<button onClick={() => setPickMode(false)}>Cancel</button></div>}
          {sceneDraft && <div className="scene-editor">
            <div className="scene-editor-title"><span className="scene-editor-icon"><Compass size={15} /></span><span><b>New scene point</b><small>{sceneDraft.longitude === undefined ? 'Choose a map location' : 'Location selected'}</small></span><button className="icon-button tiny" onClick={cancelSceneDraft} aria-label="Cancel scene point"><X size={14} /></button></div>
            <button className={`pick-location-button ${sceneDraft.longitude !== undefined ? 'has-location' : ''}`} onClick={() => setPickMode(true)}><MapPin size={14} />{sceneDraft.longitude === undefined ? 'Click map to place point' : `${sceneDraft.latitude?.toFixed(5)}°, ${sceneDraft.longitude?.toFixed(5)}°`}<span>{sceneDraft.longitude !== undefined ? 'Change' : 'Pick'}</span></button>
            <label className="scene-label">Title<input value={sceneDraft.name} maxLength={80} onChange={(event) => setSceneDraft({ ...sceneDraft, name: event.target.value })} /></label>
            <div className="scene-fields">
              <label className="scene-label">Altitude <span className="units">m</span><input type="number" min="-500" max="100000" step="1" value={sceneDraft.altitude} onChange={(event) => setSceneDraft({ ...sceneDraft, altitude: Number(event.target.value) })} /></label>
              <label className="scene-label">Heading <span className="units">°</span><input type="number" min="0" max="359" step="1" value={sceneDraft.heading} onChange={(event) => setSceneDraft({ ...sceneDraft, heading: Number(event.target.value) })} /></label>
            </div>
            <div className="compass-preview"><span className="compass-north">N</span><span className="compass-east">E</span><span className="compass-south">S</span><span className="compass-west">W</span><span className="compass-needle" style={{ transform: `translate(-50%,-50%) rotate(${sceneDraft.heading}deg)` }} /><span className="compass-degree">{String(((Math.round(sceneDraft.heading) % 360) + 360) % 360).padStart(3, '0')}°</span></div>
            <label className="scene-label">Situation notes<textarea value={sceneDraft.notes} maxLength={500} rows={2} placeholder="What should teammates know?" onChange={(event) => setSceneDraft({ ...sceneDraft, notes: event.target.value })} /></label>
            <input id="scene-image" type="file" accept="image/*" hidden onChange={(event) => { chooseSceneImage(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
            <button className="image-pick-button" onClick={() => document.getElementById('scene-image')?.click()}><ImagePlus size={15} />{sceneDraft.imageName || 'Attach an image'}<span>{sceneDraft.imageName ? 'Replace' : 'Optional'}</span></button>
            {sceneDraft.imageUrl && <img className="scene-image-preview" src={sceneDraft.imageUrl} alt="Scene attachment preview" />}
            {sceneError && <div className="scene-error">{sceneError}</div>}
            <button className="save-scene-button" disabled={sceneDraft.longitude === undefined} onClick={addScenePoint}><Check size={14} /> Add scene point</button>
            <small className="session-note">Saved in this browser session only.</small>
          </div>}
          {selectedSceneId && (() => { const selected = layers.find((layer) => layer.id === selectedSceneId && layer.scene); if (!selected?.scene) return null; return <div className="scene-detail-card"><div className="scene-detail-heading"><b>{selected.name}</b><button className="icon-button tiny" onClick={() => setSelectedSceneId(null)} aria-label="Close scene details"><X size={14} /></button></div><div className="scene-detail-coords">{selected.scene.latitude.toFixed(5)}°, {selected.scene.longitude.toFixed(5)}°</div><div className="scene-detail-stats"><span>ALT <b>{selected.scene.altitude} m</b></span><span>HDG <b>{String(selected.scene.heading).padStart(3, '0')}°</b></span></div>{selected.scene.imageUrl && <img className="scene-detail-image" src={selected.scene.imageUrl} alt={selected.scene.imageName || 'Scene attachment'} />}{selected.scene.imageName && <small className="scene-image-name">{selected.scene.imageName}</small>}{selected.scene.notes && <p className="scene-detail-notes">{selected.scene.notes}</p>}</div> })()}
        </section>
        <div className="sidebar-spacer" />
        <div className="runtime-card"><div className="runtime-card-top"><span className="model-orb"><Bot size={16} /></span><span><b>Local AI agent</b><small>{modelName}</small></span><span className="live-tag">LIVE</span></div><div className="runtime-status"><span className="status-dot" />{status}</div><div className="runtime-foot"><span><Activity size={13} /> GB10 runtime</span><button className="text-button" onClick={() => setStatus('Agent uses the configured local OpenAI-compatible endpoint.')}>Details</button></div></div>
        <div className="sidebar-footer"><span>FIELDVIEW LABS · 0.1.0</span><span className="help-link">HELP CENTER</span></div>
      </aside>

      <section className="map-workspace"><div className={`map-canvas ${pickMode ? 'pick-mode' : ''}`} ref={mapRoot} />
        <div className="map-top-overlay"><div className="location-chip"><span className="loc-dot" /><span>HULT BOSTON CAMPUS · CAMBRIDGE</span><span className="coord-sep">/</span><span className="coords">42.3701° N&nbsp; 71.0707° W</span></div><div className="map-actions"><button className="map-action" onClick={() => document.getElementById('file-upload')?.click()}><FileUp size={14} /> Import</button><button className="map-action" onClick={() => setShowTilesInput(true)}><Layers3 size={14} /> 3D Tiles</button></div></div>
        {pickMode && <div className="map-pick-toast"><MapPin size={15} />Click anywhere on the map to place the scene point</div>}
        <div className="assistant-panel"><div className="assistant-heading"><div className="assistant-icon"><Sparkles size={16} /></div><div><b>Map assistant</b><small>Describe what you want to add</small></div><span className="local-badge"><span className="status-dot" /> LOCAL</span></div>
          <div className="prompt-suggestions">{examples.map((example) => <button key={example} onClick={() => { setPrompt(example); void requestProposal(example) }}>{example}</button>)}</div>
          <div className="prompt-box"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void requestProposal() } }} placeholder="Ask the agent to create or analyze a map layer…" rows={2} /><button className="send-button" disabled={busy || !prompt.trim()} onClick={() => void requestProposal()} aria-label="Send prompt">{busy ? <span className="spinner" /> : <Send size={15} />}</button></div>
          {error && <div className="error-message">{error}</div>}
          {proposal && <div className="proposal-card"><div className="proposal-title"><span className="proposal-check"><Sparkles size={13} /></span><b>Proposed map edit</b><button className="icon-button tiny" onClick={() => setProposal(null)} aria-label="Dismiss proposal"><X size={14} /></button></div><p>{proposal.summary}</p><div className="proposal-meta"><span>{proposal.geojson.features.length} features</span><span>GeoJSON layer</span></div><button className="apply-button" onClick={() => void applyProposal()}><Check size={15} /> Review and add to map</button></div>}
          <div className="assistant-note"><span className="lock-mark">⌑</span>Runs on your local AI endpoint <span className="note-sep">·</span> Map edits need your approval</div>
        </div>
        <div className="map-scale">1 km <span className="scale-line" /></div>
      </section>
    </div>
  </main>
}
