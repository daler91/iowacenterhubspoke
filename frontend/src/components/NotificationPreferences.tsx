import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  notificationPreferencesAPI,
  type NotificationChannel,
  type NotificationFrequency,
  type NotificationPrefsResponse,
  type NotificationRegistryCategory,
  type NotificationTypeDescriptor,
} from '../lib/api';
import { portalAPI } from '../lib/coordination-api';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './ui/select';
import { Label } from './ui/label';
import { extractErrorMessage } from '../lib/types';

type Mode = 'internal' | 'portal';

/**
 * Fire-and-forget helper for promises whose errors are already handled
 * inside the promise itself. Sonar S1186 flags empty catch bodies, so we
 * route through a named helper that logs a warn at most — never throws.
 */
function logAndIgnore(p: Promise<unknown>): void {
  p.then(() => undefined, (err) => {
    console.warn('notification prefs persist failed', err);
  });
}

interface Props {
  readonly mode: Mode;
  /** Portal magic-link token — required when mode === 'portal'. */
  readonly portalToken?: string;
}

const EMAIL_FREQUENCY_OPTIONS: Array<{ value: NotificationFrequency; label: string }> = [
  { value: 'instant', label: 'Instant' },
  { value: 'daily', label: 'Daily digest' },
  { value: 'weekly', label: 'Weekly digest' },
  { value: 'off', label: 'Off' },
];

const IN_APP_FREQUENCY_OPTIONS: Array<{ value: NotificationFrequency; label: string }> = [
  { value: 'instant', label: 'On' },
  { value: 'off', label: 'Off' },
];

const WEEKDAYS: Array<{ value: string; label: string }> = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
];

/**
 * Notification preferences editor — shared between the internal Settings
 * page and the partner portal settings tab.
 *
 * The server returns a registry of visible notification types (grouped by
 * category) plus the caller's effective preferences. We render one row per
 * type with Select dropdowns for the In-App and Email channels. Every
 * change triggers a debounced save so users don't have to click "save".
 */
export default function NotificationPreferences({ mode, portalToken }: Props) {
  const [data, setData] = useState<NotificationPrefsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPrefs = useCallback(async () => {
    try {
      const res = mode === 'portal' && portalToken
        ? await portalAPI.getNotificationPrefs(portalToken)
        : await notificationPreferencesAPI.get();
      setData(res.data as NotificationPrefsResponse);
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Failed to load notification preferences'));
    } finally {
      setLoading(false);
    }
  }, [mode, portalToken]);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  const persist = useCallback(
    async (next: NonNullable<NotificationPrefsResponse['preferences']>) => {
      setSaving(true);
      try {
        const body = {
          digest: next.digest,
          types: next.types,
        };
        const res = mode === 'portal' && portalToken
          ? await portalAPI.updateNotificationPrefs(portalToken, body)
          : await notificationPreferencesAPI.update(body);
        setData(res.data as NotificationPrefsResponse);
      } catch (err: unknown) {
        toast.error(extractErrorMessage(err, 'Failed to save preferences'));
      } finally {
        setSaving(false);
      }
    },
    [mode, portalToken],
  );

  const updateType = useCallback(
    (typeKey: string, channel: NotificationChannel, value: NotificationFrequency) => {
      setData(current => {
        if (!current) return current;
        const nextTypes = { ...current.preferences.types };
        const row: Partial<Record<NotificationChannel, NotificationFrequency>> = { ...nextTypes[typeKey] };
        row[channel] = value;
        nextTypes[typeKey] = row;
        const next = {
          ...current,
          preferences: { ...current.preferences, types: nextTypes },
        };
        // Fire-and-forget — persist() already handles its own errors
        // (toast + state reset). Use .then() with a no-op continuation to
        // keep the promise floating-safe without a naked void.
        logAndIgnore(persist(next.preferences));
        return next;
      });
    },
    [persist],
  );

  const updateDigest = useCallback(
    (key: 'daily_hour' | 'weekly_day', value: number | string) => {
      setData(current => {
        if (!current) return current;
        const nextDigest = { ...current.preferences.digest, [key]: value };
        const next = {
          ...current,
          preferences: { ...current.preferences, digest: nextDigest },
        };
        persist(next.preferences).catch(() => { /* handled in persist() */ });
        return next;
      });
    },
    [persist],
  );

  const categories = useMemo<NotificationRegistryCategory[]>(
    () => data?.registry?.categories || [],
    [data],
  );

  if (loading) {
    return (
      <output
        className="flex items-center justify-center py-8"
        aria-label="Loading notification preferences"
      >
        <span className="w-6 h-6 border-2 border-hub border-t-transparent rounded-full animate-spin" />
      </output>
    );
  }

  if (!data) {
    return (
      <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-gray-800 rounded-lg">
        <Info className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-sm text-slate-500 dark:text-muted-foreground">
          Notification preferences are unavailable right now.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Digest delivery time */}
      <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-4 bg-slate-50/40 dark:bg-gray-800/30">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
          Digest delivery
        </p>
        <p className="text-xs text-slate-500 dark:text-muted-foreground mb-3">
          When daily and weekly digests are sent. Times are in the hub's timezone.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Daily digest hour</Label>
            <Select
              value={String(data.preferences.digest.daily_hour)}
              onValueChange={(v) => updateDigest('daily_hour', Number(v))}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Weekly digest day</Label>
            <Select
              value={data.preferences.digest.weekly_day}
              onValueChange={(v) => updateDigest('weekly_day', v)}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map(d => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Categories + types */}
      {categories.map(cat => (
        <div key={cat.key}>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-500" />
            {cat.label}
          </h4>
          <div className="space-y-2">
            {cat.types.map(type => (
              <NotificationRow
                key={type.key}
                type={type}
                values={data.preferences.types[type.key] || {}}
                onChange={updateType}
                disabled={saving}
              />
            ))}
          </div>
        </div>
      ))}

      {categories.length === 0 && (
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-gray-800 rounded-lg">
          <Info className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-sm text-slate-500 dark:text-muted-foreground">
            No notification types are available for your account yet.
          </p>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  readonly type: NotificationTypeDescriptor;
  readonly values: Partial<Record<NotificationChannel, NotificationFrequency>>;
  readonly onChange: (key: string, channel: NotificationChannel, value: NotificationFrequency) => void;
  readonly disabled: boolean;
}

function NotificationRow({ type, values, onChange, disabled }: RowProps) {
  const allows = new Set(type.allowed_channels);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {type.label}
          </p>
          {!type.implemented && (
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
              title="This notification isn't wired up yet — your preference will take effect once it's implemented."
            >
              Planned
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">
          {type.description}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        {allows.has('in_app') && (
          <ChannelSelect
            label="In-app"
            value={values.in_app ?? type.default_channels.in_app ?? 'off'}
            options={IN_APP_FREQUENCY_OPTIONS}
            disabled={disabled}
            onChange={(v) => onChange(type.key, 'in_app', v)}
          />
        )}
        {allows.has('email') && (
          <ChannelSelect
            label="Email"
            value={values.email ?? type.default_channels.email ?? 'off'}
            options={EMAIL_FREQUENCY_OPTIONS}
            disabled={disabled}
            onChange={(v) => onChange(type.key, 'email', v)}
          />
        )}
      </div>
    </div>
  );
}

interface ChannelSelectProps {
  readonly label: string;
  readonly value: NotificationFrequency;
  readonly options: Array<{ value: NotificationFrequency; label: string }>;
  readonly disabled: boolean;
  readonly onChange: (v: NotificationFrequency) => void;
}

function ChannelSelect({ label, value, options, disabled, onChange }: ChannelSelectProps) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
        {label}
      </span>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as NotificationFrequency)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[130px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

