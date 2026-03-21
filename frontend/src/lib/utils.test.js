import { cn } from './utils';

describe('cn utility function', () => {
  it('should merge tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('should conditionally apply classes', () => {
    expect(cn('p-2', { 'bg-red-500': true, 'bg-blue-500': false })).toBe('p-2 bg-red-500');
  });

  it('should handle arrays of classes', () => {
    expect(cn(['p-2', 'bg-red-500'])).toBe('p-2 bg-red-500');
  });

  it('should merge clsx and tailwind-merge correctly', () => {
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
  });
});
