import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, ZoomControl } from 'react-leaflet';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';
// MarkerClusterGroup removed — always show individual numbered markers
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ItineraryActivity } from '../types';
import { fetchWalkingRoute } from '../api';

/* ── Numbered marker icon factory ──────────────────────────────────────────── */
function createNumberedIcon(index: number, isFirst: boolean, isLast: boolean) {
  const bg = isFirst ? '#10b981' : isLast ? '#ef4444' : '#10b981';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${bg};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:12px;font-weight:700;
      border:3px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
    ">${index + 1}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}


/* ── Notify Leaflet when container size changes (expand / collapse) ────────── */
function InvalidateSize({ expanded }: { expanded: boolean }) {
  const map = useMap();
  useEffect(() => {
    // Fire invalidateSize at multiple intervals to cover DOM reparenting + layout
    const timers = [0, 50, 200, 500].map((ms) =>
      setTimeout(() => map.invalidateSize(), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [expanded, map]);
  return null;
}

/* ── Auto-fit bounds: responsive padding based on spread ───────────────────── */
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 14);
      return;
    }
    const bounds = L.latLngBounds(positions);
    const latSpread = bounds.getNorth() - bounds.getSouth();
    const lngSpread = bounds.getEast() - bounds.getWest();
    const spread = Math.max(latSpread, lngSpread);
    const pad = spread > 1 ? 60 : spread > 0.1 ? 50 : 40;
    const maxZ = spread > 0.5 ? 12 : spread > 0.05 ? 13 : 15;
    map.fitBounds(bounds, { padding: [pad, pad], maxZoom: maxZ });
  }, [positions, map]);
  return null;
}

/* ── Tile providers ────────────────────────────────────────────────────────── */
const AMAP_TILE_URL =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
const AMAP_SUBDOMAINS = ['1', '2', '3', '4'];
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Rough bounding box for mainland China + nearby regions covered by AMap */
function isInsideChina(lat: number, lng: number): boolean {
  return lat >= 17 && lat <= 55 && lng >= 73 && lng <= 136;
}

/* ── Main component ────────────────────────────────────────────────────────── */
interface DayRouteMapProps {
  activities: ItineraryActivity[];
  dayNumber: number;
  city?: string;
}

export function DayRouteMap({ activities, dayNumber, city = '' }: DayRouteMapProps) {
  const [expanded, setExpanded] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const points = useMemo(() =>
    activities
      .filter((a) => a.lat != null && a.lng != null)
      .map((a) => ({
        lat: a.lat!,
        lng: a.lng!,
        name: a.activity,
        time: a.time,
        location: a.location,
      })),
    [activities]
  );

  const positions: [number, number][] = useMemo(
    () => points.map((p) => [p.lat, p.lng]),
    [points]
  );

  /* ── Detect hiking/mountain scenario → skip walking API ────────────── */
  const HIKING_KEYWORDS = /山|徒步|登山|爬山|步道|栈道|索道|峰|岭|trail|hike|mountain|trek|climb/i;
  const isHikingRoute = useMemo(
    () => activities.some((a) =>
      HIKING_KEYWORDS.test(a.activity) || HIKING_KEYWORDS.test(a.location)
    ),
    [activities],
  );

  /* ── Walking route segments from Gaode API ─────────────────────────── */
  const [routeSegments, setRouteSegments] = useState<[number, number][][] | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeFailed, setRouteFailed] = useState(false);

  const positionsKey = useMemo(
    () => points.map((p) => `${p.lat},${p.lng}`).join('|'),
    [points],
  );

  const loadWalkingRoute = useCallback(async () => {
    if (points.length < 2 || isHikingRoute) {
      setRouteSegments(null);
      setRouteFailed(false);
      return;
    }
    setRouteLoading(true);
    setRouteFailed(false);
    try {
      const resp = await fetchWalkingRoute(
        points.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          name: p.name,
          location: p.location,
          city,
        })),
      );
      const validSegments = (resp.segments || []).filter((seg) => Array.isArray(seg) && seg.length > 1);
      if (resp.ok && validSegments.length > 0) {
        setRouteSegments(validSegments);
      } else {
        setRouteSegments(null);
        setRouteFailed(true);
      }
    } catch {
      setRouteSegments(null);
      setRouteFailed(true);
    } finally {
      setRouteLoading(false);
    }
  }, [positionsKey, isHikingRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadWalkingRoute();
  }, [loadWalkingRoute]);

  if (points.length === 0) {
    return (
      <div className="bg-gradient-to-br from-teal-50 to-emerald-100 rounded-xl aspect-[16/10] flex items-center justify-center shadow-[0_8px_32px_rgba(87,94,112,0.04)] ring-1 ring-outline-variant/10">
        <p className="text-sm text-on-surface-variant">暂无坐标数据，无法渲染地图</p>
      </div>
    );
  }

  const center: [number, number] = [
    points.reduce((s, p) => s + p.lat, 0) / points.length,
    points.reduce((s, p) => s + p.lng, 0) / points.length,
  ];

  /* ── Reparent map to body when expanded (avoids ancestor transform
       breaking position:fixed) and move it back when collapsed ──────── */
  useEffect(() => {
    const container = containerRef.current;
    const slot = slotRef.current;
    if (!container || !slot) return;
    if (expanded) {
      document.body.appendChild(container);
    } else {
      slot.appendChild(container);
    }
  }, [expanded]);

  /* ── Lock body scroll when expanded ──────────────────────────────── */
  useEffect(() => {
    if (expanded) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [expanded]);

  /* ── Close on Escape key ───────────────────────────────────────── */
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expanded]);

  return (
    <>
      {/* ── Slot: holds the map container in normal flow; stays as
           a placeholder when the container is reparented to body ───── */}
      <div ref={slotRef} className={expanded ? 'rounded-xl aspect-[16/10] bg-surface-container-low ring-1 ring-outline-variant/10' : undefined}>
        <div
          ref={containerRef}
          onClick={() => { if (!expanded) setExpanded(true); }}
          className={
            expanded
              ? 'overflow-hidden isolate rounded-2xl shadow-2xl ring-1 ring-white/20'
              : 'overflow-hidden relative isolate rounded-xl aspect-[16/10] shadow-[0_8px_32px_rgba(87,94,112,0.04)] ring-1 ring-outline-variant/10 cursor-pointer hover:shadow-lg hover:ring-primary/20 group'
          }
          style={expanded ? {
            position: 'fixed',
            zIndex: 9999,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '92vw',
            height: '82vh',
            maxWidth: 1400,
          } : undefined}
        >
        {/* Day badge */}
        <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-2">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </div>
          <span className="text-[11px] font-bold text-slate-700 tracking-tight">
            第{dayNumber}天路线 · {points.length}个地点
            {routeLoading && ' · 加载路径...'}
            {!routeLoading && routeFailed && !isHikingRoute && ' · 路网规划失败'}
          </span>
        </div>

        {/* Subtle expand hint (only when collapsed) */}
        {!expanded && (
          <div className="absolute inset-0 z-[999] pointer-events-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="bg-black/40 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
              点击放大地图
            </div>
          </div>
        )}

        <MapContainer
          center={center}
          zoom={12}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <ZoomControl position="bottomright" />
          {isInsideChina(center[0], center[1]) ? (
            <TileLayer
              url={AMAP_TILE_URL}
              subdomains={AMAP_SUBDOMAINS}
              attribution='&copy; <a href="https://amap.com">高德地图</a>'
            />
          ) : (
            <TileLayer
              url={OSM_TILE_URL}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
          )}
          <FitBounds positions={positions} />
          <InvalidateSize expanded={expanded} />

          {/* Route lines: real walking path + dashed fallback for failed segments */}
          {routeSegments
            ? routeSegments.map((seg, i) =>
                seg.length > 1 ? (
                  <Polyline
                    key={`seg-${dayNumber}-${i}`}
                    positions={seg}
                    pathOptions={{
                      color: '#10b981',
                      weight: 5,
                      opacity: 0.85,
                      lineCap: 'round',
                      lineJoin: 'round',
                    }}
                  />
                ) : positions[i] && positions[i + 1] ? (
                  <Polyline
                    key={`fallback-${dayNumber}-${i}`}
                    positions={[positions[i], positions[i + 1]]}
                    pathOptions={{
                      color: '#10b981',
                      weight: 3,
                      opacity: 0.5,
                      dashArray: '8,8',
                      lineCap: 'round',
                    }}
                  />
                ) : null
              )
            : (
                <Polyline
                  positions={positions}
                  pathOptions={{
                    color: '#10b981',
                    weight: 3,
                    opacity: isHikingRoute ? 0.85 : 0.5,
                    dashArray: isHikingRoute ? undefined : '8,8',
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              )
          }

          {/* Markers: always show individual numbered markers */}
          {points.map((pt, idx) => (
            <Marker
              key={`${dayNumber}-${idx}`}
              position={[pt.lat, pt.lng]}
              icon={createNumberedIcon(idx, idx === 0, idx === points.length - 1)}
            >
              <Popup>
                <div className="text-xs min-w-[120px]">
                  <p className="font-bold text-sm">{pt.name}</p>
                  <p className="text-gray-500 mt-0.5">{pt.time}</p>
                  <p className="text-gray-400 mt-0.5">{pt.location}</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        </div>
      </div>

      {/* ── Backdrop blur overlay (portal to body) ─────────────────── */}
      {createPortal(
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="map-backdrop"
              className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setExpanded(false)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
