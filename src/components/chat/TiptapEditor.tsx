/**
 * TiptapEditor — drop-in replacement for the <textarea> in InputBar.
 *
 * Exposes an imperative API (via ref) that mirrors the subset of textarea
 * behaviour that InputBar relies on:  getText(), setText(), focus(),
 * insertFileChip(), isEmpty().
 *
 * Internally uses a Tiptap editor with the StarterKit + custom FileChipExtension.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { FileChipExtension, type FileChipAttrs } from './file-chip-extension';
import { FileChipView } from './FileChipView';

/* ------------------------------------------------------------------ */
/*  Imperative handle                                                  */
/* ------------------------------------------------------------------ */

export interface TiptapEditorHandle {
  /** Extract plain text for submission. FileChips become `path` */
  getText(): string;
  /** Replace editor content with plain text (used by setInput) */
  setText(text: string): void;
  /** Focus the editor */
  focus(): void;
  /** Insert a file chip at the current cursor position */
  insertFileChip(attrs: FileChipAttrs): void;
  /** Whether the editor has no content */
  isEmpty(): boolean;
  /** Get the underlying Tiptap editor instance (escape hatch) */
  getEditor(): ReturnType<typeof useEditor> | null;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface TiptapEditorProps {
  /** Placeholder text */
  placeholder?: string;
  /** Called whenever the content changes (debounce-free) */
  onUpdate?: (text: string) => void;
  /** Called on keydown — receives the native keyboard event */
  onKeyDown?: (e: KeyboardEvent) => boolean | void;
  /** Called on paste */
  onPaste?: (e: ClipboardEvent) => boolean | void;
  /** Additional CSS class for the wrapper */
  className?: string;
  /** data attribute for external querySelector targeting */
  'data-chat-input'?: boolean;
}

/* ------------------------------------------------------------------ */
/*  FileChip extension with React NodeView                             */
/* ------------------------------------------------------------------ */

const FileChipWithView = FileChipExtension.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileChipView);
  },
});

/* ------------------------------------------------------------------ */
/*  Serializer: editor JSON → plain text with `path` for file chips    */
/* ------------------------------------------------------------------ */

function editorToPlainText(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return '';
  const json = editor.getJSON();
  const parts: string[] = [];
  for (const block of (json.content ?? []) as any[]) {
    const lineParts: string[] = [];
    for (const node of (block.content ?? []) as any[]) {
      if (node.type === 'fileChip') {
        const displayPath = node.attrs?.label ?? node.attrs?.fullPath ?? '';
        lineParts.push(`\`${displayPath}\``);
      } else if (node.type === 'text') {
        lineParts.push(node.text ?? '');
      } else if (node.type === 'hardBreak') {
        lineParts.push('\n');
      }
    }
    parts.push(lineParts.join(''));
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(
  function TiptapEditor(props, ref) {
    const {
      placeholder = '',
      onUpdate,
      onKeyDown,
      onPaste,
      className,
    } = props;

    const wrapperRef = useRef<HTMLDivElement>(null);
    const onUpdateRef = useRef(onUpdate);
    onUpdateRef.current = onUpdate;

    const onKeyDownRef = useRef(onKeyDown);
    onKeyDownRef.current = onKeyDown;

    const onPasteRef = useRef(onPaste);
    onPasteRef.current = onPaste;

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Disable all block-level nodes except paragraph + hardBreak
          heading: false,
          blockquote: false,
          codeBlock: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          horizontalRule: false,
          // Keep bold/italic/code inline marks
        }),
        Placeholder.configure({ placeholder }),
        FileChipWithView,
      ],
      editorProps: {
        attributes: {
          class: 'tiptap outline-none',
          'data-chat-input': '',
        },
        handleKeyDown: (_view, event) => {
          return onKeyDownRef.current?.(event) === true;
        },
        handlePaste: (_view, event) => {
          return onPasteRef.current?.(event as unknown as ClipboardEvent) === true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        const text = editorToPlainText(ed);
        onUpdateRef.current?.(text);
      },
    });

    // Update placeholder when prop changes
    useEffect(() => {
      if (!editor) return;
      // Access the placeholder extension and reconfigure
      editor.extensionManager.extensions.forEach((ext) => {
        if (ext.name === 'placeholder') {
          (ext.options as any).placeholder = placeholder;
          // Force re-render of decorations
          editor.view.dispatch(editor.view.state.tr);
        }
      });
    }, [editor, placeholder]);

    useImperativeHandle(ref, () => ({
      getText() {
        return editorToPlainText(editor);
      },
      setText(text: string) {
        if (!editor) return;
        if (!text) {
          editor.commands.clearContent();
          return;
        }
        // Set plain text content (preserving newlines as hard breaks)
        editor.commands.setContent(
          text.split('\n').map((line) => ({
            type: 'paragraph',
            content: line ? [{ type: 'text', text: line }] : [],
          })),
        );
      },
      focus() {
        editor?.commands.focus();
      },
      insertFileChip(attrs: FileChipAttrs) {
        if (!editor) return;
        editor.commands.focus();
        editor
          .chain()
          .insertContent({
            type: 'fileChip',
            attrs,
          })
          .insertContent(' ')  // space after chip for typing
          .run();
      },
      isEmpty() {
        return editor?.isEmpty ?? true;
      },
      getEditor() {
        return editor;
      },
    }));

    return (
      <div
        ref={wrapperRef}
        className={className}
        data-chat-input={props['data-chat-input'] ? '' : undefined}
      >
        <EditorContent editor={editor} />
      </div>
    );
  },
);
