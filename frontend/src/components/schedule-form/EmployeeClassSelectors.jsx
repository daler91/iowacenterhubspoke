import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { PlusCircle, BookOpen } from 'lucide-react';
import { COLORS } from '../../lib/constants';

const CREATE_CLASS_VALUE = '__add_new_class__';

export function EmployeeClassSelectors({
  form, setForm,
  employees, classes,
  selectedClass, onAddClass
}) {
  const handleClassSelection = (value) => {
    if (value === CREATE_CLASS_VALUE) {
      onAddClass();
      return;
    }
    setForm({ ...form, class_id: value });
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">Employee</Label>
        <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
          <SelectTrigger data-testid="schedule-employee-select" className="h-10 bg-gray-50/50">
            <SelectValue placeholder="Select an employee" />
          </SelectTrigger>
          <SelectContent>
            {(employees || []).map(emp => (
              <SelectItem key={emp.id} value={emp.id}>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: emp.color }} />
                  {emp.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-sm font-medium text-slate-700">Class Type</Label>
          <button
            type="button"
            data-testid="schedule-add-class-inline-button"
            onClick={onAddClass}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
          >
            <PlusCircle className="w-3 h-3" />
            Add New Class
          </button>
        </div>
        <Select value={form.class_id || undefined} onValueChange={handleClassSelection}>
          <SelectTrigger data-testid="schedule-class-select" className="h-10 bg-gray-50/50">
            <SelectValue placeholder="Select a class type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CREATE_CLASS_VALUE} data-testid="schedule-class-add-new-option">
              <div className="flex items-center gap-2 text-indigo-700">
                <PlusCircle className="w-3.5 h-3.5" />
                Add New Class...
              </div>
            </SelectItem>
            {(classes || []).map(classItem => (
              <SelectItem key={classItem.id} value={classItem.id}>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: classItem.color || COLORS.DEFAULT_CLASS }} />
                  <span>{classItem.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedClass && (
          <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-emerald-50/60 px-3 py-2" data-testid="schedule-selected-class-preview">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: selectedClass.color || COLORS.DEFAULT_CLASS }}>
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800" data-testid="schedule-selected-class-name">{selectedClass.name}</p>
              <p className="text-xs text-slate-500 break-words" data-testid="schedule-selected-class-description">
                {selectedClass.description || 'No class description added.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
