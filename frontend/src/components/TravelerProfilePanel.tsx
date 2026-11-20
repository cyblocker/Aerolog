import React, { useState } from 'react';
import { Check, Compass, Lock, Save, ShieldCheck } from 'lucide-react';
import type { OwnerProfile } from '../types';

interface Props {
  profile: OwnerProfile | null;
  apiBase: string;
  isOfflineFallback?: boolean;
  onProfileSaved: (saved: OwnerProfile) => void;
}

const TravelerProfilePanel: React.FC<Props> = ({
  profile,
  apiBase,
  isOfflineFallback = false,
  onProfileSaved,
}) => {
  const [citizenships, setCitizenships] = useState(profile?.citizenships ?? '');
  const [residencyCountry, setResidencyCountry] = useState(profile?.residencyCountry ?? '');
  const [residencyStatus, setResidencyStatus] = useState(profile?.residencyStatus ?? '');
  const [visasAndPrograms, setVisasAndPrograms] = useState(profile?.visasAndPrograms ?? '');
  const [frequentFlyerStatuses, setFrequentFlyerStatuses] = useState(
    profile?.frequentFlyerStatuses ?? ''
  );
  const [mealPreferences, setMealPreferences] = useState(profile?.mealPreferences ?? '');
  const [homeTimezone, setHomeTimezone] = useState(profile?.homeTimezone ?? '');
  const [dailyReminderHour, setDailyReminderHour] = useState<string>(
    profile?.dailyReminderHour !== null && profile?.dailyReminderHour !== undefined
      ? String(profile.dailyReminderHour)
      : ''
  );

  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const detectTimezone = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        setHomeTimezone(tz);
        setStatusMsg(null);
      }
    } catch {
      // Ignore unsupported environments
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOfflineFallback) {
      setStatusMsg({ kind: 'err', text: 'Connect to network to save traveler profile.' });
      return;
    }

    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${apiBase}/profile`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          citizenships: citizenships.trim() || null,
          residencyCountry: residencyCountry.trim() || null,
          residencyStatus: residencyStatus.trim() || null,
          visasAndPrograms: visasAndPrograms.trim() || null,
          frequentFlyerStatuses: frequentFlyerStatuses.trim() || null,
          mealPreferences: mealPreferences.trim() || null,
          homeTimezone: homeTimezone.trim() || null,
          dailyReminderHour: dailyReminderHour === '' ? null : Number(dailyReminderHour),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setStatusMsg({ kind: 'err', text: data?.error || res.statusText || 'Failed to save.' });
        return;
      }
      onProfileSaved(data as OwnerProfile);
      setStatusMsg({
        kind: 'ok',
        text: 'Traveler profile saved privately to D1.',
      });
    } catch {
      setStatusMsg({ kind: 'err', text: 'Network error saving traveler profile.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 780 }}>
      <div
        className="card"
        style={{
          borderColor: 'rgba(16, 185, 129, 0.3)',
          background: 'rgba(16, 185, 129, 0.08)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
          padding: '1rem 1.15rem',
        }}
      >
        <ShieldCheck size={20} color="#34d399" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: '#6ee7b7', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <Lock size={13} /> Owner-Only Private Context
          </strong>
          <div>
            Saved strictly inside your private Cloudflare D1 database behind Zero Trust Passkeys.
            Never published to <code>/api/*</code>, never stored in browser offline cache, and never
            committed to GitHub. All fields below are optional.
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Citizenships / Passports (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. CN or JP, US"
              value={citizenships}
              onChange={(e) => setCitizenships(e.target.value)}
              className="manage-input"
            />
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Country of Residence (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. JP or Singapore"
              value={residencyCountry}
              onChange={(e) => setResidencyCountry(e.target.value)}
              className="manage-input"
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Residency Status (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Permanent Resident, HSP Visa"
            value={residencyStatus}
            onChange={(e) => setResidencyStatus(e.target.value)}
            className="manage-input"
          />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', opacity: 0.85 }}>
            Helps AI distinguish returning residents from tourists on border/entry requirements.
          </span>
        </div>

        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Long-Term Visas & Trusted Traveler Programs (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. APEC Business Travel Card, US B1/B2, Japan Trusted Traveler"
            value={visasAndPrograms}
            onChange={(e) => setVisasAndPrograms(e.target.value)}
            className="manage-input"
          />
        </div>

        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Frequent Flyer & Alliance Statuses (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. JAL JGC / Oneworld Sapphire, Star Alliance Gold"
            value={frequentFlyerStatuses}
            onChange={(e) => setFrequentFlyerStatuses(e.target.value)}
            className="manage-input"
          />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', opacity: 0.85 }}>
            Helps AI know when advance seats, priority check-in, or lounges already apply.
          </span>
        </div>

        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Meal / Pre-Booking Preferences (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Japanese meal preference, interested in SQ Book the Cook"
            value={mealPreferences}
            onChange={(e) => setMealPreferences(e.target.value)}
            className="manage-input"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Home Timezone (IANA, Optional)
            </label>
            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', marginTop: '0.25rem' }}>
              <input
                type="text"
                placeholder="e.g. Asia/Tokyo (defaults UTC)"
                value={homeTimezone}
                onChange={(e) => setHomeTimezone(e.target.value)}
                className="manage-input"
                style={{ marginTop: 0, flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                onClick={detectTimezone}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '0.62rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'rgba(99, 102, 241, 0.14)',
                  color: '#c7d2fe',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <Compass size={14} /> Detect
              </button>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Daily Digest Hour (Home Timezone)
            </label>
            <select
              value={dailyReminderHour}
              onChange={(e) => setDailyReminderHour(e.target.value)}
              className="manage-input"
            >
              <option value="">Default (09:00)</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={String(h)}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </div>
        </div>

        {statusMsg && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.65rem 0.85rem',
              borderRadius: '10px',
              fontSize: '0.82rem',
              background:
                statusMsg.kind === 'ok' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.14)',
              border:
                statusMsg.kind === 'ok'
                  ? '1px solid rgba(16, 185, 129, 0.35)'
                  : '1px solid rgba(244, 63, 94, 0.35)',
              color: statusMsg.kind === 'ok' ? '#6ee7b7' : '#fda4af',
            }}
          >
            {statusMsg.kind === 'ok' && <Check size={15} />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        <button
          type="submit"
          className="manage-btn"
          disabled={saving}
          style={{ opacity: saving ? 0.7 : 1 }}
        >
          <Save size={17} /> {saving ? 'Saving Profile...' : 'Save Traveler Profile'}
        </button>
      </form>
    </div>
  );
};

export default TravelerProfilePanel;
