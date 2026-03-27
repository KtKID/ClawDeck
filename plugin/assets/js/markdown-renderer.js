/**
 * Markdown Renderer Core
 * Ported from official OpenClaw ui/src/ui/markdown.ts implementation for Vanilla JS environments.
 * Provides safe HTML rendering using Marked.js and DOMPurify.
 */
(function () {
    const allowedTags = [
        "a", "b", "blockquote", "br", "button", "code", "del", "details",
        "div", "em", "h1", "h2", "h3", "h4", "hr", "i", "li", "ol", "p",
        "pre", "span", "strong", "summary", "table", "tbody", "td", "th",
        "thead", "tr", "ul", "img"
    ];

    const allowedAttrs = [
        "class", "href", "rel", "target", "title", "start", "src", "alt",
        "data-code", "type", "aria-label"
    ];

    const sanitizeOptions = {
        ALLOWED_TAGS: allowedTags,
        ALLOWED_ATTR: allowedAttrs,
        ADD_DATA_URI_TAGS: ["img"]
    };

    const MARKDOWN_CHAR_LIMIT = 140_000;
    const MARKDOWN_PARSE_LIMIT = 40_000;
    const MARKDOWN_CACHE_LIMIT = 200;
    const MARKDOWN_CACHE_MAX_CHARS = 50_000;
    const INLINE_DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;
    const LOCAL_IMAGE_PATH_RE = /^(?!https?:\/\/)(?!\/\/)(?!.*\.\.)(?:\.?\/)?[a-z0-9._/-]+\.(?:png|jpe?g|gif|webp|bmp|avif)$/i;

    const markdownCache = new Map();
    let hooksInstalled = false;

    function getCachedMarkdown(key) {
        const cached = markdownCache.get(key);
        if (cached === undefined) return null;
        markdownCache.delete(key);
        markdownCache.set(key, cached);
        return cached;
    }

    function setCachedMarkdown(key, value) {
        markdownCache.set(key, value);
        if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) return;
        const oldest = markdownCache.keys().next().value;
        if (oldest) markdownCache.delete(oldest);
    }

    function installHooks() {
        if (hooksInstalled || !window.DOMPurify) return;
        hooksInstalled = true;

        window.DOMPurify.addHook("afterSanitizeAttributes", (node) => {
            if (!(node instanceof HTMLAnchorElement)) return;
            const href = node.getAttribute("href");
            if (!href) return;
            node.setAttribute("rel", "noreferrer noopener");
            node.setAttribute("target", "_blank");
            if (href.toLowerCase().includes("tail")) {
                node.classList.add("chat-link-tail-blur");
            }
        });
    }

    // Escape HTML helper
    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // Pre-configured marked renderer based on the official htmlEscapeRenderer.
    // In marked v12, renderer methods receive positional arguments, NOT token objects:
    //   renderer.code(text, lang, escaped)
    //   renderer.html(text, block)
    //   renderer.image(href, title, text)
    let htmlEscapeRenderer;
    if (window.marked) {
        htmlEscapeRenderer = new window.marked.Renderer();

        // marked v12 passes (text: string, block: boolean) — positional
        htmlEscapeRenderer.html = (text) => escapeHtml(String(text ?? ""));

        // marked v12 passes (href: string, title: string, text: string) — positional
        htmlEscapeRenderer.image = (href, title, text) => {
            const label = (text?.trim()) ? String(text).trim() : "image";
            const src = String(href ?? "").trim();
            if (!isAllowedImageSrc(src)) {
                return escapeHtml(label);
            }
            return `<img class="markdown-inline-image" src="${escapeHtml(src)}" alt="${escapeHtml(label)}">`;
        };

        // marked v12 passes (text: string, lang: string, escaped: boolean) — positional.
        // text is already HTML-unescaped by the lexer in v12.
        htmlEscapeRenderer.code = (text, lang, escaped) => {
            const textStr = String(text ?? "");
            const langStr = String(lang ?? "");
            const langClass = langStr ? ` class="language-${escapeHtml(langStr)}"` : "";
            // Always escape: in marked v12 text arrives raw (not HTML-escaped by the lexer).
            const safeText = escapeHtml(textStr);
            const codeBlock = `<pre><code${langClass}>${safeText}</code></pre>`;
            const langLabel = langStr ? `<span class="code-block-lang">${escapeHtml(langStr)}</span>` : "";
            // Encode for the data-code attribute used by the copy button.
            const attrSafe = textStr
                .replace(/&/g, "&amp;")
                .replace(/"/g, "&quot;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            const copyBtn = `<button type="button" class="code-block-copy" data-code="${attrSafe}" aria-label="Copy code"><span class="code-block-copy__idle">Copy</span><span class="code-block-copy__done">Copied!</span></button>`;
            const header = `<div class="code-block-header">${langLabel}${copyBtn}</div>`;

            const trimmed = textStr.trim();
            const isJson =
                langStr === "json" ||
                (!langStr &&
                    ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                        (trimmed.startsWith("[") && trimmed.endsWith("]"))));

            if (isJson) {
                const lineCount = textStr.split("\n").length;
                const label = lineCount > 1 ? `JSON &middot; ${lineCount} lines` : "JSON";
                return `<details class="json-collapse"><summary>${label}</summary><div class="code-block-wrapper">${header}${codeBlock}</div></details>`;
            }

            return `<div class="code-block-wrapper">${header}${codeBlock}</div>`;
        };
    }

    function renderEscapedPlainTextHtml(value) {
        return `<div class="markdown-plain-text-fallback">${escapeHtml(value.replace(/\r\n?/g, "\n"))}</div>`;
    }

    function truncateTextToLength(input, limit) {
        if (input.length <= limit) return { text: input, truncated: false, total: input.length };
        return { text: input.substring(0, limit), truncated: true, total: input.length };
    }

    function isAllowedImageSrc(src) {
        const value = String(src ?? "").trim();
        return INLINE_DATA_IMAGE_RE.test(value) || LOCAL_IMAGE_PATH_RE.test(value);
    }

    // Expose the global API
    window.MarkdownRenderer = {
        /**
         * Converts raw markdown into safe, stylized HTML string.
         * Integrates boundary limits and DOMPurify.
         */
        render: function (markdown) {
            if (!window.DOMPurify || !window.marked) {
                console.warn("MarkdownRenderer: marked or DOMPurify not loaded. Render aborted.");
                return escapeHtml(markdown || "");
            }

            const input = (markdown || "").trim();
            if (!input) return "";

            installHooks();

            if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
                const cached = getCachedMarkdown(input);
                if (cached !== null) return cached;
            }

            const truncated = truncateTextToLength(input, MARKDOWN_CHAR_LIMIT);
            const suffix = truncated.truncated
                ? `\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`
                : "";

            // Fallback for extremely huge blocks to avoid ReDos
            if (truncated.text.length > MARKDOWN_PARSE_LIMIT) {
                const html = renderEscapedPlainTextHtml(`${truncated.text}${suffix}`);
                const sanitized = window.DOMPurify.sanitize(html, sanitizeOptions);
                if (input.length <= MARKDOWN_CACHE_MAX_CHARS) setCachedMarkdown(input, sanitized);
                return sanitized;
            }

            let rendered;
            try {
                rendered = window.marked.parse(`${truncated.text}${suffix}`, {
                    renderer: htmlEscapeRenderer,
                    gfm: true,
                    breaks: true,
                });
            } catch (err) {
                // Parse exception: fall back to plain text rendering (not a code block).
                // Uses the same semantic class as the oversized-text fallback so both
                // paths are styled identically and distinguishable from real code blocks.
                console.warn("[markdown] marked.parse failed, falling back to plain text:", err);
                rendered = renderEscapedPlainTextHtml(`${truncated.text}${suffix}`);
            }

            const sanitized = window.DOMPurify.sanitize(rendered, sanitizeOptions);
            if (input.length <= MARKDOWN_CACHE_MAX_CHARS) setCachedMarkdown(input, sanitized);
            return sanitized;
        },

        /**
         * Binds event listeners required for rendered markdown elements, 
         * mainly the copy-to-clipboard functionality for code blocks.
         */
        bind: function (container) {
            if (!container) return;

            container.addEventListener('click', (e) => {
                const copyBtn = e.target.closest('.code-block-copy');
                if (!copyBtn) return;

                const codeData = copyBtn.getAttribute('data-code');
                if (codeData == null) return;

                // Ensure we properly decode any mapped HTML entities back to raw text before copying
                const rawCode = codeData
                    .replace(/&amp;/g, "&")
                    .replace(/&quot;/g, '"')
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">");

                navigator.clipboard.writeText(rawCode).then(() => {
                    copyBtn.classList.add('is-copied');
                    setTimeout(() => {
                        copyBtn.classList.remove('is-copied');
                    }, 1500);
                }).catch(err => {
                    console.error("MarkdownRenderer: failed to copy text", err);
                });
            });
        }
    };

})();
