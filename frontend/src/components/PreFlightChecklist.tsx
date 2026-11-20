import React, { useMemo, useState } from 'react';
import {
  Bell,
  Calendar,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  ExternalLink,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AnalysisStatus,
  Flight,
  FlightReminder,
  OwnerProfile,
  ReminderCategory,
  ReminderGranularity,
} from '../types';
import {
  buildGoogleCalendarUrl,
  downloadReminderIcs,
  formatLocalDateTime,
  getLocalYmdInTz,
  sanitizeHttpsUrl,
} from '../utils/calendar';
import { formatDisplayDate, formatFlightRef } from '../utils/flightFormat';

interface Props {
  reminders: FlightReminder[];
  flights: Flight[];
  profile: OwnerProfile | null;
  analysisStatus: AnalysisStatus | null;
  apiBase: string;
  isOfflineFallback?: boolean;
  filterFlightId?: number;
  variant?: 'compact' | 'full';
  compactHeader?: string;
  nowMs?: number;
  onRemindersChange: () => void;
  onAnalysisStatusChange: (status: AnalysisStatus) => void;
}

const CATEGORY_META: Record<
  ReminderCategory,
  { label: string; bg: string; border: string; color: string }
> = {
  seat: {
    label: 'Seat',
    bg: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.35)',
    color: '#fcd34d',
  },
  checkin: {
    label: 'Check-In',
    bg: 'rgba(6, 182, 212, 0.16)',
    border: 'rgba(6, 182, 212, 0.4)',
    color: '#67e8f9',
  },
  meal: {
    label: 'Meal',
    bg: 'rgba(236, 72, 153, 0.14)',
    border: 'rgba(236, 72, 153, 0.35)',
    color: '#f9a8d4',
  },
  border: {
    label: 'Border',
    bg: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.35)',
    color: '#6ee7b7',
  },
  departure: {
    label: 'Departure',
    bg: 'rgba(99, 102, 241, 0.14)',
    border: 'rgba(99, 102, 241, 0.35)',
    color: '#a5b4fc',
  },
  custom: {
    label: 'Custom',
    bg: 'rgba(148, 163, 184, 0.14)',
    border: 'rgba(148, 163, 184, 0.35)',
    color: '#cbd5e1',
  },
};

function toLocalTimeInput(isoUtc: string, timeZone: string): { date: string; time: string } {
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) {
    return { date: getLocalYmdInTz(Date.now(), timeZone), time: '09:00' };
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(new Date(ms));
    const lookup: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') lookup[p.type] = p.value;
    }
    return {
      date: `${lookup.year}-${lookup.month}-${lookup.day}`,
      time: `${lookup.hour}:${lookup.minute}`,
    };
  } catch {
    return {
      date: new Date(ms).toISOString().slice(0, 10),
      time: new Date(ms).toISOString().slice(11, 16),
    };
  }
}

const PreFlightChecklist: React.FC<Props> = ({
  reminders,
  flights,
  profile,
  analysisStatus,
  apiBase,
  isOfflineFallback = false,
  filterFlightId,
  variant = 'full',
  compactHeader,
  nowMs,
  onRemindersChange,
  onAnalysisStatusChange,
}) => {
  const [fallbackNow] = useState(() => Date.now());
  const effectiveNowMs = nowMs ?? fallbackNow;
  const homeTz = profile?.homeTimezone || 'UTC';
  const todayLocal = getLocalYmdInTz(effectiveNowMs, homeTz);

  const [categoryFilter, setCategoryFilter] = useState<'all' | ReminderCategory>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<FlightReminder | null>(null);

  const [formFlightId, setFormFlightId] = useState<string>(
    filterFlightId !== undefined ? String(filterFlightId) : ''
  );
  const [formCategory, setFormCategory] = useState<ReminderCategory>('custom');
  const [formTitle, setFormTitle] = useState('');
  const [formDetails, setFormDetails] = useState('');
  const [formActionUrl, setFormActionUrl] = useState('');
  const [formGranularity, setFormGranularity] = useState<ReminderGranularity>('day');
  const [formDate, setFormDate] = useState(todayLocal);
  const [formTime, setFormTime] = useState('09:00');

  const [busyId, setBusyId] = useState<number | null>(null);
  const [submittingAi, setSubmittingAi] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const isGlobalAnalyzing =
    filterFlightId === undefined && Boolean(analysisStatus?.isActive);
  const isFlightAnalyzing =
    filterFlightId !== undefined &&
    Boolean(analysisStatus?.activeFlightIds.includes(filterFlightId));
  const aiBusy = submittingAi || isGlobalAnalyzing || isFlightAnalyzing;

  const upcomingFlights = useMemo(
    () =>
      flights
        .filter((f) => f.flightDate >= todayLocal)
        .sort((a, b) => a.flightDate.localeCompare(b.flightDate) || a.id - b.id),
    [flights, todayLocal]
  );

  const scopedReminders = useMemo(() => {
    return reminders.filter((r) => {
      if (r.category === 'departure') return false;
      if (filterFlightId !== undefined) return r.flightId === filterFlightId;
      if (r.flight && r.flight.flightDate < todayLocal) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      return true;
    });
  }, [reminders, filterFlightId, todayLocal, categoryFilter]);

  const { actionNow, upcoming, upcomingByFlight, closed } = useMemo(() => {
    const nowList: FlightReminder[] = [];
    const laterList: FlightReminder[] = [];
    const doneList: FlightReminder[] = [];

    for (const r of scopedReminders) {
      if (r.status === 'done' || r.status === 'dismissed') {
        doneList.push(r);
        continue;
      }
      const remindMs = Date.parse(r.remindAtUtc);
      const localYmd = Number.isNaN(remindMs) ? todayLocal : getLocalYmdInTz(remindMs, homeTz);
      if (remindMs <= effectiveNowMs || localYmd <= todayLocal) {
        nowList.push(r);
      } else {
        laterList.push(r);
      }
    }

    const groups = new Map<
      string,
      { key: string; sortDate: string; header: string; items: FlightReminder[] }
    >();
    for (const item of laterList) {
      const f = item.flight;
      const key = f ? `f:${f.id}` : 'general';
      if (!groups.has(key)) {
        const header = f
          ? `${formatFlightRef(f.airlineIata, f.flightNumber)} · ${f.depAirportIata}→${f.arrAirportIata} · ${formatDisplayDate(f.flightDate)}`
          : 'General Travel Tasks';
        groups.set(key, {
          key,
          sortDate: f ? f.flightDate : '9999-12-31',
          header,
          items: [],
        });
      }
      groups.get(key)!.items.push(item);
    }

    const groupedList = Array.from(groups.values()).sort(
      (a, b) => a.sortDate.localeCompare(b.sortDate) || a.key.localeCompare(b.key)
    );

    return {
      actionNow: nowList,
      upcoming: laterList,
      upcomingByFlight: groupedList,
      closed: doneList,
    };
  }, [scopedReminders, effectiveNowMs, homeTz, todayLocal]);

  const pendingCount = actionNow.length + upcoming.length;

  const openAddForm = () => {
    setEditingReminder(null);
    setFormFlightId(
      filterFlightId !== undefined
        ? String(filterFlightId)
        : upcomingFlights[0]?.id
          ? String(upcomingFlights[0].id)
          : ''
    );
    setFormCategory('custom');
    setFormTitle('');
    setFormDetails('');
    setFormActionUrl('');
    setFormGranularity('day');
    setFormDate(todayLocal);
    setFormTime('09:00');
    setFeedback(null);
    setFormOpen(true);
  };

  const openEditForm = (rem: FlightReminder) => {
    setEditingReminder(rem);
    setFormFlightId(rem.flightId ? String(rem.flightId) : '');
    setFormCategory(rem.category);
    setFormTitle(rem.title);
    setFormDetails(rem.details || '');
    setFormActionUrl(rem.actionUrl || '');
    setFormGranularity(rem.granularity);
    const localParts = toLocalTimeInput(
      rem.granularity === 'exact' ? rem.eventAtUtc || rem.remindAtUtc : rem.remindAtUtc,
      homeTz
    );
    setFormDate(localParts.date);
    setFormTime(localParts.time);
    setFeedback(null);
    setFormOpen(true);
  };

  const updateReminderStatus = async (
    rem: FlightReminder,
    status: 'pending' | 'done' | 'dismissed'
  ) => {
    if (isOfflineFallback) {
      setFeedback({ kind: 'err', text: 'Offline mode: reconnect to update reminders.' });
      return;
    }
    setBusyId(rem.id);
    setFeedback(null);
    try {
      const res = await fetch(`${apiBase}/reminders/${rem.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        setFeedback({ kind: 'err', text: err?.error || 'Failed to update status.' });
        return;
      }
      if (expandedId === rem.id && status !== 'pending') {
        setExpandedId(null);
      }
      onRemindersChange();
    } catch {
      setFeedback({ kind: 'err', text: 'Network error updating reminder.' });
    } finally {
      setBusyId(null);
    }
  };

  const convertSeatToCheckin = async (rem: FlightReminder) => {
    if (isOfflineFallback) {
      setFeedback({ kind: 'err', text: 'Offline mode: reconnect to update reminders.' });
      return;
    }
    setBusyId(rem.id);
    setFeedback(null);
    try {
      const res = await fetch(`${apiBase}/reminders/${rem.id}/convert-to-checkin`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({ kind: 'err', text: data?.error || 'Failed to switch reminder.' });
        return;
      }
      setExpandedId(null);
      setFeedback({
        kind: 'ok',
        text: data?.created
          ? 'Switched to online check-in reminder (30–60m pre-open alert).'
          : 'Dismissed seat task — check-in reminder is already scheduled.',
      });
      onRemindersChange();
    } catch {
      setFeedback({ kind: 'err', text: 'Network error updating reminder.' });
    } finally {
      setBusyId(null);
    }
  };

  const deleteReminder = async (rem: FlightReminder) => {
    if (isOfflineFallback) {
      setFeedback({ kind: 'err', text: 'Offline mode: reconnect to delete reminders.' });
      return;
    }
    if (!confirm(`Delete reminder "${rem.title}"?`)) return;
    setBusyId(rem.id);
    setFeedback(null);
    try {
      const res = await fetch(`${apiBase}/reminders/${rem.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        setFeedback({ kind: 'err', text: 'Failed to delete reminder.' });
        return;
      }
      onRemindersChange();
    } catch {
      setFeedback({ kind: 'err', text: 'Network error deleting reminder.' });
    } finally {
      setBusyId(null);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOfflineFallback) {
      setFeedback({ kind: 'err', text: 'Offline mode: reconnect to save reminder.' });
      return;
    }
    if (!formTitle.trim()) {
      setFeedback({ kind: 'err', text: 'Reminder title is required.' });
      return;
    }

    setFormSaving(true);
    setFeedback(null);
    try {
      const payload: Record<string, unknown> = {
        flightId: formFlightId ? Number(formFlightId) : null,
        category: formCategory,
        title: formTitle.trim(),
        details: formDetails.trim() || null,
        actionUrl: formActionUrl.trim() || null,
        granularity: formGranularity,
      };

      if (formGranularity === 'exact') {
        payload.eventDate = formDate;
        payload.eventTime = formTime || '09:00';
        payload.eventTimezone = homeTz;
      } else {
        payload.remindDate = formDate;
      }

      const url = editingReminder
        ? `${apiBase}/reminders/${editingReminder.id}`
        : `${apiBase}/reminders`;
      const method = editingReminder ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({ kind: 'err', text: data?.error || res.statusText || 'Failed to save.' });
        return;
      }

      setFormOpen(false);
      setEditingReminder(null);
      setFeedback({
        kind: 'ok',
        text: editingReminder ? 'Reminder updated.' : 'Custom reminder added.',
      });
      onRemindersChange();
    } catch {
      setFeedback({ kind: 'err', text: 'Network error saving reminder.' });
    } finally {
      setFormSaving(false);
    }
  };

  const handleGenerateAi = async () => {
    if (isOfflineFallback) {
      setFeedback({ kind: 'err', text: 'Offline mode: reconnect to analyze trips with AI.' });
      return;
    }
    if (aiBusy) return;
    setSubmittingAi(true);
    setFeedback(null);
    try {
      const endpoint =
        filterFlightId !== undefined
          ? `${apiBase}/flights/${filterFlightId}/reminders/generate`
          : `${apiBase}/reminders/generate-all`;
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({ kind: 'err', text: data?.error || 'AI analysis failed.' });
        return;
      }
      if (data?.status) {
        onAnalysisStatusChange(data.status as AnalysisStatus);
      }
      if (data?.alreadyRunning) {
        setFeedback({
          kind: 'ok',
          text: 'Analysis is already running in the background — safe to switch tabs or leave this page.',
        });
      } else if ((data?.enqueuedCount ?? 0) > 0) {
        setFeedback({
          kind: 'ok',
          text:
            filterFlightId !== undefined
              ? 'Refreshing AI suggestions in background — safe to leave this page.'
              : `Queued ${data.enqueuedCount} flight(s) for background analysis — safe to switch tabs or leave this page.`,
        });
      } else {
        setFeedback({
          kind: 'ok',
          text: 'All upcoming flights are already analyzed.',
        });
      }
      onRemindersChange();
    } catch {
      setFeedback({ kind: 'err', text: 'Network error queueing AI analyzer.' });
    } finally {
      setSubmittingAi(false);
    }
  };

  const renderTaskRow = (
    rem: FlightReminder,
    options: { isActionNow: boolean; showFlightTag: boolean }
  ) => {
    const meta = CATEGORY_META[rem.category] || CATEGORY_META.custom;
    const isClosed = rem.status === 'done' || rem.status === 'dismissed';
    const isBusy = busyId === rem.id;
    const isExpanded = expandedId === rem.id;
    const safeUrl = sanitizeHttpsUrl(rem.actionUrl);
    const gcalUrl = buildGoogleCalendarUrl(rem, homeTz);
    const flightRef = rem.flight
      ? formatFlightRef(rem.flight.airlineIata, rem.flight.flightNumber)
      : null;

    const whenLabel =
      rem.granularity === 'exact'
        ? `Opens ${formatLocalDateTime(rem.eventAtUtc || rem.remindAtUtc, homeTz)} · 30–60m prior alert`
        : `${options.isActionNow && !isClosed ? 'Due now · ' : 'Remind '}${getLocalYmdInTz(Date.parse(rem.remindAtUtc) || effectiveNowMs, homeTz)}`;

    return (
      <div
        key={rem.id}
        className={`chk-row ${isClosed ? 'closed' : ''} ${options.isActionNow && !isClosed ? 'urgent' : ''} ${variant === 'compact' ? 'compact' : ''}`}
      >
        <div className="chk-main">
          <button
            type="button"
            className={`chk-circle ${rem.status === 'done' ? 'done' : ''}`}
            disabled={isBusy}
            onClick={() => updateReminderStatus(rem, isClosed ? 'pending' : 'done')}
            aria-label={isClosed ? 'Reopen task' : 'Mark task done'}
            title={isClosed ? 'Tap to reopen' : 'Tap to mark Done'}
          >
            {rem.status === 'done' ? <Check size={14} /> : null}
          </button>

          <button
            type="button"
            className="chk-summary-btn"
            onClick={() => setExpandedId(isExpanded ? null : rem.id)}
          >
            <div className="chk-badges-line">
              <span
                className="chk-cat-tag"
                style={{
                  background: meta.bg,
                  border: `1px solid ${meta.border}`,
                  color: meta.color,
                }}
              >
                {meta.label}
              </span>
              {options.showFlightTag && rem.flight && flightRef && (
                <span className="chk-flight-tag">
                  {flightRef} · {rem.flight.depAirportIata}→{rem.flight.arrAirportIata}
                </span>
              )}
              {rem.status !== 'pending' && (
                <span className="chk-status-tag">
                  {rem.status === 'done' ? 'Done' : 'Dismissed'}
                </span>
              )}
            </div>

            <div className="chk-title">{rem.title}</div>

            <div className="chk-when">
              <Bell size={11} style={{ flexShrink: 0 }} />
              <span>{whenLabel}</span>
            </div>
          </button>

          <div className="chk-right-tools">
            {(rem.granularity === 'exact' || rem.category === 'checkin') && (
              <a
                href={gcalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="chk-icon-btn gcal"
                title="Add to Google Calendar"
                aria-label="Add to Google Calendar"
              >
                <CalendarPlus size={14} />
              </a>
            )}
            <button
              type="button"
              className="chk-icon-btn"
              onClick={() => setExpandedId(isExpanded ? null : rem.id)}
              aria-label={isExpanded ? 'Collapse task details' : 'Expand task details'}
            >
              {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="chk-drawer">
            {rem.details && <div className="chk-details">{rem.details}</div>}

            <div className="chk-actions">
              {rem.category === 'seat' && rem.status === 'pending' && rem.flightId && (
                <button
                  type="button"
                  className="chk-btn checkin-switch"
                  disabled={isBusy}
                  onClick={() => convertSeatToCheckin(rem)}
                >
                  <Clock size={13} /> Seat at Check-In
                </button>
              )}

              <a
                href={gcalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="chk-btn gcal"
              >
                <CalendarPlus size={13} /> Google Cal
              </a>

              <button
                type="button"
                className="chk-btn"
                onClick={() => downloadReminderIcs(rem, homeTz)}
              >
                <Calendar size={13} /> .ics
              </button>

              {safeUrl && (
                <a
                  href={safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chk-btn link"
                >
                  <ExternalLink size={13} /> Portal
                </a>
              )}

              {!isClosed ? (
                <button
                  type="button"
                  className="chk-btn"
                  disabled={isBusy}
                  onClick={() => updateReminderStatus(rem, 'dismissed')}
                >
                  <X size={13} /> Dismiss
                </button>
              ) : (
                <button
                  type="button"
                  className="chk-btn"
                  disabled={isBusy}
                  onClick={() => updateReminderStatus(rem, 'pending')}
                >
                  Reopen
                </button>
              )}

              <button
                type="button"
                className="chk-btn"
                disabled={isBusy}
                onClick={() => openEditForm(rem)}
                title="Edit reminder"
              >
                <Edit3 size={13} /> Edit
              </button>

              <button
                type="button"
                className="chk-btn danger"
                disabled={isBusy}
                onClick={() => deleteReminder(rem)}
                title="Delete reminder"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const aiLabel = isGlobalAnalyzing
    ? `Analyzing (${(analysisStatus?.completed ?? 0) + (analysisStatus?.failed ?? 0)}/${analysisStatus?.totalUpcoming ?? 0})...`
    : isFlightAnalyzing || submittingAi
      ? 'Analyzing...'
      : filterFlightId !== undefined
        ? 'Refresh AI'
        : 'Analyze Upcoming';

  return (
    <div className="checklist-root">
      <div className="checklist-header">
        <div>
          <h4 style={{ fontSize: variant === 'compact' ? '0.9rem' : '1.05rem', fontWeight: 700 }}>
            {compactHeader || `Pre-Flight Checklist (${pendingCount} pending)`}
          </h4>
          {variant === 'full' && (
            <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.12rem' }}>
              Tap circle to finish early, or tap a task row for Seat-at-Check-In & Calendar options.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="upcoming-secondary-btn"
            onClick={handleGenerateAi}
            disabled={aiBusy}
            style={{ opacity: aiBusy ? 0.72 : 1, cursor: aiBusy ? 'not-allowed' : 'pointer' }}
          >
            {aiBusy ? (
              <Loader2 size={13} className="animate-spin" color="#a5b4fc" />
            ) : (
              <Sparkles size={13} color="#a5b4fc" />
            )}
            {aiLabel}
          </button>
          <button
            type="button"
            className="upcoming-share-btn"
            style={{ padding: '0.42rem 0.72rem', fontSize: '0.76rem' }}
            onClick={() => (formOpen ? setFormOpen(false) : openAddForm())}
          >
            <Plus size={14} /> Add Task
          </button>
        </div>
      </div>

      {variant === 'full' && (
        <div className="chk-filter-row">
          {(
            [
              ['all', 'All'],
              ['checkin', 'Check-In'],
              ['seat', 'Seat'],
              ['meal', 'Meal'],
              ['border', 'Border'],
              ['custom', 'Custom'],
            ] as Array<['all' | ReminderCategory, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chk-filter-pill ${categoryFilter === id ? 'active' : ''}`}
              onClick={() => setCategoryFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {feedback && (
        <div
          style={{
            padding: '0.52rem 0.78rem',
            borderRadius: '10px',
            fontSize: '0.78rem',
            background:
              feedback.kind === 'ok' ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.14)',
            border:
              feedback.kind === 'ok'
                ? '1px solid rgba(16, 185, 129, 0.35)'
                : '1px solid rgba(244, 63, 94, 0.35)',
            color: feedback.kind === 'ok' ? '#6ee7b7' : '#fda4af',
          }}
        >
          {feedback.text}
        </div>
      )}

      {formOpen && (
        <form onSubmit={handleFormSubmit} className="checklist-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.86rem' }}>
              {editingReminder ? 'Edit Reminder' : 'Add Custom Pre-Flight Reminder'}
            </strong>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setEditingReminder(null);
              }}
              className="chk-btn"
            >
              <X size={13} /> Cancel
            </button>
          </div>

          <div className="checklist-form-grid">
            {filterFlightId === undefined && !editingReminder && (
              <div>
                <label className="chk-label">Linked Flight (Optional)</label>
                <select
                  value={formFlightId}
                  onChange={(e) => setFormFlightId(e.target.value)}
                  className="manage-input"
                >
                  <option value="">General / Unlinked</option>
                  {upcomingFlights.map((f) => (
                    <option key={f.id} value={String(f.id)}>
                      {formatFlightRef(f.airlineIata, f.flightNumber)} · {f.depAirportIata}→{f.arrAirportIata} ({f.flightDate})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="chk-label">Category</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value as ReminderCategory)}
                className="manage-input"
              >
                <option value="custom">Custom Task</option>
                <option value="seat">Seat Selection</option>
                <option value="checkin">Online Check-In</option>
                <option value="meal">Meal / Service Pre-Order</option>
                <option value="border">Border / Arrival Card / Visa</option>
              </select>
            </div>
          </div>

          <div>
            <label className="chk-label">Title *</label>
            <input
              type="text"
              placeholder="e.g. Pre-select SWISS meal or Check in on ANA"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="manage-input"
              required
            />
          </div>

          <div>
            <label className="chk-label">Notes / Details (Optional)</label>
            <textarea
              rows={2}
              placeholder="Any details, fare rule, or portal instructions..."
              value={formDetails}
              onChange={(e) => setFormDetails(e.target.value)}
              className="manage-input"
              style={{ resize: 'vertical' }}
            />
          </div>

          <div className="checklist-form-grid">
            <div>
              <label className="chk-label">Reminder Timing Mode</label>
              <select
                value={formGranularity}
                onChange={(e) => setFormGranularity(e.target.value as ReminderGranularity)}
                className="manage-input"
              >
                <option value="day">Day-level (Daily Telegram Digest)</option>
                <option value="exact">Exact Window Open Time (30–60m prior alert)</option>
              </select>
            </div>

            <div>
              <label className="chk-label">
                {formGranularity === 'exact' ? `Window Opens Date (${homeTz})` : 'Remind Date'}
              </label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="manage-input"
                required
              />
            </div>

            {formGranularity === 'exact' && (
              <div>
                <label className="chk-label">Window Opens Time ({homeTz})</label>
                <input
                  type="time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  className="manage-input"
                  required
                />
              </div>
            )}
          </div>

          {formGranularity === 'exact' && (
            <div style={{ fontSize: '0.73rem', color: '#67e8f9' }}>
              Telegram alert will fire 30–60 minutes before {formDate} {formTime || '09:00'} ({homeTz}).
            </div>
          )}

          <div>
            <label className="chk-label">Official Portal Link (Optional, https://)</label>
            <input
              type="url"
              placeholder="https://..."
              value={formActionUrl}
              onChange={(e) => setFormActionUrl(e.target.value)}
              className="manage-input"
            />
          </div>

          <button type="submit" className="manage-btn" disabled={formSaving}>
            <Check size={16} />{' '}
            {formSaving ? 'Saving...' : editingReminder ? 'Save Changes' : 'Create Reminder'}
          </button>
        </form>
      )}

      {pendingCount === 0 && (
        <div
          style={{
            padding: '0.75rem 0.9rem',
            borderRadius: '12px',
            border: '1px dashed var(--border-color)',
            color: 'var(--text-secondary)',
            fontSize: '0.8rem',
            textAlign: 'center',
          }}
        >
          {aiBusy
            ? 'Analyzing upcoming trips in the background—tasks will appear as each flight finishes.'
            : 'No pending tasks here. Tap Add Task or Analyze Upcoming anytime.'}
        </div>
      )}

      {actionNow.length > 0 && (
        <div className="checklist-group">
          <div className="checklist-group-label urgent">Action Now ({actionNow.length})</div>
          {actionNow.map((r) =>
            renderTaskRow(r, { isActionNow: true, showFlightTag: filterFlightId === undefined })
          )}
        </div>
      )}

      {upcoming.length > 0 &&
        (variant === 'full' && filterFlightId === undefined ? (
          <div className="checklist-group" style={{ gap: '0.85rem' }}>
            {upcomingByFlight.map((group) => (
              <div key={group.key} className="checklist-group">
                <div className="checklist-flight-header">{group.header}</div>
                {group.items.map((r) =>
                  renderTaskRow(r, { isActionNow: false, showFlightTag: false })
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="checklist-group">
            {actionNow.length > 0 && (
              <div className="checklist-group-label">Upcoming Windows ({upcoming.length})</div>
            )}
            {upcoming.map((r) =>
              renderTaskRow(r, { isActionNow: false, showFlightTag: false })
            )}
          </div>
        ))}

      {closed.length > 0 && (
        <div className="checklist-group">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '0.2rem 0',
              alignSelf: 'flex-start',
            }}
          >
            {showCompleted ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Completed / Dismissed ({closed.length})
          </button>
          {showCompleted &&
            closed.map((r) =>
              renderTaskRow(r, {
                isActionNow: false,
                showFlightTag: filterFlightId === undefined,
              })
            )}
        </div>
      )}

      <style>{`
        .checklist-root {
          display: flex;
          flex-direction: column;
          gap: 0.65rem;
          min-width: 0;
        }
        .checklist-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .chk-filter-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .chk-filter-pill {
          padding: 0.28rem 0.62rem;
          border-radius: 999px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-secondary);
          font-size: 0.72rem;
          font-weight: 600;
          cursor: pointer;
        }
        .chk-filter-pill.active {
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.45);
          color: #e0e7ff;
        }
        .checklist-group {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          min-width: 0;
        }
        .checklist-group-label {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-secondary);
        }
        .checklist-group-label.urgent {
          color: #fcd34d;
        }
        .checklist-flight-header {
          font-size: 0.75rem;
          font-weight: 700;
          color: #c7d2fe;
          font-family: monospace;
          padding-bottom: 0.15rem;
          border-bottom: 1px solid rgba(148, 163, 184, 0.14);
        }
        .chk-row {
          display: flex;
          flex-direction: column;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.16);
          background: rgba(15, 23, 42, 0.55);
          min-width: 0;
        }
        .chk-row.compact {
          background: rgba(15, 23, 42, 0.4);
          border-color: rgba(148, 163, 184, 0.14);
        }
        .chk-row.urgent {
          border-color: rgba(245, 158, 11, 0.36);
          background: rgba(245, 158, 11, 0.06);
        }
        .chk-row.closed {
          opacity: 0.6;
        }
        .chk-main {
          display: flex;
          align-items: flex-start;
          gap: 0.6rem;
          padding: 0.65rem 0.72rem;
          min-width: 0;
        }
        .chk-circle {
          width: 24px;
          height: 24px;
          border-radius: 999px;
          border: 1.5px solid rgba(148, 163, 184, 0.45);
          background: rgba(255, 255, 255, 0.03);
          color: white;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          cursor: pointer;
          margin-top: 0.1rem;
        }
        .chk-circle:hover {
          border-color: #10b981;
          background: rgba(16, 185, 129, 0.15);
        }
        .chk-circle.done {
          border-color: #10b981;
          background: rgba(16, 185, 129, 0.25);
          color: #6ee7b7;
        }
        .chk-summary-btn {
          flex: 1;
          min-width: 0;
          background: transparent;
          border: none;
          padding: 0;
          text-align: left;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 0.22rem;
          color: inherit;
          font: inherit;
        }
        .chk-badges-line {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          flex-wrap: wrap;
        }
        .chk-cat-tag,
        .chk-flight-tag,
        .chk-status-tag {
          font-size: 0.65rem;
          font-weight: 700;
          padding: 0.08rem 0.42rem;
          border-radius: 999px;
          line-height: 1.4;
        }
        .chk-flight-tag {
          background: rgba(99, 102, 241, 0.14);
          border: 1px solid rgba(99, 102, 241, 0.28);
          color: #c7d2fe;
          font-family: monospace;
        }
        .chk-status-tag {
          background: rgba(16, 185, 129, 0.14);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: #6ee7b7;
        }
        .chk-title {
          font-weight: 600;
          font-size: 0.86rem;
          color: var(--text-primary);
          line-height: 1.32;
          word-break: break-word;
        }
        .chk-row.closed .chk-title {
          text-decoration: line-through;
        }
        .chk-when {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.72rem;
          color: #94a3b8;
        }
        .chk-right-tools {
          display: inline-flex;
          align-items: center;
          gap: 0.28rem;
          flex-shrink: 0;
        }
        .chk-icon-btn {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-secondary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          text-decoration: none;
        }
        .chk-icon-btn.gcal {
          border-color: rgba(6, 182, 212, 0.35);
          background: rgba(6, 182, 212, 0.12);
          color: #67e8f9;
        }
        .chk-drawer {
          padding: 0 0.72rem 0.72rem 2.72rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .chk-details {
          font-size: 0.77rem;
          color: var(--text-secondary);
          line-height: 1.45;
          word-break: break-word;
        }
        .chk-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.38rem;
        }
        .chk-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.28rem;
          padding: 0.32rem 0.58rem;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-secondary);
          font-size: 0.73rem;
          font-weight: 600;
          cursor: pointer;
          text-decoration: none;
        }
        .chk-btn:hover {
          background: rgba(255, 255, 255, 0.09);
          color: var(--text-primary);
        }
        .chk-btn.checkin-switch {
          border-color: rgba(6, 182, 212, 0.48);
          background: rgba(6, 182, 212, 0.16);
          color: #67e8f9;
        }
        .chk-btn.gcal {
          border-color: rgba(6, 182, 212, 0.4);
          background: rgba(6, 182, 212, 0.12);
          color: #67e8f9;
        }
        .chk-btn.link {
          border-color: rgba(99, 102, 241, 0.38);
          background: rgba(99, 102, 241, 0.12);
          color: #c7d2fe;
        }
        .chk-btn.danger:hover {
          border-color: rgba(244, 63, 94, 0.45);
          color: #fda4af;
        }
        .checklist-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 0.9rem;
          border-radius: 14px;
          border: 1px solid rgba(99, 102, 241, 0.4);
          background: rgba(30, 41, 59, 0.75);
        }
        .checklist-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 0.65rem;
        }
        .chk-label {
          font-size: 0.74rem;
          color: var(--text-secondary);
        }
        .manage-input {
          width: 100%;
          padding: 0.58rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          color: var(--text-primary);
          outline: none;
          margin-top: 0.2rem;
          font-size: 0.84rem;
          font-family: inherit;
        }
        .manage-input option {
          background: #1e293b;
          color: var(--text-primary);
        }
        .manage-btn {
          width: 100%;
          padding: 0.68rem;
          background: var(--accent-primary);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.45rem;
        }
        @media (max-width: 480px) {
          .chk-drawer {
            padding-left: 0.72rem;
          }
        }
      `}</style>
    </div>
  );
};

export default PreFlightChecklist;
