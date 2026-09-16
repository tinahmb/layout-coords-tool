(function () {
  'use strict';

  if (window.__layoutToolActive) {
    console.log('Layout tool already active.');
    return;
  }
  window.__layoutToolActive = true;

  // ---- Shared "glass" aesthetic ----
  const GLASS_BG = 'rgba(30,30,34,0.55)';
  const GLASS_BG_SOLIDER = 'rgba(30,30,34,0.7)';
  const GLASS_BORDER = '1px solid rgba(255,255,255,0.12)';
  const GLASS_BLUR = 'blur(14px) saturate(160%)';
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
  const ACCENT = '#4f9dff';

  function glassify(el, { solid = false } = {}) {
    Object.assign(el.style, {
      background: solid ? GLASS_BG_SOLIDER : GLASS_BG,
      backdropFilter: GLASS_BLUR,
      WebkitBackdropFilter: GLASS_BLUR,
      border: GLASS_BORDER,
      color: '#fff',
      borderRadius: '12px',
      fontFamily: FONT,
      boxShadow: '0 8px 24px rgba(0,0,0,0.25)'
    });
  }

  // ---- 1. Category definitions ----
  const CATEGORIES = {
    buttons: { label: 'Buttons', selector: 'button, [role="button"], input[type="submit"], input[type="button"], a.btn, a.button' },
    images: { label: 'Images', selector: 'img, svg, picture, canvas' },
    text: { label: 'Text', selector: 'p, span, h1, h2, h3, h4, h5, h6, a:not([role="button"])' },
    containers: { label: 'Containers', selector: 'div, section, header, footer, nav, main, aside, article' }
  };
  const enabled = { buttons: true, images: true, text: false, containers: false };

  // Elements the user has locked against further edits. Keyed by element ref via a WeakSet.
  const lockedEls = new WeakSet();

  // ============================================================
  // 2. Control panel — draggable, minimizable, glass aesthetic
  // ============================================================
  const panel = document.createElement('div');
  panel.id = 'layout-tool-panel';
  panel.innerHTML = `
    <div id="lt-panel-header" style="display:flex;align-items:center;justify-content:space-between;cursor:grab;touch-action:none;padding:2px 2px 8px 2px;">
      <span style="font-weight:600;font-size:13px;letter-spacing:0.2px;">⌗ Layout Tool</span>
      <span id="lt-panel-min" style="cursor:pointer;opacity:0.7;font-size:14px;padding:2px 6px;">–</span>
    </div>
    <div id="lt-panel-body">
      ${Object.keys(CATEGORIES).map(key => `
        <label style="display:block;font-size:12.5px;cursor:pointer;margin:3px 0;opacity:0.9;">
          <input type="checkbox" data-cat="${key}" ${enabled[key] ? 'checked' : ''} />
          ${CATEGORIES[key].label}
        </label>
      `).join('')}
      <button id="layout-tool-close" style="margin-top:8px;font-size:11.5px;">Remove tool</button>
    </div>
  `;
  Object.assign(panel.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: 2147483647,
    padding: '10px 12px', minWidth: '150px'
  });
  glassify(panel);
  styleButtons(panel);
  document.body.appendChild(panel);

  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => { enabled[cb.dataset.cat] = cb.checked; });
  });
  document.getElementById('layout-tool-close').addEventListener('click', teardown);

  // Minimize: collapses body, panel shrinks to just the header pill.
  let panelMinimized = false;
  const panelBody = panel.querySelector('#lt-panel-body');
  const panelMinBtn = panel.querySelector('#lt-panel-min');
  panelMinBtn.addEventListener('click', () => {
    panelMinimized = !panelMinimized;
    panelBody.style.display = panelMinimized ? 'none' : 'block';
    panelMinBtn.textContent = panelMinimized ? '□' : '–';
    panel.style.minWidth = panelMinimized ? 'unset' : '150px';
  });

  // Drag the panel by its header. Position switches to left/top so dragging feels natural.
  makeDraggable(panel, panel.querySelector('#lt-panel-header'), () => {
    // no-op on move; panel repositions itself via left/top below
  });

  function isSelectable(el) {
    return Object.keys(CATEGORIES).some(key =>
      enabled[key] && el instanceof Element && el.matches(CATEGORIES[key].selector)
    );
  }

  // ============================================================
  // 3. Selection state
  // ============================================================
  // selection = { el, stack, stackIndex, offsetX, offsetY }
  let selection = null;
  let lastTap = null;
  let resultCard = null;

  const highlightBox = document.createElement('div');
  Object.assign(highlightBox.style, {
    position: 'fixed', pointerEvents: 'none', border: `2px solid ${ACCENT}`,
    background: 'rgba(79,157,255,0.10)', zIndex: 2147483646, display: 'none',
    borderRadius: '3px', transition: 'top 0.05s, left 0.05s, width 0.05s, height 0.05s'
  });
  document.body.appendChild(highlightBox);

  const toolbar = document.createElement('div');
  toolbar.id = 'layout-tool-toolbar';
  Object.assign(toolbar.style, {
    position: 'fixed', zIndex: 2147483647, display: 'none',
    padding: '8px 10px', fontSize: '12px', userSelect: 'none',
    maxWidth: '260px'
    // touch-action deliberately NOT set here — only on the move handle —
    // so it doesn't suppress taps on Font +/-, Lock, or Get CSS buttons.
  });
  glassify(toolbar);
  document.body.appendChild(toolbar);

  // Corner resize handle
  const resizeHandle = document.createElement('div');
  Object.assign(resizeHandle.style, {
    position: 'fixed', zIndex: 2147483647, width: '14px', height: '14px',
    borderRadius: '50%', background: ACCENT, border: '2px solid rgba(255,255,255,0.9)',
    display: 'none', cursor: 'nwse-resize', touchAction: 'none',
    boxShadow: '0 2px 6px rgba(0,0,0,0.35)'
  });
  document.body.appendChild(resizeHandle);

  // ============================================================
  // 4. Tap-to-select + layer cycling
  // ============================================================
  document.addEventListener('pointerdown', onPageTap, true);

  function isOwnUI(target) {
    return panel.contains(target) ||
      toolbar.contains(target) ||
      target === resizeHandle ||
      (resultCard && resultCard.contains(target));
  }

  let tapStart = null;
  function onPageTap(e) {
    if (isOwnUI(e.target)) return;
    tapStart = { x: e.clientX, y: e.clientY, target: e.target };
  }
  document.addEventListener('pointerup', onPageTapEnd, true);
  function onPageTapEnd(e) {
    if (!tapStart) return;
    const dx = Math.abs(e.clientX - tapStart.x);
    const dy = Math.abs(e.clientY - tapStart.y);
    tapStart = null;
    if (dx > 6 || dy > 6) return;
    if (isOwnUI(e.target)) return;

    const point = { x: e.clientX, y: e.clientY };
    const stack = document.elementsFromPoint(point.x, point.y).filter(isSelectable);
    if (stack.length === 0) {
      clearSelection();
      return;
    }

    const sameSpot = lastTap && Math.abs(lastTap.x - point.x) < 8 && Math.abs(lastTap.y - point.y) < 8;
    let index = 0;
    if (sameSpot && selection && stack.includes(selection.el)) {
      index = (stack.indexOf(selection.el) + 1) % stack.length;
    }
    lastTap = { x: point.x, y: point.y };
    selectElement(stack[index], stack, index);
  }

  function clearSelection() {
    highlightBox.style.display = 'none';
    toolbar.style.display = 'none';
    resizeHandle.style.display = 'none';
    selection = null;
  }

  function selectElement(el, stack, index) {
    // Preserve an in-progress offset if we're just re-selecting the same element
    // (e.g. clicking it again in the layers bar) so we don't reset its position.
    const keepOffset = selection && selection.el === el;
    selection = {
      el, stack, stackIndex: index,
      offsetX: keepOffset ? selection.offsetX : 0,
      offsetY: keepOffset ? selection.offsetY : 0
    };
    markTemp(el);
    renderSelectionUI();
  }

  function markTemp(el) {
    if (!el.dataset.layoutToolTouched) el.dataset.layoutToolTouched = '1';
  }

  function shortTag(el) {
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`;
  }

  function renderSelectionUI() {
    const el = selection.el;
    const rect = el.getBoundingClientRect();
    const locked = lockedEls.has(el);

    Object.assign(highlightBox.style, {
      display: 'block', top: rect.top + 'px', left: rect.left + 'px',
      width: rect.width + 'px', height: rect.height + 'px',
      borderColor: locked ? '#ff9d4f' : ACCENT,
      borderStyle: locked ? 'dashed' : 'solid'
    });

    Object.assign(resizeHandle.style, {
      display: locked ? 'none' : 'block',
      top: (rect.bottom - 7) + 'px',
      left: (rect.right - 7) + 'px'
    });

    // ---- Layers bar: every selectable element under this spot, clickable ----
    let layersBarHtml = '';
    if (selection.stack.length > 1) {
      layersBarHtml = `
        <div style="opacity:0.65;margin:0 0 4px 0;font-size:10.5px;text-transform:uppercase;letter-spacing:0.4px;">Layers (${selection.stackIndex + 1}/${selection.stack.length})</div>
        <div id="lt-layers-bar" style="display:flex;gap:4px;overflow-x:auto;margin-bottom:8px;padding-bottom:2px;">
          ${selection.stack.map((s, i) => `
            <span data-layer-index="${i}" style="
              flex:0 0 auto; padding:3px 8px; border-radius:6px; cursor:pointer; font-size:11px;
              white-space:nowrap;
              background:${i === selection.stackIndex ? 'rgba(79,157,255,0.35)' : 'rgba(255,255,255,0.08)'};
              border:1px solid ${i === selection.stackIndex ? ACCENT : 'transparent'};
            ">${lockedEls.has(s) ? '🔒 ' : ''}${shortTag(s)}</span>
          `).join('')}
        </div>`;
    }

    toolbar.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
        <span>&lt;${shortTag(el)}&gt;</span>
        ${locked ? '<span style="font-size:10px;opacity:0.75;">🔒 locked</span>' : ''}
      </div>
      ${layersBarHtml}
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
        <span id="lt-move-handle" style="cursor:${locked ? 'not-allowed' : 'grab'};padding:4px 8px;background:rgba(255,255,255,0.08);border-radius:6px;touch-action:none;opacity:${locked ? '0.4' : '1'};">✥ Move</span>
        <span style="opacity:0.6;">Font</span>
        <button id="lt-font-minus" style="padding:2px 8px;" ${locked ? 'disabled' : ''}>−</button>
        <button id="lt-font-plus" style="padding:2px 8px;" ${locked ? 'disabled' : ''}>+</button>
        <span id="lt-lock-toggle" style="cursor:pointer;padding:4px 8px;background:rgba(255,255,255,0.08);border-radius:6px;">${locked ? '🔓 Unlock' : '🔒 Lock'}</span>
      </div>
      <button id="lt-get-css" style="font-size:11.5px;">Get CSS</button>
    `;
    styleButtons(toolbar);

    Object.assign(toolbar.style, {
      display: 'block',
      top: Math.max(8, rect.top - toolbar.offsetHeight - 14) + 'px',
      left: Math.min(Math.max(8, rect.left), window.innerWidth - 270) + 'px'
    });

    if (selection.stack.length > 1) {
      toolbar.querySelectorAll('[data-layer-index]').forEach(pill => {
        pill.addEventListener('click', () => {
          const i = parseInt(pill.dataset.layerIndex, 10);
          selectElement(selection.stack[i], selection.stack, i);
        });
      });
    }

    if (!locked) {
      toolbar.querySelector('#lt-move-handle').addEventListener('pointerdown', startMove);
      toolbar.querySelector('#lt-font-minus').addEventListener('click', () => adjustFontSize(-1));
      toolbar.querySelector('#lt-font-plus').addEventListener('click', () => adjustFontSize(1));
      resizeHandle.onpointerdown = startResize;
    } else {
      resizeHandle.onpointerdown = null;
    }

    toolbar.querySelector('#lt-lock-toggle').addEventListener('click', () => {
      if (lockedEls.has(el)) lockedEls.delete(el); else lockedEls.add(el);
      renderSelectionUI();
    });
    toolbar.querySelector('#lt-get-css').addEventListener('click', showResultCard);
  }

  // ============================================================
  // 5. Move (via dedicated handle only; blocked when locked)
  // ============================================================
  function startMove(e) {
    if (lockedEls.has(selection.el)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = selection.el;
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const baseX = selection.offsetX, baseY = selection.offsetY;
    document.body.style.userSelect = 'none';

    function move(ev) {
      selection.offsetX = baseX + (ev.clientX - startX);
      selection.offsetY = baseY + (ev.clientY - startY);
      el.style.transform = `translate(${selection.offsetX}px, ${selection.offsetY}px)`;
      renderSelectionUI();
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // ============================================================
  // 6. Resize (corner handle; blocked when locked)
  // ============================================================
  function startResize(e) {
    if (lockedEls.has(selection.el)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = selection.el;
    const startX = e.clientX, startY = e.clientY;
    const startRect = el.getBoundingClientRect();
    document.body.style.userSelect = 'none';

    function move(ev) {
      const newW = Math.max(10, Math.round(startRect.width + (ev.clientX - startX)));
      const newH = Math.max(10, Math.round(startRect.height + (ev.clientY - startY)));
      el.style.width = newW + 'px';
      el.style.height = newH + 'px';
      renderSelectionUI();
    }
    function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // ============================================================
  // 7. Font size stepper (blocked when locked)
  // ============================================================
  function adjustFontSize(deltaPx) {
    if (lockedEls.has(selection.el)) return;
    const el = selection.el;
    const current = parseFloat(getComputedStyle(el).fontSize) || 16;
    el.style.fontSize = Math.max(1, current + deltaPx) + 'px';
    renderSelectionUI();
  }

  // ============================================================
  // 8. Result card
  // ============================================================
  function showResultCard() {
    if (resultCard) resultCard.remove();
    const el = selection.el;
    const style = getComputedStyle(el);
    const isPositioned = style.position !== 'static';
    const rect = el.getBoundingClientRect();

    const lines = [];
    if (selection.offsetX || selection.offsetY) {
      if (isPositioned) {
        lines.push(`top: ${Math.round(rect.top)}px;\nleft: ${Math.round(rect.left)}px;`);
      } else {
        lines.push(`margin-top: ${Math.round(selection.offsetY)}px;\nmargin-left: ${Math.round(selection.offsetX)}px;`);
      }
    }
    if (el.style.width || el.style.height) {
      lines.push(`width: ${Math.round(rect.width)}px;\nheight: ${Math.round(rect.height)}px;`);
    }
    if (el.style.fontSize) {
      lines.push(`font-size: ${el.style.fontSize};`);
    }
    const code = lines.length ? lines.join('\n') : '/* no changes made yet */';

    resultCard = document.createElement('div');
    resultCard.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">CSS for this element:</div>
      <pre style="background:rgba(0,0,0,0.35);padding:6px 8px;border-radius:6px;font-size:12px;margin:0 0 6px 0;white-space:pre-wrap;">${code}</pre>
      <button id="lt-copy" style="font-size:12px;">Copy</button>
      <button id="lt-dismiss" style="font-size:12px;margin-left:6px;">Dismiss</button>
    `;
    Object.assign(resultCard.style, {
      position: 'fixed', top: Math.min(rect.bottom + 8, window.innerHeight - 200) + 'px',
      left: Math.min(rect.left, window.innerWidth - 280) + 'px',
      zIndex: 2147483647, padding: '10px 12px', maxWidth: '260px'
    });
    glassify(resultCard, { solid: true });
    styleButtons(resultCard);
    document.body.appendChild(resultCard);
    resultCard.querySelector('#lt-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(code);
      resultCard.querySelector('#lt-copy').textContent = 'Copied!';
    });
    resultCard.querySelector('#lt-dismiss').addEventListener('click', () => {
      resultCard.remove(); resultCard = null;
    });
  }

  // ============================================================
  // 9. Shared helpers: button styling + generic draggable-by-handle
  // ============================================================
  function styleButtons(container) {
    container.querySelectorAll('button').forEach(btn => {
      Object.assign(btn.style, {
        background: 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.15)',
        color: '#fff',
        borderRadius: '6px',
        padding: btn.style.padding || '4px 8px',
        fontFamily: FONT,
        cursor: btn.disabled ? 'not-allowed' : 'pointer',
        opacity: btn.disabled ? '0.4' : '1'
      });
    });
  }

  // Makes `el` draggable by pointer-dragging `handle`. Repositions `el` using
  // fixed top/left (clearing right/bottom so it doesn't fight itself).
  function makeDraggable(el, handle) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Switch from right-anchored to left/top-anchored before dragging.
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';

      const startX = e.clientX, startY = e.clientY;
      const baseLeft = rect.left, baseTop = rect.top;
      handle.style.cursor = 'grabbing';

      function move(ev) {
        const newLeft = baseLeft + (ev.clientX - startX);
        const newTop = baseTop + (ev.clientY - startY);
        el.style.left = Math.min(Math.max(0, newLeft), window.innerWidth - 40) + 'px';
        el.style.top = Math.min(Math.max(0, newTop), window.innerHeight - 40) + 'px';
      }
      function up() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        handle.style.cursor = 'grab';
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  // ============================================================
  // 10. Teardown
  // ============================================================
  function teardown() {
    panel.remove();
    highlightBox.remove();
    toolbar.remove();
    resizeHandle.remove();
    if (resultCard) { resultCard.remove(); resultCard = null; }
    document.removeEventListener('pointerdown', onPageTap, true);
    document.removeEventListener('pointerup', onPageTapEnd, true);

    document.querySelectorAll('[data-layout-tool-touched]').forEach(el => {
      el.style.transform = '';
      el.style.width = '';
      el.style.height = '';
      el.style.fontSize = '';
      delete el.dataset.layoutToolTouched;
    });

    window.__layoutToolActive = false;
  }

  console.log('Layout tool loaded. Tap an element to select it; tap the same spot again — or use the layers bar — to reach elements underneath. Lock an element to protect it from further edits.');
})();
