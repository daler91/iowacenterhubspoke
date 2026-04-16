import { useState } from 'react';
import { BookOpen, Pencil, Plus, Trash2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { PageShell } from './ui/page-shell';
import { classesAPI } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';

const CLASS_COLORS = ['#0F766E', '#0EA5E9', '#F97316', '#DC2626', '#7C3AED', '#CA8A04', '#059669', '#475569'];

import { useOutletContext } from 'react-router-dom';
import { EntityLink } from './ui/entity-link';
import ClassProfile from './ClassProfile';

export default function ClassManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { classes, handleClassRefresh: onRefresh } = useOutletContext();
  const [selectedClassId, setSelectedClassId] = useState(null);
  const onViewProfile = (id) => setSelectedClassId(id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '#0F766E' });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', description: '', color: '#0F766E' });
    setDialogOpen(true);
  };

  const openEdit = (classItem) => {
    setEditing(classItem);
    setForm({
      name: classItem.name,
      description: classItem.description || '',
      color: classItem.color || '#0F766E',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Class name is required');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color,
      };

      if (editing) {
        await classesAPI.update(editing.id, payload);
        toast.success('Class updated');
      } else {
        await classesAPI.create(payload);
        toast.success('Class added');
      }

      onRefresh?.();
      setDialogOpen(false);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save class');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (classId) => {
    try {
      await classesAPI.delete(classId);
      toast.success('Class deleted');
      onRefresh?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete class');
    }
  };

  let saveButtonLabel = 'Add Class';
  if (loading) saveButtonLabel = 'Saving...';
  else if (editing) saveButtonLabel = 'Update Class';

  if (selectedClassId) {
    return <ClassProfile classId={selectedClassId} onBack={() => setSelectedClassId(null)} />;
  }

  return (
    <PageShell
      testId="class-manager"
      breadcrumbs={[{ label: 'Manage' }, { label: 'Classes' }]}
      title="Classes"
      subtitle={
        <span data-testid="class-manager-subtitle">
          Track class series, colors, and on-the-fly scheduling options.
        </span>
      }
      actions={
        isAdmin ? (
          <Button
            data-testid="add-class-button"
            onClick={openNew}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            Add Class
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3">
        {(classes || []).map((classItem) => (
          <div
            key={classItem.id}
            data-testid={`class-card-${classItem.id}`}
            className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-4 flex items-start justify-between gap-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-4 min-w-0">
              <div
                className="w-10 h-10 rounded-xl shrink-0"
                style={{ backgroundColor: classItem.color || '#0F766E' }}
                data-testid={`class-color-swatch-${classItem.id}`}
              />
              <div className="min-w-0">
                <EntityLink type="class" id={classItem.id} className="font-semibold text-slate-800 dark:text-gray-100 truncate block" data-testid={`class-name-${classItem.id}`}>
                  {classItem.name}
                </EntityLink>
                <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 break-words" data-testid={`class-description-${classItem.id}`}>
                  {classItem.description || 'No description added yet.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                data-testid={`view-class-${classItem.id}`}
                onClick={() => onViewProfile(classItem.id)}
                className="text-muted-foreground hover:text-teal-600"
                aria-label={`View ${classItem.name}`}
              >
                <Eye className="w-4 h-4" aria-hidden="true" />
              </Button>
              {isAdmin && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`edit-class-${classItem.id}`}
                    onClick={() => openEdit(classItem)}
                    className="text-muted-foreground hover:text-indigo-600"
                    aria-label={`Edit ${classItem.name}`}
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`delete-class-${classItem.id}`}
                    onClick={() => setDeleteTarget(classItem)}
                    className="text-muted-foreground hover:text-danger"
                    aria-label={`Delete ${classItem.name}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}

        {(!classes || classes.length === 0) && (
          <div className="text-center py-12 text-muted-foreground" data-testid="classes-empty-state">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No class types yet</p>
            <p className="text-sm">Create your first class series to start scheduling by class.</p>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Class</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone. Any schedules using this class will become unclassified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { handleDelete(deleteTarget?.id); setDeleteTarget(null); }}
              className="bg-danger hover:bg-danger/90 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[460px] bg-white dark:bg-gray-900" data-testid="class-form-dialog">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Class' : 'Add Class'}
            </DialogTitle>
            <DialogDescription>
              {editing ? 'Update this class type.' : 'Create a class type to assign during scheduling.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="class-name-input">Class Name</Label>
              <Input
                id="class-name-input"
                data-testid="class-name-input"
                placeholder="Financial Literacy"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="bg-gray-50/50"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="class-description-input">Description</Label>
              <Textarea
                id="class-description-input"
                data-testid="class-description-input"
                placeholder="Optional notes about the class type"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                className="min-h-[100px] bg-gray-50/50 resize-none"
              />
            </div>

            <div
              className="space-y-2"
              role="radiogroup"
              aria-labelledby="class-color-label"
            >
              {/* Group heading for the radiogroup — a <span>, not a <Label>,
                  because this text isn't associated with a single form
                  control. */}
              <span
                id="class-color-label"
                data-testid="class-color-label"
                className="text-sm font-medium leading-none"
              >
                Color
              </span>
              <div className="flex flex-wrap gap-2 items-center" data-testid="class-color-grid">
                {CLASS_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={form.color === color}
                    data-testid={`class-color-${color}`}
                    onClick={() => setForm((prev) => ({ ...prev, color }))}
                    className={cn(
                      'h-8 w-8 rounded-full transition-transform',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1',
                      form.color === color ? 'ring-2 ring-offset-2 ring-slate-900 scale-110' : 'hover:scale-105',
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={`Use ${color} for class`}
                  />
                ))}
                <label className="relative h-8 w-8 rounded-full border-2 border-dashed border-slate-300 hover:border-slate-400 cursor-pointer transition-colors flex items-center justify-center group">
                  <Plus className="w-3 h-3 text-muted-foreground group-hover:text-slate-500" aria-hidden="true" />
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    aria-label="Pick custom color"
                  />
                </label>
                {!CLASS_COLORS.includes(form.color) && (
                  <div
                    className="h-8 w-8 rounded-full ring-2 ring-offset-2 ring-slate-900 scale-110"
                    style={{ backgroundColor: form.color }}
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="submit"
                data-testid="class-save-button"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {saveButtonLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

