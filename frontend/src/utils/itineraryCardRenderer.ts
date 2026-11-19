import type { Airport, Flight } from '../types';
import {
  computeConnectionSummary,
  estimateArrivalTiming,
  formatDisplayDate,
  formatDurationMinutes,
  formatFlightRef,
  getShortTzLabel,
  sortFlightsChronologically,
  toAirportUtcMs,
} from './flightFormat';

export type ItineraryCardThemeId = 'midnight' | 'firstclass' | 'aurora';

export interface ItineraryCardOptions {
  flights: Flight[];
  airportsMap: Map<string, Airport>;
  title: string;
  customNote: string;
  theme: ItineraryCardThemeId;
  showCabinAndSeat: boolean;
  showFlightNotes: boolean;
  showBookingCredentials: boolean;
  showFooter: boolean;
}

interface ThemePalette {
  id: ItineraryCardThemeId;
  label: string;
  bgTop: string;
  bgBottom: string;
  glowA: string;
  glowB: string;
  cardBorder: string;
  panelBg: string;
  panelBorder: string;
  accentStart: string;
  accentEnd: string;
  accentSoft: string;
  accentText: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  pillBg: string;
  pillBorder: string;
  pnrBg: string;
  pnrBorder: string;
  pnrText: string;
}

export const CARD_THEMES: Record<ItineraryCardThemeId, ThemePalette> = {
  midnight: {
    id: 'midnight',
    label: 'Midnight Indigo',
    bgTop: '#080d1a',
    bgBottom: '#131736',
    glowA: 'rgba(99, 102, 241, 0.28)',
    glowB: 'rgba(236, 72, 153, 0.18)',
    cardBorder: 'rgba(148, 163, 184, 0.22)',
    panelBg: 'rgba(15, 23, 42, 0.72)',
    panelBorder: 'rgba(148, 163, 184, 0.16)',
    accentStart: '#6366f1',
    accentEnd: '#ec4899',
    accentSoft: 'rgba(99, 102, 241, 0.16)',
    accentText: '#a5b4fc',
    textPrimary: '#f8fafc',
    textSecondary: '#cbd5e1',
    textMuted: '#64748b',
    pillBg: 'rgba(255, 255, 255, 0.06)',
    pillBorder: 'rgba(255, 255, 255, 0.12)',
    pnrBg: 'rgba(245, 158, 11, 0.14)',
    pnrBorder: 'rgba(245, 158, 11, 0.35)',
    pnrText: '#fcd34d',
  },
  firstclass: {
    id: 'firstclass',
    label: 'First Class Gold',
    bgTop: '#0b0908',
    bgBottom: '#1d1712',
    glowA: 'rgba(245, 158, 11, 0.22)',
    glowB: 'rgba(217, 119, 6, 0.16)',
    cardBorder: 'rgba(251, 191, 36, 0.25)',
    panelBg: 'rgba(24, 20, 17, 0.78)',
    panelBorder: 'rgba(251, 191, 36, 0.18)',
    accentStart: '#f59e0b',
    accentEnd: '#fde68a',
    accentSoft: 'rgba(245, 158, 11, 0.15)',
    accentText: '#fde68a',
    textPrimary: '#fefce8',
    textSecondary: '#d6d3d1',
    textMuted: '#78716c',
    pillBg: 'rgba(255, 250, 235, 0.05)',
    pillBorder: 'rgba(251, 191, 36, 0.2)',
    pnrBg: 'rgba(251, 191, 36, 0.14)',
    pnrBorder: 'rgba(251, 191, 36, 0.38)',
    pnrText: '#fde68a',
  },
  aurora: {
    id: 'aurora',
    label: 'Aurora Cyan',
    bgTop: '#04121c',
    bgBottom: '#0a2433',
    glowA: 'rgba(6, 182, 212, 0.24)',
    glowB: 'rgba(16, 185, 129, 0.18)',
    cardBorder: 'rgba(56, 189, 248, 0.22)',
    panelBg: 'rgba(7, 25, 38, 0.74)',
    panelBorder: 'rgba(56, 189, 248, 0.16)',
    accentStart: '#06b6d4',
    accentEnd: '#10b981',
    accentSoft: 'rgba(6, 182, 212, 0.16)',
    accentText: '#67e8f9',
    textPrimary: '#f0f9ff',
    textSecondary: '#bae6fd',
    textMuted: '#64748b',
    pillBg: 'rgba(255, 255, 255, 0.05)',
    pillBorder: 'rgba(103, 232, 249, 0.18)',
    pnrBg: 'rgba(245, 158, 11, 0.14)',
    pnrBorder: 'rgba(245, 158, 11, 0.35)',
    pnrText: '#fcd34d',
  },
};

const LOGICAL_WIDTH = 560;
const SCALE = 3;
const PAD_X = 28;
const CONTENT_W = LOGICAL_WIDTH - PAD_X * 2;
const MAP_H = 204;
const FONT_SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const tileCache = new Map<string, HTMLImageElement>();
const inFlightTiles = new Map<string, Promise<HTMLImageElement | null>>();

function getAirportByIata(
  airportsMap: Map<string, Airport>,
  iata: string
): Airport | undefined {
  const key = (iata || '').trim().toUpperCase();
  return airportsMap.get(key) || airportsMap.get(iata);
}

function loadDarkMapTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  const n = 1 << z;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const wrappedX = ((x % n) + n) % n;
  const cacheKey = `${z}/${wrappedX}/${y}`;

  const cached = tileCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = inFlightTiles.get(cacheKey);
  if (pending) return pending;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let settled = false;
    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      inFlightTiles.delete(cacheKey);
      resolve(result);
    };

    const timer = window.setTimeout(() => finish(null), 3500);
    img.onload = () => {
      tileCache.set(cacheKey, img);
      finish(img);
    };
    img.onerror = () => finish(null);
    img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${wrappedX}`;
  });

  inFlightTiles.set(cacheKey, promise);
  return promise;
}

interface MapViewport {
  z: number;
  useShiftedLon: boolean;
  centerWx: number;
  centerWy: number;
  viewScale: number;
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
  plottedAirports: Airport[];
  projectMercator: (lon: number, lat: number) => { wx: number; wy: number };
}

function projectMercatorPoint(
  lon: number,
  lat: number,
  z: number,
  useShiftedLon: boolean
): { wx: number; wy: number } {
  const worldSize = 256 * (1 << z);
  const adjLon = useShiftedLon && lon < 0 ? lon + 360 : lon;
  const wx = ((adjLon + 180) / 360) * worldSize;
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const wy =
    (0.5 - Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad))) / (4 * Math.PI)) *
    worldSize;
  return { wx, wy };
}

function computeMapViewport(
  orderedFlights: Flight[],
  airportsMap: Map<string, Airport>,
  w: number,
  h: number
): MapViewport | null {
  const plottedMap = new Map<string, Airport>();
  for (const f of orderedFlights) {
    const dep = getAirportByIata(airportsMap, f.depAirportIata);
    const arr = getAirportByIata(airportsMap, f.arrAirportIata);
    if (dep) plottedMap.set(dep.iataCode, dep);
    if (arr) plottedMap.set(arr.iataCode, arr);
  }

  const plottedAirports = Array.from(plottedMap.values());
  if (plottedAirports.length === 0) return null;

  const rawLons = plottedAirports.map((a) => a.longitude);
  const directSpan = Math.max(...rawLons) - Math.min(...rawLons);
  const shiftedLons = rawLons.map((lon) => (lon < 0 ? lon + 360 : lon));
  const shiftedSpan = Math.max(...shiftedLons) - Math.min(...shiftedLons);
  const useShiftedLon = shiftedSpan < directSpan;

  const availW = Math.max(80, w - 116);
  const availH = Math.max(60, h - 76);

  const maxCandidateZ = plottedAirports.length === 1 ? 5 : 6;
  let chosenZ = 1;
  let minWx = 0;
  let maxWx = 0;
  let minWy = 0;
  let maxWy = 0;

  for (let z = maxCandidateZ; z >= 1; z--) {
    const pts = plottedAirports.map((a) =>
      projectMercatorPoint(a.longitude, a.latitude, z, useShiftedLon)
    );
    const xs = pts.map((p) => p.wx);
    const ys = pts.map((p) => p.wy);
    const curMinX = Math.min(...xs);
    const curMaxX = Math.max(...xs);
    const curMinY = Math.min(...ys);
    const curMaxY = Math.max(...ys);

    chosenZ = z;
    minWx = curMinX;
    maxWx = curMaxX;
    minWy = curMinY;
    maxWy = curMaxY;

    if (curMaxX - curMinX <= availW && curMaxY - curMinY <= availH) {
      break;
    }
  }

  const spanX = Math.max(1, maxWx - minWx);
  const spanY = Math.max(1, maxWy - minWy);
  const viewScale = Math.min(1, availW / spanX, availH / spanY);

  const centerWx = (minWx + maxWx) / 2;
  const centerWy = (minWy + maxWy) / 2;
  const halfWorldW = (w / 2) / viewScale;
  const halfWorldH = (h / 2) / viewScale;
  const n = 1 << chosenZ;

  const minTileX = Math.floor((centerWx - halfWorldW) / 256);
  const maxTileX = Math.floor((centerWx + halfWorldW) / 256);
  const minTileY = Math.max(0, Math.floor((centerWy - halfWorldH) / 256));
  const maxTileY = Math.min(n - 1, Math.floor((centerWy + halfWorldH) / 256));

  return {
    z: chosenZ,
    useShiftedLon,
    centerWx,
    centerWy,
    viewScale,
    minTileX,
    maxTileX,
    minTileY,
    maxTileY,
    plottedAirports,
    projectMercator: (lon: number, lat: number) =>
      projectMercatorPoint(lon, lat, chosenZ, useShiftedLon),
  };
}

export async function preloadRouteMapTiles(
  flights: Flight[],
  airportsMap: Map<string, Airport>
): Promise<boolean> {
  const orderedFlights = sortFlightsChronologically(flights, airportsMap, 'asc');
  const viewport = computeMapViewport(orderedFlights, airportsMap, CONTENT_W, MAP_H);
  if (!viewport) return false;

  const promises: Promise<HTMLImageElement | null>[] = [];
  for (let tx = viewport.minTileX; tx <= viewport.maxTileX; tx++) {
    for (let ty = viewport.minTileY; ty <= viewport.maxTileY; ty++) {
      promises.push(loadDarkMapTile(viewport.z, tx, ty));
    }
  }

  const results = await Promise.all(promises);
  return results.some(Boolean);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
        current = word;
      } else {
        // Hard break very long unbroken tokens
        let sliced = word;
        while (ctx.measureText(`${sliced}…`).width > maxWidth && sliced.length > 1) {
          sliced = sliced.slice(0, -1);
        }
        lines.push(`${sliced}…`);
        current = '';
      }
      if (lines.length >= maxLines) break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current && lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }

  return lines;
}

function drawMiniPlaneIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angleRad: number,
  size: number,
  color: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.fillStyle = color;
  ctx.beginPath();
  // Pointing right (+x axis)
  ctx.moveTo(size, 0);
  ctx.lineTo(size * 0.22, -size * 0.18);
  ctx.lineTo(-size * 0.15, -size * 0.85);
  ctx.lineTo(-size * 0.4, -size * 0.85);
  ctx.lineTo(-size * 0.18, -size * 0.18);
  ctx.lineTo(-size * 0.68, -size * 0.14);
  ctx.lineTo(-size * 0.86, -size * 0.44);
  ctx.lineTo(-size * 1.0, -size * 0.44);
  ctx.lineTo(-size * 0.85, 0);
  ctx.lineTo(-size * 1.0, size * 0.44);
  ctx.lineTo(-size * 0.86, size * 0.44);
  ctx.lineTo(-size * 0.68, size * 0.14);
  ctx.lineTo(-size * 0.18, size * 0.18);
  ctx.lineTo(-size * 0.4, size * 0.85);
  ctx.lineTo(-size * 0.15, size * 0.85);
  ctx.lineTo(size * 0.22, size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  opts: {
    bg: string;
    border: string;
    color: string;
    font?: string;
    padX?: number;
    height?: number;
  }
): number {
  const padX = opts.padX ?? 9;
  const height = opts.height ?? 22;
  ctx.save();
  ctx.font = opts.font ?? `600 10.5px ${FONT_SANS}`;
  const textWidth = ctx.measureText(text).width;
  const width = textWidth + padX * 2;
  drawRoundedRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = opts.bg;
  ctx.fill();
  ctx.strokeStyle = opts.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = opts.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, y + height / 2 + 0.5);
  ctx.restore();
  return width;
}

function deriveDefaultTitle(orderedFlights: Flight[], airportsMap: Map<string, Airport>): string {
  if (orderedFlights.length === 0) return 'Flight Itinerary';
  const first = orderedFlights[0];
  const last = orderedFlights[orderedFlights.length - 1];
  const depCity = getAirportByIata(airportsMap, first.depAirportIata)?.city || first.depAirportIata;
  const arrCity = getAirportByIata(airportsMap, last.arrAirportIata)?.city || last.arrAirportIata;
  if (orderedFlights.length === 1) {
    return `${depCity} → ${arrCity}`;
  }
  if (first.depAirportIata === last.arrAirportIata && orderedFlights.length >= 2) {
    const mid = orderedFlights[Math.floor(orderedFlights.length / 2)];
    const midCity = getAirportByIata(airportsMap, mid.depAirportIata)?.city || mid.depAirportIata;
    return `${depCity} ⇄ ${midCity}`;
  }
  return `${depCity} → ${arrCity}`;
}

interface LegLayout {
  flight: Flight;
  noteLines: string[];
  hasMetaRow: boolean;
  height: number;
  connectionLabel: string | null;
}

function buildLegLayouts(
  ctx: CanvasRenderingContext2D,
  orderedFlights: Flight[],
  options: ItineraryCardOptions
): LegLayout[] {
  ctx.font = `400 11px ${FONT_SANS}`;
  return orderedFlights.map((flight, index) => {
    const hasCabinOrSeat =
      options.showCabinAndSeat && Boolean(flight.cabinClass || flight.seat || flight.aircraftType);
    const hasCreds =
      options.showBookingCredentials && Boolean(flight.bookingRef || flight.ticketNumber);
    const hasMetaRow = hasCabinOrSeat || hasCreds;
    const noteLines =
      options.showFlightNotes && flight.notes
        ? wrapTextLines(ctx, flight.notes, CONTENT_W - 44, 2)
        : [];

    let height = 114;
    if (hasMetaRow) height += 30;
    if (noteLines.length > 0) height += 14 + noteLines.length * 15;

    const nextFlight = index < orderedFlights.length - 1 ? orderedFlights[index + 1] : null;
    const connectionLabel = nextFlight
      ? computeConnectionSummary(flight, nextFlight, options.airportsMap)
      : null;

    return {
      flight,
      noteLines,
      hasMetaRow,
      height,
      connectionLabel,
    };
  });
}

function drawRouteMapPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  orderedFlights: Flight[],
  airportsMap: Map<string, Airport>,
  theme: ThemePalette
) {
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = '#090d14';
  ctx.fill();
  ctx.clip();

  const viewport = computeMapViewport(orderedFlights, airportsMap, w, h);
  if (!viewport) {
    // Fallback radar grid when no coordinates exist
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    for (let gx = x + 36; gx < x + w; gx += 42) {
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
    }
    for (let gy = y + 32; gy < y + h; gy += 32) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }
    ctx.fillStyle = theme.textMuted;
    ctx.font = `500 12px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Route preview unavailable (missing airport coordinates)', x + w / 2, y + h / 2);
    ctx.restore();
    drawRoundedRect(ctx, x, y, w, h, 16);
    ctx.strokeStyle = theme.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }

  // Draw Esri Dark Gray Base raster tiles when cached
  const n = 1 << viewport.z;
  let tilesDrawn = 0;
  ctx.save();
  if ('filter' in ctx) {
    ctx.filter = 'brightness(1.08) contrast(1.22)';
  }
  const tileDrawSize = 256 * viewport.viewScale + 0.6;
  for (let tx = viewport.minTileX; tx <= viewport.maxTileX; tx++) {
    const wrappedX = ((tx % n) + n) % n;
    for (let ty = viewport.minTileY; ty <= viewport.maxTileY; ty++) {
      const tileImg = tileCache.get(`${viewport.z}/${wrappedX}/${ty}`);
      if (!tileImg) continue;
      const drawX = x + w / 2 + (tx * 256 - viewport.centerWx) * viewport.viewScale;
      const drawY = y + h / 2 + (ty * 256 - viewport.centerWy) * viewport.viewScale;
      ctx.drawImage(tileImg, drawX, drawY, tileDrawSize, tileDrawSize);
      tilesDrawn++;
    }
  }
  ctx.restore();

  if (tilesDrawn === 0) {
    // Offline fallback grid before/without tiles
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.lineWidth = 1;
    for (let gx = x + 36; gx < x + w; gx += 42) {
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
    }
    for (let gy = y + 32; gy < y + h; gy += 32) {
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.stroke();
    }
  } else {
    // Subtle dark edge shading so route arcs & labels read sharply over tiles
    const vig = ctx.createRadialGradient(
      x + w / 2,
      y + h / 2,
      w * 0.2,
      x + w / 2,
      y + h / 2,
      w * 0.72
    );
    vig.addColorStop(0, 'rgba(2, 6, 23, 0.06)');
    vig.addColorStop(1, 'rgba(2, 6, 23, 0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(x, y, w, h);
  }

  const toCanvasPoint = (airport: Airport) => {
    const { wx, wy } = viewport.projectMercator(airport.longitude, airport.latitude);
    return {
      x: x + w / 2 + (wx - viewport.centerWx) * viewport.viewScale,
      y: y + h / 2 + (wy - viewport.centerWy) * viewport.viewScale,
    };
  };

  // Draw flight arcs
  for (let i = 0; i < orderedFlights.length; i++) {
    const f = orderedFlights[i];
    const dep = getAirportByIata(airportsMap, f.depAirportIata);
    const arr = getAirportByIata(airportsMap, f.arrAirportIata);
    if (!dep || !arr) continue;

    const p1 = toCanvasPoint(dep);
    const p2 = toCanvasPoint(arr);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy) || 1;
    const curveLift = Math.min(46, Math.max(18, dist * 0.24));
    const cx = (p1.x + p2.x) / 2 - (dy / dist) * (curveLift * 0.15);
    const cy = Math.min(p1.y, p2.y) - curveLift * 0.65 + Math.abs(dy) * 0.1;

    // Glow under-arc
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.quadraticCurveTo(cx, cy, p2.x, p2.y);
    ctx.strokeStyle = theme.accentSoft;
    ctx.lineWidth = 6.5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Main gradient arc
    const arcGrad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
    arcGrad.addColorStop(0, theme.accentStart);
    arcGrad.addColorStop(1, theme.accentEnd);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.quadraticCurveTo(cx, cy, p2.x, p2.y);
    ctx.strokeStyle = arcGrad;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    const midX = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
    const midY = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    drawMiniPlaneIcon(ctx, midX, midY, angle, 6.5, theme.textPrimary);
    ctx.restore();
  }

  // Draw airport pins & labels
  const mapCenterY = y + h / 2;
  for (const airport of viewport.plottedAirports) {
    const pt = toCanvasPoint(airport);

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = theme.accentSoft;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = theme.textPrimary;
    ctx.fill();
    ctx.strokeStyle = theme.accentStart;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const placeAbove = pt.y > mapCenterY + 12;
    const labelY = placeAbove ? pt.y - 14 : pt.y + 16;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 11px ${FONT_MONO}`;
    const codeW = ctx.measureText(airport.iataCode).width;
    const badgeW = codeW + 10;
    const badgeX = Math.max(x + 8, Math.min(x + w - badgeW - 8, pt.x - badgeW / 2));

    drawRoundedRect(ctx, badgeX, labelY - 9, badgeW, 18, 5);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
    ctx.fill();
    ctx.strokeStyle = theme.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = theme.textPrimary;
    ctx.fillText(airport.iataCode, badgeX + badgeW / 2, labelY + 0.5);
  }

  ctx.restore();

  // Crisp outer map viewport border
  drawRoundedRect(ctx, x, y, w, h, 16);
  ctx.strokeStyle = theme.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function renderItineraryCard(
  canvas: HTMLCanvasElement,
  options: ItineraryCardOptions
): { width: number; height: number } {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { width: LOGICAL_WIDTH, height: 400 };

  const theme = CARD_THEMES[options.theme];
  const orderedFlights = sortFlightsChronologically(options.flights, options.airportsMap, 'asc');
  const legLayouts = buildLegLayouts(ctx, orderedFlights, options);

  // Measure custom note lines if provided
  ctx.font = `500 12px ${FONT_SANS}`;
  const customNoteLines = options.customNote.trim()
    ? wrapTextLines(ctx, options.customNote, CONTENT_W - 44, 3)
    : [];

  const headerH = 112;
  const mapH = MAP_H;
  const mapGap = 18;
  const legGap = 28; // space for perforation + layover pill
  const legsTotalH =
    legLayouts.reduce((sum, l) => sum + l.height, 0) +
    Math.max(0, legLayouts.length - 1) * legGap;
  const noteBannerH = customNoteLines.length > 0 ? 28 + customNoteLines.length * 17 : 0;
  const noteGap = noteBannerH > 0 ? 16 : 0;
  const footerH = options.showFooter ? 46 : 22;

  const logicalHeight =
    26 +
    headerH +
    mapH +
    mapGap +
    (orderedFlights.length > 0 ? legsTotalH : 90) +
    noteGap +
    noteBannerH +
    footerH;

  canvas.width = LOGICAL_WIDTH * SCALE;
  canvas.height = logicalHeight * SCALE;

  ctx.save();
  ctx.scale(SCALE, SCALE);

  // 1. Background card gradient
  const bgGrad = ctx.createLinearGradient(0, 0, LOGICAL_WIDTH, logicalHeight);
  bgGrad.addColorStop(0, theme.bgTop);
  bgGrad.addColorStop(1, theme.bgBottom);
  drawRoundedRect(ctx, 0, 0, LOGICAL_WIDTH, logicalHeight, 24);
  ctx.fillStyle = bgGrad;
  ctx.fill();
  ctx.clip();

  // Ambient corner glows
  const glow1 = ctx.createRadialGradient(70, 50, 10, 70, 50, 260);
  glow1.addColorStop(0, theme.glowA);
  glow1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, 320);

  const glow2 = ctx.createRadialGradient(
    LOGICAL_WIDTH - 60,
    logicalHeight - 60,
    10,
    LOGICAL_WIDTH - 60,
    logicalHeight - 60,
    260
  );
  glow2.addColorStop(0, theme.glowB);
  glow2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, logicalHeight - 320, LOGICAL_WIDTH, 320);

  // Subtle background dot matrix
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let dx = 18; dx < LOGICAL_WIDTH; dx += 20) {
    for (let dy = 18; dy < logicalHeight; dy += 20) {
      ctx.fillRect(dx, dy, 1.2, 1.2);
    }
  }

  // Outer hairline border
  drawRoundedRect(ctx, 0.5, 0.5, LOGICAL_WIDTH - 1, logicalHeight - 1, 24);
  ctx.strokeStyle = theme.cardBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 2. Header
  let cursorY = 26;

  // Eyebrow + date range
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  drawMiniPlaneIcon(ctx, PAD_X + 7, cursorY + 8, -0.35, 6.5, theme.accentText);
  ctx.fillStyle = theme.accentText;
  ctx.font = `700 10px ${FONT_MONO}`;
  ctx.fillText('AEROLOG • FLIGHT ITINERARY', PAD_X + 20, cursorY + 8.5);

  if (orderedFlights.length > 0) {
    const firstDate = formatDisplayDate(orderedFlights[0].flightDate);
    const lastDate = formatDisplayDate(orderedFlights[orderedFlights.length - 1].flightDate);
    const dateSpan =
      firstDate === lastDate ? firstDate : `${firstDate} — ${lastDate}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.textSecondary;
    ctx.font = `500 10.5px ${FONT_SANS}`;
    ctx.fillText(dateSpan, LOGICAL_WIDTH - PAD_X, cursorY + 8.5);
  }

  // Title
  const resolvedTitle =
    options.title.trim() || deriveDefaultTitle(orderedFlights, options.airportsMap);
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.textPrimary;
  ctx.font = `800 23px ${FONT_SANS}`;
  const titleLines = wrapTextLines(ctx, resolvedTitle, CONTENT_W, 1);
  ctx.fillText(titleLines[0] || 'Flight Itinerary', PAD_X, cursorY + 38);

  // Summary pills
  const totalDist = orderedFlights.reduce((sum, f) => sum + (f.distanceKm || 0), 0);
  const airportSet = new Set<string>();
  orderedFlights.forEach((f) => {
    airportSet.add(f.depAirportIata);
    airportSet.add(f.arrAirportIata);
  });

  let pillX = PAD_X;
  const pillY = cursorY + 62;
  pillX +=
    drawPill(
      ctx,
      pillX,
      pillY,
      `${orderedFlights.length} ${orderedFlights.length === 1 ? 'FLIGHT' : 'FLIGHTS'}`,
      {
        bg: theme.accentSoft,
        border: theme.cardBorder,
        color: theme.accentText,
        font: `700 10px ${FONT_MONO}`,
      }
    ) + 8;

  if (totalDist > 0) {
    pillX +=
      drawPill(ctx, pillX, pillY, `${totalDist.toLocaleString()} KM`, {
        bg: theme.pillBg,
        border: theme.pillBorder,
        color: theme.textSecondary,
        font: `700 10px ${FONT_MONO}`,
      }) + 8;
  }

  if (airportSet.size > 0) {
    drawPill(ctx, pillX, pillY, `${airportSet.size} AIRPORTS`, {
      bg: theme.pillBg,
      border: theme.pillBorder,
      color: theme.textSecondary,
      font: `700 10px ${FONT_MONO}`,
    });
  }

  cursorY += headerH;

  // 3. Embedded Vector Route Map
  drawRouteMapPanel(
    ctx,
    PAD_X,
    cursorY,
    CONTENT_W,
    mapH,
    orderedFlights,
    options.airportsMap,
    theme
  );
  cursorY += mapH + mapGap;

  // 4. Flight Leg Boarding-Pass Blocks
  if (orderedFlights.length === 0) {
    drawRoundedRect(ctx, PAD_X, cursorY, CONTENT_W, 80, 16);
    ctx.fillStyle = theme.panelBg;
    ctx.fill();
    ctx.strokeStyle = theme.panelBorder;
    ctx.stroke();
    ctx.fillStyle = theme.textMuted;
    ctx.font = `500 13px ${FONT_SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Select at least one flight to generate your boarding pass', LOGICAL_WIDTH / 2, cursorY + 40);
    cursorY += 90;
  } else {
    for (let i = 0; i < legLayouts.length; i++) {
      const leg = legLayouts[i];
      const f = leg.flight;
      const depAirport = getAirportByIata(options.airportsMap, f.depAirportIata);
      const arrAirport = getAirportByIata(options.airportsMap, f.arrAirportIata);
      const flightRef = formatFlightRef(f.airlineIata, f.flightNumber);
      const timing = estimateArrivalTiming(f, depAirport, arrAirport);

      // Leg card container
      drawRoundedRect(ctx, PAD_X, cursorY, CONTENT_W, leg.height, 16);
      ctx.fillStyle = theme.panelBg;
      ctx.fill();
      ctx.strokeStyle = theme.panelBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Top strip: Flight number pill + date + aircraft/cabin
      const topY = cursorY + 14;
      const badgeGrad = ctx.createLinearGradient(PAD_X + 16, topY, PAD_X + 90, topY + 22);
      badgeGrad.addColorStop(0, theme.accentStart);
      badgeGrad.addColorStop(1, theme.accentEnd);

      ctx.font = `800 11.5px ${FONT_MONO}`;
      const refW = ctx.measureText(flightRef).width + 18;
      drawRoundedRect(ctx, PAD_X + 16, topY, refW, 22, 6);
      ctx.fillStyle = badgeGrad;
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(flightRef, PAD_X + 16 + refW / 2, topY + 11.5);

      ctx.textAlign = 'left';
      ctx.fillStyle = theme.textSecondary;
      ctx.font = `600 11.5px ${FONT_SANS}`;
      ctx.fillText(formatDisplayDate(f.flightDate), PAD_X + 16 + refW + 10, topY + 11.5);

      // Right top pills (Aircraft + Cabin when enabled)
      if (options.showCabinAndSeat) {
        let rightCursorX = PAD_X + CONTENT_W - 16;
        if (f.cabinClass) {
          ctx.font = `600 10px ${FONT_SANS}`;
          const w = ctx.measureText(f.cabinClass).width + 16;
          drawPill(ctx, rightCursorX - w, topY, f.cabinClass, {
            bg: theme.accentSoft,
            border: theme.cardBorder,
            color: theme.accentText,
            font: `600 10px ${FONT_SANS}`,
            padX: 8,
            height: 22,
          });
          rightCursorX -= w + 6;
        }
        if (f.aircraftType) {
          ctx.font = `600 10px ${FONT_MONO}`;
          const w = ctx.measureText(f.aircraftType).width + 16;
          drawPill(ctx, rightCursorX - w, topY, f.aircraftType, {
            bg: theme.pillBg,
            border: theme.pillBorder,
            color: theme.textSecondary,
            font: `600 10px ${FONT_MONO}`,
            padX: 8,
            height: 22,
          });
        }
      }

      // Main IATA Route Row
      const routeY = cursorY + 58;
      const leftX = PAD_X + 18;
      const rightX = PAD_X + CONTENT_W - 18;

      // Departure IATA + City + Time
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.textPrimary;
      ctx.font = `800 28px ${FONT_MONO}`;
      ctx.fillText(f.depAirportIata, leftX, routeY);

      ctx.fillStyle = theme.textSecondary;
      ctx.font = `500 11px ${FONT_SANS}`;
      ctx.fillText(depAirport?.city || 'Departure', leftX, routeY + 21);

      const depRefMs = toAirportUtcMs(
        f.flightDate,
        f.depTime || '12:00',
        f.depTimezone || depAirport?.timezone || 'UTC'
      );
      const depTzShort = getShortTzLabel(f.depTimezone || depAirport?.timezone, depRefMs);
      ctx.fillStyle = f.depTime ? theme.textPrimary : theme.textMuted;
      ctx.font = `700 12.5px ${FONT_MONO}`;
      ctx.fillText(
        f.depTime ? `${f.depTime} ${depTzShort}` : 'Time TBD',
        leftX,
        routeY + 38
      );

      // Arrival IATA + City + Time
      ctx.textAlign = 'right';
      ctx.fillStyle = theme.textPrimary;
      ctx.font = `800 28px ${FONT_MONO}`;
      ctx.fillText(f.arrAirportIata, rightX, routeY);

      ctx.fillStyle = theme.textSecondary;
      ctx.font = `500 11px ${FONT_SANS}`;
      ctx.fillText(arrAirport?.city || 'Arrival', rightX, routeY + 21);

      const arrTzShort = getShortTzLabel(f.arrTimezone || arrAirport?.timezone, depRefMs);
      const dayBadge = timing.dayOffset > 0 ? ` (+${timing.dayOffset}d)` : timing.dayOffset < 0 ? ` (${timing.dayOffset}d)` : '';
      ctx.fillStyle = f.arrTime ? theme.textPrimary : theme.textMuted;
      ctx.font = `700 12.5px ${FONT_MONO}`;
      ctx.fillText(
        f.arrTime ? `${f.arrTime} ${arrTzShort}${dayBadge}` : 'Time TBD',
        rightX,
        routeY + 38
      );

      // Center connector line + plane + duration/distance
      const trackStartX = leftX + 86;
      const trackEndX = rightX - 86;
      const trackY = routeY - 2;
      const trackMidX = (trackStartX + trackEndX) / 2;

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(trackStartX, trackY);
      ctx.lineTo(trackEndX, trackY);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.restore();

      // Track endpoints
      ctx.beginPath();
      ctx.arc(trackStartX, trackY, 3, 0, Math.PI * 2);
      ctx.arc(trackEndX, trackY, 3, 0, Math.PI * 2);
      ctx.fillStyle = theme.accentStart;
      ctx.fill();

      // Center plane pill
      ctx.beginPath();
      ctx.arc(trackMidX, trackY, 12, 0, Math.PI * 2);
      ctx.fillStyle = theme.bgBottom;
      ctx.fill();
      ctx.strokeStyle = theme.panelBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      drawMiniPlaneIcon(ctx, trackMidX, trackY, 0, 6.5, theme.accentText);

      // Duration / Distance caption under track
      const metaParts: string[] = [];
      if (timing.durationMinutes !== null) {
        metaParts.push(formatDurationMinutes(timing.durationMinutes));
      }
      if (f.distanceKm) {
        metaParts.push(`${f.distanceKm.toLocaleString()} km`);
      }
      if (metaParts.length > 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = theme.textMuted;
        ctx.font = `600 10.5px ${FONT_MONO}`;
        ctx.fillText(metaParts.join(' • '), trackMidX, trackY + 21);
      }

      // Optional Metadata Row (Seat / PNR / Ticket #)
      let legInnerY = cursorY + 114;
      if (leg.hasMetaRow) {
        let metaX = leftX;
        if (options.showCabinAndSeat && f.seat) {
          metaX +=
            drawPill(ctx, metaX, legInnerY, `SEAT ${f.seat}`, {
              bg: theme.pillBg,
              border: theme.pillBorder,
              color: theme.textPrimary,
              font: `700 10px ${FONT_MONO}`,
              padX: 8,
              height: 20,
            }) + 6;
        }
        if (options.showBookingCredentials && f.bookingRef) {
          metaX +=
            drawPill(ctx, metaX, legInnerY, `PNR ${f.bookingRef}`, {
              bg: theme.pnrBg,
              border: theme.pnrBorder,
              color: theme.pnrText,
              font: `700 10px ${FONT_MONO}`,
              padX: 8,
              height: 20,
            }) + 6;
        }
        if (options.showBookingCredentials && f.ticketNumber) {
          drawPill(ctx, metaX, legInnerY, `TKT ${f.ticketNumber}`, {
            bg: theme.pnrBg,
            border: theme.pnrBorder,
            color: theme.pnrText,
            font: `600 10px ${FONT_MONO}`,
            padX: 8,
            height: 20,
          });
        }
        legInnerY += 30;
      }

      // Optional Saved Flight Notes
      if (leg.noteLines.length > 0) {
        ctx.textAlign = 'left';
        ctx.fillStyle = theme.textSecondary;
        ctx.font = `400 11px ${FONT_SANS}`;
        leg.noteLines.forEach((line, idx) => {
          ctx.fillText(line, leftX, legInnerY + idx * 15 + 4);
        });
      }

      cursorY += leg.height;

      // Perforation & Connection Banner between legs
      if (i < legLayouts.length - 1) {
        const dividerY = cursorY + legGap / 2;

        // Dashed tear line across card
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(PAD_X + 12, dividerY);
        ctx.lineTo(PAD_X + CONTENT_W - 12, dividerY);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // Semicircular ticket notches on card edges
        ctx.fillStyle = theme.bgTop;
        ctx.beginPath();
        ctx.arc(0, dividerY, 10, -Math.PI / 2, Math.PI / 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(LOGICAL_WIDTH, dividerY, 10, Math.PI / 2, (Math.PI * 3) / 2);
        ctx.fill();

        if (leg.connectionLabel) {
          ctx.font = `600 10px ${FONT_MONO}`;
          const labelW = ctx.measureText(leg.connectionLabel).width + 20;
          const badgeX = (LOGICAL_WIDTH - labelW) / 2;
          drawPill(ctx, badgeX, dividerY - 10, leg.connectionLabel, {
            bg: theme.bgTop,
            border: theme.panelBorder,
            color: theme.accentText,
            font: `600 10px ${FONT_MONO}`,
            padX: 10,
            height: 20,
          });
        }

        cursorY += legGap;
      }
    }
  }

  // 5. Custom Greeting / Pickup Note Banner
  if (customNoteLines.length > 0) {
    cursorY += noteGap;
    drawRoundedRect(ctx, PAD_X, cursorY, CONTENT_W, noteBannerH, 12);
    ctx.fillStyle = theme.accentSoft;
    ctx.fill();
    ctx.strokeStyle = theme.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.textPrimary;
    ctx.font = `500 12px ${FONT_SANS}`;
    customNoteLines.forEach((line, idx) => {
      ctx.fillText(line, PAD_X + 18, cursorY + 18 + idx * 17);
    });
    cursorY += noteBannerH;
  }

  // 6. Subtle Boarding-Pass Barcode Footer
  if (options.showFooter) {
    const footY = logicalHeight - 28;
    const barWidths = [2, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 2, 3, 1, 2, 1];
    let bx = PAD_X;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    for (let idx = 0; idx < barWidths.length; idx++) {
      const bw = barWidths[idx];
      if (idx % 2 === 0) {
        ctx.fillRect(bx, footY - 6, bw, 12);
      }
      bx += bw + 2;
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.textMuted;
    ctx.font = `600 9.5px ${FONT_MONO}`;
    ctx.fillText('AEROLOG • PERSONAL FLIGHT PASS', LOGICAL_WIDTH - PAD_X, footY);
  }

  ctx.restore();
  return { width: LOGICAL_WIDTH, height: logicalHeight };
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate PNG image from canvas'));
    }, 'image/png');
  });
}
