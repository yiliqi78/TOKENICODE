import { describe, it, expect } from 'vitest';
import { shouldOpenExternally } from '../fileTypes';

describe('shouldOpenExternally', () => {
  it('opens archives / office / executables externally', () => {
    for (const p of ['/a/b.zip', 'D:/x/report.docx', '/bin/tool.exe', '/f/font.woff2', '/d/data.sqlite']) {
      expect(shouldOpenExternally(p)).toBe(true);
    }
  });

  it('keeps inline-previewable binaries in the app', () => {
    for (const p of ['/img/a.png', '/doc/b.pdf', '/v/c.mp4', 'C:/d/e.svg']) {
      expect(shouldOpenExternally(p)).toBe(false);
    }
  });

  it('keeps dotfiles and extension-less files in the editor', () => {
    for (const p of ['/proj/.env', '/proj/.gitignore', '/proj/.prettierrc', '/proj/Makefile', '/proj/LICENSE', 'D:\\proj\\.editorconfig']) {
      expect(shouldOpenExternally(p)).toBe(false);
    }
  });

  it('keeps unknown text-ish extensions in the editor', () => {
    for (const p of ['/p/a.plist', '/p/run.bat', '/p/paper.tex', '/p/x.properties', '/p/main.dart']) {
      expect(shouldOpenExternally(p)).toBe(false);
    }
  });
});
