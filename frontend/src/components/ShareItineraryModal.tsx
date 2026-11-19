import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Plane,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import type { Airport, Flight } from '../types';
import { formatFlightRef, getUtcTodayStr, sortFlightsChronologically } from '../utils/flightFormat';
import {
  CARD_THEMES,
  canvasToPngBlob,
  preloadRouteMapTiles,
  renderItineraryCard,
  type ItineraryCardThemeId,
} from '../utils/itineraryCardRenderer';

interface Props {
  availableFlights: Flight[];
  initialSelectedIds: number[];
  airports: Airport[];
  onClose: () => void;
}

const ShareItineraryModal: React.FC<Props> = ({
  availableFlights,
  initialSelectedIds,
  airports,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const airportMap = useMemo(
    () => new Map(airports.map((a) => [a.iataCode.trim().toUpperCase(), a])),
    [airports]
  );

  const todayUtc = getUtcTodayStr();

  const sortedAvailable = useMemo(
    () => sortFlightsChronologically(availableFlights, airportMap, 'desc'),
    [availableFlights, airportMap]
  );

  const upcomingIds = useMemo(
    () =>
      sortFlightsChronologically(
        availableFlights.filter((f) => f.flightDate >= todayUtc),
        airportMap,
        'asc'
      ).map((f) => f.id),
    [availableFlights, airportMap, todayUtc]
  );

  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    if (initialSelectedIds.length > 0) return initialSelectedIds;
    if (upcomingIds.length > 0) return upcomingIds.slice(0, 4);
    return sortedAvailable.slice(0, 1).map((f) => f.id);
  });

  const [title, setTitle] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [theme, setTheme] = useState<ItineraryCardThemeId>('midnight');
  const [showCabinAndSeat, setShowCabinAndSeat] = useState(true);
  const [showFlightNotes, setShowFlightNotes] = useState(false);
  const [showBookingCredentials, setShowBookingCredentials] = useState(false);
  const [showFooter, setShowFooter] = useState(true);
  const [flightPickerFilter, setFlightPickerFilter] = useState<'upcoming' | 'all'>(
    upcomingIds.length > 0 ? 'upcoming' : 'all'
  );

  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedFlights = useMemo(() => {
    const idSet = new Set(selectedIds);
    return availableFlights.filter((f) => idSet.has(f.id));
  }, [availableFlights, selectedIds]);

  const pickerFlights = useMemo(() => {
    if (flightPickerFilter === 'upcoming') {
      const idSet = new Set(upcomingIds);
      return sortFlightsChronologically(
        availableFlights.filter((f) => idSet.has(f.id)),
        airportMap,
        'asc'
      );
    }
    return sortedAvailable;
  }, [availableFlights, airportMap, flightPickerFilter, sortedAvailable, upcomingIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cardOpts = {
      flights: selectedFlights,
      airportsMap: airportMap,
      title,
      customNote,
      theme,
      showCabinAndSeat,
      showFlightNotes,
      showBookingCredentials,
      showFooter,
    };

    renderItineraryCard(canvas, cardOpts);

    let cancelled = false;
    void preloadRouteMapTiles(selectedFlights, airportMap).then((loadedAny) => {
      if (!cancelled && loadedAny && canvasRef.current) {
        renderItineraryCard(canvasRef.current, cardOpts);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    selectedFlights,
    airportMap,
    title,
    customNote,
    theme,
    showCabinAndSeat,
    showFlightNotes,
    showBookingCredentials,
    showFooter,
  ]);

  const renderFinalPngBlob = async (): Promise<Blob | null> => {
    if (!canvasRef.current || selectedFlights.length === 0) return null;
    await preloadRouteMapTiles(selectedFlights, airportMap);
    if (!canvasRef.current) return null;
    renderItineraryCard(canvasRef.current, {
      flights: selectedFlights,
      airportsMap: airportMap,
      title,
      customNote,
      theme,
      showCabinAndSeat,
      showFlightNotes,
      showBookingCredentials,
      showFooter,
    });
    return canvasToPngBlob(canvasRef.current);
  };

  const toggleFlight = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const getSuggestedFilename = () => {
    const ordered = sortFlightsChronologically(selectedFlights, airportMap, 'asc');
    const datePart = ordered[0]?.flightDate || todayUtc;
    return `aerolog-itinerary-${datePart}.png`;
  };

  const handleDownload = async () => {
    if (!canvasRef.current || selectedFlights.length === 0) return;
    setBusy(true);
    try {
      const blob = await renderFinalPngBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = getSuggestedFilename();
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setStatusMsg('Saved high-res PNG!');
      setTimeout(() => setStatusMsg(null), 2500);
    } catch (err) {
      console.error(err);
      setStatusMsg('Download failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyImage = async () => {
    if (!canvasRef.current || selectedFlights.length === 0) return;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      setStatusMsg('Clipboard image copy not supported in this browser — use Download.');
      return;
    }
    setBusy(true);
    try {
      const blob = await renderFinalPngBlob();
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setStatusMsg('Copied PNG to clipboard!');
      setTimeout(() => {
        setCopied(false);
        setStatusMsg(null);
      }, 2500);
    } catch (err) {
      console.error(err);
      setStatusMsg('Copy blocked by browser — use Download or Share.');
    } finally {
      setBusy(false);
    }
  };

  const handleNativeShare = async () => {
    if (!canvasRef.current || selectedFlights.length === 0) return;
    setBusy(true);
    try {
      const blob = await renderFinalPngBlob();
      if (!blob) return;
      const file = new File([blob], getSuggestedFilename(), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: title.trim() || 'Flight Itinerary',
          text: customNote.trim() || undefined,
          files: [file],
        });
      } else {
        await handleDownload();
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        console.error(err);
        await handleDownload();
      }
    } finally {
      setBusy(false);
    }
  };

  const canShareFiles =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className="share-modal-backdrop" onClick={onClose}>
      <div className="share-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Sparkles size={20} color="#a5b4fc" />
            <div>
              <h3 style={{ fontSize: '1.125rem' }}>Share Itinerary Card</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Generate a Retina boarding-pass PNG for family & friends — zero live data exposed
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="share-icon-close" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="share-modal-body">
          {/* Controls Column */}
          <div className="share-controls">
            {/* Flight Selector */}
            <div className="share-section">
              <div className="share-section-title">
                <span>1. Select Flights ({selectedIds.length} chosen)</span>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {upcomingIds.length > 0 && (
                    <button
                      type="button"
                      className="share-mini-btn"
                      onClick={() => setSelectedIds(upcomingIds)}
                    >
                      All Upcoming ({upcomingIds.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className={`share-mini-btn ${flightPickerFilter === 'upcoming' ? 'active' : ''}`}
                    onClick={() =>
                      setFlightPickerFilter((f) => (f === 'upcoming' ? 'all' : 'upcoming'))
                    }
                  >
                    {flightPickerFilter === 'upcoming' ? 'Show All' : 'Upcoming Only'}
                  </button>
                </div>
              </div>

              <div className="share-flight-list">
                {pickerFlights.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.5rem' }}>
                    No flights in this filter. Switch to "Show All" to pick past legs.
                  </p>
                ) : (
                  pickerFlights.slice(0, 60).map((f) => {
                    const isChecked = selectedIds.includes(f.id);
                    return (
                      <label
                        key={f.id}
                        className={`share-flight-chip ${isChecked ? 'selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleFlight(f.id)}
                          style={{ accentColor: '#6366f1' }}
                        />
                        <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                          {formatFlightRef(f.airlineIata, f.flightNumber)}
                        </span>
                        <span>
                          {f.depAirportIata}→{f.arrAirportIata}
                        </span>
                        <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                          {f.flightDate}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Title & Note */}
            <div className="share-section">
              <label className="share-label">Trip Title (optional)</label>
              <input
                type="text"
                placeholder="e.g. Tokyo → Beijing Family Trip"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="share-input"
              />
              <label className="share-label" style={{ marginTop: '0.65rem' }}>
                Pickup / Greeting Note on Card (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Arriving Terminal 3 — meet at North Exit!"
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                className="share-input"
              />
            </div>

            {/* Theme Switcher */}
            <div className="share-section">
              <label className="share-label">Card Style</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                {(Object.keys(CARD_THEMES) as ItineraryCardThemeId[]).map((key) => {
                  const t = CARD_THEMES[key];
                  const active = theme === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTheme(key)}
                      className={`share-theme-btn ${active ? 'active' : ''}`}
                    >
                      <span
                        className="share-theme-dot"
                        style={{
                          background: `linear-gradient(135deg, ${t.accentStart}, ${t.accentEnd})`,
                        }}
                      />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Privacy Toggles */}
            <div className="share-section">
              <label className="share-label">Included Details</label>
              <div className="share-toggles">
                <label className="share-toggle-row">
                  <input
                    type="checkbox"
                    checked={showCabinAndSeat}
                    onChange={(e) => setShowCabinAndSeat(e.target.checked)}
                  />
                  <span>Cabin Class, Aircraft & Seat</span>
                </label>
                <label className="share-toggle-row">
                  <input
                    type="checkbox"
                    checked={showFlightNotes}
                    onChange={(e) => setShowFlightNotes(e.target.checked)}
                  />
                  <span>Saved Flight Notes</span>
                </label>
                <label className="share-toggle-row">
                  <input
                    type="checkbox"
                    checked={showFooter}
                    onChange={(e) => setShowFooter(e.target.checked)}
                  />
                  <span>Boarding-Pass Barcode Footer</span>
                </label>
                <label className="share-toggle-row">
                  <input
                    type="checkbox"
                    checked={showBookingCredentials}
                    onChange={(e) => setShowBookingCredentials(e.target.checked)}
                  />
                  <span style={{ color: showBookingCredentials ? '#fcd34d' : undefined }}>
                    PNR (Booking Ref) & Ticket Number
                  </span>
                </label>
              </div>

              {showBookingCredentials && (
                <div className="share-warning">
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>
                    Anyone with your PNR and last name can manage or cancel your ticket on airline
                    sites. Enable only for co-travelers.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Live Preview Column */}
          <div className="share-preview-col">
            <div className="share-preview-stage">
              {selectedFlights.length === 0 ? (
                <div className="share-empty-preview">
                  <Plane size={28} color="#6366f1" />
                  <p>Select at least one flight to render your card</p>
                </div>
              ) : null}
              <canvas
                ref={canvasRef}
                className="share-canvas-preview"
                style={{ display: selectedFlights.length === 0 ? 'none' : 'block' }}
              />
            </div>

            <div className="share-actions">
              {canShareFiles && (
                <button
                  type="button"
                  disabled={busy || selectedFlights.length === 0}
                  onClick={handleNativeShare}
                  className="share-action-btn primary"
                >
                  <Share2 size={16} />
                  Share Image
                </button>
              )}
              <button
                type="button"
                disabled={busy || selectedFlights.length === 0}
                onClick={handleCopyImage}
                className="share-action-btn"
              >
                {copied ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
                {copied ? 'Copied!' : 'Copy PNG'}
              </button>
              <button
                type="button"
                disabled={busy || selectedFlights.length === 0}
                onClick={handleDownload}
                className={`share-action-btn ${canShareFiles ? '' : 'primary'}`}
              >
                <Download size={16} />
                Download PNG
              </button>
            </div>
            {statusMsg && (
              <p style={{ fontSize: '0.78rem', color: '#a5b4fc', textAlign: 'center', marginTop: '0.5rem' }}>
                {statusMsg}
              </p>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .share-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 2000;
          background: rgba(2, 6, 23, 0.8);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }
        .share-modal-dialog {
          width: 100%;
          max-width: 1020px;
          max-height: 92vh;
          background: #0f172a;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
        }
        .share-modal-header {
          padding: 1rem 1.25rem;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .share-icon-close {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .share-icon-close:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.12);
        }
        .share-modal-body {
          display: grid;
          grid-template-columns: 380px 1fr;
          overflow-y: auto;
          flex: 1;
        }
        .share-controls {
          padding: 1.15rem;
          border-right: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          gap: 1rem;
          overflow-y: auto;
        }
        .share-section {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .share-section-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--text-secondary);
          gap: 0.5rem;
        }
        .share-mini-btn {
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.25);
          color: #a5b4fc;
          font-size: 0.7rem;
          padding: 0.2rem 0.5rem;
          border-radius: 6px;
          cursor: pointer;
        }
        .share-mini-btn.active {
          background: rgba(99, 102, 241, 0.28);
          color: white;
        }
        .share-flight-list {
          max-height: 155px;
          overflow-y: auto;
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 0.35rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          background: rgba(15, 23, 42, 0.6);
        }
        .share-flight-chip {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0.55rem;
          border-radius: 8px;
          font-size: 0.8rem;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .share-flight-chip:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        .share-flight-chip.selected {
          background: rgba(99, 102, 241, 0.14);
          border-color: rgba(99, 102, 241, 0.35);
        }
        .share-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .share-input {
          width: 100%;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color);
          border-radius: 9px;
          padding: 0.55rem 0.75rem;
          color: var(--text-primary);
          font-size: 0.85rem;
          outline: none;
        }
        .share-input:focus {
          border-color: var(--accent-primary);
        }
        .share-theme-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          padding: 0.55rem 0.4rem;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          font-size: 0.7rem;
          font-weight: 600;
          cursor: pointer;
        }
        .share-theme-btn.active {
          border-color: #6366f1;
          background: rgba(99, 102, 241, 0.14);
          color: var(--text-primary);
        }
        .share-theme-dot {
          width: 18px;
          height: 18px;
          border-radius: 999px;
          display: block;
        }
        .share-toggles {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .share-toggle-row {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          font-size: 0.82rem;
          color: var(--text-primary);
          cursor: pointer;
        }
        .share-toggle-row input {
          accent-color: #6366f1;
        }
        .share-warning {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.35);
          color: #fcd34d;
          padding: 0.55rem 0.7rem;
          border-radius: 9px;
          font-size: 0.74rem;
          line-height: 1.4;
        }
        .share-preview-col {
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          background: rgba(2, 6, 23, 0.45);
          overflow-y: auto;
        }
        .share-preview-stage {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 0.25rem 0 1rem;
        }
        .share-canvas-preview {
          width: 100%;
          max-width: 440px;
          height: auto;
          border-radius: 18px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
        }
        .share-empty-preview {
          padding: 3rem 1.5rem;
          text-align: center;
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }
        .share-actions {
          display: flex;
          gap: 0.65rem;
          flex-wrap: wrap;
          justify-content: center;
        }
        .share-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.65rem 1.05rem;
          border-radius: 10px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-primary);
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
        }
        .share-action-btn.primary {
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          border-color: rgba(99, 102, 241, 0.6);
        }
        .share-action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        @media (max-width: 860px) {
          .share-modal-body {
            grid-template-columns: 1fr;
          }
          .share-controls {
            border-right: none;
            border-bottom: 1px solid var(--border-color);
            max-height: none;
          }
        }
      `}</style>
    </div>
  );
};

export default ShareItineraryModal;
