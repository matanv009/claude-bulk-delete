(function () {
  'use strict';

  let selected = new Set();
  let active = false;
  let orgUuid = null;
  const modifiedContainers = new WeakSet();
  let navObs = null;

  // ─── API ─────────────────────────────────────────────────────────────────

  async function fetchOrgUuid() {
    try {
      const r = await fetch('/api/organizations', { credentials: 'include' });
      if (!r.ok) return null;
      const d = await r.json();
      return Array.isArray(d) && d[0]?.uuid ? d[0].uuid : null;
    } catch { return null; }
  }

  async function deleteChat(id) {
    if (!orgUuid) return false;
    try {
      const r = await fetch(
        `/api/organizations/${orgUuid}/chat_conversations/${id}`,
        { method: 'DELETE', credentials: 'include', headers: { 'content-type': 'application/json' } }
      );
      return r.ok;
    } catch { return false; }
  }

  // ─── DOM Helpers ─────────────────────────────────────────────────────────

  function chatLinks() {
    return Array.from(document.querySelectorAll('nav a[href*="/chat/"]'));
  }

  function convId(link) {
    const m = link.href.match(/\/chat\/([^/?#\s]+)/);
    return m?.[1] ?? null;
  }

  function chatContainer(link) {
    return link.closest('li') ?? link.parentElement;
  }

  // ─── Fixed Overlay Positioning ───────────────────────────────────────────
  // The wrap lives in document.body so React can never remove it.
  // We position it over the top of the nav and push nav content down via
  // a <style> tag in <head> — also outside React's control.

  function getNavBg() {
    let el = document.querySelector('nav');
    while (el && el !== document.documentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      el = el.parentElement;
    }
    return '#1a1a1a';
  }

  const SIDEBAR_MIN_WIDTH = 100; // px — below this the sidebar is considered collapsed

  function syncPosition() {
    const wrap = document.getElementById('cbe-wrap');
    const nav = document.querySelector('nav');
    if (!wrap || !nav) return;

    const rect = nav.getBoundingClientRect();
    const collapsed = rect.width < SIDEBAR_MIN_WIDTH;

    // Hide and disable the button when sidebar is collapsed
    wrap.style.display = collapsed ? 'none' : '';

    const mainBtn = document.getElementById('cbe-main');
    if (mainBtn) mainBtn.disabled = collapsed;

    if (collapsed) {
      // Remove nav padding so the sidebar layout is not affected
      const styleTag = document.getElementById('cbe-nav-style');
      if (styleTag) styleTag.textContent = '';
      return;
    }

    Object.assign(wrap.style, {
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      backgroundColor: getNavBg(),
    });

    // Push nav's scrollable content down by injecting a persistent CSS rule.
    // Using !important so React can't override it via inline styles.
    const h = wrap.getBoundingClientRect().height;
    let styleTag = document.getElementById('cbe-nav-style');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'cbe-nav-style';
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = `nav { padding-top: ${h}px !important; }`;
  }

  // ─── Selection ───────────────────────────────────────────────────────────

  function toggleItem(id, cb, container) {
    if (selected.has(id)) {
      selected.delete(id);
      cb.checked = false;
      container.classList.remove('cbe-selected');
    } else {
      selected.add(id);
      cb.checked = true;
      container.classList.add('cbe-selected');
    }
    syncDeleteBtn();
  }

  function syncDeleteBtn() {
    const btn = document.getElementById('cbe-delete');
    if (!btn) return;
    const n = selected.size;
    btn.textContent = n ? `Delete (${n})` : 'Delete (0)';
    btn.disabled = !n;
  }

  // ─── Checkboxes ──────────────────────────────────────────────────────────

  function addCheckboxes() {
    chatLinks().forEach((link) => {
      const id = convId(link);
      if (!id) return;
      const container = chatContainer(link);
      if (!container || container.querySelector('.cbe-cb')) return;

      if (!modifiedContainers.has(container)) {
        if (getComputedStyle(container).position === 'static') {
          container.style.position = 'relative';
        }
        modifiedContainers.add(container);
      }

      link._cbeHandler = (e) => {
        if (!active) return;
        e.preventDefault();
        e.stopPropagation();
        const cb = container.querySelector('.cbe-cb');
        if (cb) toggleItem(id, cb, container);
      };
      link.addEventListener('click', link._cbeHandler, true);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'cbe-cb';
      cb.dataset.id = id;
      cb.checked = selected.has(id);
      if (cb.checked) container.classList.add('cbe-selected');

      Object.assign(cb.style, {
        position: 'absolute',
        left: '8px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: '50',
        width: '15px',
        height: '15px',
        cursor: 'pointer',
        accentColor: '#d97706',
        margin: '0',
      });

      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleItem(id, cb, container);
      });

      container.appendChild(cb);
    });
  }

  function setBulkPadding(enable) {
    let s = document.getElementById('cbe-link-padding');
    if (enable) {
      if (!s) {
        s = document.createElement('style');
        s.id = 'cbe-link-padding';
        document.head.appendChild(s);
      }
      // Checkbox: left=8px, width=16px → ends at 24px. Padding=36px → 12px gap.
      s.textContent = 'nav a[href*="/chat/"] { padding-left: 36px !important; }';
    } else {
      s?.remove();
    }
  }

  function removeCheckboxes() {
    document.querySelectorAll('.cbe-cb').forEach((cb) => {
      const container = cb.parentElement;
      const link = container?.querySelector('a[href*="/chat/"]');
      if (link) {
        if (link._cbeHandler) {
          link.removeEventListener('click', link._cbeHandler, true);
          delete link._cbeHandler;
        }
      }
      if (container) container.classList.remove('cbe-selected');
      cb.remove();
    });
    selected.clear();
    syncDeleteBtn();
  }

  // ─── Toolbar Actions ─────────────────────────────────────────────────────

  function selectAll() {
    const cbs = [...document.querySelectorAll('.cbe-cb')];
    const allOn = cbs.length > 0 && cbs.every((c) => c.checked);
    cbs.forEach((cb) => {
      const container = cb.parentElement;
      const id = cb.dataset.id;
      if (allOn) {
        selected.delete(id);
        cb.checked = false;
        container?.classList.remove('cbe-selected');
      } else {
        selected.add(id);
        cb.checked = true;
        container?.classList.add('cbe-selected');
      }
    });
    const btn = document.getElementById('cbe-all');
    if (btn) btn.textContent = allOn ? 'Select All' : 'Deselect All';
    syncDeleteBtn();
  }

  async function deleteSelected() {
    const n = selected.size;
    if (!n) return;
    if (!confirm(`Delete ${n} chat(s)? This cannot be undone.`)) return;

    const delBtn = document.getElementById('cbe-delete');
    if (delBtn) { delBtn.disabled = true; delBtn.textContent = 'Deleting…'; }

    let ok = 0;
    for (const id of [...selected]) {
      if (await deleteChat(id)) ok++;
      await new Promise((r) => setTimeout(r, 150));
    }

    if (ok > 0) {
      sessionStorage.setItem('cbe-active', '1');
      const currentId = location.href.match(/\/chat\/([^/?#\s]+)/)?.[1];
      if (currentId && selected.has(currentId)) {
        location.href = '/new';
      } else {
        location.reload();
      }
    }
    else {
      alert('Could not delete chats. Please try again.');
      if (delBtn) { delBtn.disabled = false; syncDeleteBtn(); }
    }
  }

  // ─── Toggle Bulk Mode ────────────────────────────────────────────────────

  function toggleMode() {
    active = !active;
    const mainBtn = document.getElementById('cbe-main');
    const toolbar = document.getElementById('cbe-toolbar');

    if (active) {
      mainBtn.textContent = '✕ Cancel';
      mainBtn.classList.add('cbe-cancel');
      toolbar.style.display = 'flex';
      setBulkPadding(true);
      addCheckboxes();
    } else {
      mainBtn.textContent = '🗑 Bulk Delete Chats';
      mainBtn.classList.remove('cbe-cancel');
      toolbar.style.display = 'none';
      setBulkPadding(false);
      removeCheckboxes();
      const allBtn = document.getElementById('cbe-all');
      if (allBtn) allBtn.textContent = 'Select All';
    }

    // Re-sync nav padding after toolbar height changes
    requestAnimationFrame(syncPosition);
  }

  // ─── Build UI ────────────────────────────────────────────────────────────

  function buildUI() {
    const wrap = document.createElement('div');
    wrap.id = 'cbe-wrap';

    const main = document.createElement('button');
    main.id = 'cbe-main';
    main.textContent = '🗑 Bulk Delete Chats';
    main.addEventListener('click', toggleMode);

    const toolbar = document.createElement('div');
    toolbar.id = 'cbe-toolbar';
    toolbar.style.display = 'none';

    const allBtn = document.createElement('button');
    allBtn.id = 'cbe-all';
    allBtn.textContent = 'Select All';
    allBtn.addEventListener('click', selectAll);

    const delBtn = document.createElement('button');
    delBtn.id = 'cbe-delete';
    delBtn.textContent = 'Delete (0)';
    delBtn.disabled = true;
    delBtn.addEventListener('click', deleteSelected);

    toolbar.append(allBtn, delBtn);
    wrap.append(main, toolbar);
    return wrap;
  }

  // ─── Restore bulk mode after page reload ─────────────────────────────────

  function restoreIfNeeded() {
    if (!sessionStorage.getItem('cbe-active')) return;
    sessionStorage.removeItem('cbe-active');
    // Activate UI immediately, then add checkboxes once chats appear in nav
    active = true;
    const mainBtn = document.getElementById('cbe-main');
    const toolbar = document.getElementById('cbe-toolbar');
    if (mainBtn) { mainBtn.textContent = '✕ Cancel'; mainBtn.classList.add('cbe-cancel'); }
    if (toolbar) toolbar.style.display = 'flex';
    setBulkPadding(true);
    syncPosition(); // update nav padding for expanded toolbar
    addCheckboxes(); // in case chats are already in DOM
  }

  // ─── Inject ───────────────────────────────────────────────────────────────

  function attachNavObserver() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    if (navObs) navObs.disconnect();
    navObs = new MutationObserver(() => {
      // Re-apply padding each time React mutates the nav
      syncPosition();
      if (active) addCheckboxes();
    });
    navObs.observe(nav, { childList: true, subtree: true });
  }

  function inject() {
    if (document.getElementById('cbe-wrap')) return true;
    const nav = document.querySelector('nav');
    if (!nav) return false;

    // Append to body — permanently outside React's managed tree
    document.body.appendChild(buildUI());

    // Position after the browser has painted the element, then restore state
    requestAnimationFrame(() => {
      syncPosition();
      attachNavObserver();
      restoreIfNeeded();
    });

    return true;
  }

  // ─── Keep nav observer connected after SPA navigation ────────────────────

  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    setTimeout(() => {
      syncPosition();
      attachNavObserver();
      if (active) addCheckboxes();
    }, 600);
  }).observe(document.body, { childList: true, subtree: true });

  window.addEventListener('resize', syncPosition);

  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    orgUuid = await fetchOrgUuid();
    if (inject()) return;

    // Nav not ready yet — watch for it
    const obs = new MutationObserver(() => {
      if (inject()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 30000);
  }

  init();
})();
