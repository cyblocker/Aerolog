import React, { useMemo, useState } from 'react';
import { Check, Clock, Copy, Lock, Search, Share2, X } from 'lucide-react';
import type { Airport, Flight } from '../types';
import {
  formatFlightRef,
  getFlightPrivacyBadge,
  getUtcTodayStr,
  sortFlightsChronologically,
} from '../utils/flightFormat';

interface Props {
  flights: Flight[];
  airports?: Airport[];
  isOwnerMode?: boolean;
  onShareFlights?: (ids: number[]) => void;
}

const FlightLog: React.FC<Props> = ({
  flights,
  airports = [],
  isOwnerMode = false,
  onShareFlights,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'upcoming' | 'past' | 'hidden'>('all');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [copiedPnrId, setCopiedPnrId] = useState<number | null>(null);

  const todayUtc = getUtcTodayStr();
  const airportMap = useMemo(
    () => new Map(airports.map((a) => [a.iataCode, a])),
    [airports]
  );

  const orderedFlights = useMemo(
    () => sortFlightsChronologically(flights, airportMap, 'desc'),
    [flights, airportMap]
  );

  const filteredFlights = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orderedFlights.filter((f) => {
      if (isOwnerMode) {
        if (ownerFilter === 'upcoming' && f.flightDate < todayUtc) return false;
        if (ownerFilter === 'past' && f.flightDate >= todayUtc) return false;
        if (ownerFilter === 'hidden' && f.isPublicNow) return false;
      }
      if (!q) return true;
      const flightRef = formatFlightRef(f.airlineIata, f.flightNumber).toLowerCase();
      return (
        flightRef.includes(q) ||
        f.flightNumber.toLowerCase().includes(q) ||
        f.depAirportIata.toLowerCase().includes(q) ||
        f.arrAirportIata.toLowerCase().includes(q) ||
        f.airlineIata.toLowerCase().includes(q) ||
        (f.aircraftType && f.aircraftType.toLowerCase().includes(q)) ||
        (isOwnerMode &&
          ((f.bookingRef && f.bookingRef.toLowerCase().includes(q)) ||
            (f.seat && f.seat.toLowerCase().includes(q)) ||
            (f.notes && f.notes.toLowerCase().includes(q))))
      );
    });
  }, [orderedFlights, searchTerm, isOwnerMode, ownerFilter, todayUtc]);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const copyPnr = async (id: number, pnr: string) => {
    try {
      await navigator.clipboard.writeText(pnr);
      setCopiedPnrId(id);
      setTimeout(() => setCopiedPnrId(null), 1600);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <div className="tab-content animate-fade-in">
      <div className="card flight-log-card">
        <div className="log-header">
          <div>
            <h3 style={{ fontSize: '1.25rem' }}>Flight History</h3>
            {isOwnerMode && (
              <div className="log-filter-pills">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'upcoming', label: 'Upcoming' },
                    { id: 'past', label: 'Completed' },
                    { id: 'hidden', label: 'Private / Delayed' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setOwnerFilter(item.id)}
                    className={`log-filter-pill ${ownerFilter === item.id ? 'active' : ''}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="search-container">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder={isOwnerMode ? 'Search flight, airport, PNR...' : 'Search...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        {isOwnerMode && selectedIds.length > 0 && (
          <div className="log-selection-bar">
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              {selectedIds.length} flight{selectedIds.length > 1 ? 's' : ''} selected
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {onShareFlights && (
                <button
                  type="button"
                  onClick={() => onShareFlights(selectedIds)}
                  className="log-share-btn"
                >
                  <Share2 size={14} /> Share Selected Itinerary
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="log-clear-btn"
              >
                <X size={14} /> Clear
              </button>
            </div>
          </div>
        )}

        <div className="table-responsive">
          <table className="flight-table">
            <thead>
              <tr>
                {isOwnerMode && <th style={{ width: 38 }}></th>}
                <th>Date{isOwnerMode ? ' & Time' : ''}</th>
                <th>Flight</th>
                <th>Route</th>
                <th className="hide-mobile">Class</th>
                {isOwnerMode && <th className="hide-mobile">Seat / PNR</th>}
                {isOwnerMode && <th>Visibility</th>}
                <th className="hide-mobile">Distance</th>
              </tr>
            </thead>
            <tbody>
              {filteredFlights.map((f) => {
                const badge = isOwnerMode ? getFlightPrivacyBadge(f, todayUtc) : null;
                const isSelected = selectedIds.includes(f.id);
                return (
                  <tr
                    key={f.id}
                    className={`table-row-hover ${isSelected ? 'row-selected' : ''}`}
                  >
                    {isOwnerMode && (
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(f.id)}
                          style={{ accentColor: '#6366f1', cursor: 'pointer' }}
                        />
                      </td>
                    )}
                    <td>
                      <div className="date-cell">
                        <span className="primary-text">{f.flightDate}</span>
                        {isOwnerMode && f.depTime && (
                          <span className="secondary-text">
                            <Clock size={12} style={{ marginRight: '4px' }} />
                            {f.depTime}
                            {f.arrTime ? ` → ${f.arrTime}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flight-cell">
                        <span className="airline-code">{f.airlineIata}</span>
                        <span className="flight-no">
                          {formatFlightRef(f.airlineIata, f.flightNumber)}
                        </span>
                        {f.aircraftType && (
                          <span className="secondary-text" style={{ fontSize: '0.72rem' }}>
                            {f.aircraftType}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="route-cell">
                        <span className="airport-tag">{f.depAirportIata}</span>
                        <span className="route-arrow">&rarr;</span>
                        <span className="airport-tag">{f.arrAirportIata}</span>
                      </div>
                    </td>
                    <td className="hide-mobile">
                      <span className="class-badge">{f.cabinClass || '-'}</span>
                    </td>
                    {isOwnerMode && (
                      <td className="hide-mobile">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                          {f.seat && (
                            <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                              Seat {f.seat}
                            </span>
                          )}
                          {f.bookingRef && (
                            <button
                              type="button"
                              onClick={() => copyPnr(f.id, f.bookingRef!)}
                              className="pnr-mini-copy"
                              title="Copy PNR"
                            >
                              <span>{f.bookingRef}</span>
                              {copiedPnrId === f.id ? (
                                <Check size={11} color="#10b981" />
                              ) : (
                                <Copy size={11} />
                              )}
                            </button>
                          )}
                          {!f.seat && !f.bookingRef && (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>-</span>
                          )}
                        </div>
                      </td>
                    )}
                    {isOwnerMode && badge && (
                      <td>
                        <span className={`privacy-badge ${badge.kind}`}>
                          {badge.kind === 'private' && <Lock size={11} />}
                          {badge.label}
                        </span>
                      </td>
                    )}
                    <td
                      className="hide-mobile"
                      style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}
                    >
                      {f.distanceKm ? `${f.distanceKm} km` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .log-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 1.25rem;
          gap: 1rem;
        }
        .log-filter-pills {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
          margin-top: 0.65rem;
        }
        .log-filter-pill {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 0.28rem 0.7rem;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
        }
        .log-filter-pill.active {
          background: rgba(99, 102, 241, 0.22);
          border-color: rgba(99, 102, 241, 0.45);
          color: var(--text-primary);
        }
        .log-selection-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          padding: 0.65rem 1rem;
          margin-bottom: 1rem;
          border-radius: 12px;
          background: rgba(99, 102, 241, 0.14);
          border: 1px solid rgba(99, 102, 241, 0.35);
        }
        .log-share-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.42rem 0.85rem;
          border-radius: 8px;
          border: none;
          background: #6366f1;
          color: white;
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
        }
        .log-clear-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          padding: 0.42rem 0.7rem;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          background: transparent;
          color: var(--text-secondary);
          font-size: 0.78rem;
          cursor: pointer;
        }
        .search-container {
          position: relative;
          flex: 0 1 300px;
        }
        .search-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-secondary);
        }
        .search-input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 0.75rem 1rem 0.75rem 2.5rem;
          color: var(--text-primary);
          width: 100%;
          outline: none;
          transition: border-color 0.2s;
        }
        .search-input:focus {
          border-color: var(--accent-primary);
        }
        .table-responsive {
          overflow-x: auto;
          margin: 0 -1rem;
          padding: 0 1rem;
        }
        .flight-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.9375rem;
        }
        .flight-table th {
          color: var(--text-secondary);
          font-weight: 500;
          padding: 1rem;
          border-bottom: 1px solid var(--border-color);
          font-size: 0.8125rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .flight-table td {
          padding: 1.1rem 1rem;
          border-bottom: 1px solid var(--border-color);
        }
        .date-cell, .flight-cell, .route-cell {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .primary-text {
          font-weight: 500;
          color: var(--text-primary);
        }
        .secondary-text {
          font-size: 0.8125rem;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
        }
        .airline-code {
          color: var(--accent-primary);
          font-weight: 700;
          font-size: 0.75rem;
        }
        .flight-no {
          font-weight: 600;
        }
        .route-cell {
          flex-direction: row;
          align-items: center;
          gap: 0.5rem;
        }
        .airport-tag {
          background: rgba(255, 255, 255, 0.05);
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          font-family: monospace;
          font-weight: 600;
        }
        .route-arrow {
          color: var(--text-secondary);
          opacity: 0.5;
        }
        .class-badge {
          font-size: 0.75rem;
          background: rgba(99, 102, 241, 0.1);
          color: #a5b4fc;
          padding: 0.25rem 0.6rem;
          border-radius: 100px;
          border: 1px solid rgba(99, 102, 241, 0.2);
        }
        .pnr-mini-copy {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: monospace;
          font-size: 0.72rem;
          font-weight: 700;
          color: #fcd34d;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 6px;
          padding: 0.15rem 0.45rem;
          cursor: pointer;
        }
        .privacy-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 0.72rem;
          font-weight: 600;
          padding: 0.2rem 0.55rem;
          border-radius: 999px;
          white-space: nowrap;
        }
        .privacy-badge.private {
          background: rgba(244, 63, 94, 0.14);
          border: 1px solid rgba(244, 63, 94, 0.35);
          color: #fda4af;
        }
        .privacy-badge.upcoming {
          background: rgba(6, 182, 212, 0.14);
          border: 1px solid rgba(6, 182, 212, 0.35);
          color: #67e8f9;
        }
        .privacy-badge.delayed {
          background: rgba(245, 158, 11, 0.14);
          border: 1px solid rgba(245, 158, 11, 0.35);
          color: #fcd34d;
        }
        .privacy-badge.public {
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: #6ee7b7;
        }
        .table-row-hover:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        .row-selected {
          background: rgba(99, 102, 241, 0.08);
        }

        @media (max-width: 640px) {
          .log-header {
            flex-direction: column;
            align-items: stretch;
          }
          .search-container {
            flex: 1;
          }
          .hide-mobile {
            display: none;
          }
          .flight-table td {
            padding: 1rem 0.5rem;
          }
          .route-cell {
            gap: 0.25rem;
          }
          .airport-tag {
            padding: 0.15rem 0.35rem;
            font-size: 0.8125rem;
          }
        }
      `}</style>
    </div>
  );
};

export default FlightLog;
