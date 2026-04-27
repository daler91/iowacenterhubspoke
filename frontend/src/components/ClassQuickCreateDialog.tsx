import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import { classesAPI } from '../lib/api';
import { describeApiError } from '../lib/error-messages';
import { cn } from '../lib/utils';

const CLASS_COLORS = ['#0F766E', '#0EA5E9', '#F97316', '#DC2626', '#7C3AED', '#CA8A04', '#059669', '#475569'];

export default function ClassQuickCreateDialog({ open, onOpenChange, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', color: '#0F766E' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ name: '', description: '', color: '#0F766E' });
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Class name is required');
      return;
    }

    setLoading(true);
    try {
      const res = await classesAPI.create({
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color,
      });
      toast.success('Class created');
      onCreated?.(res.data);
      onOpenChange(false);
    } catch (err) {
      toast.error(describeApiError(err, 'Couldn\u2019t create class \u2014 please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] bg-white dark:bg-card" data-testid="class-quick-create-dialog">
        <DialogHeader>
          <DialogTitle>Add New Class</DialogTitle>
          <DialogDescription>
            Create a class type without leaving the schedule flow.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="class-quick-name">Class Name</Label>
            <Input
              id="class-quick-name"
              data-testid="class-quick-name-input"
              placeholder="Entrepreneurship 101"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="bg-muted/50 dark:bg-muted/50"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="class-quick-description">Description</Label>
            <Textarea
              id="class-quick-description"
              data-testid="class-quick-description-input"
              placeholder="Optional details for this class type"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="min-h-[96px] bg-muted/50 dark:bg-muted/50 resize-none"
            />
          </div>

          <div
            className="space-y-2"
            role="radiogroup"
            aria-labelledby="class-quick-color-label"
          >
            {/* Group heading — not a <Label> because it doesn't label a
                single form control. */}
            <span
              id="class-quick-color-label"
              data-testid="class-quick-color-label"
              className="text-sm font-medium leading-none"
            >
              Color
            </span>
            <div className="flex flex-wrap gap-2" data-testid="class-quick-color-grid">
              {CLASS_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={form.color === color}
                  data-testid={`class-quick-color-${color}`}
                  onClick={() => setForm((prev) => ({ ...prev, color }))}
                  className={cn(
                    'h-8 w-8 rounded-full transition-transform',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1',
                    form.color === color ? 'ring-2 ring-offset-2 ring-foreground scale-110' : 'hover:scale-105',
                  )}
                  style={{ backgroundColor: color }}
                  aria-label={`Select ${color} for class`}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="submit"
              data-testid="class-quick-save-button"
              disabled={loading}
              className="w-full bg-hub hover:bg-hub-strong text-white"
            >
              {loading ? 'Saving...' : 'Create Class'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

