import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import DOMPurify from 'isomorphic-dompurify';

let markdownConfigured = false;
let mhchemLoadStarted = false;

function normalizeMathInMarkdown(markdown: string): string {
  let normalized = markdown
    // Strip zero-width characters that can break parsing.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize escaped TeX delimiters to KaTeX inline/block delimiters.
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    // Fix common malformed inline math snippets like (\text{g}$).
    .replace(/\((\\text\{[^}]+\})\$\)/g, '($$$1$)');

  normalized = normalized
    // Wrap bare equations such as KE=1/2mv2 or PE=mgh in inline math when not already wrapped.
    .replace(/(^|[^$\w])([A-Za-z]{1,8}\s*=\s*[A-Za-z0-9.^_+\-*/()\\]+)(?=[^$\w]|$)/g, (match, prefix, equation) => {
      const compactEquation = equation.replace(/\s+/g, '');
      if (!compactEquation.includes('=')) {
        return match;
      }

      let fixedEquation = equation
        .replace(/\b1\s*\/\s*2\b/g, '\\frac{1}{2}')
        .replace(/([A-Za-z])2\b/g, '$1^2');

      return `${prefix}$${fixedEquation}$`;
    })
    // Normalize accidental unmatched delimiter around known constants.
    .replace(/\$\s*\)/g, '$)')
    .replace(/\(\s*\$/g, '($');

  return normalized;
}

export async function setupMarkdownRenderer() {
  if (!markdownConfigured) {
    marked.use(markedKatex({
      throwOnError: false,
      output: 'html',
    }));
    markdownConfigured = true;
  }

  if (!mhchemLoadStarted) {
    mhchemLoadStarted = true;
    try {
      await import('katex/contrib/mhchem');
    } catch (error) {
      console.warn('Could not load mhchem extension:', error);
    }
  }
}

// http(s), mailto, or scheme-less (relative) URLs only.
const SAFE_URL = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href');
      if (href !== null && !SAFE_URL.test(href.trim())) {
        node.removeAttribute('href');
      }
      if (node.getAttribute('href')?.match(/^https?:/i)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }
  });
}

/**
 * Sanitize rendered HTML. Allows standard HTML plus KaTeX output
 * (HTML spans with inline styles and MathML), strips scripts, event
 * handlers, forms, embeds and any non http(s)/mailto/relative URLs.
 */
export function sanitizeHtml(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ['target', 'aria-hidden', 'encoding'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'svg'],
    FORBID_ATTR: ['srcset', 'formaction', 'xlink:href', 'action'],
    ALLOWED_URI_REGEXP: SAFE_URL,
  });
}

export function renderMarkdown(markdown: string): string {
  const normalized = normalizeMathInMarkdown(markdown);
  return sanitizeHtml(marked(normalized) as string);
}
