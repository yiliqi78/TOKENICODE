/**
 * Tiptap custom inline-node extension: FileChip
 *
 * Renders file references as visual chips inside the contenteditable editor.
 * Each chip stores the full path and a short display name.
 *
 * Serialized to plain-text as `path` (backtick-wrapped) when extracting
 * editor content for submission to the Claude CLI.
 */
import { Node, mergeAttributes } from '@tiptap/react';

export interface FileChipAttrs {
  /** Absolute path on disk */
  fullPath: string;
  /** Short display label (filename or relative path) */
  label: string;
}

export const FileChipExtension = Node.create({
  name: 'fileChip',
  group: 'inline',
  inline: true,
  atom: true,          // treated as a single unit, not editable inside
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      fullPath: { default: '' },
      label: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-file-chip]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-file-chip': '',
        'data-full-path': HTMLAttributes.fullPath,
        class: 'file-chip',
      }),
      HTMLAttributes.label,
    ];
  },
});
