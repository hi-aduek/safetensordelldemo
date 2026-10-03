import { useEffect, useRef, useState } from 'react'
import { ArcType, Viewer, createWorldTerrainAsync, Cartesian2, Cartesian3, Cartographic, Color, ConstantPositionProperty, ConstantProperty, Entity, GeoJsonDataSource, HeightReference, HorizontalOrigin, ImageMaterialProperty, KmlDataSource, Cesium3DTileset, Cesium3DTileStyle, Ion, LabelStyle, Math as CesiumMath, Matrix4, PolygonHierarchy, PolylineArrowMaterialProperty, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms, VerticalOrigin } from 'cesium'
import { Activity, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, Compass, FileUp, ImagePlus, Layers3, MapPin, Pause, Pencil, Play, Plus, Route as RouteIcon, Send, Settings2, Sparkles, X } from 'lucide-react'

type FeatureCollection = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> }
type Proposal = { summary: string; geojson: FeatureCollection }
type AreaOfInterest = { longitude: number; latitude: number; groundAltitude: number }
type SceneDetails = { longitude: number; latitude: number; altitude: number; groundAltitude: number; heading: number; pitch: number; notes: string; imageUrl?: string; imageName?: string; areaOfInterest?: AreaOfInterest }
type RoutePoint = { longitude: number; latitude: number; altitude: number }
type RouteMode = 'drive' | 'walk'
type ActorType = 'emt' | 'firefighter' | 'police'
type RouteDetails = { points: RoutePoint[]; legModes: RouteMode[]; actorType: ActorType }
type RouteDraft = RouteDetails & { name: string; nextMode: RouteMode }
type Layer = { id: string; name: string; kind: string; visible: boolean; source?: unknown; auxEntities?: Entity[]; scene?: SceneDetails; route?: RouteDetails }
type SceneDraft = { name: string; longitude?: number; latitude?: number; altitude: number; groundAltitude?: number; heading: number; pitch: number; notes: string; imageUrl?: string; imageName?: string; areaOfInterest?: AreaOfInterest }

const GROUND_VISUAL_OFFSET_METERS = -20
const EMT_VEHICLE_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#17221d" stroke="#c6f36a" stroke-width="2"/><path d="M8 17h21v16H8zM29 22h7l5 6v5H29z" fill="#f4f5ec"/><path d="M13 20h11v8H13z" fill="#87b5c5"/><path d="M32 24h3l3 4h-6z" fill="#87b5c5"/><path d="M20 21v6m-3-3h6" stroke="#d95748" stroke-width="2.5"/><circle cx="15" cy="34" r="3" fill="#222"/><circle cx="35" cy="34" r="3" fill="#222"/></svg>')}`
const EMT_WALKER_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#17221d" stroke="#c6f36a" stroke-width="2"/><circle cx="25" cy="12" r="4" fill="#f4f5ec"/><path d="m21 19 8 3 4 7m-12-8-5 8m13-7-3 8 6 7m-9-7-7 7" fill="none" stroke="#f4f5ec" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')}`
const actorLabel = (type: ActorType) => type === 'firefighter' ? 'Firefighter' : type === 'police' ? 'Police' : 'EMT'
const routeActorIcon = (type: ActorType, mode: RouteMode) => {
  if (type === 'emt') return mode === 'drive' ? EMT_VEHICLE_ICON : EMT_WALKER_ICON
  const fire = type === 'firefighter'
  const accent = fire ? '#ef604d' : '#5ca9f2'
  const mark = fire ? 'FD' : 'PD'
  const svg = mode === 'drive'
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#17221d" stroke="${accent}" stroke-width="2"/><path d="M7 19h25v14H7zM32 23h6l4 5v5H32z" fill="#f4f5ec"/><path d="M11 21h9v7h-9zM22 21h7v7h-7z" fill="#87b5c5"/><path d="M10 17h23" stroke="${accent}" stroke-width="3"/><text x="24" y="32" text-anchor="middle" font-family="sans-serif" font-size="6" font-weight="bold" fill="${accent}">${mark}</text><circle cx="14" cy="35" r="3" fill="#222"/><circle cx="36" cy="35" r="3" fill="#222"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#17221d" stroke="${accent}" stroke-width="2"/><path d="M18 15q7-8 14 0z" fill="${accent}"/><circle cx="25" cy="18" r="4" fill="#f4f5ec"/><path d="m21 23 8 2 3 8m-11-8-5 7m13-6-3 8 6 5m-10-5-7 5" fill="none" stroke="${accent}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="13" font-family="sans-serif" font-size="6" font-weight="bold" fill="${accent}">${mark}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const sceneArrowEnd = (scene: Pick<SceneDetails, 'longitude' | 'latitude' | 'altitude' | 'groundAltitude' | 'heading' | 'pitch'>) => {
  const radians = CesiumMath.toRadians(scene.heading)
  const pitchRadians = CesiumMath.toRadians(scene.pitch)
  const latitudeRadians = CesiumMath.toRadians(scene.latitude)
  const arrowLength = 70
  const horizontalLength = arrowLength * Math.cos(pitchRadians)
  const endLatitude = scene.latitude + Math.cos(radians) * horizontalLength / 111320
  const endLongitude = scene.longitude + Math.sin(radians) * horizontalLength / (111320 * Math.max(0.1, Math.cos(latitudeRadians)))
  return Cartesian3.fromDegrees(endLongitude, endLatitude, scene.groundAltitude + scene.altitude + arrowLength * Math.sin(pitchRadians))
}

const sceneAltitudeGuide = (scene: Pick<SceneDetails, 'longitude' | 'latitude' | 'altitude' | 'groundAltitude'>) => [
  Cartesian3.fromDegrees(scene.longitude, scene.latitude, scene.groundAltitude + scene.altitude),
  Cartesian3.fromDegrees(scene.longitude, scene.latitude, scene.groundAltitude + GROUND_VISUAL_OFFSET_METERS),
]

const sceneAltitudeRing = (scene: Pick<SceneDetails, 'longitude' | 'latitude' | 'altitude' | 'groundAltitude'>) => {
  const radius = Math.max(2, scene.altitude)
  const groundPosition = Cartesian3.fromDegrees(scene.longitude, scene.latitude, scene.groundAltitude + GROUND_VISUAL_OFFSET_METERS)
  const eastNorthUp = Transforms.eastNorthUpToFixedFrame(groundPosition)
  return Array.from({ length: 49 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2
    const localPoint = new Cartesian3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
    return Matrix4.multiplyByPoint(eastNorthUp, localPoint, new Cartesian3())
  })
}

const examples = ['Mark three access points near the center of the map', 'Add a search area around the Hult campus', 'Create a route connecting the current map layers']

export default function App() {
  const mapRoot = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const googleTileset = useRef<Cesium3DTileset | null>(null)
  const googleTilesLoading = useRef(false)
  const googleOriginalStyle = useRef<Cesium3DTileStyle | undefined>(undefined)
  const [layers, setLayers] = useState<Layer[]>([])
  const [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null)
  const [routePickMode, setRoutePickMode] = useState(false)
  const [playingRouteIds, setPlayingRouteIds] = useState<string[]>([])
  const routePlaybackTimers = useRef(new Map<string, number>())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [assistantCollapsed, setAssistantCollapsed] = useState(false)
  const layersRef = useRef<Layer[]>([])
  layersRef.current = layers
  const [prompt, setPrompt] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Local agent ready')
  const [tilesetUrl, setTilesetUrl] = useState('')
  const [showTilesInput, setShowTilesInput] = useState(false)
  const [modelName, setModelName] = useState('Local model')
  const [error, setError] = useState('')
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null)
  const sceneDraftRef = useRef<SceneDraft | null>(null)
  sceneDraftRef.current = sceneDraft
  const routeDraftRef = useRef<RouteDraft | null>(null)
  routeDraftRef.current = routeDraft
  const [pickMode, setPickMode] = useState(false)
  const [aoiPickMode, setAoiPickMode] = useState(false)
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null)
  const [sceneError, setSceneError] = useState('')
  const pickModeRef = useRef(false)
  const aoiPickModeRef = useRef(false)
  const routePickModeRef = useRef(false)
  const draftEntity = useRef<Entity | null>(null)
  const draftAltitudeEntities = useRef<Entity[]>([])
  const routeDraftEntities = useRef<Entity[]>([])
  const imageProjectionEntity = useRef<Entity | null>(null)
  const altitudeDrag = useRef<{ id: string; entity: Entity; startY: number; startAltitude: number } | null>(null)
  pickModeRef.current = pickMode
  aoiPickModeRef.current = aoiPickMode
  routePickModeRef.current = routePickMode

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
      if (routePickModeRef.current) {
        const position = mapViewer.scene.pickPosition(event.position) ?? mapViewer.camera.pickEllipsoid(event.position, mapViewer.scene.globe.ellipsoid)
        const draft = routeDraftRef.current
        if (position && draft) {
          const cartographic = Cartographic.fromCartesian(position)
          const point = { longitude: CesiumMath.toDegrees(cartographic.longitude), latitude: CesiumMath.toDegrees(cartographic.latitude), altitude: cartographic.height }
          setRouteDraft((current) => current ? { ...current, points: [...current.points, point], legModes: current.points.length ? [...current.legModes, current.nextMode] : current.legModes } : current)
        }
        return
      }
      if (aoiPickModeRef.current) {
          const target = mapViewer.scene.pickPosition(event.position) ?? mapViewer.camera.pickEllipsoid(event.position, mapViewer.scene.globe.ellipsoid)
        const draft = sceneDraftRef.current
        if (target && draft?.longitude !== undefined && draft.latitude !== undefined) {
          const targetCartographic = Cartographic.fromCartesian(target)
          const observer = Cartesian3.fromDegrees(draft.longitude, draft.latitude, (draft.groundAltitude ?? 0) + draft.altitude)
          const frame = Transforms.eastNorthUpToFixedFrame(observer)
          const inverseFrame = Matrix4.inverseTransformation(frame, new Matrix4())
          const localTarget = Matrix4.multiplyByPoint(inverseFrame, target, new Cartesian3())
          const heading = ((CesiumMath.toDegrees(Math.atan2(localTarget.x, localTarget.y)) % 360) + 360) % 360
          const pitch = CesiumMath.toDegrees(Math.atan2(localTarget.z, Math.hypot(localTarget.x, localTarget.y)))
          const areaOfInterest = { longitude: Number(CesiumMath.toDegrees(targetCartographic.longitude).toFixed(6)), latitude: Number(CesiumMath.toDegrees(targetCartographic.latitude).toFixed(6)), groundAltitude: Math.round(targetCartographic.height) }
          setSceneDraft((current) => current ? { ...current, heading: Math.round(heading), pitch: Math.max(-89, Math.min(89, Math.round(pitch))), areaOfInterest } : current)
          setAoiPickMode(false)
        }
        return
      }
      if (pickModeRef.current) {
        const position = mapViewer.scene.pickPosition(event.position) ?? mapViewer.camera.pickEllipsoid(event.position, mapViewer.scene.globe.ellipsoid)
        if (position) {
          const cartographic = Cartographic.fromCartesian(position)
          const groundAltitude = Math.max(0, Math.round(cartographic.height))
          setSceneDraft((draft) => draft ? { ...draft, longitude: Number(CesiumMath.toDegrees(cartographic.longitude).toFixed(6)), latitude: Number(CesiumMath.toDegrees(cartographic.latitude).toFixed(6)), altitude: 0, groundAltitude, areaOfInterest: undefined } : draft)
          setPickMode(false)
        }
        return
      }
      const picked = mapViewer.scene.pick(event.position)?.id
      if (picked instanceof Entity) {
        const id = picked.properties?.scenePointId?.getValue(mapViewer.clock.currentTime)
        if (typeof id === 'string') setSelectedSceneId(id)
        const routeId = picked.properties?.routeId?.getValue(mapViewer.clock.currentTime)
        if (typeof routeId === 'string') setSelectedSceneId(routeId)
      }
    }, ScreenSpaceEventType.LEFT_CLICK)
    clickHandler.setInputAction((event: { position: Cartesian2 }) => {
      if (pickModeRef.current) return
      const picked = mapViewer.scene.pick(event.position)?.id
      if (!(picked instanceof Entity)) return
      const id = picked.properties?.scenePointId?.getValue(mapViewer.clock.currentTime)
      const layer = layersRef.current.find((item) => item.id === id && item.scene)
      if (typeof id === 'string' && layer?.scene && layer.source instanceof Entity) {
        altitudeDrag.current = { id, entity: layer.source, startY: event.position.y, startAltitude: layer.scene.altitude }
        mapViewer.scene.screenSpaceCameraController.enableRotate = false
        mapViewer.scene.screenSpaceCameraController.enableTranslate = false
        mapViewer.scene.screenSpaceCameraController.enableTilt = false
        setSelectedSceneId(id)
      }
    }, ScreenSpaceEventType.LEFT_DOWN)
    clickHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
      const drag = altitudeDrag.current
      const mapLayer = layersRef.current.find((item) => item.id === drag?.id && item.scene)
      if (!drag || !mapLayer?.scene) {
        const hovered = mapViewer.scene.pick(event.endPosition)?.id
        mapViewer.scene.canvas.style.cursor = hovered instanceof Entity && typeof hovered.properties?.scenePointId?.getValue(mapViewer.clock.currentTime) === 'string' ? 'grab' : ''
        return
      }
      const altitude = Math.max(0, Math.round(drag.startAltitude + (drag.startY - event.endPosition.y)))
      const scene = { ...mapLayer.scene, altitude }
      const origin = Cartesian3.fromDegrees(scene.longitude, scene.latitude, scene.groundAltitude + altitude)
      const end = sceneArrowEnd(scene)
      drag.entity.position = new ConstantPositionProperty(origin)
      if (drag.entity.polyline) drag.entity.polyline.positions = new ConstantProperty([origin, end])
      const [guide, ring] = mapLayer.auxEntities ?? []
      if (guide?.polyline) guide.polyline.positions = new ConstantProperty(sceneAltitudeGuide(scene))
      if (ring?.polyline) ring.polyline.positions = new ConstantProperty(sceneAltitudeRing(scene))
      setLayers((previous) => previous.map((item) => item.id === drag.id ? { ...item, scene } : item))
    }, ScreenSpaceEventType.MOUSE_MOVE)
    clickHandler.setInputAction(() => {
      altitudeDrag.current = null
      mapViewer.scene.screenSpaceCameraController.enableRotate = true
      mapViewer.scene.screenSpaceCameraController.enableTranslate = true
      mapViewer.scene.screenSpaceCameraController.enableTilt = true
      mapViewer.scene.canvas.style.cursor = ''
    }, ScreenSpaceEventType.LEFT_UP)
    return () => { active = false; clickHandler.destroy(); mapViewer.destroy(); viewer.current = null }
    }, [])

  useEffect(() => {
    const mapViewer = viewer.current
    if (!mapViewer || !sceneDraft || sceneDraft.longitude === undefined || sceneDraft.latitude === undefined) {
      if (draftEntity.current && viewer.current) viewer.current.entities.remove(draftEntity.current)
      if (viewer.current) draftAltitudeEntities.current.forEach((entity) => viewer.current?.entities.remove(entity))
      draftEntity.current = null
      draftAltitudeEntities.current = []
      return
    }
    const origin = Cartesian3.fromDegrees(sceneDraft.longitude, sceneDraft.latitude, (sceneDraft.groundAltitude ?? 0) + sceneDraft.altitude)
    const scenePosition = { longitude: sceneDraft.longitude, latitude: sceneDraft.latitude, altitude: sceneDraft.altitude, groundAltitude: sceneDraft.groundAltitude ?? 0 }
    const end = sceneArrowEnd({ ...scenePosition, heading: sceneDraft.heading, pitch: sceneDraft.pitch })
    if (!draftEntity.current) {
      draftEntity.current = mapViewer.entities.add({
        position: origin,
        point: { pixelSize: 13, color: Color.fromCssColorString('#f5a623'), outlineColor: Color.fromCssColorString('#172019'), outlineWidth: 2, heightReference: HeightReference.NONE },
        polyline: { positions: [origin, end], width: 4, material: new PolylineArrowMaterialProperty(Color.fromCssColorString('#f5a623')), arcType: ArcType.NONE },
      })
    } else {
      draftEntity.current.position = new ConstantPositionProperty(origin)
      if (draftEntity.current.polyline) draftEntity.current.polyline.positions = new ConstantProperty([origin, end])
    }
    draftAltitudeEntities.current.forEach((entity) => mapViewer.entities.remove(entity))
    draftAltitudeEntities.current = [
      mapViewer.entities.add({ polyline: { positions: sceneAltitudeGuide(scenePosition), width: 2, material: Color.fromCssColorString('#f5a623'), arcType: ArcType.NONE } }),
      mapViewer.entities.add({ polyline: { positions: sceneAltitudeRing(scenePosition), width: 2, material: Color.fromCssColorString('#f5a623').withAlpha(0.75), arcType: ArcType.NONE } }),
    ]
  }, [sceneDraft])

  useEffect(() => {
    let cancelled = false
    const mapViewer = viewer.current
    if (imageProjectionEntity.current && mapViewer) mapViewer.entities.remove(imageProjectionEntity.current)
    imageProjectionEntity.current = null
    if (!mapViewer || sceneDraft) return () => { cancelled = true }
    const layer = layers.find((item) => item.id === selectedSceneId && item.scene && item.visible)
    const imageUrl = layer?.scene?.imageUrl
    if (!layer?.scene || typeof imageUrl !== 'string') return () => { cancelled = true }
    const scene = layer.scene
    const target = scene.areaOfInterest ?? { longitude: scene.longitude, latitude: scene.latitude, groundAltitude: scene.groundAltitude }
    const targetCenter = Cartesian3.fromDegrees(target.longitude, target.latitude, target.groundAltitude + 1)
    const observer = Cartesian3.fromDegrees(scene.longitude, scene.latitude, scene.groundAltitude + scene.altitude)
    const center = scene.areaOfInterest ? Cartesian3.lerp(observer, targetCenter, 0.75, new Cartesian3()) : targetCenter
    const enu = Transforms.eastNorthUpToFixedFrame(center)
    let sightline: Cartesian3
    if (scene.areaOfInterest) {
      sightline = Cartesian3.normalize(Cartesian3.subtract(center, observer, new Cartesian3()), new Cartesian3())
    } else {
      const heading = CesiumMath.toRadians(scene.heading)
      const pitch = CesiumMath.toRadians(scene.pitch)
      const localSightline = new Cartesian3(Math.sin(heading) * Math.cos(pitch), Math.cos(heading) * Math.cos(pitch), Math.sin(pitch))
      const observerFrame = Transforms.eastNorthUpToFixedFrame(observer)
      sightline = Cartesian3.normalize(Matrix4.multiplyByPointAsVector(observerFrame, localSightline, new Cartesian3()), new Cartesian3())
    }
    const north = Matrix4.multiplyByPointAsVector(enu, new Cartesian3(0, 1, 0), new Cartesian3())
    const worldUp = Matrix4.multiplyByPointAsVector(enu, new Cartesian3(0, 0, 1), new Cartesian3())
    const upDot = Cartesian3.dot(worldUp, sightline)
    let imageUp = Cartesian3.subtract(worldUp, Cartesian3.multiplyByScalar(sightline, upDot, new Cartesian3()), new Cartesian3())
    if (Cartesian3.magnitude(imageUp) < 1e-5) {
      const northDot = Cartesian3.dot(north, sightline)
      imageUp = Cartesian3.subtract(north, Cartesian3.multiplyByScalar(sightline, northDot, new Cartesian3()), new Cartesian3())
    }
    Cartesian3.normalize(imageUp, imageUp)
    const imageRight = Cartesian3.normalize(Cartesian3.cross(sightline, imageUp, new Cartesian3()), new Cartesian3())
    imageUp = Cartesian3.normalize(Cartesian3.cross(imageRight, sightline, new Cartesian3()), new Cartesian3())
    const sourceImage = new Image()
    sourceImage.onload = () => {
      if (cancelled || mapViewer.isDestroyed()) return
      const canvas = document.createElement('canvas')
      canvas.width = sourceImage.naturalHeight
      canvas.height = sourceImage.naturalWidth
      const context = canvas.getContext('2d')
      if (!context) return
      context.translate(canvas.width, 0)
      context.rotate(Math.PI / 2)
      context.drawImage(sourceImage, 0, 0)
      const halfWidth = 18
      const halfLength = halfWidth * canvas.height / canvas.width
      const imageCorners = [[-halfWidth, -halfLength], [halfWidth, -halfLength], [halfWidth, halfLength], [-halfWidth, halfLength]].map(([right, forward]) => {
        const rightOffset = Cartesian3.multiplyByScalar(imageRight, right!, new Cartesian3())
        const upOffset = Cartesian3.multiplyByScalar(imageUp, forward!, new Cartesian3())
        return Cartesian3.add(center, Cartesian3.add(rightOffset, upOffset, new Cartesian3()), new Cartesian3())
      })
      imageProjectionEntity.current = mapViewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(imageCorners),
          perPositionHeight: true,
          material: new ImageMaterialProperty({ image: canvas, color: Color.WHITE.withAlpha(0.5), transparent: true }),
          outline: false,
        },
      })
    }
    sourceImage.src = imageUrl
    return () => {
      cancelled = true
      if (imageProjectionEntity.current && !mapViewer.isDestroyed()) mapViewer.entities.remove(imageProjectionEntity.current)
      imageProjectionEntity.current = null
    }
  }, [selectedSceneId, layers, sceneDraft])

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
    layer.auxEntities?.forEach((entity) => { entity.show = visible })
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
    if (googleTilesLoading.current) return
    if (!import.meta.env.VITE_CESIUM_ION_TOKEN) {
      setError('Set VITE_CESIUM_ION_TOKEN in .env to stream Google Photorealistic 3D Tiles.')
      return
    }
    if (layers.some((layer) => layer.kind === 'Google Photorealistic')) {
      setError('Google Photorealistic 3D Tiles are already in the scene.')
      return
    }
    googleTilesLoading.current = true
    setError('')
    try {
      const tileset = await Cesium3DTileset.fromIonAssetId(2275207)
      if (viewer.current !== mapViewer || mapViewer.isDestroyed()) { tileset.destroy(); return }
      googleTileset.current = tileset
      googleOriginalStyle.current = tileset.style
      if (sceneDraft) tileset.style = new Cesium3DTileStyle({ color: "color('white', 0.8)" })
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
    } finally {
      googleTilesLoading.current = false
    }
  }

  useEffect(() => {
    if (!import.meta.env.VITE_CESIUM_ION_TOKEN) return
    const timeout = window.setTimeout(() => { void addGoogleTiles() }, 0)
    return () => window.clearTimeout(timeout)
  }, [])

  const beginScenePoint = () => {
    const previousImage = layersRef.current.find((layer) => layer.id === editingSceneId)?.scene?.imageUrl
    if (sceneDraft?.imageUrl && sceneDraft.imageUrl !== previousImage) URL.revokeObjectURL(sceneDraft.imageUrl)
    const editingLayer = layersRef.current.find((layer) => layer.id === editingSceneId)
    if (editingLayer?.source instanceof Entity) editingLayer.source.show = editingLayer.visible
    editingLayer?.auxEntities?.forEach((entity) => { entity.show = editingLayer.visible })
    setEditingSceneId(null)
    setSceneError('')
    setSelectedSceneId(null)
    setSceneDraft({ name: 'Observation point', altitude: 0, heading: 0, pitch: 0, notes: '' })
    setAoiPickMode(false)
    if (googleTileset.current) googleTileset.current.style = new Cesium3DTileStyle({ color: "color('white', 0.8)" })
    setPickMode(true)
  }

  const cancelSceneDraft = () => {
    const originalImage = layersRef.current.find((layer) => layer.id === editingSceneId)?.scene?.imageUrl
    if (sceneDraft?.imageUrl && sceneDraft.imageUrl !== originalImage) URL.revokeObjectURL(sceneDraft.imageUrl)
    const editingLayer = layersRef.current.find((layer) => layer.id === editingSceneId)
    if (editingLayer?.source instanceof Entity) editingLayer.source.show = true
    editingLayer?.auxEntities?.forEach((entity) => { entity.show = true })
    setSceneDraft(null)
    setEditingSceneId(null)
    if (googleTileset.current) googleTileset.current.style = googleOriginalStyle.current
    setPickMode(false)
    setAoiPickMode(false)
    setSceneError('')
  }

  const beginSceneEdit = (layer: Layer) => {
    if (!layer.scene) return
    const previous = layersRef.current.find((candidate) => candidate.id === editingSceneId)
    if (previous?.source instanceof Entity) previous.source.show = previous.visible
    previous?.auxEntities?.forEach((entity) => { entity.show = previous.visible })
    if (sceneDraft?.imageUrl && sceneDraft.imageUrl !== layer.scene.imageUrl) URL.revokeObjectURL(sceneDraft.imageUrl)
    if (layer.source instanceof Entity) layer.source.show = false
    layer.auxEntities?.forEach((entity) => { entity.show = false })
    setEditingSceneId(layer.id)
    setSelectedSceneId(layer.id)
    setPickMode(false)
    setAoiPickMode(false)
    setSceneError('')
    setSceneDraft({
      name: layer.name, longitude: layer.scene.longitude, latitude: layer.scene.latitude,
      altitude: layer.scene.altitude, groundAltitude: layer.scene.groundAltitude,
      heading: layer.scene.heading, pitch: layer.scene.pitch, notes: layer.scene.notes,
      imageUrl: layer.scene.imageUrl, imageName: layer.scene.imageName, areaOfInterest: layer.scene.areaOfInterest,
    })
    if (googleTileset.current) googleTileset.current.style = new Cesium3DTileStyle({ color: "color('white', 0.8)" })
  }

  const beginRoutePlan = () => {
    if (sceneDraft) cancelSceneDraft()
    setSelectedSceneId(null)
    setRouteDraft({ name: 'EMT response', actorType: 'emt', points: [], legModes: [], nextMode: 'drive' })
    setRoutePickMode(true)
  }

  const saveRoute = () => {
    const mapViewer = viewer.current
    if (!mapViewer || !routeDraft || routeDraft.points.length < 2) return
    const id = crypto.randomUUID()
    const route = { points: routeDraft.points, legModes: routeDraft.legModes, actorType: routeDraft.actorType }
    const routeEntities = route.legModes.map((mode, index) => mapViewer.entities.add({
      polyline: {
        positions: route.points.slice(index, index + 2).map((point) => Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude)),
        width: mode === 'drive' ? 5 : 4,
        material: Color.fromCssColorString(mode === 'drive' ? '#58c8e8' : '#c6f36a').withAlpha(0.9),
        arcType: ArcType.GEODESIC,
        clampToGround: true,
      },
    }))
    const actor = mapViewer.entities.add({
      position: Cartesian3.fromDegrees(route.points[0].longitude, route.points[0].latitude, route.points[0].altitude + 2),
      billboard: { image: routeActorIcon(route.actorType, route.legModes[0] || 'drive'), width: 40, height: 40, verticalOrigin: VerticalOrigin.CENTER },
      properties: { routeId: id, actorType: route.actorType },
    })
    setLayers((previous) => [...previous, { id, name: routeDraft.name.trim() || `${actorLabel(route.actorType)} response`, kind: 'Route', visible: true, source: actor, auxEntities: routeEntities, route }])
    setSelectedSceneId(id)
    setRouteDraft(null)
    setRoutePickMode(false)
    setStatus('Route ready to simulate')
  }

  useEffect(() => {
    const mapViewer = viewer.current
    if (!mapViewer) return
    routeDraftEntities.current.forEach((entity) => mapViewer.entities.remove(entity))
    routeDraftEntities.current = []
    if (!routeDraft) return
    routeDraft.points.forEach((point, index) => {
      routeDraftEntities.current.push(mapViewer.entities.add({
        position: Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude + 2),
        point: { pixelSize: index === 0 ? 10 : 8, color: index === 0 ? Color.fromCssColorString('#58c8e8') : Color.WHITE, outlineColor: Color.fromCssColorString('#172019'), outlineWidth: 2 },
      }))
    })
    routeDraft.legModes.forEach((mode, index) => {
      routeDraftEntities.current.push(mapViewer.entities.add({
        polyline: {
          positions: routeDraft.points.slice(index, index + 2).map((point) => Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitude)),
          width: mode === 'drive' ? 5 : 4,
          material: Color.fromCssColorString(mode === 'drive' ? '#58c8e8' : '#c6f36a').withAlpha(0.9),
          arcType: ArcType.GEODESIC,
          clampToGround: true,
        },
      }))
    })
  }, [routeDraft])

  const toggleRoutePlayback = (routeId: string) => {
    const activeTimer = routePlaybackTimers.current.get(routeId)
    if (activeTimer !== undefined) {
      window.clearInterval(activeTimer)
      routePlaybackTimers.current.delete(routeId)
      setPlayingRouteIds((current) => current.filter((id) => id !== routeId))
      return
    }
    const layer = layersRef.current.find((item) => item.id === routeId && item.route)
    if (!layer?.route || !(layer.source instanceof Entity)) return
    const { points, legModes, actorType } = layer.route
    if (points.length < 2) return
    const actor = layer.source
    actor.position = new ConstantPositionProperty(Cartesian3.fromDegrees(points[0].longitude, points[0].latitude, points[0].altitude + 2))
    if (actor.billboard) actor.billboard.image = new ConstantProperty(routeActorIcon(actorType, legModes[0] || 'drive'))
    const legDurations = legModes.map((mode, index) => {
      const start = points[index]
      const end = points[index + 1]
      const startPosition = Cartesian3.fromDegrees(start.longitude, start.latitude, start.altitude)
      const endPosition = Cartesian3.fromDegrees(end.longitude, end.latitude, end.altitude)
      return Math.max(1200, Cartesian3.distance(startPosition, endPosition) / (mode === 'drive' ? 13 : 1.4) * 1000)
    })
    const totalDuration = legDurations.reduce((sum, duration) => sum + duration, 0)
    let elapsed = 0
    const timer = window.setInterval(() => {
      elapsed += 50
      if (elapsed >= totalDuration) {
        const last = points[points.length - 1]
        actor.position = new ConstantPositionProperty(Cartesian3.fromDegrees(last.longitude, last.latitude, last.altitude + 2))
        window.clearInterval(timer)
        routePlaybackTimers.current.delete(routeId)
        setPlayingRouteIds((current) => current.filter((id) => id !== routeId))
        return
      }
      let remaining = elapsed
      let index = 0
      while (index < legDurations.length - 1 && remaining >= legDurations[index]) { remaining -= legDurations[index]; index += 1 }
      const start = points[index]
      const end = points[index + 1]
      const fraction = Math.min(1, remaining / legDurations[index])
      let longitudeDelta = end.longitude - start.longitude
      if (longitudeDelta > 180) longitudeDelta -= 360
      if (longitudeDelta < -180) longitudeDelta += 360
      const longitude = start.longitude + longitudeDelta * fraction
      const latitude = start.latitude + (end.latitude - start.latitude) * fraction
      const altitude = start.altitude + (end.altitude - start.altitude) * fraction + 2
      actor.position = new ConstantPositionProperty(Cartesian3.fromDegrees(longitude, latitude, altitude))
      if (actor.billboard) actor.billboard.image = new ConstantProperty(routeActorIcon(actorType, legModes[index]))
    }, 50)
    routePlaybackTimers.current.set(routeId, timer)
    setPlayingRouteIds((current) => [...current, routeId])
  }

  useEffect(() => () => {
    routePlaybackTimers.current.forEach((timer) => window.clearInterval(timer))
    routePlaybackTimers.current.clear()
  }, [])

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
    const id = editingSceneId ?? crypto.randomUUID()
    const editingLayer = layersRef.current.find((layer) => layer.id === editingSceneId && layer.scene)
    const heading = ((Math.round(sceneDraft.heading) % 360) + 360) % 360
    const origin = Cartesian3.fromDegrees(sceneDraft.longitude, sceneDraft.latitude, (sceneDraft.groundAltitude ?? 0) + sceneDraft.altitude)
    const pitch = Math.max(-89, Math.min(89, Math.round(sceneDraft.pitch)))
    const end = sceneArrowEnd({ longitude: sceneDraft.longitude, latitude: sceneDraft.latitude, altitude: sceneDraft.altitude, groundAltitude: sceneDraft.groundAltitude ?? 0, heading, pitch })
    if (draftEntity.current) mapViewer.entities.remove(draftEntity.current)
    draftEntity.current = null
    const details: SceneDetails = {
      longitude: sceneDraft.longitude, latitude: sceneDraft.latitude, altitude: sceneDraft.altitude, groundAltitude: sceneDraft.groundAltitude ?? 0,
      heading, pitch, notes: sceneDraft.notes.trim(), imageUrl: sceneDraft.imageUrl, imageName: sceneDraft.imageName, areaOfInterest: sceneDraft.areaOfInterest,
    }
    let entity: Entity
    let auxEntities: Entity[]
    if (editingLayer?.source instanceof Entity) {
      entity = editingLayer.source
      entity.show = editingLayer.visible
      entity.position = new ConstantPositionProperty(origin)
      if (entity.label) entity.label.text = new ConstantProperty(`${sceneDraft.name.trim()}  ·  ${String(heading).padStart(3, '0')}°`)
      if (entity.polyline) entity.polyline.positions = new ConstantProperty([origin, end])
      auxEntities = editingLayer.auxEntities ?? []
      if (auxEntities[0]?.polyline) { auxEntities[0].show = editingLayer.visible; auxEntities[0].polyline.positions = new ConstantProperty(sceneAltitudeGuide(details)) }
      if (auxEntities[1]?.polyline) { auxEntities[1].show = editingLayer.visible; auxEntities[1].polyline.positions = new ConstantProperty(sceneAltitudeRing(details)) }
      setLayers((previous) => previous.map((layer) => layer.id === id ? { ...layer, name: sceneDraft.name.trim(), scene: details, source: entity, auxEntities } : layer))
      if (editingLayer.scene?.imageUrl && editingLayer.scene.imageUrl !== details.imageUrl) URL.revokeObjectURL(editingLayer.scene.imageUrl)
    } else {
      entity = mapViewer.entities.add({
        position: origin,
        point: { pixelSize: 12, color: Color.fromCssColorString('#c6f36a'), outlineColor: Color.fromCssColorString('#172019'), outlineWidth: 2, heightReference: HeightReference.NONE },
        label: {
          text: `${sceneDraft.name.trim()}  ·  ${String(heading).padStart(3, '0')}°`,
          font: '11px DM Sans', fillColor: Color.WHITE, outlineColor: Color.fromCssColorString('#172019'), outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE, showBackground: true, backgroundColor: Color.fromCssColorString('#172019').withAlpha(0.8),
          verticalOrigin: VerticalOrigin.BOTTOM, horizontalOrigin: HorizontalOrigin.CENTER,
          pixelOffset: new Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        polyline: { positions: [origin, end], width: 4, material: new PolylineArrowMaterialProperty(Color.fromCssColorString('#c6f36a')), arcType: ArcType.NONE },
        properties: { scenePointId: id },
      })
      auxEntities = [
        mapViewer.entities.add({ polyline: { positions: sceneAltitudeGuide(details), width: 2, material: Color.fromCssColorString('#c6f36a'), arcType: ArcType.NONE } }),
        mapViewer.entities.add({ polyline: { positions: sceneAltitudeRing(details), width: 2, material: Color.fromCssColorString('#c6f36a').withAlpha(0.75), arcType: ArcType.NONE } }),
      ]
      setLayers((previous) => [...previous, { id, name: sceneDraft.name.trim(), kind: 'Scene point', visible: true, source: entity, auxEntities, scene: details }])
    }
    if (googleTileset.current) googleTileset.current.style = googleOriginalStyle.current
    setSelectedSceneId(id)
    setSceneDraft(null)
    setEditingSceneId(null)
    setPickMode(false)
    setAoiPickMode(false)
    setSceneError('')
    setStatus(editingLayer ? 'Scene point updated' : 'Scene point added to map')
  }

  const chooseSceneImage = (file?: File) => {
    if (!file || !sceneDraft) return
    if (!file.type.startsWith('image/')) { setSceneError('Choose an image file.'); return }
    if (file.size > 8 * 1024 * 1024) { setSceneError('Choose an image smaller than 8 MB.'); return }
    const originalImage = layersRef.current.find((layer) => layer.id === editingSceneId)?.scene?.imageUrl
    if (sceneDraft.imageUrl && sceneDraft.imageUrl !== originalImage) URL.revokeObjectURL(sceneDraft.imageUrl)
    setSceneDraft({ ...sceneDraft, imageUrl: URL.createObjectURL(file), imageName: file.name })
    setSceneError('')
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="brand-mark"><Layers3 size={19} /></span><span>SafeTensor<span className="brand-dot">.</span></span></a>
      <div className="project-switch"><span className="project-glyph">H</span><span>Hult · Cambridge</span><ChevronDown size={14} /></div>
      <div className="topbar-right"><span className="runtime-pill"><span className="pulse" />LOCAL RUNTIME</span><button className="icon-button" title="Settings"><Settings2 size={17} /></button><div className="avatar">S</div></div>
    </header>
    <div className="workspace">
      <aside className={`sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <div className="side-heading"><div><span className="eyebrow">WORKSPACE</span><h1>Map studio</h1></div><button className="icon-button sidebar-collapse-button" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button><button className="icon-button subtle" title="Workspace help"><CircleHelp size={16} /></button></div>
        <section className="side-section">
          <div className="section-head"><span className="eyebrow">LAYERS <span className="count">{layers.length}</span></span><button className="mini-button" onClick={() => document.getElementById('file-upload')?.click()} title="Add layer"><Plus size={15} /></button></div>
          <input id="file-upload" type="file" accept=".kmz,.kml,.geojson,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void addLayer(file); event.currentTarget.value = '' }} />
          <button className="upload-card" onClick={() => document.getElementById('file-upload')?.click()}><span className="upload-icon"><FileUp size={16} /></span><span><b>Import map data</b><small>KMZ, KML, GeoJSON</small></span><Plus className="upload-plus" size={15} /></button>
          <button className="upload-card tiles-card" onClick={() => setShowTilesInput((value) => !value)}><span className="upload-icon terrain-icon"><Layers3 size={16} /></span><span><b>3D scene data</b><small>Google 3D or custom tiles</small></span><Plus className="upload-plus" size={15} /></button>
          {showTilesInput && <div className="tiles-form">{!layers.some((layer) => layer.kind === 'Google Photorealistic') && <button className="google-tiles-button" onClick={() => void addGoogleTiles()}><span className="google-g">G</span><span>Stream Google 3D area<small>Cesium ion · asset 2275207</small></span><Plus size={14} /></button>}<div className="inline-form"><input value={tilesetUrl} onChange={(event) => setTilesetUrl(event.target.value)} placeholder="Custom tileset.json URL" /><button onClick={() => void addTileset()}>Add</button></div></div>}
          {layers.length > 0 && <div className="layer-list">{layers.map((layer) => <div className={`layer-row ${selectedSceneId === layer.id ? 'is-selected' : ''}`} key={layer.id}><button className={`visibility ${layer.visible ? 'is-on' : ''}`} onClick={() => toggleLayer(layer)} aria-label={`Toggle ${layer.name}`} /><span className="layer-symbol"><MapPin size={14} /></span><button className="layer-name" onClick={() => (layer.scene || layer.route) && setSelectedSceneId(layer.id)}>{layer.name}<small>{layer.kind}</small></button><button className="icon-button tiny" onClick={() => { const timer = routePlaybackTimers.current.get(layer.id); if (timer !== undefined) window.clearInterval(timer); routePlaybackTimers.current.delete(layer.id); setPlayingRouteIds((current) => current.filter((id) => id !== layer.id)); if (layer.source instanceof GeoJsonDataSource || layer.source instanceof KmlDataSource) viewer.current?.dataSources.remove(layer.source, true); if (layer.source instanceof Cesium3DTileset) viewer.current?.scene.primitives.remove(layer.source); if (layer.source instanceof Entity) viewer.current?.entities.remove(layer.source); layer.auxEntities?.forEach((entity) => viewer.current?.entities.remove(entity)); if (layer.kind === 'Google Photorealistic' && viewer.current) viewer.current.scene.globe.show = true; if (layer.scene?.imageUrl) URL.revokeObjectURL(layer.scene.imageUrl); if (selectedSceneId === layer.id) setSelectedSceneId(null); setLayers((previous) => previous.filter((item) => item.id !== layer.id)) }} aria-label={`Remove ${layer.name}`}><X size={14} /></button></div>)}</div>}
          {layers.length === 0 && <div className="empty-layers">No layers yet.<br />Import data or ask the agent to create some.</div>}
          <button className="scene-create-button" onClick={beginScenePoint}><Plus size={15} /><span>Add scene point</span><small>Point · heading · image</small></button>
          <button className="scene-create-button route-create-button" onClick={beginRoutePlan}><RouteIcon size={15} /><span>Plan route</span><small>Drive · walk · actor</small></button>
          {(pickMode || aoiPickMode || routePickMode) && <div className="pick-banner"><MapPin size={14} /> {routePickMode ? 'Click the map to add route waypoints' : aoiPickMode ? 'Click the area of interest on the map' : 'Click the map to set the observer'}<button onClick={() => { setPickMode(false); setAoiPickMode(false); setRoutePickMode(false) }}>Done</button></div>}
          {routeDraft && <div className="scene-editor route-editor">
            <div className="scene-editor-title"><span className="scene-editor-icon"><RouteIcon size={15} /></span><span><b>Plan responder route</b><small>{routeDraft.points.length} waypoint{routeDraft.points.length === 1 ? '' : 's'}</small></span><button className="icon-button tiny" onClick={() => { setRouteDraft(null); setRoutePickMode(false) }} aria-label="Cancel route"><X size={14} /></button></div>
            <div className="route-mode-label">Actor</div><div className="route-actor-switch">{(['emt', 'firefighter', 'police'] as ActorType[]).map((type) => <button key={type} className={routeDraft.actorType === type ? 'is-active' : ''} onClick={() => setRouteDraft((current) => current ? { ...current, actorType: type, name: current.name === `${actorLabel(current.actorType)} response` ? `${actorLabel(type)} response` : current.name } : current)}>{actorLabel(type)}</button>)}</div>
            <label className="scene-label">Route name<input value={routeDraft.name} maxLength={80} onChange={(event) => setRouteDraft({ ...routeDraft, name: event.target.value })} /></label>
            <div className="route-mode-label">Next leg mode</div><div className="route-mode-switch"><button className={routeDraft.nextMode === 'drive' ? 'is-active' : ''} onClick={() => setRouteDraft({ ...routeDraft, nextMode: 'drive' })}>Drive</button><button className={routeDraft.nextMode === 'walk' ? 'is-active' : ''} onClick={() => setRouteDraft({ ...routeDraft, nextMode: 'walk' })}>Walk</button></div>
            <div className="route-waypoints">{routeDraft.points.map((point, index) => <div key={`${point.longitude}-${point.latitude}-${index}`}><span>{index === 0 ? 'START' : routeDraft.legModes[index - 1] === 'drive' ? 'DRIVE' : 'WALK'}</span><small>{point.latitude.toFixed(5)}°, {point.longitude.toFixed(5)}°</small></div>)}</div>
            <button className="pick-location-button" onClick={() => setRoutePickMode((picking) => !picking)}><MapPin size={14} />{routePickMode ? 'Stop adding waypoints' : 'Add waypoints on map'}<span>{routePickMode ? 'Active' : 'Pick'}</span></button>
            <button className="save-scene-button" disabled={routeDraft.points.length < 2} onClick={saveRoute}><Check size={14} /> Save route</button>
          </div>}
          {sceneDraft && <div className="scene-editor">
            <div className="scene-editor-title"><span className="scene-editor-icon"><Compass size={15} /></span><span><b>{editingSceneId ? 'Edit observer point' : 'New observer point'}</b><small>{sceneDraft.longitude === undefined ? 'Choose observer location' : 'Observer location selected'}</small></span><button className="icon-button tiny" onClick={cancelSceneDraft} aria-label="Cancel scene point"><X size={14} /></button></div>
            <button className={`pick-location-button ${sceneDraft.longitude !== undefined ? 'has-location' : ''}`} onClick={() => { setAoiPickMode(false); setPickMode(true) }}><MapPin size={14} />{sceneDraft.longitude === undefined ? 'Click map to place observer' : `${sceneDraft.latitude?.toFixed(5)}°, ${sceneDraft.longitude?.toFixed(5)}°`}<span>{sceneDraft.longitude !== undefined ? 'Change' : 'Pick'}</span></button>
            <button className="pick-location-button aoi-pick-button" disabled={sceneDraft.longitude === undefined} onClick={() => { setPickMode(false); setAoiPickMode(true) }}><MapPin size={14} />{sceneDraft.areaOfInterest ? `${sceneDraft.areaOfInterest.latitude.toFixed(5)}°, ${sceneDraft.areaOfInterest.longitude.toFixed(5)}°` : 'Set area of interest'}<span>{sceneDraft.areaOfInterest ? 'Change' : 'Pick on map'}</span></button>
            <label className="scene-label">Title<input value={sceneDraft.name} maxLength={80} onChange={(event) => setSceneDraft({ ...sceneDraft, name: event.target.value })} /></label>
            <div className="scene-fields">
              <label className="scene-label">Altitude AGL <span className="units">m</span><input type="number" min="0" max="100000" step="1" value={sceneDraft.altitude} onChange={(event) => setSceneDraft({ ...sceneDraft, altitude: Math.max(0, Number(event.target.value)) })} /></label>
              <label className="scene-label">Heading <span className="units">°</span><input type="number" min="0" max="359" step="1" value={sceneDraft.heading} onChange={(event) => setSceneDraft({ ...sceneDraft, heading: Number(event.target.value) })} /></label>
              <label className="scene-label">Pitch <span className="units">°</span><input type="number" min="-89" max="89" step="1" value={sceneDraft.pitch} onChange={(event) => setSceneDraft({ ...sceneDraft, pitch: Math.max(-89, Math.min(89, Number(event.target.value))) })} /></label>
            </div>
            <div className="scene-map-hint">Set an area of interest to calculate heading and pitch. The map arrow previews the 3D direction.</div>
            <div className="compass-preview"><span className="compass-north">N</span><span className="compass-east">E</span><span className="compass-south">S</span><span className="compass-west">W</span><span className="compass-needle" style={{ transform: `translate(-50%,-50%) rotate(${sceneDraft.heading}deg)` }} /><span className="compass-degree">{String(((Math.round(sceneDraft.heading) % 360) + 360) % 360).padStart(3, '0')}°</span></div>
            <label className="scene-label">Situation notes<textarea value={sceneDraft.notes} maxLength={500} rows={2} placeholder="What should teammates know?" onChange={(event) => setSceneDraft({ ...sceneDraft, notes: event.target.value })} /></label>
            <input id="scene-image" type="file" accept="image/*" hidden onChange={(event) => { chooseSceneImage(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
            <button className="image-pick-button" onClick={() => document.getElementById('scene-image')?.click()}><ImagePlus size={15} />{sceneDraft.imageName || 'Attach an image'}<span>{sceneDraft.imageName ? 'Replace' : 'Optional'}</span></button>
            {sceneDraft.imageUrl && <img className="scene-image-preview" src={sceneDraft.imageUrl} alt="Scene attachment preview" />}
            {sceneError && <div className="scene-error">{sceneError}</div>}
            <button className="save-scene-button" disabled={sceneDraft.longitude === undefined} onClick={addScenePoint}><Check size={14} /> {editingSceneId ? 'Save changes' : 'Add scene point'}</button>
            <small className="session-note">Saved in this browser session only.</small>
          </div>}
          {selectedSceneId && (() => {
            const selected = layers.find((layer) => layer.id === selectedSceneId)
            if (!selected) return null
            if (selected.route) return <div className="scene-detail-card route-detail-card"><div className="scene-detail-heading"><b>{selected.name}</b><button className="icon-button tiny" onClick={() => setSelectedSceneId(null)} aria-label="Close route details"><X size={14} /></button></div><div className="route-summary">{actorLabel(selected.route.actorType)} · {selected.route.points.length} waypoints · {selected.route.legModes.filter((mode) => mode === 'drive').length} drive legs · {selected.route.legModes.filter((mode) => mode === 'walk').length} walk legs</div><button className="save-scene-button route-play-button" onClick={() => toggleRoutePlayback(selected.id)}>{playingRouteIds.includes(selected.id) ? <><Pause size={14} /> Pause {actorLabel(selected.route.actorType)}</> : <><Play size={14} /> Simulate {actorLabel(selected.route.actorType)}</>}</button><div className="route-legend"><span><i className="drive-dot" />Drive</span><span><i className="walk-dot" />Walk</span></div></div>
            if (!selected.scene) return null
            return <div className="scene-detail-card"><div className="scene-detail-heading"><b>{selected.name}</b><button className="scene-edit-button" onClick={() => beginSceneEdit(selected)}><Pencil size={12} />Edit</button><button className="icon-button tiny" onClick={() => setSelectedSceneId(null)} aria-label="Close scene details"><X size={14} /></button></div><div className="scene-detail-coords">{selected.scene.latitude.toFixed(5)}°, {selected.scene.longitude.toFixed(5)}°</div><div className="scene-detail-stats"><span>ALT AGL <b>{selected.scene.altitude} m</b></span><span>HDG <b>{String(selected.scene.heading).padStart(3, '0')}°</b></span><span>PITCH <b>{String(selected.scene.pitch).padStart(2, '0')}°</b></span></div><small className="scene-drag-hint">Drag map point vertically to change altitude</small>{selected.scene.imageUrl && <img className="scene-detail-image" src={selected.scene.imageUrl} alt={selected.scene.imageName || 'Scene attachment'} />}{selected.scene.imageName && <small className="scene-image-name">{selected.scene.imageName}</small>}{selected.scene.notes && <p className="scene-detail-notes">{selected.scene.notes}</p>}</div>
          })()}
        </section>
        <div className="sidebar-spacer" />
        <div className="runtime-card"><div className="runtime-card-top"><span className="model-orb"><Bot size={16} /></span><span><b>Local AI agent</b><small>{modelName}</small></span><span className="live-tag">LIVE</span></div><div className="runtime-status"><span className="status-dot" />{status}</div><div className="runtime-foot"><span><Activity size={13} /> GB10 runtime</span><button className="text-button" onClick={() => setStatus('Agent uses the configured local OpenAI-compatible endpoint.')}>Details</button></div></div>
        <div className="sidebar-footer"><span>SAFETENSOR · 0.1.0</span><span className="help-link">HELP CENTER</span></div>
      </aside>

      <section className="map-workspace"><div className={`map-canvas ${pickMode || aoiPickMode || routePickMode ? 'pick-mode' : ''}`} ref={mapRoot} />
        <div className="map-top-overlay"><div className="location-chip"><span className="loc-dot" /><span>HULT BOSTON CAMPUS · CAMBRIDGE</span><span className="coord-sep">/</span><span className="coords">42.3701° N&nbsp; 71.0707° W</span></div><div className="map-actions"><button className="map-action" onClick={() => document.getElementById('file-upload')?.click()}><FileUp size={14} /> Import</button><button className="map-action" onClick={() => setShowTilesInput(true)}><Layers3 size={14} /> 3D Tiles</button></div></div>
        {(pickMode || aoiPickMode || routePickMode) && <div className="map-pick-toast"><MapPin size={15} />{routePickMode ? 'Click the map to add route waypoints' : aoiPickMode ? 'Click the area of interest to set heading and pitch' : 'Click anywhere on the map to place the observer point'}</div>}
        <div className={`assistant-panel ${assistantCollapsed ? 'is-collapsed' : ''}`}><div className="assistant-heading"><div className="assistant-icon"><Sparkles size={16} /></div><div><b>Map assistant</b><small>{assistantCollapsed ? 'Click to expand' : 'Describe what you want to add'}</small></div><span className="local-badge"><span className="status-dot" /> LOCAL</span><button className="assistant-collapse-button" onClick={() => setAssistantCollapsed((collapsed) => !collapsed)} title={assistantCollapsed ? 'Expand map assistant' : 'Collapse map assistant'} aria-label={assistantCollapsed ? 'Expand map assistant' : 'Collapse map assistant'}>{assistantCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button></div>
          {!assistantCollapsed && <>
          <div className="prompt-suggestions">{examples.map((example) => <button key={example} onClick={() => { setPrompt(example); void requestProposal(example) }}>{example}</button>)}</div>
          <div className="prompt-box"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void requestProposal() } }} placeholder="Ask the agent to create or analyze a map layer…" rows={2} /><button className="send-button" disabled={busy || !prompt.trim()} onClick={() => void requestProposal()} aria-label="Send prompt">{busy ? <span className="spinner" /> : <Send size={15} />}</button></div>
          {error && <div className="error-message">{error}</div>}
          {proposal && <div className="proposal-card"><div className="proposal-title"><span className="proposal-check"><Sparkles size={13} /></span><b>Proposed map edit</b><button className="icon-button tiny" onClick={() => setProposal(null)} aria-label="Dismiss proposal"><X size={14} /></button></div><p>{proposal.summary}</p><div className="proposal-meta"><span>{proposal.geojson.features.length} features</span><span>GeoJSON layer</span></div><button className="apply-button" onClick={() => void applyProposal()}><Check size={15} /> Review and add to map</button></div>}
          <div className="assistant-note"><span className="lock-mark">⌑</span>Runs on your local AI endpoint <span className="note-sep">·</span> Map edits need your approval</div>
          </>}
        </div>
        <div className="map-scale">1 km <span className="scale-line" /></div>
      </section>
    </div>
  </main>
}
