import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ListChecks,
  Loader2,
  Plane,
  Plus,
  Share2,
  ShieldAlert,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import type { Airport, AnalysisStatus, Flight, FlightReminder, OwnerProfile } from '../types';
import {
  estimateArrivalTiming,
  formatDisplayDate,
  formatDurationMinutes,
  formatFlightRef,
  getShortTzLabel,
  getUtcTodayStr,
  sortFlightsChronologically,
  toAirportUtcMs,
} from '../utils/flightFormat';
import { getLocalYmdInTz } from '../utils/calendar';
import PreFlightChecklist from './PreFlightChecklist';

interface Props {
  flights: Flight[];
  airports: Airport[];
  reminders: FlightReminder[];
  profile: OwnerProfile | null;
  analysisStatus: AnalysisStatus | null;
  apiBase: string;
  isOfflineFallback?: boolean;
  onShareFlights: (ids: number[]) => void;
  onNavigateTab: (tab: 'manage' | 'records' | 'profile') => void;
  onRemindersChange: () => void;
  onAnalysisStatusChange: (status: AnalysisStatus) => void;
}

const UpcomingTrips: React.FC<Props> = ({
  flights,
  airports,
  reminders,
  profile,
  analysisStatus,
  apiBase,
  isOfflineFallback = false,
  onShareFlights,
  onNavigateTab,
  onRemindersChange,
  onAnalysisStatusChange,
}) => {
  const airportMap = useMemo(
    () => new Map(airports.map((a) => [a.iataCode, a])),
    [airports]
  );

  const [nowMs, setNowMs] = useState(() => Date.now());
  const homeTz = profile?.homeTimezone || 'UTC';
  const todayStr = profile?.homeTimezone ? getLocalYmdInTz(nowMs, homeTz) : getUtcTodayStr();

  const upcomingFlights = useMemo(
    () =>
      sortFlightsChronologically(
        flights.filter((f) => f.flightDate >= todayStr),
        airportMap,
        'asc'
      ),
    [flights, airportMap, todayStr]
  );

  const [subView, setSubView] = useState<'trips' | 'checklist'>('trips');
  const [expandedFlightId, setExpandedFlightId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const { totalPendingChecklist, pendingByFlightId } = useMemo(() => {
    let total = 0;
    const map = new Map<number, number>();
    for (const r of reminders) {
      if (r.category === 'departure' || r.status !== 'pending') continue;
      if (r.flight && r.flight.flightDate < todayStr) continue;
      total++;
      if (r.flightId) {
        map.set(r.flightId, (map.get(r.flightId) || 0) + 1);
      }
    }
    return { totalPendingChecklist: total, pendingByFlightId: map };
  }, [reminders, todayStr]);

  const hasProfileContext = Boolean(
    profile?.citizenships?.trim() ||
    profile?.residencyCountry?.trim() ||
    profile?.frequentFlyerStatuses?.trim()
  );

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Clipboard API may be unavailable in insecure contexts
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const topToolbar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div className="upcoming-subview-bar">
        <button
          type="button"
          className={`upcoming-subview-btn ${subView === 'trips' ? 'active' : ''}`}
          onClick={() => setSubView('trips')}
        >
          <Plane size={15} /> Trips & Next Flight
        </button>
        <button
          type="button"
          className={`upcoming-subview-btn ${subView === 'checklist' ? 'active' : ''}`}
          onClick={() => setSubView('checklist')}
        >
          <ListChecks size={15} /> All Checklist
          {totalPendingChecklist > 0 && (
            <span className="upcoming-tab-pill">{totalPendingChecklist}</span>
          )}
        </button>
      </div>

      {analysisStatus?.isActive && (
        <div className="upcoming-analysis-banner">
          <Loader2 size={15} className="animate-spin" color="#67e8f9" style={{ flexShrink: 0 }} />
          <span>
            Analyzing flights in background (
            {analysisStatus.completed + analysisStatus.failed}/{analysisStatus.totalUpcoming} done)
            — safe to switch tabs or close this page.
          </span>
        </div>
      )}

      {!hasProfileContext && (
        <div className="upcoming-profile-hint">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
            <UserCheck size={15} color="#a5b4fc" style={{ flexShrink: 0 }} />
            <span>
              Add optional citizenship, residency, or airline status to tailor border & meal reminders.
            </span>
          </span>
          <button
            type="button"
            className="upcoming-secondary-btn"
            onClick={() => onNavigateTab('profile')}
          >
            Traveler Profile →
          </button>
        </div>
      )}
    </div>
  );

  const renderTripsView = () => {
    if (upcomingFlights.length === 0) {
      return (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '3rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '16px',
              background: 'rgba(99, 102, 241, 0.14)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Plane size={28} color="#818cf8" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.4rem' }}>
              No Upcoming Flights Scheduled
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', maxWidth: 420 }}>
              Forward an itinerary email or add a trip manually to see live countdowns, pre-flight
              checklists, and offline boarding passes here.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => onNavigateTab('manage')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.65rem 1.1rem',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--accent-primary)',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus size={16} /> Add Flight
            </button>
            <button
              type="button"
              onClick={() => setSubView('checklist')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.65rem 1.1rem',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <ListChecks size={16} color="#67e8f9" /> Open Checklist
            </button>
            {flights.length > 0 && (
              <button
                type="button"
                onClick={() => onShareFlights(flights.slice(0, 1).map((f) => f.id))}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.65rem 1.1rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Sparkles size={16} color="#a5b4fc" /> Share Past Trip Card
              </button>
            )}
          </div>
        </div>
      );
    }

    const next = upcomingFlights[0];
    const nextDepAirport = airportMap.get(next.depAirportIata);
    const nextArrAirport = airportMap.get(next.arrAirportIata);
    const nextDepTz = next.depTimezone || nextDepAirport?.timezone || 'UTC';
    const nextArrTz = next.arrTimezone || nextArrAirport?.timezone || 'UTC';
    const nextDepUtc = toAirportUtcMs(next.flightDate, next.depTime || '09:00', nextDepTz);
    const diffMins = Math.round((nextDepUtc - nowMs) / 60_000);
    const timing = estimateArrivalTiming(next, nextDepAirport, nextArrAirport);

    let countdownLabel = 'Upcoming';
    if (diffMins > 0) {
      countdownLabel = `Departs in ${formatDurationMinutes(diffMins)}`;
    } else if (diffMins > -180) {
      countdownLabel = 'Departing / In Progress';
    } else {
      countdownLabel = 'Today';
    }

    const nextTripIds = upcomingFlights
      .filter((f) => {
        const fUtc = toAirportUtcMs(
          f.flightDate,
          f.depTime || '00:00',
          f.depTimezone || airportMap.get(f.depAirportIata)?.timezone || 'UTC'
        );
        return fUtc - nextDepUtc <= 5 * 86_400_000;
      })
      .map((f) => f.id);

    return (
      <>
        {/* Hero Next Flight Card */}
        <div className="upcoming-hero-card">
          <div className="upcoming-hero-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span className="upcoming-countdown-pill">
                <Clock size={13} />
                {countdownLabel}
              </span>
              <span className="upcoming-flight-badge">
                {formatFlightRef(next.airlineIata, next.flightNumber)}
              </span>
              {next.aircraftType && (
                <span className="upcoming-meta-pill">{next.aircraftType}</span>
              )}
              {next.cabinClass && (
                <span className="upcoming-meta-pill accent">{next.cabinClass}</span>
              )}
              {next.isPrivate && (
                <span className="upcoming-meta-pill private">
                  <ShieldAlert size={12} /> Always Private
                </span>
              )}
            </div>

            <button
              type="button"
              className="upcoming-share-btn"
              onClick={() =>
                onShareFlights(nextTripIds.length > 0 ? nextTripIds : [next.id])
              }
            >
              <Share2 size={15} />
              Share {nextTripIds.length > 1 ? `Trip (${nextTripIds.length} legs)` : 'Itinerary Card'}
            </button>
          </div>

          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
            {formatDisplayDate(next.flightDate)}
          </div>

          <div className="upcoming-hero-route">
            <div>
              <div className="upcoming-iata">{next.depAirportIata}</div>
              <div className="upcoming-city">
                {nextDepAirport ? `${nextDepAirport.city}, ${nextDepAirport.countryCode}` : 'Departure'}
              </div>
              <div className="upcoming-time">
                {next.depTime || 'TBD'}{' '}
                <span>{getShortTzLabel(nextDepTz, nextDepUtc)}</span>
              </div>
            </div>

            <div className="upcoming-track">
              <div className="upcoming-track-line">
                <Plane size={18} color="#a5b4fc" />
              </div>
              <div className="upcoming-track-meta">
                {timing.durationMinutes !== null && (
                  <span>{formatDurationMinutes(timing.durationMinutes)}</span>
                )}
                {next.distanceKm && <span>{next.distanceKm.toLocaleString()} km</span>}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div className="upcoming-iata">{next.arrAirportIata}</div>
              <div className="upcoming-city">
                {nextArrAirport ? `${nextArrAirport.city}, ${nextArrAirport.countryCode}` : 'Arrival'}
              </div>
              <div className="upcoming-time">
                {next.arrTime || 'TBD'}{' '}
                <span>
                  {getShortTzLabel(nextArrTz, nextDepUtc)}
                  {timing.dayOffset > 0 ? ` (+${timing.dayOffset}d)` : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="upcoming-vault-row">
            {next.seat && (
              <div className="vault-chip">
                <span className="vault-label">SEAT</span>
                <span className="vault-value">{next.seat}</span>
              </div>
            )}

            {next.bookingRef && (
              <button
                type="button"
                className="vault-copy-btn"
                onClick={() => copyText(`pnr-${next.id}`, next.bookingRef!)}
                title="Tap to copy PNR"
              >
                <span className="vault-label">PNR</span>
                <span className="vault-value">{next.bookingRef}</span>
                {copiedField === `pnr-${next.id}` ? (
                  <Check size={14} color="#10b981" />
                ) : (
                  <Copy size={13} />
                )}
              </button>
            )}

            {next.ticketNumber && (
              <button
                type="button"
                className="vault-copy-btn"
                onClick={() => copyText(`tkt-${next.id}`, next.ticketNumber!)}
                title="Tap to copy Ticket Number"
              >
                <span className="vault-label">TICKET</span>
                <span className="vault-value">{next.ticketNumber}</span>
                {copiedField === `tkt-${next.id}` ? (
                  <Check size={14} color="#10b981" />
                ) : (
                  <Copy size={13} />
                )}
              </button>
            )}
          </div>

          {next.notes && (
            <div className="upcoming-notes">
              {next.notes}
            </div>
          )}

          <div
            style={{
              marginTop: '1rem',
              paddingTop: '0.9rem',
              borderTop: '1px solid rgba(148, 163, 184, 0.18)',
            }}
          >
            <PreFlightChecklist
              reminders={reminders}
              flights={flights}
              profile={profile}
              analysisStatus={analysisStatus}
              apiBase={apiBase}
              isOfflineFallback={isOfflineFallback}
              filterFlightId={next.id}
              variant="compact"
              compactHeader={`Checklist for ${formatFlightRef(next.airlineIata, next.flightNumber)} (${pendingByFlightId.get(next.id) || 0})`}
              nowMs={nowMs}
              onRemindersChange={onRemindersChange}
              onAnalysisStatusChange={onAnalysisStatusChange}
            />
          </div>
        </div>

        {/* Upcoming Flights Queue */}
        <div className="card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginBottom: '1rem',
            }}
          >
            <div>
              <h3 style={{ fontSize: '1.1rem' }}>
                All Upcoming Flights ({upcomingFlights.length})
              </h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Hidden from all public APIs until 3–7 days after each flight date
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  className="upcoming-share-btn"
                  onClick={() => onShareFlights(selectedIds)}
                >
                  <Share2 size={14} /> Share Selected ({selectedIds.length})
                </button>
              )}
              <button
                type="button"
                className="upcoming-secondary-btn"
                onClick={() => onShareFlights(upcomingFlights.map((f) => f.id))}
              >
                <Sparkles size={14} /> Share All Upcoming
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {upcomingFlights.map((f) => {
              const dep = airportMap.get(f.depAirportIata);
              const arr = airportMap.get(f.arrAirportIata);
              const isSelected = selectedIds.includes(f.id);
              const pendingCount = pendingByFlightId.get(f.id) || 0;
              const isExpanded = expandedFlightId === f.id;
              return (
                <div
                  key={f.id}
                  className={`upcoming-list-wrap ${isSelected ? 'selected' : ''}`}
                >
                  <div className="upcoming-list-item">
                    <div className="upcoming-list-head">
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', paddingTop: '0.15rem' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(f.id)}
                          style={{ accentColor: '#6366f1', width: 16, height: 16 }}
                        />
                      </label>

                      <div className="upcoming-list-info">
                        <div className="upcoming-list-route">
                          <span style={{ fontWeight: 700, color: '#a5b4fc', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                            {formatFlightRef(f.airlineIata, f.flightNumber)}
                          </span>
                          <span className="upcoming-list-iata" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {f.depAirportIata} → {f.arrAirportIata}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {dep?.city || f.depAirportIata} to {arr?.city || f.arrAirportIata}
                          </span>
                        </div>
                        <div className="upcoming-list-meta">
                          <span>{f.flightDate}</span>
                          <span>
                            {f.depTime || 'TBD'} → {f.arrTime || 'TBD'}
                          </span>
                          {f.seat && <span>Seat {f.seat}</span>}
                          {f.cabinClass && <span>{f.cabinClass}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="upcoming-list-actions">
                      <button
                        type="button"
                        className={`upcoming-secondary-btn ${pendingCount > 0 ? 'has-tasks' : ''}`}
                        onClick={() => setExpandedFlightId(isExpanded ? null : f.id)}
                        title="Expand pre-flight checklist"
                      >
                        <ListChecks size={13} />
                        {pendingCount > 0 ? `${pendingCount} task${pendingCount > 1 ? 's' : ''}` : 'Checklist'}
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                      {f.bookingRef && (
                        <button
                          type="button"
                          className="vault-copy-btn compact"
                          onClick={() => copyText(`list-pnr-${f.id}`, f.bookingRef!)}
                        >
                          <span className="vault-label">PNR</span>
                          <span className="vault-value">{f.bookingRef}</span>
                          {copiedField === `list-pnr-${f.id}` ? (
                            <Check size={12} color="#10b981" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        className="upcoming-secondary-btn"
                        onClick={() => onShareFlights([f.id])}
                        title="Generate shareable image card"
                      >
                        <Share2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="upcoming-list-expanded">
                      <PreFlightChecklist
                        reminders={reminders}
                        flights={flights}
                        profile={profile}
                        analysisStatus={analysisStatus}
                        apiBase={apiBase}
                        isOfflineFallback={isOfflineFallback}
                        filterFlightId={f.id}
                        variant="compact"
                        compactHeader={`${formatFlightRef(f.airlineIata, f.flightNumber)} Checklist`}
                        nowMs={nowMs}
                        onRemindersChange={onRemindersChange}
                        onAnalysisStatusChange={onAnalysisStatusChange}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="tab-content animate-fade-in" style={{ gap: '1.15rem', display: 'flex', flexDirection: 'column' }}>
      {topToolbar}

      {subView === 'checklist' ? (
        <div className="card upcoming-checklist-card">
          <PreFlightChecklist
            reminders={reminders}
            flights={flights}
            profile={profile}
            analysisStatus={analysisStatus}
            apiBase={apiBase}
            isOfflineFallback={isOfflineFallback}
            variant="full"
            nowMs={nowMs}
            onRemindersChange={onRemindersChange}
            onAnalysisStatusChange={onAnalysisStatusChange}
          />
        </div>
      ) : (
        renderTripsView()
      )}

      <style>{`
        .upcoming-subview-bar {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .upcoming-subview-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.55rem 0.95rem;
          border-radius: 12px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-secondary);
          font-size: 0.84rem;
          font-weight: 600;
          cursor: pointer;
        }
        .upcoming-subview-btn.active {
          background: rgba(99, 102, 241, 0.16);
          border-color: rgba(99, 102, 241, 0.45);
          color: var(--text-primary);
        }
        .upcoming-tab-pill {
          font-size: 0.7rem;
          font-weight: 700;
          padding: 0.08rem 0.42rem;
          border-radius: 999px;
          background: rgba(245, 158, 11, 0.2);
          color: #fcd34d;
        }
        .upcoming-analysis-banner {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.6rem 0.85rem;
          border-radius: 12px;
          border: 1px solid rgba(6, 182, 212, 0.38);
          background: rgba(6, 182, 212, 0.1);
          color: #67e8f9;
          font-size: 0.78rem;
        }
        .upcoming-profile-hint {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
          padding: 0.65rem 0.9rem;
          border-radius: 12px;
          border: 1px solid rgba(99, 102, 241, 0.28);
          background: rgba(99, 102, 241, 0.08);
          font-size: 0.78rem;
          color: var(--text-secondary);
        }
        .upcoming-secondary-btn.has-tasks {
          border-color: rgba(245, 158, 11, 0.35);
          color: #fcd34d;
          background: rgba(245, 158, 11, 0.08);
        }
        .upcoming-list-wrap {
          border-radius: 14px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.02);
          overflow: hidden;
        }
        .upcoming-list-wrap.selected {
          border-color: rgba(99, 102, 241, 0.45);
          background: rgba(99, 102, 241, 0.08);
        }
        .upcoming-list-wrap .upcoming-list-item {
          border: none;
          border-radius: 0;
          background: transparent;
        }
        .upcoming-list-expanded {
          padding: 0.85rem 1rem 1rem 1rem;
          border-top: 1px solid var(--border-color);
          background: rgba(15, 23, 42, 0.45);
        }
        .upcoming-hero-card {
          background: linear-gradient(145deg, rgba(30, 41, 59, 0.85), rgba(30, 27, 75, 0.72));
          border: 1px solid rgba(99, 102, 241, 0.35);
          border-radius: 22px;
          padding: 1.5rem;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
        }
        .upcoming-hero-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .upcoming-countdown-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          background: rgba(6, 182, 212, 0.16);
          border: 1px solid rgba(6, 182, 212, 0.4);
          color: #67e8f9;
          padding: 0.3rem 0.7rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 700;
        }
        .upcoming-flight-badge {
          background: linear-gradient(135deg, #6366f1, #ec4899);
          color: white;
          padding: 0.3rem 0.7rem;
          border-radius: 8px;
          font-family: monospace;
          font-weight: 800;
          font-size: 0.85rem;
        }
        .upcoming-meta-pill {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          padding: 0.25rem 0.6rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
        }
        .upcoming-meta-pill.accent {
          color: #a5b4fc;
          border-color: rgba(99, 102, 241, 0.3);
          background: rgba(99, 102, 241, 0.12);
        }
        .upcoming-meta-pill.private {
          color: #fda4af;
          border-color: rgba(244, 63, 94, 0.35);
          background: rgba(244, 63, 94, 0.14);
        }
        .upcoming-share-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.55rem 0.95rem;
          border-radius: 10px;
          border: 1px solid rgba(99, 102, 241, 0.5);
          background: rgba(99, 102, 241, 0.22);
          color: white;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
        }
        .upcoming-share-btn:hover {
          background: rgba(99, 102, 241, 0.35);
        }
        .upcoming-secondary-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.48rem 0.8rem;
          border-radius: 9px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
        }
        .upcoming-hero-route {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 1rem;
          margin: 1.25rem 0;
        }
        .upcoming-iata {
          font-size: 2.15rem;
          font-weight: 800;
          font-family: monospace;
          line-height: 1.1;
        }
        .upcoming-city {
          font-size: 0.82rem;
          color: var(--text-secondary);
          margin-top: 0.15rem;
        }
        .upcoming-time {
          font-size: 0.95rem;
          font-weight: 700;
          font-family: monospace;
          margin-top: 0.35rem;
        }
        .upcoming-time span {
          font-size: 0.75rem;
          color: var(--text-secondary);
          font-weight: 500;
        }
        .upcoming-track {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          min-width: 110px;
        }
        .upcoming-track-line {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .upcoming-track-line::before,
        .upcoming-track-line::after {
          content: '';
          flex: 1;
          height: 1px;
          border-top: 1px dashed rgba(148, 163, 184, 0.45);
          margin: 0 6px;
        }
        .upcoming-track-meta {
          display: flex;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: var(--text-secondary);
          font-family: monospace;
        }
        .upcoming-vault-row {
          display: flex;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .vault-chip,
        .vault-copy-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          padding: 0.45rem 0.75rem;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(148, 163, 184, 0.25);
          color: var(--text-primary);
          font-size: 0.8rem;
        }
        .vault-copy-btn {
          cursor: pointer;
          border-color: rgba(245, 158, 11, 0.35);
          background: rgba(245, 158, 11, 0.08);
        }
        .vault-copy-btn.compact {
          padding: 0.3rem 0.55rem;
          font-size: 0.74rem;
        }
        .vault-label {
          font-size: 0.68rem;
          font-weight: 700;
          color: var(--text-secondary);
          letter-spacing: 0.05em;
        }
        .vault-value {
          font-family: monospace;
          font-weight: 700;
          color: #fcd34d;
        }
        .vault-chip .vault-value {
          color: var(--text-primary);
        }
        .upcoming-notes {
          margin-top: 0.9rem;
          padding: 0.65rem 0.85rem;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid var(--border-color);
          font-size: 0.82rem;
          color: var(--text-secondary);
        }
        .upcoming-list-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem 0.85rem;
          flex-wrap: wrap;
          padding: 0.85rem 1rem;
          border-radius: 14px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.02);
        }
        .upcoming-list-head {
          display: flex;
          align-items: flex-start;
          gap: 0.7rem;
          flex: 1 1 260px;
          min-width: 0;
        }
        .upcoming-list-info {
          flex: 1;
          min-width: 0;
        }
        .upcoming-list-route {
          display: flex;
          align-items: baseline;
          gap: 0.45rem;
          flex-wrap: wrap;
        }
        .upcoming-list-meta {
          display: flex;
          gap: 0.35rem 0.75rem;
          flex-wrap: wrap;
          font-size: 0.78rem;
          color: var(--text-secondary);
          margin-top: 0.25rem;
        }
        .upcoming-list-meta > span {
          white-space: nowrap;
        }
        .upcoming-list-actions {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .upcoming-list-item.selected {
          border-color: rgba(99, 102, 241, 0.45);
          background: rgba(99, 102, 241, 0.08);
        }
        @media (max-width: 640px) {
          .upcoming-hero-card {
            padding: 1rem;
            border-radius: 18px;
          }
          .upcoming-checklist-card {
            padding: 1rem;
          }
          .upcoming-hero-route {
            grid-template-columns: 1fr auto 1fr;
            gap: 0.45rem;
            margin: 0.85rem 0;
          }
          .upcoming-hero-route > div:last-child {
            text-align: right !important;
          }
          .upcoming-iata {
            font-size: 1.55rem;
          }
          .upcoming-city {
            font-size: 0.74rem;
          }
          .upcoming-time {
            font-size: 0.84rem;
          }
          .upcoming-track {
            min-width: 58px;
          }
          .upcoming-list-item {
            flex-direction: column;
            align-items: stretch;
            gap: 0.6rem;
            padding: 0.82rem;
          }
          .upcoming-list-head {
            flex: none;
            width: 100%;
          }
          .upcoming-list-actions {
            width: 100%;
            padding-left: 1.65rem;
          }
          .upcoming-list-expanded {
            padding: 0.72rem;
          }
        }
      `}</style>
    </div>
  );
};

export default UpcomingTrips;
