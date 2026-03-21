import { useState } from 'react';
import PropTypes from 'prop-types';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { classesAPI } from '../lib/api';

const CLASS_COLORS = ['#0F766E', '#0EA5E9', '#F97316', '#DC2626', '#7C3AED', '#CA8A04', '#059669', '#475569'];

export default function ClassManager({ classes, onRefresh }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '#0F766E' });

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

  return (
    <div className="space-y-6 animate-slide-in" data-testid="class-manager">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>Classes</h2>
          <p className="text-sm text-slate-500 mt-1" data-testid="class-manager-subtitle">
            Track class series, colors, and on-the-fly scheduling options.
          </p>
        </div>
        <Button
          data-testid="add-class-button"
          onClick={openNew}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Class
        </Button>
      </div>

      <div className="grid gap-3">
        {(classes || []).map((classItem) => (
          <div
            key={classItem.id}
            data-testid={`class-card-${classItem.id}`}
            className="bg-white rounded-xl border border-gray-100 p-4 flex items-start justify-between gap-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-4 min-w-0">
              <div
                className="w-10 h-10 rounded-xl shrink-0"
                style={{ backgroundColor: classItem.color || '#0F766E' }}
                data-testid={`class-color-swatch-${classItem.id}`}
              />
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 truncate" data-testid={`class-name-${classItem.id}`}>
                  {classItem.name}
                </p>
                <p className="text-xs text-slate-500 mt-1 break-words" data-testid={`class-description-${classItem.id}`}>
                  {classItem.description || 'No description added yet.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                data-testid={`edit-class-${classItem.id}`}
                onClick={() => openEdit(classItem)}
                className="text-slate-400 hover:text-indigo-600"
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid={`delete-class-${classItem.id}`}
                onClick={() => handleDelete(classItem.id)}
                className="text-slate-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}

        {(!classes || classes.length === 0) && (
          <div className="text-center py-12 text-slate-400" data-testid="classes-empty-state">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No class types yet</p>
            <p className="text-sm">Create your first class series to start scheduling by class.</p>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[460px] bg-white" data-testid="class-form-dialog">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Manrope, sans-serif' }}>
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

            <div className="space-y-2">
              <Label data-testid="class-color-label">Color</Label>
              <div className="flex flex-wrap gap-2" data-testid="class-color-grid">
                {CLASS_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    data-testid={`class-color-${color}`}
                    onClick={() => setForm((prev) => ({ ...prev, color }))}
                    className={`h-8 w-8 rounded-full transition-transform ${form.color === color ? 'ring-2 ring-offset-2 ring-slate-900 scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: color }}
                    aria-label={`Use ${color} for class`}
                  />
                ))}
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
    </div>
  );
}

ClassManager.propTypes = {
  classes: PropTypes.array,
  onRefresh: PropTypes.func,
};