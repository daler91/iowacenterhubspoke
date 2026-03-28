import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Users, Plus, Pencil, Trash2, Mail, Phone, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { employeesAPI } from '../lib/api';
import { useAuth } from '../lib/auth';

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
      console.error(err);
      toast.error('Failed to delete employee');
    }
  };

  let saveLabel = 'Add Employee';
  if (loading) saveLabel = 'Saving...';
  else if (editing) saveLabel = 'Update Employee';

  return (
    <div className="space-y-6 animate-slide-in" data-testid="employee-manager">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>Employees</h2>
          <p className="text-sm text-slate-500 mt-1">Manage team members and their scheduling colors</p>
        </div>
        {isAdmin && (
          <Button
            data-testid="add-employee-btn"
            onClick={openNew}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Employee
          </Button>
        )}
      </div>

      {/* Employee list */}
      <div className="grid gap-3">
        {(employees || []).map(emp => (
          <div
            key={emp.id}
            data-testid={`employee-card-${emp.id}`}
            className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: emp.color || '#4F46E5' }}
              >
                {emp.name?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <EntityLink type="employee" id={emp.id} className="font-semibold text-slate-800">{emp.name}</EntityLink>
                <div className="flex items-center gap-3 mt-1">
                  {emp.email && (
                    <div className="flex items-center gap-1">
                      <Mail className="w-3 h-3 text-slate-400" />
                      <span className="text-xs text-slate-500">{emp.email}</span>
                    </div>
                  )}
                  {emp.phone && (
                    <div className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-400" />
                      <span className="text-xs text-slate-500">{emp.phone}</span>
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
                className="text-slate-400 hover:text-teal-600"
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
                    className="text-slate-400 hover:text-indigo-600"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`delete-employee-${emp.id}`}
                    onClick={() => handleDelete(emp.id)}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}

        {(!employees || employees.length === 0) && (
          <div className="text-center py-12 text-slate-400">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No employees yet</p>
            <p className="text-sm">Add your first team member</p>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px] bg-white" data-testid="employee-form-dialog">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Manrope, sans-serif' }}>
              {editing ? 'Edit Employee' : 'Add Employee'}
            </DialogTitle>
            <DialogDescription>
              {editing ? 'Update employee details.' : 'Add a new team member to the scheduler.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                data-testid="employee-name-input"
                placeholder="John Smith"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="bg-gray-50/50"
              />
            </div>
            <div className="space-y-2">
              <Label>Email (optional)</Label>
              <Input
                type="email"
                data-testid="employee-email-input"
                placeholder="john@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-gray-50/50"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone (optional)</Label>
              <Input
                data-testid="employee-phone-input"
                placeholder="(515) 555-0123"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="bg-gray-50/50"
              />
            </div>
            <div className="space-y-2">
              <Label>Calendar Color</Label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    data-testid={`color-${c}`}
                    onClick={() => setForm({ ...form, color: c })}
                    className={`w-8 h-8 rounded-full transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-indigo-600 scale-110' : 'hover:scale-105'}`}
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
    </div>
  );
}

