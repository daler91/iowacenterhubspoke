import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { coordinationReportsAPI } from '../../lib/coordination-api';
import { cn } from '../../lib/utils';

interface PartnerHealthRow {
  partner_org_id: string;
  name: string;
  community: string;
  status: string;
  classes_hosted: number;
  completion_rate: number;
  last_active?: string;
  health_score: number;
  health_tier: string;
}

const TIER_COLORS: Record<string, string> = {
  excellent: 'bg-spoke-soft text-spoke',
  good: 'bg-info-soft text-info',
  needs_attention: 'bg-warn-soft text-warn',
  at_risk: 'bg-danger-soft text-danger',
};

const TIER_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_attention: 'Needs Attention',
  at_risk: 'At Risk',
};

function completionColor(rate: number): string {
  if (rate >= 80) return 'text-spoke';
  if (rate >= 50) return 'text-warn';
  return 'text-danger';
}

export default function PartnerHealthTable() {
  const navigate = useNavigate();
  const [partners, setPartners] = useState<PartnerHealthRow[]>([]);
  const [sortBy, setSortBy] = useState<string>('health_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    coordinationReportsAPI.partnerHealth().then(res => {
      setPartners(res.data.partners || []);
    }).catch(() => {});
  }, []);

  const sorted = useMemo(() => {
    return [...partners].sort((a, b) => {
      const aVal = a[sortBy as keyof PartnerHealthRow] ?? 0;
      const bVal = b[sortBy as keyof PartnerHealthRow] ?? 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [partners, sortBy, sortDir]);

  const toggleSort = useCallback((col: string) => {
    setSortBy(prev => {
      if (prev === col) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir('desc');
      return col;
    });
  }, []);

  const renderSortHeader = useCallback((col: string, label: string) => (
    <th
      key={col}
      className="px-4 py-3 font-medium cursor-pointer hover:text-slate-700"
      onClick={() => toggleSort(col)}
    >
      {label}
      {sortBy === col && (
        <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  ), [sortBy, sortDir, toggleSort]);

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 dark:bg-gray-900/50 text-left text-slate-500">
              {renderSortHeader("name", "Partner")}
              {renderSortHeader("community", "Community")}
              {renderSortHeader("health_score", "Health")}
              {renderSortHeader("classes_hosted", "Classes")}
              {renderSortHeader("completion_rate", "Completion")}
              <th className="px-4 py-3 font-medium">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => (
              <tr
                key={p.partner_org_id}
                className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                onClick={() => navigate(`/coordination/partners/${p.partner_org_id}`)}
              >
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-slate-500">{p.community}</td>
                <td className="px-4 py-3">
                  <Badge className={cn('text-[10px]', TIER_COLORS[p.health_tier])}>
                    {TIER_LABELS[p.health_tier] || p.health_tier} ({p.health_score})
                  </Badge>
                </td>
                <td className="px-4 py-3 text-slate-500">{p.classes_hosted}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'text-sm font-medium',
                    completionColor(p.completion_rate),
                  )}>
                    {p.completion_rate}%
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {p.last_active
                    ? new Date(p.last_active).toLocaleDateString()
                    : 'Never'}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No partner data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
