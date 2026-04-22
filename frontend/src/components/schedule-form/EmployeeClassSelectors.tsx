import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { PlusCircle, BookOpen } from 'lucide-react';
import { COLORS } from '../../lib/constants';
import { EmployeeMultiSelect } from '../ui/employee-multi-select';
import { RequiredMark } from './RequiredMark';

const CREATE_CLASS_VALUE = '__add_new_class__';

export function EmployeeClassSelectors({
  form, setForm,
  employees, classes,
  selectedClass, onAddClass,
  invalidFieldId,
}) {
  const handleClassSelection = (value) => {
    if (value === CREATE_CLASS_VALUE) {
      onAddClass();
      return;
    }
    setForm({ ...form, class_id: value });
  };
  const employeeInvalid = invalidFieldId === 'schedule-employee-select';

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="schedule-employee-select" className="text-sm font-medium text-slate-700 dark:text-gray-200">
          Employees <RequiredMark />
        </Label>
        <EmployeeMultiSelect
          id="schedule-employee-select"
          employees={employees || []}
          selectedIds={form.employee_ids || []}
          onSelectionChange={(ids) => setForm({ ...form, employee_ids: ids })}
          aria-invalid={employeeInvalid || undefined}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="schedule-class-select" className="text-sm font-medium text-slate-700 dark:text-gray-200">Class Type</Label>
          {onAddClass && (
            <button
              type="button"
              data-testid="schedule-add-class-inline-button"
              onClick={onAddClass}
              className="text-xs font-medium text-hub hover:text-hub-strong flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1 rounded"
            >
              <PlusCircle className="w-3 h-3" aria-hidden="true" />
              Add New Class
            </button>
          )}
        </div>
        <Select value={form.class_id || undefined} onValueChange={handleClassSelection}>
          <SelectTrigger
            id="schedule-class-select"
            data-testid="schedule-class-select"
            className="h-10 bg-gray-50/50 dark:bg-gray-800/50"
            aria-describedby={selectedClass ? 'schedule-selected-class-preview' : undefined}
          >
            <SelectValue placeholder="Select a class type" />
          </SelectTrigger>
          <SelectContent>
            {onAddClass && (
              <SelectItem value={CREATE_CLASS_VALUE} data-testid="schedule-class-add-new-option">
                <div className="flex items-center gap-2 text-hub">
                  <PlusCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  Add New Class...
                </div>
              </SelectItem>
            )}
            {(classes || []).map(classItem => (
              <SelectItem key={classItem.id} value={classItem.id}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: classItem.color || COLORS.DEFAULT_CLASS }}
                    aria-hidden="true"
                  />
                  <span>{classItem.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedClass && (
          <div
            id="schedule-selected-class-preview"
            className="flex items-start gap-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-spoke-soft px-3 py-2"
            data-testid="schedule-selected-class-preview"
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0"
              style={{ backgroundColor: selectedClass.color || COLORS.DEFAULT_CLASS }}
              aria-hidden="true"
            >
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-gray-100" data-testid="schedule-selected-class-name">{selectedClass.name}</p>
              <p className="text-xs text-slate-600 dark:text-gray-400 break-words" data-testid="schedule-selected-class-description">
                {selectedClass.description || 'No class description added.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
