import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';

export default function ScheduleFilters({
  filterEmployee,
  setFilterEmployee,
  filterLocation,
  setFilterLocation,
  filterClass,
  setFilterClass,
  employees,
  locations,
  classes,
}) {
  const hasFilters = filterEmployee !== 'all' || filterLocation !== 'all' || filterClass !== 'all';

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filter:</span>
      <Select value={filterEmployee} onValueChange={setFilterEmployee}>
        <SelectTrigger className="w-[180px] h-9 text-xs bg-white" data-testid="filter-employee" aria-label="Filter by employee">
          <SelectValue placeholder="All employees" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Employees</SelectItem>
          {(employees || []).map(emp => (
            <SelectItem key={emp.id} value={emp.id}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: emp.color }} aria-hidden="true" />
                {emp.name}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filterLocation} onValueChange={setFilterLocation}>
        <SelectTrigger className="w-[180px] h-9 text-xs bg-white" data-testid="filter-location" aria-label="Filter by location">
          <SelectValue placeholder="All locations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Locations</SelectItem>
          {(locations || []).map(loc => (
            <SelectItem key={loc.id} value={loc.id}>{loc.city_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {classes && (
        <Select value={filterClass} onValueChange={setFilterClass}>
          <SelectTrigger className="w-[180px] h-9 text-xs bg-white" data-testid="filter-class" aria-label="Filter by class">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {(classes || []).map(cls => (
              <SelectItem key={cls.id} value={cls.id}>
                <div className="flex items-center gap-2">
                  {cls.color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cls.color }} />}
                  {cls.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setFilterEmployee('all'); setFilterLocation('all'); setFilterClass?.('all'); }}
          className="text-xs text-muted-foreground"
          data-testid="clear-filters"
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

