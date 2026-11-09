/**
 * 把右键菜单的落点限制在视口内（#141）。
 *
 * 菜单先按点击位置渲染，量出实际尺寸后再调用这里：右侧 / 下方放不下就
 * 整体往左 / 往上挪，四周留 margin 边距，保证所有菜单项都在可视区域内。
 */
export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 8,
): { left: number; top: number } {
  const left = Math.max(margin, Math.min(x, viewportWidth - menuWidth - margin));
  const top = Math.max(margin, Math.min(y, viewportHeight - menuHeight - margin));
  return { left, top };
}
