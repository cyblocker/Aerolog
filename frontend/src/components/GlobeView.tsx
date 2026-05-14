import React, { useEffect, useRef } from 'react';
import createGlobe from 'cobe';

interface Props {
  markers?: { location: [number, number], size: number }[];
}

const GlobeView: React.FC<Props> = ({ markers = [] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let phi = 0;

    if (!canvasRef.current) return;

    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: 2,
      width: 300 * 2,
      height: 300 * 2,
      phi: 0,
      theta: 0,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 8000,
      mapBrightness: 6,
      baseColor: [0.3, 0.3, 0.3],
      markerColor: [0.1, 0.8, 1],
      glowColor: [1, 1, 1],
      markers: markers.map(m => ({ location: m.location, size: m.size })),
      onRender: (state: any) => {
        state.phi = phi;
        phi += 0.003;
      }
    } as any);

    return () => {
      globe.destroy();
    };
  }, [markers]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', maxWidth: '200px', maxHeight: '200px', aspectRatio: '1' }}
      />
    </div>
  );
};

export default GlobeView;
