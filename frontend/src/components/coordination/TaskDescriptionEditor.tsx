import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  readonly value: string;
  readonly onBlurSave: (html: string) => void;
  readonly placeholder?: string;
}

const PROSE_CLASSES = [
  'text-sm leading-relaxed',
  'focus:outline-none',
  '[&_p]:my-1',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1',
  '[&_li]:my-0.5',
  '[&_strong]:font-bold',
  '[&_em]:italic',
  '[&_u]:underline',
  '[&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
  '[&_p.is-editor-empty:first-child::before]:text-muted-foreground',
  '[&_p.is-editor-empty:first-child::before]:float-left',
  '[&_p.is-editor-empty:first-child::before]:pointer-events-none',
  '[&_p.is-editor-empty:first-child::before]:h-0',
].join(' ');

export function TaskDescriptionEditor({ value, onBlurSave, placeholder }: Props) {
  const editor = useEditor({
    // StarterKit v3 bundles Underline by default, but we register it
    // explicitly (and disable the bundled copy) so the Underline toolbar
    // command is obviously wired up at the call site.
    extensions: [StarterKit.configure({ underline: false }), Underline],
    content: value || '',
    editorProps: {
      attributes: {
        class: cn(PROSE_CLASSES, 'min-h-[96px] px-3 py-2.5'),
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
      },
    },
    onBlur: ({ editor: ed }) => {
      onBlurSave(ed.getHTML());
    },
  });

  // When the parent swaps to a different task, push new content into the editor
  // without firing transaction listeners that would trigger a save loop.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || '';
    if (current !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  const btnCls = (active: boolean) => cn(
    'p-1.5 rounded transition-colors text-slate-600 dark:text-slate-300',
    'hover:bg-slate-200/70 dark:hover:bg-slate-700/70',
    active && 'bg-slate-200 dark:bg-slate-700 text-hub',
  );

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900 focus-within:border-slate-300 dark:focus-within:border-slate-600 transition-colors">
      <div className="border-b border-slate-200 dark:border-slate-700 px-2 py-1 flex items-center gap-0.5 bg-slate-50 dark:bg-slate-800/60">
        <button
          type="button"
          aria-label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={btnCls(editor.isActive('bold'))}
        >
          <Bold className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btnCls(editor.isActive('italic'))}
        >
          <Italic className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Underline"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={btnCls(editor.isActive('underline'))}
        >
          <UnderlineIcon className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1" />
        <button
          type="button"
          aria-label="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={btnCls(editor.isActive('orderedList'))}
        >
          <ListOrdered className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Bulleted list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btnCls(editor.isActive('bulletList'))}
        >
          <List className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
