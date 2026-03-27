/**
 * MarkdownRenderer 回归测试
 *
 * 目标：锁定当前 vendor marked v12 与统一 MarkdownRenderer 的契约，
 * 覆盖标题、粗体、表格、代码块、JSON、链接、图片、XSS、超长文本与异常 fallback。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MARKED_PATH = resolve(ROOT, 'plugin/assets/vendor/marked.min.js');
const RENDERER_PATH = resolve(ROOT, 'plugin/assets/js/markdown-renderer.js');

class HTMLAnchorElementFake {
  constructor(initialAttrs = {}) {
    this.attrs = { ...initialAttrs };
    this.classList = {
      _items: new Set(
        String(initialAttrs.class || '')
          .split(/\s+/)
          .map(s => s.trim())
          .filter(Boolean)
      ),
      add: (...names) => {
        for (const name of names) this.classList._items.add(name);
        this.attrs.class = Array.from(this.classList._items).join(' ');
      },
    };
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === 'class') {
      this.classList._items = new Set(
        String(value).split(/\s+/).map(s => s.trim()).filter(Boolean)
      );
    }
  }
  toHTML(innerHtml) {
    const attrs = Object.entries(this.attrs)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => ` ${key}="${String(value).replace(/"/g, '&quot;')}"`)
      .join('');
    return `<a${attrs}>${innerHtml}</a>`;
  }
}

function createAnchorElement(attrs = {}) {
  return new HTMLAnchorElementFake(attrs);
}

function createFakeDOMPurify(HTMLAnchorElement) {
  const hooks = [];

  function stripDangerousHtml(html) {
    return String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z-]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son[a-z-]+\s*=\s*'[^']*'/gi, '')
      .replace(/\son[a-z-]+\s*=\s*[^\s>]+/gi, '')
      .replace(/\shref\s*=\s*"\s*javascript:[^"]*"/gi, '')
      .replace(/\shref\s*=\s*'\s*javascript:[^']*'/gi, '');
  }

  function applyAnchorHooks(html) {
    return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, rawAttrs, innerHtml) => {
      const attrs = {};
      rawAttrs.replace(/([:@a-zA-Z0-9_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_m, key, _quoted, v1, v2) => {
        attrs[key] = v1 ?? v2 ?? '';
        return '';
      });
      const node = createAnchorElement(attrs);
      for (const hook of hooks) hook(node);
      return node.toHTML(innerHtml);
    });
  }

  return {
    addHook(name, fn) {
      if (name === 'afterSanitizeAttributes') hooks.push(fn);
    },
    sanitize(html, _options) {
      let output = stripDangerousHtml(html);
      output = applyAnchorHooks(output);
      return output;
    },
  };
}

function loadRenderer() {
  const markedSource = readFileSync(MARKED_PATH, 'utf-8');
  const rendererSource = readFileSync(RENDERER_PATH, 'utf-8');

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    HTMLAnchorElement: HTMLAnchorElementFake,
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.DOMPurify = createFakeDOMPurify(HTMLAnchorElementFake);

  const context = vm.createContext(sandbox);
  vm.runInContext(markedSource, context, { filename: 'marked.min.js' });
  vm.runInContext(rendererSource, context, { filename: 'markdown-renderer.js' });

  return context;
}

describe('MarkdownRenderer', () => {
  it('渲染标题、粗体与表格', () => {
    const { MarkdownRenderer } = loadRenderer();
    const html = MarkdownRenderer.render('# 标题\n\n**粗体**\n\n| a | b |\n| - | - |\n| 1 | 2 |');

    assert.match(html, /<h1[^>]*>标题<\/h1>/);
    assert.match(html, /<strong>粗体<\/strong>/);
    assert.match(html, /<table>/);
    assert.match(html, /<td>1<\/td>/);
  });

  it('渲染代码块并保留复制按钮', () => {
    const { MarkdownRenderer } = loadRenderer();
    const html = MarkdownRenderer.render('```js\nconst x = 1 < 2;\n```');

    assert.match(html, /class="code-block-wrapper"/);
    assert.match(html, /class="language-js"/);
    assert.match(html, /class="code-block-copy"/);
    assert.match(html, /const x = 1 &lt; 2;/);
  });

  it('识别 JSON 代码块并渲染为折叠块', () => {
    const { MarkdownRenderer } = loadRenderer();
    const html = MarkdownRenderer.render('```json\n{\n  "ok": true\n}\n```');

    assert.match(html, /<details class="json-collapse">/);
    assert.match(html, /<summary>JSON/);
    assert.match(html, /&quot;ok&quot;/);
  });

  it('为链接补齐安全属性并保留 tail 模糊类', () => {
    const { MarkdownRenderer } = loadRenderer();
    const html = MarkdownRenderer.render('[tail 链接](https://tail.example.com/path)');

    assert.match(html, /<a [^>]*href="https:\/\/tail\.example\.com\/path"/);
    assert.match(html, /rel="noreferrer noopener"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /class="chat-link-tail-blur"/);
  });

  it('允许 data URI 与本地相对图片，继续拦截外链图片', () => {
    const { MarkdownRenderer } = loadRenderer();
    const inlineHtml = MarkdownRenderer.render('![猫图](data:image/svg+xml;base64,PHN2Zy8+)');
    const localHtml = MarkdownRenderer.render('![本地图](data/pic/md_avatar_256.png)');
    const remoteHtml = MarkdownRenderer.render('![远程图](https://example.com/a.png)');

    assert.match(inlineHtml, /<img [^>]*class="markdown-inline-image"/);
    assert.match(inlineHtml, /src="data:image\/svg\+xml;base64,PHN2Zy8\+"/);
    assert.match(localHtml, /<img [^>]*class="markdown-inline-image"/);
    assert.match(localHtml, /src="data\/pic\/md_avatar_256\.png"/);
    assert.doesNotMatch(remoteHtml, /<img\b/);
    assert.match(remoteHtml, /远程图/);
  });

  it('对原始 HTML 与事件属性做净化，避免 XSS 注入', () => {
    const { MarkdownRenderer } = loadRenderer();
    const html = MarkdownRenderer.render('<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">bad</a>');

    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /<img\b/i);
    assert.doesNotMatch(html, /<a\b/i);
    assert.doesNotMatch(html, /onerror=/i);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=&quot;x&quot;/);
    assert.match(html, /&lt;\/a&gt;/);
    assert.match(html, /javascript:alert\(3\)/);
  });

  it('超长文本走纯文本 fallback，而不是伪代码块', () => {
    const { MarkdownRenderer } = loadRenderer();
    const html = MarkdownRenderer.render('a'.repeat(40001));

    assert.match(html, /markdown-plain-text-fallback/);
    assert.doesNotMatch(html, /code-block-wrapper/);
    assert.doesNotMatch(html, /pre class="code-block"/);
  });

  it('解析异常时也走纯文本 fallback，而不是伪代码块', () => {
    const context = loadRenderer();
    const originalParse = context.marked.parse;
    context.marked.parse = () => {
      throw new Error('forced parse failure');
    };

    const html = context.MarkdownRenderer.render('# 标题');

    context.marked.parse = originalParse;
    assert.match(html, /markdown-plain-text-fallback/);
    assert.doesNotMatch(html, /pre class="code-block"/);
    assert.match(html, /# 标题/);
  });
});
