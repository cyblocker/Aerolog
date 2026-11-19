import React, { useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map as MapGL } from 'react-map-gl/maplibre';
import type { Flight, Airport } from '../types';
import { formatFlightRef, getUtcTodayStr } from '../utils/flightFormat';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Props {
  flights: Flight[];
  airports: Airport[];
  isOwnerMode?: boolean;
}

interface ArcDatum {
  source: [number, number];
  target: [number, number];
  flightRef: string;
  route: string;
  date: string;
  depTime?: string | null;
  isUpcoming: boolean;
  isPrivate: boolean;
}

interface HoverObject {
  flightRef?: string;
  date?: string;
  route?: string;
  depTime?: string | null;
  isUpcoming?: boolean;
  isPrivate?: boolean;
  name?: string;
  iataCode?: string;
  city?: string;
}

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const FlightMap: React.FC<Props> = ({ flights, airports, isOwnerMode = false }) => {
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; object?: HoverObject } | null>(null);
  const [mapFilter, setMapFilter] = useState<'all' | 'past' | 'upcoming'>('all');

  const todayUtc = getUtcTodayStr();
  const airportMap = useMemo(() => new Map(airports.map((a) => [a.iataCode, a])), [airports]);

  const filteredFlights = useMemo(() => {
    if (!isOwnerMode || mapFilter === 'all') return flights;
    if (mapFilter === 'upcoming') return flights.filter((f) => f.flightDate >= todayUtc);
    return flights.filter((f) => f.flightDate < todayUtc);
  }, [flights, isOwnerMode, mapFilter, todayUtc]);

  const visibleAirports = useMemo(() => {
    const iatas = new Set<string>();
    filteredFlights.forEach((f) => {
      iatas.add(f.depAirportIata);
      iatas.add(f.arrAirportIata);
    });
    return airports.filter((a) => iatas.has(a.iataCode));
  }, [filteredFlights, airports]);

  const arcData = useMemo<ArcDatum[]>(() => {
    const arcs: ArcDatum[] = [];
    for (const flight of filteredFlights) {
      const dep = airportMap.get(flight.depAirportIata);
      const arr = airportMap.get(flight.arrAirportIata);
      if (!dep || !arr) continue;
      arcs.push({
        source: [dep.longitude, dep.latitude],
        target: [arr.longitude, arr.latitude],
        flightRef: formatFlightRef(flight.airlineIata, flight.flightNumber),
        route: `${dep.iataCode} → ${arr.iataCode}`,
        date: flight.flightDate,
        depTime: isOwnerMode ? flight.depTime : null,
        isUpcoming: isOwnerMode && flight.flightDate >= todayUtc,
        isPrivate: isOwnerMode && Boolean(flight.isPrivate),
      });
    }
    return arcs;
  }, [filteredFlights, airportMap, isOwnerMode, todayUtc]);

  const layers = [
    new ArcLayer<ArcDatum>({
      id: 'arcs',
      data: arcData,
      getSourcePosition: (d) => d.source,
      getTargetPosition: (d) => d.target,
      getSourceColor: (d) => (d.isUpcoming ? [6, 182, 212, 200] : [99, 102, 241, 110]),
      getTargetColor: (d) => (d.isUpcoming ? [245, 158, 11, 220] : [236, 72, 153, 110]),
      getWidth: (d) => (d.isUpcoming ? 2.4 : 1.5),
      pickable: true,
      onHover: (info) =>
        setHoverInfo(
          info.object ? { x: info.x, y: info.y, object: info.object as HoverObject } : null
        ),
    }),
    new ScatterplotLayer<Airport>({
      id: 'airports',
      data: visibleAirports,
      getPosition: (d) => [d.longitude, d.latitude],
      getFillColor: [255, 255, 255, 200],
      getRadius: 18000,
      pickable: true,
      onHover: (info) =>
        setHoverInfo(
          info.object ? { x: info.x, y: info.y, object: info.object as HoverObject } : null
        ),
    }),
  ];

  return (
    <div
      className="map-container"
      style={{
        height: '600px',
        width: '100%',
        position: 'relative',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
      }}
    >
      {isOwnerMode && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 15,
            display: 'flex',
            gap: '4px',
            background: 'rgba(15, 23, 42, 0.86)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '10px',
            padding: '4px',
          }}
        >
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'past', label: 'Completed' },
              { id: 'upcoming', label: 'Upcoming' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMapFilter(item.id)}
              style={{
                border: 'none',
                borderRadius: '7px',
                padding: '0.35rem 0.7rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                background:
                  mapFilter === item.id ? 'rgba(99, 102, 241, 0.35)' : 'transparent',
                color: mapFilter === item.id ? '#f8fafc' : '#94a3b8',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <DeckGL
        initialViewState={{
          longitude: 30,
          latitude: 35,
          zoom: 1.5,
          pitch: 30,
          bearing: 0,
        }}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
      >
        <MapGL mapStyle={MAP_STYLE} />
      </DeckGL>

      {hoverInfo && hoverInfo.object && (
        <div
          style={{
            position: 'absolute',
            zIndex: 10,
            pointerEvents: 'none',
            left: hoverInfo.x + 10,
            top: hoverInfo.y + 10,
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            color: 'white',
            padding: '12px',
            borderRadius: '8px',
            fontSize: '13px',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
          }}
        >
          {hoverInfo.object.flightRef ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontWeight: 600, color: hoverInfo.object.isUpcoming ? '#67e8f9' : '#818cf8' }}>
                  {hoverInfo.object.flightRef}
                </span>
                {hoverInfo.object.isUpcoming && (
                  <span style={{ fontSize: '10px', color: '#fcd34d', fontWeight: 600 }}>
                    UPCOMING
                  </span>
                )}
                {hoverInfo.object.isPrivate && (
                  <span style={{ fontSize: '10px', color: '#fda4af', fontWeight: 600 }}>
                    PRIVATE
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', opacity: 0.8 }}>
                {hoverInfo.object.date}
                {hoverInfo.object.depTime ? ` • ${hoverInfo.object.depTime}` : ''}
              </div>
              <div style={{ marginTop: '4px' }}>{hoverInfo.object.route}</div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>{hoverInfo.object.name}</div>
              <div style={{ fontSize: '11px', opacity: 0.8 }}>
                {hoverInfo.object.iataCode} - {hoverInfo.object.city}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FlightMap;
