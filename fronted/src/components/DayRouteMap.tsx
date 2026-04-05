import { useMemo, useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ItineraryActivity } from '../types';
import { fetchWalkingRoute } from '../api';

/* ── Numbered marker icon factory ──────────────────────────────────────────── */
function createNumberedIcon(index: number, isFirst: boolean, isLast: boolean) {
  const bg = isFirst ? '#10b981' : isLast ? '#ef4444' : '#6366f1';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${bg};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;
      border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.25);
    ">${index + 1}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  });
}

/* ── Cluster icon: shows how many stops are grouped ────────────────────────── */
function createClusterIcon(cluster: { getChildCount(): number }) {
  const count = cluster.getChildCount();
  return L.divIcon({
    className: '',
    html: `<div style="
      width:32px;height:32px;border-radius:50%;
      background:#6366f1;color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;
      border:3px solid #fff;
      box-shadow:0 2px 8px rgba(99,102,241,0.4);
    ">${count}站</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
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

/* ── Gaode (AMap) tile config ──────────────────────────────────────────────── */
const AMAP_TILE_URL =
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
const AMAP_SUBDOMAINS = ['1', '2', '3', '4'];

/* ── Main component ────────────────────────────────────────────────────────── */
interface DayRouteMapProps {
  activities: ItineraryActivity[];
  dayNumber: number;
  city?: string;
}

export function DayRouteMap({ activities, dayNumber, city = '' }: DayRouteMapProps) {
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

  return (
    <div className="rounded-xl overflow-hidden aspect-[16/10] shadow-[0_8px_32px_rgba(87,94,112,0.04)] ring-1 ring-outline-variant/10 relative">
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

      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={true}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url={AMAP_TILE_URL}
          subdomains={AMAP_SUBDOMAINS}
          attribution='&copy; <a href="https://amap.com">高德地图</a>'
        />
        <FitBounds positions={positions} />

        {/* Route lines: real walking path or fallback straight lines */}
        {routeSegments
          ? routeSegments.map((seg, i) => (
              <Polyline
                key={`seg-${dayNumber}-${i}`}
                positions={seg}
                pathOptions={{
                  color: '#6366f1',
                  weight: 4,
                  opacity: 0.85,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            ))
          : isHikingRoute ? (
              <Polyline
                positions={positions}
                pathOptions={{
                  color: '#6366f1',
                  weight: 3,
                  opacity: 0.85,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            ) : null
        }

        {/* Markers: hiking → no cluster (keep aligned with polyline); city → cluster */}
        {isHikingRoute ? (
          points.map((pt, idx) => (
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
          ))
        ) : (
          <MarkerClusterGroup
            iconCreateFunction={createClusterIcon}
            maxClusterRadius={25}
            disableClusteringAtZoom={14}
            spiderfyOnMaxZoom={true}
            showCoverageOnHover={false}
            zoomToBoundsOnClick={true}
          >
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
          </MarkerClusterGroup>
        )}
      </MapContainer>
    </div>
  );
}
