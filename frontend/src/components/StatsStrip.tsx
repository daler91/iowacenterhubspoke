import { Calendar as CalIcon, TrendingUp, Users, MapPin, BookOpen } from 'lucide-react';

export default function StatsStrip({ stats = {}, onStatClick }) {
  const safeStats = {
    today_schedules: 0,
    total_schedules: 0,
    total_employees: 0,
    total_locations: 0,
    total_classes: 0,
    ...stats,
  };

  return (
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-3" data-testid="calendar-stats-strip">
      <button
        type="button"
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all text-left"
        onClick={() => onStatClick('today')}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Today</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-today">
              {safeStats.today_schedules}
            </p>
          </div>
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <CalIcon className="w-5 h-5 text-indigo-600" />
          </div>
        </div>
      </button>

      <button
        type="button"
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-teal-300 hover:shadow-sm transition-all text-left"
        onClick={() => onStatClick('scheduled')}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Scheduled</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-total-schedules">
              {safeStats.total_schedules}
            </p>
          </div>
          <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-teal-600" />
          </div>
        </div>
      </button>

      <button
        type="button"
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-violet-300 hover:shadow-sm transition-all text-left"
        onClick={() => onStatClick('team')}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Team</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-employees">
              {safeStats.total_employees}
            </p>
          </div>
          <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
            <Users className="w-5 h-5 text-violet-600" />
          </div>
        </div>
      </button>

      <button
        type="button"
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-amber-300 hover:shadow-sm transition-all text-left"
        onClick={() => onStatClick('locations')}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Locations</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-locations">
              {safeStats.total_locations}
            </p>
          </div>
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
            <MapPin className="w-5 h-5 text-amber-600" />
          </div>
        </div>
      </button>

      <button
        type="button"
        className="bg-white rounded-2xl border border-gray-100 px-4 py-3 cursor-pointer hover:border-rose-300 hover:shadow-sm transition-all text-left"
        onClick={() => onStatClick('classes')}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Classes</p>
            <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="stat-classes">
              {safeStats.total_classes}
            </p>
          </div>
          <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-rose-600" />
          </div>
        </div>
      </button>
    </div>
  );
}

