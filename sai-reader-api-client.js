/* ============================================================
   SAI READER API CLIENT — Batch 2 patch, v3
   ============================================================
   v3: Use findItemByUrl() to gather items for publish, since
   allItems is declared with `let` in the reader and isn't on window.
   ============================================================ */

(function () {
  'use strict';

  const API_BASE = 'https://notes.scienceaccountability.org/api';
  const PASSWORD_KEY = 'sai-reader-password';
  const EDITOR_KEY = 'sai-reader-editor';
  const FEEDS_STORAGE_KEY = 'sai-reader-feeds-v1';
  const TRIAGE_STORAGE_KEY = 'sai-reader-v2';
  const FRONTPAGE_STORAGE_KEY = 'sai-reader-frontpage-v1';
  const FEED_CACHE_KEY = 'sai-reader-feed-cache-v1';

  function getPassword() { return localStorage.getItem(PASSWORD_KEY) || ''; }
  function getEditor() { return localStorage.getItem(EDITOR_KEY) || 'unknown'; }
  function setPassword(pw) { localStorage.setItem(PASSWORD_KEY, pw); }
  function setEditor(name) { localStorage.setItem(EDITOR_KEY, name); }

  function authHeaders() {
    return { 'x-sai-password': getPassword(), 'x-sai-editor': getEditor() };
  }

  function ensureToastContainer() {
    let c = document.getElementById('sai-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'sai-toast-container';
      c.style.cssText = 'position:fixed;bottom:1.2rem;right:1.2rem;z-index:9999;display:flex;flex-direction:column;gap:0.4rem;align-items:flex-end;pointer-events:none;';
      document.body.appendChild(c);
    }
    return c;
  }
  function toast(message, kind) {
    const c = ensureToastContainer();
    const el = document.createElement('div');
    const bg = kind === 'error' ? '#7a1f2b' : (kind === 'ok' ? '#2d5a3d' : '#1a1613');
    el.style.cssText = `background:${bg};color:#f7f3ec;font-family:'IBM Plex Sans',sans-serif;font-size:0.78rem;font-weight:500;padding:0.6rem 0.9rem;border-radius:3px;max-width:360px;box-shadow:0 4px 14px rgba(0,0,0,0.2);pointer-events:auto;opacity:0;transition:opacity 0.18s;`;
    el.textContent = message;
    c.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, kind === 'error' ? 6000 : 2200);
  }

  async function apiGet(path) {
    const res = await fetch(API_BASE + path, { method: 'GET', headers: authHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GET ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }
  async function apiPost(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  function showPasswordSetup() {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(26,22,19,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;padding:2rem;';
      backdrop.innerHTML = `
          <div style="background:#f7f3ec;border:1px solid #1a1613;border-radius:4px;max-width:480px;width:100%;padding:1.8rem 2rem;font-family:'IBM Plex Sans',sans-serif;">
            <h2 style="font-family:'Fraunces',Georgia,serif;font-size:1.5rem;font-weight:600;margin-bottom:0.4rem;color:#1a1613;">SAI Reader · Sign in</h2>
            <p style="font-size:0.88rem;color:#3a342f;margin-bottom:1.2rem;line-height:1.5;">Enter the editor password to access the reader. Your name is used to attribute edits.</p>
            <label style="display:block;font-size:0.7rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b6358;margin-bottom:0.3rem;">Your name</label>
            <input id="sai-setup-editor" type="text" placeholder="Bob, Sage, etc." style="width:100%;padding:0.55rem 0.7rem;margin-bottom:0.9rem;border:1px solid #d4cab5;border-radius:2px;font-size:0.92rem;font-family:inherit;background:#fffdf7;">
            <label style="display:block;font-size:0.7rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#6b6358;margin-bottom:0.3rem;">Editor password</label>
            <input id="sai-setup-pw" type="password" placeholder="Shared editor password" style="width:100%;padding:0.55rem 0.7rem;margin-bottom:1.2rem;border:1px solid #d4cab5;border-radius:2px;font-size:0.92rem;font-family:inherit;background:#fffdf7;">
            <div style="display:flex;gap:0.6rem;align-items:center;">
              <button id="sai-setup-ok" style="background:#1a1613;color:#f7f3ec;border:none;padding:0.6rem 1.3rem;font-family:inherit;font-size:0.78rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;border-radius:2px;">Sign in</button>
              <span id="sai-setup-msg" style="font-family:'IBM Plex Mono',monospace;font-size:0.74rem;color:#7a1f2b;"></span>
            </div>
          </div>`;
      document.body.appendChild(backdrop);
      const editorEl = backdrop.querySelector('#sai-setup-editor');
      const pwEl = backdrop.querySelector('#sai-setup-pw');
      const okBtn = backdrop.querySelector('#sai-setup-ok');
      const msgEl = backdrop.querySelector('#sai-setup-msg');

      const prevEditor = getEditor();
      if (prevEditor && prevEditor !== 'unknown') editorEl.value = prevEditor;
      editorEl.focus();

      async function submit() {
        const editor = editorEl.value.trim();
        const pw = pwEl.value;
        if (!editor) { msgEl.textContent = 'Name required'; editorEl.focus(); return; }
        if (!pw) { msgEl.textContent = 'Password required'; pwEl.focus(); return; }
        msgEl.style.color = '#6b6358';
        msgEl.textContent = 'Checking…';
        try {
          setPassword(pw); setEditor(editor);
          const testRes = await fetch(API_BASE + '/triage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ url: '' }),
          });
          if (testRes.status === 401) {
            msgEl.style.color = '#7a1f2b';
            msgEl.textContent = 'Wrong password';
            setPassword('');
            pwEl.focus(); pwEl.select();
            return;
          }
          backdrop.remove();
          toast('Signed in as ' + editor, 'ok');
          resolve();
        } catch (err) {
          msgEl.style.color = '#7a1f2b';
          msgEl.textContent = 'Connection failed: ' + err.message.slice(0, 60);
        }
      }
      okBtn.addEventListener('click', submit);
      [editorEl, pwEl].forEach(el => {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
      });
    });
  }

  async function syncFromServer() {
    const state = await apiGet('/state');

    if (state.feeds && state.feeds.scientists && state.feeds.writers) {
      localStorage.setItem(FEEDS_STORAGE_KEY, JSON.stringify({
        scientists: state.feeds.scientists,
        writers: state.feeds.writers,
      }));
    }
    if (state.triage && typeof state.triage === 'object') {
      localStorage.setItem(TRIAGE_STORAGE_KEY, JSON.stringify(state.triage));
    }
    if (state.frontpage) {
      localStorage.setItem(FRONTPAGE_STORAGE_KEY, JSON.stringify({
        tagline: state.frontpage.tagline || '',
        heroUrl: state.frontpage.heroUrl || '',
        selectedUrls: Array.isArray(state.frontpage.selectedUrls) ? state.frontpage.selectedUrls : [],
        recentCount: state.frontpage.recentCount || 5,
      }));
    }

    if (typeof window.loadFeeds === 'function') window.loadFeeds();
    return state;
  }

  const debounceTimers = {};
  function debounceWrite(key, ms, fn) {
    if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(() => {
      delete debounceTimers[key];
      fn().catch(err => {
        console.error(`Write failed (${key}):`, err);
        toast(`Save failed: ${err.message.slice(0, 80)}`, 'error');
      });
    }, ms);
  }

  function patchSaveFunctions() {
    if (typeof window.setTriage === 'function' && !window.setTriage._saiPatched) {
      const orig = window.setTriage;
      window.setTriage = function (url, patch) {
        orig(url, patch);
        const current = window.getTriage(url);
        debounceWrite('triage:' + url, 300, async () => {
          await apiPost('/triage', {
            url,
            tags: current.tags,
            starred: current.starred,
            archived: current.archived,
            brief: current.brief,
            kicker: current.kicker,
            // Metadata — persisted so the record is self-contained and searchable,
            // and so picks/publish render without the live RSS feed.
            title: current.title || '',
            author: current.author || '',
            sourceName: current.sourceName || '',
            image: current.image || '',
            date: current.date || '',
            excerpt: current.excerpt || '',
            group: current.group || '',
          });
        });
      };
      window.setTriage._saiPatched = true;
    }
    if (typeof window.saveFeeds === 'function' && !window.saveFeeds._saiPatched) {
      const orig = window.saveFeeds;
      window.saveFeeds = function () {
        orig();
        debounceWrite('feeds', 400, async () => {
          const stored = JSON.parse(localStorage.getItem(FEEDS_STORAGE_KEY) || '{}');
          await apiPost('/feeds', {
            scientists: stored.scientists || [],
            writers: stored.writers || [],
          });
        });
      };
      window.saveFeeds._saiPatched = true;
    }

    if (typeof window.saveFrontPage === 'function' && !window.saveFrontPage._saiPatched) {
      const orig = window.saveFrontPage;
      window.saveFrontPage = function () {
        orig();
        debounceWrite('frontpage', 400, async () => {
          const stored = JSON.parse(localStorage.getItem(FRONTPAGE_STORAGE_KEY) || '{}');
          await apiPost('/frontpage', stored);
        });
      };
      window.saveFrontPage._saiPatched = true;
    }
  }

  // Gather items needed for publish by using the reader's own findItemByUrl().
  // This is the workaround for allItems not being on window.
  // Strategy: get the URLs we care about (hero + selected + all starred from
  // localStorage triage), then call findItemByUrl for each one.
  function gatherItemsForPublish() {
    const fp = JSON.parse(localStorage.getItem(FRONTPAGE_STORAGE_KEY) || '{}');
    const triage = JSON.parse(localStorage.getItem(TRIAGE_STORAGE_KEY) || '{}');

    const urls = new Set();
    if (fp.heroUrl) urls.add(fp.heroUrl);
    for (const u of (fp.selectedUrls || [])) if (u) urls.add(u);
    for (const [url, t] of Object.entries(triage)) {
      if (t && t.starred) urls.add(url);
    }

    const items = [];
    const missing = [];
    for (const url of urls) {
      const live = (typeof window.findItemByUrl === 'function') ? window.findItemByUrl(url) : null;
      const t = triage[url] || {};
      const src = live || t;
      if (src && src.title) {
        items.push({
          link: url,
          title: src.title,
          author: src.author || '',
          sourceName: src.sourceName || '',
          date: src.date ? (src.date instanceof Date ? src.date.toISOString() : src.date) : null,
          image: src.image || '',
          excerpt: src.excerpt || '',
        });
      } else {
        missing.push(url);
      }
    }
    return { items, missing };
  }

  // Track in-flight summary requests so we don't fire duplicates (e.g. a fast
  // double-star, or a star + manual click).
  const summarizing = {};

  // Generate an editorial brief for a post via /api/summarize and save it
  // through the Reader's normal triage path. By default it's a no-op when a
  // brief already exists (so starring never clobbers a hand-written brief);
  // pass { force: true } from the Regenerate button to overwrite.
  async function summarize(url, opts) {
    opts = opts || {};
    if (!url || summarizing[url]) return;

    const t = (typeof window.getTriage === 'function') ? window.getTriage(url) : {};
    if (!opts.force && t && t.brief && t.brief.trim()) return; // cached — don't redo

    const item = (typeof window.findItemByUrl === 'function') ? window.findItemByUrl(url) : null;

    summarizing[url] = true;
    setSummarizeButtonState(url, true);
    toast('Summarizing…');

    try {
      const result = await apiPost('/summarize', {
        url,
        title: (item && item.title) || (t && t.title) || '',
        author: (item && item.author) || (t && t.author) || '',
        sourceName: (item && item.sourceName) || (t && t.sourceName) || '',
        excerpt: (item && item.excerpt) || (t && t.excerpt) || '',
      });
      if (result && result.brief && typeof window.setTriage === 'function') {
        window.setTriage(url, { brief: result.brief });
        if (typeof window.render === 'function') window.render();
        toast('Summary added', 'ok');
      } else {
        toast('No summary returned', 'error');
      }
    } catch (err) {
      console.error('Summarize failed:', err);
      toast('Summary failed: ' + err.message.slice(0, 90), 'error');
    } finally {
      delete summarizing[url];
      setSummarizeButtonState(url, false);
    }
  }

  // Reflect in-flight state on the matching Summarize/Regenerate button(s).
  function setSummarizeButtonState(url, busy) {
    document
      .querySelectorAll('[data-action="summarize"][data-link="' + (window.CSS && CSS.escape ? CSS.escape(url) : url) + '"]')
      .forEach((btn) => {
        btn.disabled = busy;
        if (busy) {
          btn.dataset.prevLabel = btn.textContent;
          btn.textContent = '… summarizing';
        } else if (btn.dataset.prevLabel) {
          btn.textContent = btn.dataset.prevLabel;
          delete btn.dataset.prevLabel;
        }
      });
  }

  async function publishToSite() {
    if (typeof window.findItemByUrl !== 'function') {
      toast('Reader not fully loaded yet. Wait for feeds to load and try again.', 'error');
      return;
    }

    let gathered;
    try {
      gathered = gatherItemsForPublish();
    } catch (err) {
      toast('Could not gather items: ' + err.message, 'error');
      return;
    }

    if (!gathered.items.length) {
      toast('No items to publish. Star some posts and build a front page first.', 'error');
      return;
    }

    const missingMsg = gathered.missing.length
      ? `\n\n${gathered.missing.length} starred post(s) are outside the 14-day feed window and will not be included.`
      : '';

    if (!confirm(`Publish current front-page configuration to notes.scienceaccountability.org?\n\n${gathered.items.length} items will be included.${missingMsg}\n\nThis will commit a new state.json to the GitHub repo. The site updates in about 60 seconds.`)) return;

    const btn = document.getElementById('sai-publish-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }

    try {
      const result = await apiPost('/publish', { items: gathered.items });
      const counts = result.slotCounts || {};
      toast(`Published! ${(counts.hero || 0) + (counts.selected || 0)} slots + ${counts.recent || 0} recent. Site updates in ~60s.`, 'ok');
      console.log('Publish commit:', result.commit);
    } catch (err) {
      console.error('Publish failed:', err);
      toast(`Publish failed: ${err.message.slice(0, 80)}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↑ Publish to site'; }
    }
  }

  function installPublishButton() {
    const observer = new MutationObserver(() => {
      const bar = document.querySelector('.fp-export-actions');
      if (bar && !document.getElementById('sai-publish-btn')) {
        const btn = document.createElement('button');
        btn.id = 'sai-publish-btn';
        btn.className = 'fp-export-btn primary';
        btn.style.cssText = 'background:#7a1f2b;color:#f7f3ec;border-color:#7a1f2b;margin-right:0.4rem;';
        btn.textContent = '↑ Publish to site';
        btn.addEventListener('click', publishToSite);
        bar.insertBefore(btn, bar.firstChild);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function installSignOutButton() {
    const meta = document.querySelector('.masthead-meta');
    if (!meta || document.getElementById('sai-signout')) return;
    const btn = document.createElement('button');
    btn.id = 'sai-signout';
    btn.style.cssText = `margin-top:0.4rem;margin-left:0.4rem;font-family:'IBM Plex Sans',sans-serif;font-size:0.7rem;letter-spacing:0.05em;text-transform:uppercase;font-weight:600;background:transparent;color:#6b6358;border:1px solid #d4cab5;padding:0.4rem 0.8rem;cursor:pointer;border-radius:2px;`;
    btn.textContent = 'Sign out';
    btn.title = 'Clear stored credentials on this machine';
    btn.addEventListener('click', () => {
      if (!confirm('Sign out of SAI Reader on this machine?')) return;
      localStorage.removeItem(PASSWORD_KEY);
      localStorage.removeItem(EDITOR_KEY);
      location.reload();
    });
    meta.appendChild(btn);
    const indicator = document.createElement('div');
    indicator.style.cssText = `font-family:'IBM Plex Mono',monospace;font-size:0.66rem;color:#6b6358;margin-top:0.3rem;`;
    indicator.textContent = 'Signed in: ' + getEditor();
    meta.appendChild(indicator);
  }

  async function bootstrap() {
    if (!getPassword()) await showPasswordSetup();

    try {
      await syncFromServer();
      console.log('SAI Reader: state synced from API');
    } catch (err) {
      console.error('Initial sync failed:', err);
      toast('Could not load state from server: ' + err.message.slice(0, 80), 'error');
      if (/401/.test(err.message)) {
        localStorage.removeItem(PASSWORD_KEY);
        await showPasswordSetup();
        try { await syncFromServer(); } catch (e2) {
          toast('Still failed: ' + e2.message.slice(0, 80), 'error');
          return;
        }
      } else {
        return;
      }
    }

    patchSaveFunctions();
    if (typeof window.render === 'function') window.render();
    localStorage.removeItem(FEED_CACHE_KEY);
    if (typeof window.loadAllFeeds === 'function') window.loadAllFeeds(true);
    installPublishButton();
    installSignOutButton();
  }

  function start() { setTimeout(bootstrap, 100); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.SAI_API = {
    sync: syncFromServer,
    apiGet, apiPost,
    publish: publishToSite,
    summarize,
    getEditor,
    gatherItemsForPublish,  // exposed for debugging
    signOut: () => {
      localStorage.removeItem(PASSWORD_KEY);
      localStorage.removeItem(EDITOR_KEY);
      location.reload();
    },
  };

})();