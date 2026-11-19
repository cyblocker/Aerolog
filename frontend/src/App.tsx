import { useState, useEffect, useCallback } from 'react'
import {
  Map as MapIcon,
  BarChart3,
  Database,
  Plane,
  Settings,
  Globe,
  Navigation,
  Clock,
  Lock,
  Eye,
  Share2,
  WifiOff,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import FlightMap from './components/FlightMap'
import AnalyticsDashboard from './components/AnalyticsDashboard'
import FlightLog from './components/FlightLog'
import ManagePanel from './components/ManagePanel'
import UpcomingTrips from './components/UpcomingTrips'
import ShareItineraryModal from './components/ShareItineraryModal'
import './App.css'

import type { Flight, Airport, Stats } from './types'

type TabId = 'upcoming' | 'map' | 'stats' | 'records' | 'manage'

interface OwnerCachePayload {
  flights: Flight[]
  airports: Airport[]
  stats: Stats | null
  syncedAt: string
}

const OWNER_CACHE_KEY = 'aerolog_owner_cache_v1'

function App() {
  const isOwnerRoute = window.location.pathname.startsWith('/admin')

  const [previewPublic, setPreviewPublic] = useState(false)
  const isOwnerMode = isOwnerRoute && !previewPublic

  const [activeTab, setActiveTab] = useState<TabId>(isOwnerRoute ? 'upcoming' : 'map')
  const [flights, setFlights] = useState<Flight[]>([])
  const [airports, setAirports] = useState<Airport[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [authRequired, setAuthRequired] = useState(false)
  const [isOfflineFallback, setIsOfflineFallback] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [shareModalFlightIds, setShareModalFlightIds] = useState<number[] | null>(null)

  const API_BASE = import.meta.env.DEV
    ? 'http://localhost:8787/api'
    : (import.meta.env.VITE_API_BASE || '/api')
  const ADMIN_API_BASE = API_BASE.replace(/\/api$/, '/admin/api')

  const loadData = useCallback(async (ownerMode: boolean) => {
    const base = ownerMode ? ADMIN_API_BASE : API_BASE
    const fetchOpts: RequestInit = ownerMode ? { credentials: 'include' } : {}

    try {
      const [flightsRes, airportsRes, statsRes] = await Promise.all([
        fetch(`${base}/flights`, fetchOpts),
        fetch(`${base}/airports`, fetchOpts),
        fetch(`${base}/stats`, fetchOpts),
      ])

      if (
        ownerMode &&
        (flightsRes.status === 401 ||
          flightsRes.status === 403 ||
          airportsRes.status === 401 ||
          airportsRes.status === 403)
      ) {
        setAuthRequired(true)
        setLoading(false)
        return
      }

      if (!flightsRes.ok || !airportsRes.ok || !statsRes.ok) {
        throw new Error('Failed to load AeroLog data')
      }

      const [flightData, airportData, statsData] = await Promise.all([
        flightsRes.json(),
        airportsRes.json(),
        statsRes.json(),
      ])

      setAuthRequired(false)
      setFlights(flightData)
      setAirports(airportData)
      setStats(statsData)
      setIsOfflineFallback(false)

      if (ownerMode) {
        const syncedAt = new Date().toISOString()
        setLastSyncedAt(syncedAt)
        try {
          const payload: OwnerCachePayload = {
            flights: flightData,
            airports: airportData,
            stats: statsData,
            syncedAt,
          }
          localStorage.setItem(OWNER_CACHE_KEY, JSON.stringify(payload))
        } catch {
          // Ignore storage quota errors
        }
      }
    } catch (err) {
      console.error('Failed to fetch data:', err)
      if (ownerMode) {
        try {
          const raw = localStorage.getItem(OWNER_CACHE_KEY)
          if (raw) {
            const cached = JSON.parse(raw) as OwnerCachePayload
            setFlights(cached.flights || [])
            setAirports(cached.airports || [])
            setStats(cached.stats || null)
            setLastSyncedAt(cached.syncedAt || null)
            setIsOfflineFallback(true)
          }
        } catch {
          // Ignore malformed cache
        }
      }
    } finally {
      setLoading(false)
    }
  }, [API_BASE, ADMIN_API_BASE])

  const fetchData = useCallback(() => {
    void loadData(isOwnerMode)
  }, [loadData, isOwnerMode])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData(isOwnerMode)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData, isOwnerMode])

  const setPreviewMode = (nextPreview: boolean) => {
    setPreviewPublic(nextPreview)
    setLoading(true)
    if (nextPreview && (activeTab === 'upcoming' || activeTab === 'manage')) {
      setActiveTab('map')
    }
  }

  const upcomingCount = stats?.upcomingFlights ?? 0

  const navItems: { id: TabId; label: string; icon: typeof MapIcon; badge?: number }[] = isOwnerMode
    ? [
        { id: 'upcoming', label: 'Upcoming', icon: Clock, badge: upcomingCount > 0 ? upcomingCount : undefined },
        { id: 'map', label: 'Route Map', icon: MapIcon },
        { id: 'stats', label: 'Statistics', icon: BarChart3 },
        { id: 'records', label: 'Flight Log', icon: Database },
        { id: 'manage', label: 'Manage', icon: Settings },
      ]
    : [
        { id: 'map', label: 'Route Map', icon: MapIcon },
        { id: 'stats', label: 'Statistics', icon: BarChart3 },
        { id: 'records', label: 'Flight Log', icon: Database },
      ]

  const clearOfflineCache = () => {
    try {
      localStorage.removeItem(OWNER_CACHE_KEY)
    } catch {
      // Ignore
    }
    setLastSyncedAt(null)
  }

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

  if (isOwnerMode && authRequired) {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <div className="card" style={{ maxWidth: 440, width: '100%', textAlign: 'center', padding: '2.25rem' }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: '14px',
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}
          >
            <Lock size={26} color="#818cf8" />
          </div>
          <h2 style={{ fontSize: '1.35rem', marginBottom: '0.5rem' }}>Owner Access Required</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
            Sign in through Cloudflare Zero Trust (Passkey) to view upcoming flights, PNRs, private
            trips, and itinerary sharing.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '0.65rem 1.25rem',
                borderRadius: '10px',
                border: 'none',
                background: 'var(--accent-primary)',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign in with Zero Trust
            </button>
            <a
              href="/"
              style={{
                padding: '0.65rem 1.1rem',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
              }}
            >
              Public View
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <Plane size={24} color="#6366f1" />
          <h1>AeroLog</h1>
          {isOwnerRoute && (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '0.18rem 0.5rem',
                borderRadius: '999px',
                background: previewPublic ? 'rgba(245, 158, 11, 0.15)' : 'rgba(99, 102, 241, 0.18)',
                border: previewPublic ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(99, 102, 241, 0.35)',
                color: previewPublic ? '#fcd34d' : '#a5b4fc',
              }}
            >
              {previewPublic ? 'PREVIEW' : 'OWNER'}
            </span>
          )}
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
              {item.badge !== undefined && (
                <span className="nav-badge">{item.badge}</span>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {isOwnerRoute ? (
            <>
              <a href="/" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                Public Showcase ↗
              </a>
              {lastSyncedAt && (
                <button
                  type="button"
                  onClick={clearOfflineCache}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    textAlign: 'left',
                    color: 'var(--text-secondary)',
                    fontSize: '0.7rem',
                    cursor: 'pointer',
                    opacity: 0.75,
                  }}
                >
                  Clear offline cache
                </button>
              )}
            </>
          ) : (
            <a
              href="/admin"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                color: 'var(--text-secondary)',
                fontSize: '0.75rem',
              }}
            >
              <Lock size={12} /> Owner Sign In
            </a>
          )}
          <span>By cyblocker.com</span>
        </div>
      </aside>

      <main className="main-content">
        <div className="content-wrapper">
          {isOwnerRoute && previewPublic && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                flexWrap: 'wrap',
                marginBottom: '1rem',
                padding: '0.65rem 1rem',
                borderRadius: '12px',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#fcd34d',
                fontSize: '0.82rem',
              }}
            >
              <span>
                Previewing Public Site — upcoming trips, private flights, and 3–7 day delayed records
                are hidden.
              </span>
              <button
                type="button"
                onClick={() => setPreviewMode(false)}
                style={{
                  border: '1px solid rgba(245, 158, 11, 0.45)',
                  background: 'rgba(245, 158, 11, 0.18)',
                  color: '#fef3c7',
                  borderRadius: '8px',
                  padding: '0.32rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Exit Public Preview
              </button>
            </div>
          )}

          {isOwnerMode && isOfflineFallback && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                flexWrap: 'wrap',
                marginBottom: '1rem',
                padding: '0.65rem 1rem',
                borderRadius: '12px',
                background: 'rgba(6, 182, 212, 0.12)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                color: '#67e8f9',
                fontSize: '0.82rem',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                <WifiOff size={15} />
                Offline Mode — showing cached flights
                {lastSyncedAt ? ` (synced ${new Date(lastSyncedAt).toLocaleString()})` : ''}
              </span>
              <button
                type="button"
                onClick={fetchData}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  border: '1px solid rgba(6, 182, 212, 0.45)',
                  background: 'rgba(6, 182, 212, 0.18)',
                  color: '#ecfeff',
                  borderRadius: '8px',
                  padding: '0.32rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={13} /> Retry Sync
              </button>
            </div>
          )}

          <header
            style={{
              marginBottom: '1.75rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h2 style={{ fontSize: '1.5rem' }}>
                {navItems.find((n) => n.id === activeTab)?.label}
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Displaying {flights.length} {isOwnerMode ? 'personal' : 'public'} flight records
              </p>
            </div>

            <div
              className="header-right-group"
              style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}
            >
              {stats && (
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Globe size={16} color="var(--accent-secondary)" />
                    <span style={{ fontSize: '0.875rem' }}>
                      <b>{stats.countriesVisited}</b> Countries
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Navigation size={16} color="var(--accent-primary)" />
                    <span style={{ fontSize: '0.875rem' }}>
                      <b>{(stats.totalDistanceKm / 1000).toFixed(1)}k</b> km Flown
                    </span>
                  </div>
                </div>
              )}

              {isOwnerRoute ? (
                <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                  {isOwnerMode && (
                    <button
                      type="button"
                      onClick={() => setShareModalFlightIds([])}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.48rem 0.85rem',
                        borderRadius: '10px',
                        border: '1px solid rgba(99, 102, 241, 0.45)',
                        background: 'rgba(99, 102, 241, 0.2)',
                        color: '#e0e7ff',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Share2 size={14} /> Share Trip
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPreviewMode(!previewPublic)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.48rem 0.8rem',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      background: previewPublic
                        ? 'rgba(245, 158, 11, 0.16)'
                        : 'rgba(255, 255, 255, 0.05)',
                      color: previewPublic ? '#fcd34d' : 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Eye size={14} /> {previewPublic ? 'Owner View' : 'Preview Public'}
                  </button>
                  <a
                    href="/"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.38rem',
                      padding: '0.48rem 0.8rem',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      background: 'rgba(255, 255, 255, 0.04)',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    <ExternalLink size={13} /> Public Showcase
                  </a>
                </div>
              ) : (
                <a
                  href="/admin"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.42rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  <Lock size={13} /> Owner
                </a>
              )}
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={`${activeTab}-${isOwnerMode ? 'owner' : 'public'}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
            >
              {activeTab === 'upcoming' && isOwnerMode && (
                <UpcomingTrips
                  flights={flights}
                  airports={airports}
                  onShareFlights={(ids) => setShareModalFlightIds(ids)}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                />
              )}
              {activeTab === 'map' && (
                <FlightMap flights={flights} airports={airports} isOwnerMode={isOwnerMode} />
              )}
              {activeTab === 'stats' && <AnalyticsDashboard flights={flights} />}
              {activeTab === 'records' && (
                <FlightLog
                  flights={flights}
                  airports={airports}
                  isOwnerMode={isOwnerMode}
                  onShareFlights={(ids) => setShareModalFlightIds(ids)}
                />
              )}
              {activeTab === 'manage' && isOwnerMode && (
                <ManagePanel
                  flights={flights}
                  airports={airports}
                  onDataChange={fetchData}
                  apiBase={ADMIN_API_BASE}
                  onShareFlight={(ids) => setShareModalFlightIds(ids)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {isOwnerMode && shareModalFlightIds !== null && (
        <ShareItineraryModal
          availableFlights={flights}
          initialSelectedIds={shareModalFlightIds}
          airports={airports}
          onClose={() => setShareModalFlightIds(null)}
        />
      )}

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
