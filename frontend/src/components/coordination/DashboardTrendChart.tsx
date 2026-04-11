import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface TrendData {
  months: string[];
  by_month: Record<string, Record<string, { delivered: number; attendance: number }>>;
}

interface Props {
  readonly trends: TrendData;
}

const COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444',
  '#06b6d4', '#ec4899',
];

export default function DashboardTrendChart({ trends }: Props) {
  if (!trends.months.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No trend data available
      </p>
    );
  }

  // Build chart data: each month gets a row with community-specific counts
  const communities = new Set<string>();
  for (const monthData of Object.values(trends.by_month)) {
    for (const c of Object.keys(monthData)) {
      communities.add(c);
    }
  }
  const communityList = Array.from(communities).sort(
    (a, b) => a.localeCompare(b),
  );

  const data = trends.months.map(month => {
    const row: Record<string, string | number> = { month };
    const monthData = trends.by_month[month] || {};
    for (const c of communityList) {
      row[c] = monthData[c]?.delivered ?? 0;
    }
    return row;
  });

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {communityList.map((c, i) => (
            <Bar
              key={c}
              dataKey={c}
              fill={COLORS[i % COLORS.length]}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
