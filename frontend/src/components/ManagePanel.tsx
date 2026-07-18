import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Save, Trash2, Plus, Plane, MapPin, Edit, Clock, Globe } from 'lucide-react';
import type { Flight, Airport } from '../types';

interface Props {
  flights: Flight[];
  airports: Airport[];
  onDataChange: () => void;
  apiBase: string;
}

const ManagePanel: React.FC<Props> = ({ flights, airports, onDataChange, apiBase }) => {

  const [activeSubTab, setActiveSubTab] = useState<'flights' | 'airports'>('flights');
  const [editingFlight, setEditingFlight] = useState<Flight | null>(null);
  const [editingAirport, setEditingAirport] = useState<Airport | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  
  // Lazy loading state
  const [visibleFlightsCount, setVisibleFlightsCount] = useState(25);
  const [visibleAirportsCount, setVisibleAirportsCount] = useState(25);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Flight form state
  const [newFlight, setNewFlight] = useState<Partial<Flight>>({
    flightDate: new Date().toISOString().split('T')[0],
    airlineIata: '',
    flightNumber: '',
    depAirportIata: '',
    arrAirportIata: '',
    depTime: '',
    arrTime: '',
    distanceKm: null,
    cabinClass: ''
  });

interface AirportFormState {
  iataCode: string;
  name: string;
  latitude: string;
  longitude: string;
  city: string;
  countryCode: string;
  timezone: string;
}

  // Airport form state
  const [newAirport, setNewAirport] = useState<AirportFormState>({
    iataCode: '',
    name: '',
    latitude: '',
    longitude: '',
    city: '',
    countryCode: '',
    timezone: ''
  });

  // Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (activeSubTab === 'flights') {
          setVisibleFlightsCount(prev => Math.min(prev + 25, flights.length));
        } else {
          setVisibleAirportsCount(prev => Math.min(prev + 25, airports.length));
        }
      }
    }, { threshold: 0.1 });

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [activeSubTab, flights.length, airports.length]);

  const sortedFlights = useMemo(() => {
    return [...flights].sort((a, b) => {
      const getUtcTimestamp = (f: Flight) => {
        const tz = f.depTimezone || airports.find(ap => ap.iataCode === f.depAirportIata)?.timezone || 'UTC';
        const localStr = `${f.flightDate}T${f.depTime || '00:00'}:00`;
        const localTs = new Date(localStr).getTime();

        try {
          // Calculate the offset between the target timezone and UTC for this specific date/time
          // We use the same baseline date to find the wall-clock difference
          const d = new Date(localStr);
          const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
          const tzStr = d.toLocaleString('en-US', { timeZone: tz, hour12: false });
          
          // The wall-clock difference between the timezone and UTC
          const offset = new Date(tzStr).getTime() - new Date(utcStr).getTime();
          return localTs - offset;
        } catch (e) {
          return localTs;
        }
      };

      return getUtcTimestamp(b) - getUtcTimestamp(a);
    });
  }, [flights, airports]);

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
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFlight)
      });
      if (res.ok) {
        onDataChange();
        if (!isEdit) {
          setNewFlight({
            flightDate: new Date().toISOString().split('T')[0],
            airlineIata: '',
            flightNumber: '',
            depAirportIata: '',
            arrAirportIata: '',
            depTime: '',
            arrTime: '',
            distanceKm: null,
            cabinClass: 'Economy'
          });
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
    setNewFlight(flight);
    setActiveSubTab('flights');
  };

  const cancelEditing = () => {
    setEditingFlight(null);
    setNewFlight({
      flightDate: new Date().toISOString().split('T')[0],
      airlineIata: '',
      flightNumber: '',
      depAirportIata: '',
      arrAirportIata: '',
      depTime: '',
      arrTime: '',
      distanceKm: null,
      cabinClass: ''
    });
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
      timezone: airport.timezone || ''
    });
    setActiveSubTab('airports');
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
      timezone: ''
    });
  };

  const triggerAirportLookup = async (iata: string) => {
    if (!iata || iata.length !== 3) return;
    if (airports.some(a => a.iataCode === iata)) return;

    setIsLookingUp(true);
    try {
      const res = await fetch(`${apiBase}/airports/auto-lookup/${iata}`, { method: 'POST' });
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
      const res = await fetch(`${apiBase}/flights/${id}`, { method: 'DELETE' });
      if (res.ok) onDataChange();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddAirport = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validations
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
      timezone: tz || null
    };

    try {
      const isEdit = !!editingAirport;
      const url = isEdit ? `${apiBase}/airports/${editingAirport.iataCode}` : `${apiBase}/airports`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        onDataChange();
        if (!isEdit) {
          cancelEditingAirport();
        }
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
      const res = await fetch(`${apiBase}/airports/${iata}`, { method: 'DELETE' });
      if (res.ok) onDataChange();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="tab-content animate-fade-in">
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <button 
          onClick={() => setActiveSubTab('flights')}
          className={`nav-item ${activeSubTab === 'flights' ? 'active' : ''}`}
          style={{ padding: '0.5rem 1.5rem', borderRadius: '12px', background: activeSubTab === 'flights' ? 'rgba(99, 102, 241, 0.1)' : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Plane size={18} /> Flights
        </button>
        <button 
          onClick={() => setActiveSubTab('airports')}
          className={`nav-item ${activeSubTab === 'airports' ? 'active' : ''}`}
          style={{ padding: '0.5rem 1.5rem', borderRadius: '12px', background: activeSubTab === 'airports' ? 'rgba(99, 102, 241, 0.1)' : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <MapPin size={18} /> Airports
        </button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: '1.2fr 2fr' }}>
        {/* ADD / EDIT FORM */}
        <div className="card" style={{ alignSelf: 'start', position: 'sticky', top: '1rem' }}>
          <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {editingFlight || editingAirport ? <Edit size={20} color="var(--accent-secondary)" /> : <Plus size={20} color="var(--accent-primary)" />}
            {(editingFlight || editingAirport) ? 'Edit' : 'Add'} {activeSubTab === 'flights' ? 'Flight' : 'Airport'}
          </h3>
          
          {activeSubTab === 'flights' ? (
            <form onSubmit={handleAddFlight} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                      gap: '4px'
                    }}
                  >
                    <Plus size={12} /> Back to Add
                  </button>
                )}
              </div>
              <input type="date" value={newFlight.flightDate} onChange={e => setNewFlight({...newFlight, flightDate: e.target.value})} className="manage-input" />
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Airline IATA</label>
                  <input type="text" placeholder="JL" value={newFlight.airlineIata} onChange={e => setNewFlight({...newFlight, airlineIata: e.target.value.toUpperCase()})} className="manage-input" />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Flight No</label>
                  <input type="text" placeholder="22" value={newFlight.flightNumber} onChange={e => setNewFlight({...newFlight, flightNumber: e.target.value.toUpperCase()})} className="manage-input" />
                </div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                   <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}><Clock size={12} /> Dep Time (Local)</label>
                   <input type="time" value={newFlight.depTime || ''} onChange={e => setNewFlight({...newFlight, depTime: e.target.value})} className="manage-input" />
                </div>
                <div>
                   <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}><Clock size={12} /> Arr Time (Local)</label>
                   <input type="time" value={newFlight.arrTime || ''} onChange={e => setNewFlight({...newFlight, arrTime: e.target.value})} className="manage-input" />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Cabin Class</label>
                <select value={newFlight.cabinClass || ''} onChange={e => setNewFlight({...newFlight, cabinClass: e.target.value})} className="manage-input">
                  <option value="">Select Class</option>
                  <option value="Economy">Economy</option>
                  <option value="Premium Economy">Premium Economy</option>
                  <option value="Business">Business</option>
                  <option value="First">First</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Dep IATA {isLookingUp && '...'}</label>
                  <input type="text" value={newFlight.depAirportIata} onChange={e => setNewFlight({...newFlight, depAirportIata: e.target.value.toUpperCase()})} onBlur={(e) => triggerAirportLookup(e.target.value)} className="manage-input" />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Arr IATA {isLookingUp && '...'}</label>
                  <input type="text" value={newFlight.arrAirportIata} onChange={e => setNewFlight({...newFlight, arrAirportIata: e.target.value.toUpperCase()})} onBlur={(e) => triggerAirportLookup(e.target.value)} className="manage-input" />
                </div>
              </div>
              
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
                      gap: '4px'
                    }}
                  >
                    <Plus size={12} /> Back to Add
                  </button>
                )}
              </div>
              <input type="text" placeholder="HND" disabled={!!editingAirport} value={newAirport.iataCode} onChange={e => setNewAirport({...newAirport, iataCode: e.target.value.toUpperCase()})} className="manage-input" />
              
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Airport Name</label>
                <input type="text" placeholder="Tokyo Haneda" value={newAirport.name} onChange={e => setNewAirport({...newAirport, name: e.target.value})} className="manage-input" />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}><Globe size={12} /> Timezone (IANA)</label>
                <input type="text" placeholder="Asia/Tokyo" value={newAirport.timezone || ''} onChange={e => setNewAirport({...newAirport, timezone: e.target.value})} className="manage-input" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>City</label>
                  <input type="text" value={newAirport.city} onChange={e => setNewAirport({...newAirport, city: e.target.value})} className="manage-input" />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Country (ISO)</label>
                  <input type="text" value={newAirport.countryCode} onChange={e => setNewAirport({...newAirport, countryCode: e.target.value.toUpperCase()})} className="manage-input" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Latitude</label>
                  <input type="number" step="any" value={newAirport.latitude} onChange={e => setNewAirport({...newAirport, latitude: e.target.value})} className="manage-input" />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Longitude</label>
                  <input type="number" step="any" value={newAirport.longitude} onChange={e => setNewAirport({...newAirport, longitude: e.target.value})} className="manage-input" />
                </div>
              </div>
              <button type="submit" className="manage-btn"><Save size={18} /> {editingAirport ? 'Update Airport' : 'Save Airport'}</button>
            </form>
          )}
        </div>

        {/* LIST VIEW */}
        <div className="card">
          <h3 style={{ marginBottom: '1.5rem' }}>
            List of {activeSubTab === 'flights' ? 'Flights' : 'Airports'}
          </h3>
          <div style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto', paddingRight: '0.5rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                  <th style={{ padding: '1rem' }}>{activeSubTab === 'flights' ? 'Details' : 'Airport'}</th>
                  <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeSubTab === 'flights' ? (
                  sortedFlights.slice(0, visibleFlightsCount).map(f => (
                    <tr 
                      key={f.id} 
                      style={{ 
                        borderBottom: '1px solid var(--border-color)',
                        background: editingFlight?.id === f.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                        transition: 'background 0.2s ease'
                      }}
                    >
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                           <span style={{ fontWeight: '600', color: 'var(--accent-primary)' }}>{f.airlineIata}{f.flightNumber}</span>
                           <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{f.flightDate}</span>
                        </div>
                        <div style={{ fontWeight: '600', marginTop: '4px' }}>
                          {f.depAirportIata} → {f.arrAirportIata}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.5rem', marginTop: '2px' }}>
                           <span>{f.depTime || '--:--'} LCL</span>
                           <span>→</span>
                           <span>{f.arrTime || '--:--'} LCL</span>
                        </div>
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button onClick={() => startEditing(f)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-secondary)' }}>
                            <Edit size={16} />
                          </button>
                          <button onClick={() => handleDeleteFlight(f.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  airports.slice(0, visibleAirportsCount).map(a => (
                    <tr 
                      key={a.iataCode} 
                      style={{ 
                        borderBottom: '1px solid var(--border-color)',
                        background: editingAirport?.iataCode === a.iataCode ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                        transition: 'background 0.2s ease'
                      }}
                    >
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: '600' }}>{a.iataCode} - {a.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {a.city}, {a.countryCode} | {a.timezone || 'No TZ'}
                        </div>
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button onClick={() => startEditingAirport(a)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent-secondary)' }}>
                            <Edit size={16} />
                          </button>
                          <button onClick={() => handleDeleteAirport(a.iataCode)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {/* Lazy Load Trigger Element */}
            <div ref={loadMoreRef} style={{ height: '20px', margin: '1rem 0', textAlign: 'center', opacity: 0.5, fontSize: '0.75rem' }}>
              {(activeSubTab === 'flights' ? visibleFlightsCount < flights.length : visibleAirportsCount < airports.length) ? 'Loading more...' : 'End of list'}
            </div>
          </div>
        </div>
      </div>

      <style>{`
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
          margin-top: 1rem;
          transition: all 0.2s ease;
        }
        .manage-input option {
          background: #1e293b; /* --bg-sidebar color roughly */
          color: var(--text-primary);
        }
        .manage-btn:hover {
          opacity: 0.9;
          transform: translateY(-1px);
          filter: brightness(1.1);
        }
        tr:hover {
          background: rgba(255, 255, 255, 0.02);
        }
      `}</style>
    </div>
  );
};

export default ManagePanel;
