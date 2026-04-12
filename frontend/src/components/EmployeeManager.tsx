import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { PageShell } from './ui/page-shell';
import { Users, Plus, Pencil, Trash2, Mail, Phone, Eye, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { employeesAPI } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';

const COLORS = ['#4F46E5', '#0D9488', '#DC2626', '#EA580C', '#7C3AED', '#2563EB', '#059669', '#D97706'];

import { useOutletContext } from 'react-router-dom';
import { EntityLink } from './ui/entity-link';
import EmployeeProfile from './EmployeeProfile';

export default function EmployeeManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { employees, fetchEmployees, fetchActivities, fetchWorkload } = useOutletContext();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);

  const onRefresh = () => {
    fetchEmployees();
    fetchActivities();
    fetchWorkload();
  };

  const onViewProfile = (id) => setSelectedEmployeeId(id);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', color: '#4F46E5' });
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  if (selectedEmployeeId) {
    return <EmployeeProfile employeeId={selectedEmployeeId} onBack={() => setSelectedEmployeeId(null)} />;
  }

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', email: '', phone: '', color: COLORS[Math.floor(Math.random() * COLORS.length)] });
    setDialogOpen(true);
  };

  const openEdit = (emp) => {
    setEditing(emp);
    setForm({ name: emp.name, email: emp.email || '', phone: emp.phone || '', color: emp.color || '#4F46E5' });
    setDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name) {
      toast.error('Name is required');
      return;
    }
    setLoading(true);
    try {
      if (editing) {
        await employeesAPI.update(editing.id, form);
        toast.success('Employee updated');
      } else {
        await employeesAPI.create(form);
        toast.success('Employee added');
      }
      onRefresh();
      setDialogOpen(false);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save employee');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await employeesAPI.delete(id);
      toast.success('Employee deleted');
      onRefresh();
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(detail || 'Failed to delete employee');
    } finally {
      setDeleteTarget(null);
    }
  };

  let saveLabel = 'Add Employee';
  if (loading) saveLabel = 'Saving...';
  else if (editing) saveLabel = 'Update Employee';

  return (
    <PageShell
      testId="employee-manager"
      breadcrumbs={[{ label: 'Manage' }, { label: 'Employees' }]}
      title="Employees"
      subtitle="Manage team members and their scheduling colors"
      actions={
        isAdmin ? (
          <Button
            data-testid="add-employee-btn"
            onClick={openNew}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            Add Employee
          </Button>
        ) : undefined
      }
    >
      {/* Employee list */}
      <div className="grid gap-3">
        {(employees || []).map(emp => (
          <div
            key={emp.id}
            data-testid={`employee-card-${emp.id}`}
            className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-4 flex items-center justify-between hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: emp.color || '#4F46E5' }}
              >
                {emp.name?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <EntityLink type="employee" id={emp.id} className="font-semibold text-slate-800 dark:text-gray-100">{emp.name}</EntityLink>
                <div className="flex items-center gap-3 mt-1">
                  {emp.email && (
                    <div className="flex items-center gap-1">
                      <Mail className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-slate-500 dark:text-gray-400">{emp.email}</span>
                    </div>
                  )}
                  {emp.phone && (
                    <div className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-slate-500 dark:text-gray-400">{emp.phone}</span>
                    </div>
                  )}
                  {emp.google_calendar_connected && (
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-teal-500" />
                      <span className="text-xs text-teal-600">Google Calendar</span>
                    </div>
                  )}
                  {emp.outlook_calendar_connected && (
                    <div className="flex items-center gap-1">
                      <Mail className="w-3 h-3 text-info" aria-hidden="true" />
                      <span className="text-xs text-info">Outlook Calendar</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                data-testid={`view-employee-${emp.id}`}
                onClick={() => { onViewProfile?.(emp.id); }}
                className="text-muted-foreground hover:text-teal-600"
              >
                <Eye className="w-4 h-4" />
              </Button>
              {isAdmin && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`edit-employee-${emp.id}`}
                    onClick={() => openEdit(emp)}
                    className="text-muted-foreground hover:text-indigo-600"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`delete-employee-${emp.id}`}
                    onClick={() => setDeleteTarget(emp)}
                    className="text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}

        {(!employees || employees.length === 0) && (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No employees yet</p>
            <p className="text-sm">Add your first team member</p>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px] bg-white dark:bg-gray-900" data-testid="employee-form-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Employee' : 'Add Employee'}
            </DialogTitle>
            <DialogDescription>
              {editing ? 'Update employee details.' : 'Add a new team member to the scheduler.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="employee-name-input">Full Name</Label>
              <Input
                id="employee-name-input"
                data-testid="employee-name-input"
                placeholder="John Smith"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="bg-gray-50/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee-email-input">Email (optional)</Label>
              <Input
                id="employee-email-input"
                type="email"
                data-testid="employee-email-input"
                placeholder="john@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-gray-50/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee-phone-input">Phone (optional)</Label>
              <Input
                id="employee-phone-input"
                data-testid="employee-phone-input"
                placeholder="(515) 555-0123"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="bg-gray-50/50"
              />
            </div>
            <div
              className="space-y-2"
              role="radiogroup"
              aria-labelledby="employee-color-label"
            >
              {/* Group heading for the radiogroup — a <span>, not a <Label>,
                  because this text isn't associated with a single form
                  control (jsx-a11y's label-has-associated-control rule). */}
              <span id="employee-color-label" className="text-sm font-medium leading-none">
                Calendar Color
              </span>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={form.color === c}
                    aria-label={`Color swatch ${c}`}
                    data-testid={`color-${c}`}
                    onClick={() => setForm({ ...form, color: c })}
                    className={cn(
                      'w-8 h-8 rounded-full transition-all',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1',
                      form.color === c ? 'ring-2 ring-offset-2 ring-indigo-600 scale-110' : 'hover:scale-105',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                data-testid="employee-save-btn"
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white w-full"
              >
                {saveLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the employee from the system. This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={(e) => { e.preventDefault(); handleDelete(deleteTarget?.id); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

