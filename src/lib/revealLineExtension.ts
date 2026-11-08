import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

/** 设置 / 清除预览里的目标行高亮。value 为 1-based 行号，null 清除。 */
export const setRevealLine = StateEffect.define<number | null>();

const lineDecoration = Decoration.line({ class: 'cm-reveal-line' });

/**
 * 目标行高亮装饰。独立于选区，避免「聊天里点路径定位」把编辑器的选中
 * 内容冲掉（那份选区会同步给 Claude 当上下文）。
 */
export const revealLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setRevealLine)) continue;
      if (effect.value == null) return Decoration.none;
      const lineNo = Math.max(1, Math.min(effect.value, tr.state.doc.lines));
      const line = tr.state.doc.line(lineNo);
      return Decoration.set([lineDecoration.range(line.from)]);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 滚动到指定行（居中）并高亮。越界行号会夹到首/末行。 */
export function revealLineInView(view: EditorView, line: number): void {
  const lineNo = Math.max(1, Math.min(line, view.state.doc.lines));
  const pos = view.state.doc.line(lineNo).from;
  view.dispatch({
    effects: [setRevealLine.of(lineNo), EditorView.scrollIntoView(pos, { y: 'center' })],
  });
}

export function clearRevealLine(view: EditorView): void {
  view.dispatch({ effects: [setRevealLine.of(null)] });
}
