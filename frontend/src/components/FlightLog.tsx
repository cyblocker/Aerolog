import React, { useState } from 'react';
import { Search, Clock } from 'lucide-react';
import type { Flight } from '../types';

interface Props {
  flights: Flight[];
}

const FlightLog: React.FC<Props> = ({ flights }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const getSortKey = (f: Flight) => {
    // Combine date and time for sorting. 
    // If timezone is available, we could do even better, but Date + Time (local) 
    // is sufficient for most sequential logs.
    const time = f.depTime || '00:00';
    return `${f.flightDate}T${time}`;
  };

  const filteredFlights = flights.filter(f => 
    f.flightNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.depAirportIata.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.arrAirportIata.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.airlineIata.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => getSortKey(b).localeCompare(getSortKey(a)));

  return (
    <div className="tab-content animate-fade-in">
      <div className="card flight-log-card">
        <div className="log-header">
          <h3 style={{ fontSize: '1.25rem' }}>Flight History</h3>
          <div className="search-container">
            <Search size={18} className="search-icon" />
            <input 
              type="text" 
              placeholder="Search..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        <div className="table-responsive">
          <table className="flight-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Flight</th>
                <th>Route</th>
                <th className="hide-mobile">Class</th>
                <th className="hide-mobile">Distance</th>
              </tr>
            </thead>
            <tbody>
              {filteredFlights.map(f => (
                <tr key={f.id} className="table-row-hover">
                  <td>
                    <div className="date-cell">
                      <span className="primary-text">{f.flightDate}</span>
                      <span className="secondary-text">
                        <Clock size={12} style={{ marginRight: '4px' }} />
                        {f.depTime || '--:--'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="flight-cell">
                      <span className="airline-code">{f.airlineIata}</span>
                      <span className="flight-no">{f.flightNumber}</span>
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
                  <td className="hide-mobile" style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                    {f.distanceKm ? `${f.distanceKm} km` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <style>{`
        .log-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
          gap: 1rem;
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
          padding: 1.25rem 1rem;
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
        .table-row-hover:hover {
          background: rgba(255, 255, 255, 0.02);
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
