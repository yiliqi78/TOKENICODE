import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

// 与 MarkdownRenderer 同一套插件顺序：sanitize 在 katex 之前，katex 输出不被剥掉（#107）
const schema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, '*': [...(defaultSchema.attributes?.['*'] || []), 'className'] },
};
function render(md: string): string {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [[remarkMath, { singleDollarTextMath: false }]],
    rehypePlugins: [rehypeRaw, [rehypeSanitize, schema], rehypeKatex, rehypeHighlight],
    children: md,
  }));
}

describe('markdown LaTeX rendering (#107)', () => {
  it('renders $$...$$ display math through KaTeX after sanitize', () => {
    const html = render('Before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nAfter');
    expect(html).toContain('class="katex');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('language-math');
  });

  it('renders inline $$...$$ math', () => {
    const html = render('Energy: $$E = mc^2$$ here.');
    expect(html).toContain('class="katex');
    expect(html).toContain('Energy:');
  });

  it('leaves single-dollar prose alone', () => {
    const html = render('It costs $5 and $10, and $HOME is set.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5 and $10');
  });

  it('still highlights ordinary code blocks', () => {
    const html = render('```ts\nconst a = 1;\n```');
    expect(html).toContain('hljs');
  });
});
