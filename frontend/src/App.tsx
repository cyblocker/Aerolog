import { useState, useEffect } from 'react'
import { Map as MapIcon, BarChart3, Database, Plane, Settings, Globe, Navigation } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import FlightMap from './components/FlightMap'
import AnalyticsDashboard from './components/AnalyticsDashboard'
import FlightLog from './components/FlightLog'
import ManagePanel from './components/ManagePanel'
import './App.css'

import type { Flight, Airport, Stats } from './types'

function App() {
  const [activeTab, setActiveTab ] = useState('map')
  const [flights, setFlights] = useState<Flight[]>([])
  const [airports, setAirports] = useState<Airport[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const API_BASE = import.meta.env.DEV 
    ? 'http://localhost:8787/api' 
    : (import.meta.env.VITE_API_BASE || '/api');
  const fetchData = async () => {
    try {
      const [flightsRes, airportsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/flights`),
        fetch(`${API_BASE}/airports`),
        fetch(`${API_BASE}/stats`),
      ]);

      const flightData = await flightsRes.json();
      const airportData = await airportsRes.json();
      const statsData = await statsRes.json();

      setFlights(flightData);
      setAirports(airportData);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const isAdminPage = window.location.pathname.startsWith('/admin');

  const navItems = [
    { id: 'map', label: 'Route Map', icon: MapIcon },
    { id: 'stats', label: 'Statistics', icon: BarChart3 },
    { id: 'records', label: 'Flight Log', icon: Database },
  ]

  if (loading) {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Plane className="animate-spin" size={48} color="#6366f1" style={{ marginBottom: '1rem' }} />
          <h2 style={{ color: 'var(--text-secondary)' }}>Loading Flight Records...</h2>
        </div>
      </div>
    )
  }

  if (isAdminPage) {
    return (
      <div className="app-container">
        <main className="main-content" style={{ width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
          <div className="content-wrapper">
            <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Settings size={24} color="var(--accent-primary)" />
                  Admin Dashboard
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  Managing {flights.length} personal flight records
                </p>
              </div>
              <a href="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>← Back to map</a>
            </header>
            <ManagePanel 
              flights={flights} 
              airports={airports} 
              onDataChange={fetchData} 
              apiBase={API_BASE.replace('/api', '/admin/api')} 
            />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Plane size={24} color="#6366f1" />
          <h1>AeroLog</h1>
        </div>

        <nav className="nav-links">
          {navItems.map((item) => (
            <div
              key={item.id}
              className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer" style={{ marginTop: 'auto', padding: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
          By cyblocker.com
        </div>
      </aside>

      <main className="main-content">
        <div className="content-wrapper">
          <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem' }}>
                {navItems.find(n => n.id === activeTab)?.label}
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Displaying {flights.length} personal flight records
              </p>
            </div>
            
            {stats && (
              <div style={{ display: 'flex', gap: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Globe size={16} color="var(--accent-secondary)" />
                  <span style={{ fontSize: '0.875rem' }}><b>{stats.countriesVisited}</b> Countries</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Navigation size={16} color="var(--accent-primary)" />
                  <span style={{ fontSize: '0.875rem' }}><b>{(stats.totalDistanceKm / 1000).toFixed(1)}k</b> km Flown</span>
                </div>
              </div>
            )}
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
            >
              {activeTab === 'map' && <FlightMap flights={flights} airports={airports} />}
              {activeTab === 'stats' && <AnalyticsDashboard flights={flights} />}
              {activeTab === 'records' && <FlightLog flights={flights} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: spin 2s linear infinite;
        }
      `}</style>
    </div>
  )
}

export default App
