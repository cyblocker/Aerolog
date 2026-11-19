import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Save,
  Trash2,
  Plus,
  Plane,
  MapPin,
  Edit,
  Clock,
  Globe,
  Lock,
  Unlock,
  Share2,
} from 'lucide-react';
import type { Flight, Airport } from '../types';
import {
  formatFlightRef,
  getFlightPrivacyBadge,
  getUtcTodayStr,
  sortFlightsChronologically,
} from '../utils/flightFormat';

interface Props {
  flights: Flight[];
  airports: Airport[];
  onDataChange: () => void;
  apiBase: string;
  onShareFlight?: (ids: number[]) => void;
}

interface AirportFormState {
  iataCode: string;
  name: string;
  latitude: string;
  longitude: string;
  city: string;
  countryCode: string;
  timezone: string;
}

const createEmptyFlightForm = (): Partial<Flight> => ({
  flightDate: getUtcTodayStr(),
  airlineIata: '',
  flightNumber: '',
  depAirportIata: '',
  arrAirportIata: '',
  depTime: '',
  arrTime: '',
  distanceKm: null,
  cabinClass: '',
  aircraftType: '',
  seat: '',
  bookingRef: '',
  ticketNumber: '',
  notes: '',
  isPrivate: false,
});

const ManagePanel: React.FC<Props> = ({
  flights,
  airports,
  onDataChange,
  apiBase,
  onShareFlight,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'flights' | 'airports'>('flights');
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [editingAirport, setEditingAirport] = useState<Airport | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [visibleFlightsCount, setVisibleFlightsCount] = useState(25);
  const [visibleAirportsCount, setVisibleAirportsCount] = useState(25);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const formCardRef = useRef<HTMLDivElement>(null);

  const [newFlight, setNewFlight] = useState<Partial<Flight>>(createEmptyFlightForm);

  const [newAirport, setNewAirport] = useState<AirportFormState>({
    iataCode: '',
    name: '',
    latitude: '',
    longitude: '',
    city: '',
    countryCode: '',
    timezone: '',
  });

  const todayUtc = getUtcTodayStr();
  const airportMap = useMemo(
    () => new Map(airports.map((a) => [a.iataCode, a])),
    [airports]
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          if (activeSubTab === 'flights') {
            setVisibleFlightsCount((prev) => Math.min(prev + 25, flights.length));
          } else {
            setVisibleAirportsCount((prev) => Math.min(prev + 25, airports.length));
          }
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [activeSubTab, flights.length, airports.length]);

  const sortedFlights = useMemo(
    () => sortFlightsChronologically(flights, airportMap, 'desc'),
    [flights, airportMap]
  );

  const handleAddFlight = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newFlight.flightDate) {
      alert('Flight Date is required.');
      return;
    }
    if (!newFlight.airlineIata) {
      alert('Airline IATA is required.');
      return;
    }
    if (!newFlight.flightNumber) {
      alert('Flight Number is required.');
      return;
    }
    if (!newFlight.depAirportIata) {
      alert('Departure airport is required.');
      return;
    }
    if (!newFlight.arrAirportIata) {
      alert('Arrival airport is required.');
      return;
    }

    try {
      const isEdit = !!editingFlight;
      const url = isEdit ? `${apiBase}/flights/${editingFlight.id}` : `${apiBase}/flights`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFlight),
      });
      if (res.ok) {
        onDataChange();
        if (isEdit) {
          cancelEditing();
        } else {
          setNewFlight(createEmptyFlightForm());
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`Failed to save flight: ${errorData.error || res.statusText}`);
      }
    } catch (err) {
      console.error(err);
      alert('Network error. Failed to save flight.');
    }
  };

  const startEditing = (flight: Flight) => {
    setEditingFlight(flight);
    setNewFlight({
      ...flight,
      depTime: flight.depTime || '',
      arrTime: flight.arrTime || '',
      cabinClass: flight.cabinClass || '',
      aircraftType: flight.aircraftType || '',
      seat: flight.seat || '',
      bookingRef: flight.bookingRef || '',
      ticketNumber: flight.ticketNumber || '',
      notes: flight.notes || '',
      isPrivate: Boolean(flight.isPrivate),
    });
    setActiveSubTab('flights');
    window.requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const cancelEditing = () => {
    setEditingFlight(null);
    setNewFlight(createEmptyFlightForm());
  };

  const toggleFlightPrivacy = async (flight: Flight) => {
    try {
      const res = await fetch(`${apiBase}/flights/${flight.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrivate: !flight.isPrivate }),
      });
      if (res.ok) {
        onDataChange();
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`Failed to update privacy: ${errorData.error || res.statusText}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const startEditingAirport = (airport: Airport) => {
    setEditingAirport(airport);
    setNewAirport({
      iataCode: airport.iataCode,
      name: airport.name,
      latitude: airport.latitude.toString(),
      longitude: airport.longitude.toString(),
      city: airport.city,
      countryCode: airport.countryCode,
      timezone: airport.timezone || '',
    });
    setActiveSubTab('airports');
    window.requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const cancelEditingAirport = () => {
    setEditingAirport(null);
    setNewAirport({
      iataCode: '',
      name: '',
      latitude: '',
      longitude: '',
      city: '',
      countryCode: '',
      timezone: '',
    });
  };

  const triggerAirportLookup = async (iata: string) => {
    if (!iata || iata.length !== 3) return;
    if (airports.some((a) => a.iataCode === iata)) return;

    setIsLookingUp(true);
    try {
      const res = await fetch(`${apiBase}/airports/auto-lookup/${iata}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) onDataChange();
    } catch (err) {
      console.error('Auto-lookup failed:', err);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleDeleteFlight = async (id: number) => {
    if (!confirm('Are you sure you want to delete this flight record?')) return;
    try {
      const res = await fetch(`${apiBase}/flights/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) onDataChange();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddAirport = async (e: React.FormEvent) => {
    e.preventDefault();

    const iata = newAirport.iataCode.trim().toUpperCase();
    const name = newAirport.name.trim();
    const city = newAirport.city.trim();
    const country = newAirport.countryCode.trim().toUpperCase();
    const latStr = newAirport.latitude.trim();
    const lngStr = newAirport.longitude.trim();
    const tz = newAirport.timezone.trim();

    if (!iata || iata.length !== 3) {
      alert('IATA Code must be exactly 3 letters.');
      return;
    }
    if (!name) {
      alert('Airport Name is required.');
      return;
    }
    if (!city) {
      alert('City is required.');
      return;
    }
    if (!country) {
      alert('Country code is required.');
      return;
    }

    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      alert('Latitude must be a valid number between -90 and 90.');
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      alert('Longitude must be a valid number between -180 and 180.');
      return;
    }

    const payload = {
      iataCode: iata,
      name,
      city,
      countryCode: country,
      latitude: lat,
      longitude: lng,
      timezone: tz || null,
    };

    try {
      const isEdit = !!editingAirport;
      const url = isEdit ? `${apiBase}/airports/${editingAirport.iataCode}` : `${apiBase}/airports`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        onDataChange();
        cancelEditingAirport();
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(`Failed to save airport: ${errorData.error || res.statusText}`);
      }
    } catch (err) {
      console.error(err);
      alert('Network error. Failed to save airport.');
    }
  };

  const handleDeleteAirport = async (iata: string) => {
    if (!confirm(`Are you sure you want to delete airport ${iata}?`)) return;
    try {
      const res = await fetch(`${apiBase}/airports/${iata}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) onDataChange();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="tab-content animate-fade-in">
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('flights')}
          className={`nav-item ${activeSubTab === 'flights' ? 'active' : ''}`}
          style={{
            padding: '0.5rem 1.5rem',
            borderRadius: '12px',
            background: activeSubTab === 'flights' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Plane size={18} /> Flights
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('airports')}
          className={`nav-item ${activeSubTab === 'airports' ? 'active' : ''}`}
          style={{
            padding: '0.5rem 1.5rem',
            borderRadius: '12px',
            background: activeSubTab === 'airports' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <MapPin size={18} /> Airports
        </button>
      </div>

      <div className="manage-grid">
        {/* ADD / EDIT FORM */}
        <div ref={formCardRef} className="card manage-form-card">
          <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {editingFlight || editingAirport ? (
              <Edit size={20} color="var(--accent-secondary)" />
            ) : (
              <Plus size={20} color="var(--accent-primary)" />
            )}
            {editingFlight || editingAirport ? 'Edit' : 'Add'}{' '}
            {activeSubTab === 'flights' ? 'Flight' : 'Airport'}
          </h3>

          {activeSubTab === 'flights' ? (
            <form onSubmit={handleAddFlight} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Flight Date</label>
                {editingFlight && (
                  <button
                    type="button"
                    onClick={cancelEditing}
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--accent-primary)',
                      background: 'rgba(99, 102, 241, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Plus size={12} /> Back to Add
                  </button>
                )}
              </div>
              <input
                type="date"
                value={newFlight.flightDate || ''}
                onChange={(e) => setNewFlight({ ...newFlight, flightDate: e.target.value })}
                className="manage-input"
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Airline IATA</label>
                  <input
                    type="text"
                    placeholder="JL"
                    value={newFlight.airlineIata || ''}
                    onChange={(e) =>
                      setNewFlight({ ...newFlight, airlineIata: e.target.value.toUpperCase() })
                    }
                    className="manage-input"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Flight No</label>
                  <input
                    type="text"
                    placeholder="JL25"
                    value={newFlight.flightNumber || ''}
                    onChange={(e) =>
                      setNewFlight({ ...newFlight, flightNumber: e.target.value.toUpperCase() })
                    }
                    className="manage-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Dep IATA {isLookingUp && '...'}
                  </label>
                  <input
                    type="text"
                    placeholder="HND"
                    value={newFlight.depAirportIata || ''}
                    onChange={(e) =>
                      setNewFlight({ ...newFlight, depAirportIata: e.target.value.toUpperCase() })
                    }
                    onBlur={(e) => triggerAirportLookup(e.target.value)}
                    className="manage-input"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Arr IATA {isLookingUp && '...'}
                  </label>
                  <input
                    type="text"
                    placeholder="PEK"
                    value={newFlight.arrAirportIata || ''}
                    onChange={(e) =>
                      setNewFlight({ ...newFlight, arrAirportIata: e.target.value.toUpperCase() })
                    }
                    onBlur={(e) => triggerAirportLookup(e.target.value)}
                    className="manage-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <Clock size={12} /> Dep Time (Local)
                  </label>
                  <input
                    type="time"
                    value={newFlight.depTime || ''}
                    onChange={(e) => setNewFlight({ ...newFlight, depTime: e.target.value })}
                    className="manage-input"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <Clock size={12} /> Arr Time (Local)
                  </label>
                  <input
                    type="time"
                    value={newFlight.arrTime || ''}
                    onChange={(e) => setNewFlight({ ...newFlight, arrTime: e.target.value })}
                    className="manage-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Cabin Class</label>
                  <select
                    value={newFlight.cabinClass || ''}
                    onChange={(e) => setNewFlight({ ...newFlight, cabinClass: e.target.value })}
                    className="manage-input"
                  >
                    <option value="">Select Class</option>
                    <option value="Economy">Economy</option>
                    <option value="Premium Economy">Premium Economy</option>
                    <option value="Business">Business</option>
                    <option value="First">First</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Seat</label>
                  <input
                    type="text"
                    placeholder="14A"
                    value={newFlight.seat || ''}
                    onChange={(e) =>
                      setNewFlight({ ...newFlight, seat: e.target.value.toUpperCase() })
                    }
                    className="manage-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Aircraft</label>
                  <input
                    type="text"
                    placeholder="B787-9"
                    value={newFlight.aircraftType || ''}
                    onChange={(e) =>
                      setNewFlight({ ...newFlight, aircraftType: e.target.value.toUpperCase() })
                    }
                    className="manage-input"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>PNR (Booking Ref)</label>
                  <input
                    type="text"
                    placeholder="ABC123"
                    value={newFlight.bookingRef || ''}
                    onChange={(e) =>
                      setNewFlight({ ...newFlight, bookingRef: e.target.value.toUpperCase() })
                    }
                    className="manage-input"
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ticket Number</label>
                <input
                  type="text"
                  placeholder="131-2134567890"
                  value={newFlight.ticketNumber || ''}
                  onChange={(e) => setNewFlight({ ...newFlight, ticketNumber: e.target.value })}
                  className="manage-input"
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Notes (Private)</label>
                <textarea
                  rows={2}
                  placeholder="Optional personal notes..."
                  value={newFlight.notes || ''}
                  onChange={(e) => setNewFlight({ ...newFlight, notes: e.target.value })}
                  className="manage-input"
                  style={{ resize: 'vertical' }}
                />
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '0.35rem 0',
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(newFlight.isPrivate)}
                  onChange={(e) => setNewFlight({ ...newFlight, isPrivate: e.target.checked })}
                  style={{ accentColor: '#f43f5e' }}
                />
                <span>Keep permanently private (never publish after 3–7d delay)</span>
              </label>

              <button type="submit" className="manage-btn">
                <Save size={18} /> {editingFlight ? 'Update Flight' : 'Save Flight'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAddAirport} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>IATA Code</label>
                {editingAirport && (
                  <button
                    type="button"
                    onClick={cancelEditingAirport}
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--accent-primary)',
                      background: 'rgba(99, 102, 241, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Plus size={12} /> Back to Add
                  </button>
                )}
              </div>
              <input
                type="text"
                placeholder="HND"
                disabled={!!editingAirport}
                value={newAirport.iataCode}
                onChange={(e) =>
                  setNewAirport({ ...newAirport, iataCode: e.target.value.toUpperCase() })
                }
                className="manage-input"
              />

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Airport Name</label>
                <input
                  type="text"
                  placeholder="Tokyo Haneda"
                  value={newAirport.name}
                  onChange={(e) => setNewAirport({ ...newAirport, name: e.target.value })}
                  className="manage-input"
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <Globe size={12} /> Timezone (IANA)
                </label>
                <input
                  type="text"
                  placeholder="Asia/Tokyo"
                  value={newAirport.timezone || ''}
                  onChange={(e) => setNewAirport({ ...newAirport, timezone: e.target.value })}
                  className="manage-input"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>City</label>
                  <input
                    type="text"
                    value={newAirport.city}
                    onChange={(e) => setNewAirport({ ...newAirport, city: e.target.value })}
                    className="manage-input"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Country (ISO)</label>
                  <input
                    type="text"
                    value={newAirport.countryCode}
                    onChange={(e) =>
                      setNewAirport({ ...newAirport, countryCode: e.target.value.toUpperCase() })
                    }
                    className="manage-input"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={newAirport.latitude}
                    onChange={(e) => setNewAirport({ ...newAirport, latitude: e.target.value })}
                    className="manage-input"
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={newAirport.longitude}
                    onChange={(e) => setNewAirport({ ...newAirport, longitude: e.target.value })}
                    className="manage-input"
                  />
                </div>
              </div>
              <button type="submit" className="manage-btn">
                <Save size={18} /> {editingAirport ? 'Update Airport' : 'Save Airport'}
              </button>
            </form>
          )}
        </div>

        {/* LIST VIEW */}
        <div className="card">
          <h3 style={{ marginBottom: '1.5rem' }}>
            List of {activeSubTab === 'flights' ? 'Flights' : 'Airports'}
          </h3>
          <div className="manage-list-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr
                  style={{
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border-color)',
                    fontSize: '0.875rem',
                  }}
                >
                  <th style={{ padding: '1rem' }}>{activeSubTab === 'flights' ? 'Details' : 'Airport'}</th>
                  <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeSubTab === 'flights'
                  ? sortedFlights.slice(0, visibleFlightsCount).map((f) => {
                      const badge = getFlightPrivacyBadge(f, todayUtc);
                      return (
                        <tr
                          key={f.id}
                          style={{
                            borderBottom: '1px solid var(--border-color)',
                            background:
                              editingFlight?.id === f.id
                                ? 'rgba(99, 102, 241, 0.15)'
                                : 'transparent',
                            transition: 'background 0.2s ease',
                          }}
                        >
                          <td style={{ padding: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: '600', color: 'var(--accent-primary)' }}>
                                  {formatFlightRef(f.airlineIata, f.flightNumber)}
                                </span>
                                <span className={`manage-privacy-pill ${badge.kind}`}>
                                  {badge.label}
                                </span>
                              </div>
                              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                {f.flightDate}
                              </span>
                            </div>
                            <div style={{ fontWeight: '600', marginTop: '4px' }}>
                              {f.depAirportIata} → {f.arrAirportIata}
                            </div>
                            <div
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--text-secondary)',
                                display: 'flex',
                                gap: '0.5rem',
                                marginTop: '2px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <span>{f.depTime || '--:--'} LCL</span>
                              <span>→</span>
                              <span>{f.arrTime || '--:--'} LCL</span>
                              {f.seat && <span>• Seat {f.seat}</span>}
                              {f.bookingRef && <span>• PNR {f.bookingRef}</span>}
                            </div>
                          </td>
                          <td style={{ padding: '1rem', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: '0.55rem', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                onClick={() => toggleFlightPrivacy(f)}
                                title={f.isPrivate ? 'Make publicly eligible (after delay)' : 'Keep permanently private'}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: f.isPrivate ? '#fda4af' : 'var(--text-secondary)',
                                }}
                              >
                                {f.isPrivate ? <Lock size={16} /> : <Unlock size={16} />}
                              </button>
                              {onShareFlight && (
                                <button
                                  type="button"
                                  onClick={() => onShareFlight([f.id])}
                                  title="Share itinerary image"
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: '#a5b4fc',
                                  }}
                                >
                                  <Share2 size={16} />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => startEditing(f)}
                                title="Edit flight"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--accent-secondary)',
                                }}
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteFlight(f.id)}
                                title="Delete flight"
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: '#ef4444',
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  : airports.slice(0, visibleAirportsCount).map((a) => (
                      <tr
                        key={a.iataCode}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          background:
                            editingAirport?.iataCode === a.iataCode
                              ? 'rgba(99, 102, 241, 0.15)'
                              : 'transparent',
                          transition: 'background 0.2s ease',
                        }}
                      >
                        <td style={{ padding: '1rem' }}>
                          <div style={{ fontWeight: '600' }}>
                            {a.iataCode} - {a.name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {a.city}, {a.countryCode} | {a.timezone || 'No TZ'}
                          </div>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => startEditingAirport(a)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--accent-secondary)',
                              }}
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAirport(a.iataCode)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#ef4444',
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            <div
              ref={loadMoreRef}
              style={{ height: '20px', margin: '1rem 0', textAlign: 'center', opacity: 0.5, fontSize: '0.75rem' }}
            >
              {(activeSubTab === 'flights'
                ? visibleFlightsCount < flights.length
                : visibleAirportsCount < airports.length)
                ? 'Loading more...'
                : 'End of list'}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .manage-grid {
          display: grid;
          grid-template-columns: 1.2fr 2fr;
          gap: 1.5rem;
          margin-bottom: 2rem;
        }
        .manage-form-card {
          align-self: start;
          position: sticky;
          top: 1rem;
          max-height: calc(100vh - 3rem);
          overflow-y: auto;
        }
        .manage-list-scroll {
          max-height: calc(100vh - 300px);
          overflow-y: auto;
          padding-right: 0.5rem;
        }
        @media (max-width: 900px) {
          .manage-grid {
            grid-template-columns: 1fr;
          }
          .manage-form-card {
            position: static;
            max-height: none;
            overflow-y: visible;
          }
          .manage-list-scroll {
            max-height: none;
            overflow-y: visible;
            padding-right: 0;
          }
        }
        .manage-input {
          width: 100%;
          padding: 0.625rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          color: var(--text-primary);
          outline: none;
          margin-top: 0.25rem;
          font-size: 0.875rem;
          transition: all 0.2s;
          font-family: inherit;
        }
        .manage-input:focus {
           border-color: var(--accent-primary);
           background: rgba(255, 255, 255, 0.08);
        }
        .manage-btn {
          width: 100%;
          padding: 0.75rem;
          background: var(--accent-primary);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 0.5rem;
          transition: all 0.2s ease;
        }
        .manage-input option {
          background: #1e293b;
          color: var(--text-primary);
        }
        .manage-btn:hover {
          opacity: 0.9;
          transform: translateY(-1px);
          filter: brightness(1.1);
        }
        .manage-privacy-pill {
          font-size: 0.68rem;
          font-weight: 600;
          padding: 0.12rem 0.48rem;
          border-radius: 999px;
        }
        .manage-privacy-pill.private {
          background: rgba(244, 63, 94, 0.14);
          color: #fda4af;
          border: 1px solid rgba(244, 63, 94, 0.35);
        }
        .manage-privacy-pill.upcoming {
          background: rgba(6, 182, 212, 0.14);
          color: #67e8f9;
          border: 1px solid rgba(6, 182, 212, 0.35);
        }
        .manage-privacy-pill.delayed {
          background: rgba(245, 158, 11, 0.14);
          color: #fcd34d;
          border: 1px solid rgba(245, 158, 11, 0.35);
        }
        .manage-privacy-pill.public {
          background: rgba(16, 185, 129, 0.12);
          color: #6ee7b7;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }
        tr:hover {
          background: rgba(255, 255, 255, 0.02);
        }
      `}</style>
    </div>
  );
};

export default ManagePanel;
