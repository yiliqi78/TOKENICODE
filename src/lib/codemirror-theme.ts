import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Custom CodeMirror theme that uses CSS variables from App.css,
 * so it automatically follows the app's theme and color scheme.
 * Replaces vscodeDark/vscodeLight — no isDark branching needed.
 */
export const tokenicodeTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-bg-secondary)',
    color: 'var(--color-text-tertiary)',
    borderRight: '1px solid var(--color-border-subtle)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-bg-tertiary)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--color-accent-glow)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-accent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 20%, transparent) !important',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-border-subtle)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-bg-card)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: '8px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-accent-glow)',
    color: 'var(--color-text-primary)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--color-bg-secondary)',
    color: 'var(--color-text-primary)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--color-border-subtle)',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid var(--color-border-subtle)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '3ch',
    padding: '0 4px 0 8px',
  },
});

export const tokenicodeHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--color-syntax-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--color-syntax-keyword)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--color-syntax-string)' },
  { tag: tags.regexp, color: 'var(--color-syntax-string)' },
  { tag: tags.number, color: 'var(--color-syntax-number)' },
  { tag: tags.bool, color: 'var(--color-syntax-number)' },
  { tag: tags.null, color: 'var(--color-syntax-number)' },
  { tag: tags.function(tags.variableName), color: 'var(--color-syntax-function)' },
  { tag: tags.function(tags.propertyName), color: 'var(--color-syntax-function)' },
  { tag: tags.definition(tags.variableName), color: 'var(--color-syntax-function)' },
  { tag: tags.comment, color: 'var(--color-syntax-comment)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--color-syntax-comment)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--color-syntax-comment)', fontStyle: 'italic' },
  { tag: tags.typeName, color: 'var(--color-syntax-type)' },
  { tag: tags.className, color: 'var(--color-syntax-type)' },
  { tag: tags.namespace, color: 'var(--color-syntax-type)' },
  { tag: tags.propertyName, color: 'var(--color-syntax-function)' },
  { tag: tags.operator, color: 'var(--color-syntax-keyword)' },
  { tag: tags.punctuation, color: 'var(--color-text-muted)' },
  { tag: tags.meta, color: 'var(--color-syntax-meta)' },
  { tag: tags.atom, color: 'var(--color-syntax-builtin)' },
  { tag: tags.self, color: 'var(--color-syntax-builtin)' },
  { tag: tags.special(tags.variableName), color: 'var(--color-syntax-builtin)' },
  { tag: tags.tagName, color: 'var(--color-syntax-keyword)' },
  { tag: tags.attributeName, color: 'var(--color-syntax-function)' },
  { tag: tags.attributeValue, color: 'var(--color-syntax-string)' },
  { tag: tags.heading, color: 'var(--color-syntax-keyword)', fontWeight: 'bold' },
  { tag: tags.link, color: 'var(--color-syntax-string)', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
]));
