import React, { useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { ArcLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map as MapGL } from 'react-map-gl/maplibre';
import type { Flight, Airport } from '../types';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Props {
  flights: Flight[];
  airports: Airport[];
}

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const FlightMap: React.FC<Props> = ({ flights, airports }) => {
  const [hoverInfo, setHoverInfo] = useState<any>(null);

  const airportMap = useMemo(() => new Map(airports.map(a => [a.iataCode, a])), [airports]);

  const arcData = useMemo(() => {
    return flights.map(flight => {
      const dep = airportMap.get(flight.depAirportIata);
      const arr = airportMap.get(flight.arrAirportIata);
      if (!dep || !arr) return null;
      return {
        source: [dep.longitude, dep.latitude],
        target: [arr.longitude, arr.latitude],
        flightNumber: flight.flightNumber,
        route: `${dep.iataCode} → ${arr.iataCode}`,
        date: flight.flightDate
      };
    }).filter(Boolean);
  }, [flights, airportMap]);

  const layers = [
    new ArcLayer({
      id: 'arcs',
      data: arcData,
      getSourcePosition: (d: any) => d.source,
      getTargetPosition: (d: any) => d.target,
      getSourceColor: [99, 102, 241, 100], // #6366f1 with opacity
      getTargetColor: [236, 72, 153, 100], // #ec4899 with opacity
      getWidth: 1.5,
      pickable: true,
      onHover: info => setHoverInfo(info),
    }),
    new ScatterplotLayer({
      id: 'airports',
      data: airports,
      getPosition: (d: Airport) => [d.longitude, d.latitude],
      getFillColor: [255, 255, 255, 200],
      getRadius: 18000,
      pickable: true,
      onHover: info => setHoverInfo(info),
    })
  ];

  return (
    <div className="map-container" style={{ height: '600px', width: '100%', position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
      <DeckGL
        initialViewState={{
          longitude: 30,
          latitude: 35,
          zoom: 1.5,
          pitch: 30,
          bearing: 0
        }}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
      >
        <MapGL mapStyle={MAP_STYLE} />
      </DeckGL>

      {hoverInfo && hoverInfo.object && (
        <div style={{
          position: 'absolute',
          zIndex: 10,
          pointerEvents: 'none',
          left: hoverInfo.x + 10,
          top: hoverInfo.y + 10,
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          color: 'white',
          padding: '12px',
          borderRadius: '8px',
          fontSize: '13px',
          backdropFilter: 'blur(4px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
        }}>
          {hoverInfo.object.flightNumber ? (
            <>
              <div style={{ fontWeight: 600, color: '#818cf8', marginBottom: '4px' }}>{hoverInfo.object.flightNumber}</div>
              <div style={{ fontSize: '11px', opacity: 0.8 }}>{hoverInfo.object.date}</div>
              <div style={{ marginTop: '4px' }}>{hoverInfo.object.route}</div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>{hoverInfo.object.name}</div>
              <div style={{ fontSize: '11px', opacity: 0.8 }}>{hoverInfo.object.iataCode} - {hoverInfo.object.city}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FlightMap;
