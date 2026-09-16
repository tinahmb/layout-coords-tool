(function () {
  'use strict';

  if (window.__layoutToolActive) {
    console.log('Layout tool already active.');
    return;
  }
  window.__layoutToolActive = true;

  // ---- 1. Category definitions ----
  const CATEGORIES = {
    buttons: { label: 'Buttons', selector: 'button, [role="button"], input[type="submit"], input[type="button"], a.btn, a.button' },
    images: { label: 'Images', selector: 'img, svg, picture, canvas' },
    text: { label: 'Text', selector: 'p, span, h1, h2, h3, h4, h5, h6, a:not([role="button"])' },
    containers: { label: 'Containers', selector: 'div, section, header, footer, nav, main, aside, article' }
  };
  const enabled = { buttons: true, images: true, text: false, containers: false };

  // ---- 2. Control panel (category toggles) ----
  const panel = document.createElement('div');
  panel.id = 'layout-tool-panel';
  panel.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;">Layout Coords Tool</div>
    ${Object.keys(CATEGORIES).map(key => `
      <label style="display:block;font-size:13px;cursor:pointer;margin:2px 0;">
        <input type="checkbox" data-cat="${key}" ${enabled[key] ? 'checked' : ''} />
        ${CATEGORIES[key].label}
      </label>
    `).join('')}
    <button id="layout-tool-close" style="margin-top:8px;font-size:12px;">Remove tool</button>
  `;
  Object.assign(panel.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: 2147483647,
    background: '#1e1e1e', color: '#fff', padding: '10px 12px',
    borderRadius: '8px', fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
  });
  document.body.appendChild(panel);
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => { enabled[cb.dataset.cat] = cb.checked; });
  });
  document.getElementById('layout-tool-close').addEventListener('click', teardown);

  function isSelectable(el) {
    return Object.keys(CATEGORIES).some(key =>
      enabled[key] && el instanceof Element && el.matches(CATEGORIES[key].selector)
    );
  }

  // ---- 3. Selection state ----
  // selection = { el, stack, stackIndex, origTransform, origWidth, origHeight,
  //               origFontSize, offsetX, offsetY }
  let selection = null;
  let lastTap = null; // { x, y, time } — used to detect "tap same spot again" for layer cycling

  const highlightBox = document.createElement('div');
  Object.assign(highlightBox.style, {
    position: 'fixed', pointerEvents: 'none', border: '2px solid #4f9dff',
    background: 'rgba(79,157,255,0.12)', zIndex: 2147483646, display: 'none'
  });
  document.body.appendChild(highlightBox);

  const toolbar = document.createElement('div');
  toolbar.id = 'layout-tool-toolbar';
  Object.assign(toolbar.style, {
    position: 'fixed', zIndex: 2147483647, display: 'none',
    background: '#1e1e1e', color: '#fff', borderRadius: '8px',
    padding: '8px 10px', fontFamily: 'system-ui, sans-serif', fontSize: '12px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)', touchAction: 'none', userSelect: 'none'
  });
  document.body.appendChild(toolbar);

  // Corner resize handle — a small dot the user drags to change width/height
  const resizeHandle = document.createElement('div');
  Object.assign(resizeHandle.style, {
    position: 'fixed', zIndex: 2147483647, width: '14px', height: '14px',
    borderRadius: '50%', background: '#4f9dff', border: '2px solid #fff',
    display: 'none', cursor: 'nwse-resize', touchAction: 'none'
  });
  document.body.appendChild(resizeHandle);

  // ---- 4. Tap-to-select + layer cycling ----
  // A plain tap (no drag) on the page selects whatever's under the finger/cursor.
  // Tapping the SAME spot again cycles to the next element stacked underneath —
  // this is what solves "I can't get to the element under this one."
  document.addEventListener('pointerdown', onPageTap, true);

  let tapStart = null;
  function onPageTap(e) {
    // Ignore taps on our own UI
    if (panel.contains(e.target) || toolbar.contains(e.target) || e.target === resizeHandle) return;
    tapStart = { x: e.clientX, y: e.clientY, target: e.target };
  }
  document.addEventListener('pointerup', onPageTapEnd, true);
  function onPageTapEnd(e) {
    if (!tapStart) return;
    const dx = Math.abs(e.clientX - tapStart.x);
    const dy = Math.abs(e.clientY - tapStart.y);
    tapStart = null;
    // If they moved more than a few px, it was a scroll/gesture, not a tap — ignore.
    if (dx > 6 || dy > 6) return;
    if (panel.contains(e.target) || toolbar.contains(e.target) || e.target === resizeHandle) return;

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
    selection = {
      el, stack, stackIndex: index,
      origTransform: el.style.transform || '',
      origWidth: el.style.width || '',
      origHeight: el.style.height || '',
      origFontSize: el.style.fontSize || '',
      offsetX: 0, offsetY: 0
    };
    markTemp(el);
    renderSelectionUI();
  }

  // Track which elements we've temporarily modified, so teardown can revert them all.
  function markTemp(el) {
    if (!el.dataset.layoutToolTouched) el.dataset.layoutToolTouched = '1';
  }

  function renderSelectionUI() {
    const el = selection.el;
    const rect = el.getBoundingClientRect();

    Object.assign(highlightBox.style, {
      display: 'block', top: rect.top + 'px', left: rect.left + 'px',
      width: rect.width + 'px', height: rect.height + 'px'
    });

    Object.assign(resizeHandle.style, {
      display: 'block',
      top: (rect.bottom - 7) + 'px',
      left: (rect.right - 7) + 'px'
    });

    const layerInfo = selection.stack.length > 1
      ? `Layer ${selection.stackIndex + 1}/${selection.stack.length} — tap same spot for next`
      : '';

    toolbar.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px;">&lt;${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}&gt;</div>
      ${layerInfo ? `<div style="opacity:0.7;margin-bottom:6px;">${layerInfo}</div>` : ''}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span id="lt-move-handle" style="cursor:grab;padding:4px 8px;background:#333;border-radius:4px;touch-action:none;">✥ Move</span>
        <span>Font:</span>
        <button id="lt-font-minus" style="padding:2px 8px;">−</button>
        <button id="lt-font-plus" style="padding:2px 8px;">+</button>
      </div>
      <button id="lt-get-css" style="font-size:12px;">Get CSS</button>
    `;
    Object.assign(toolbar.style, {
      display: 'block',
      top: Math.max(8, rect.top - 78) + 'px',
      left: Math.min(rect.left, window.innerWidth - 220) + 'px'
    });

    // Move handle — dragging THIS (not the element directly) starts the move.
    // This is what stops normal page scrolling from being hijacked elsewhere.
    const moveHandle = toolbar.querySelector('#lt-move-handle');
    moveHandle.addEventListener('pointerdown', startMove);

    toolbar.querySelector('#lt-font-minus').addEventListener('click', () => adjustFontSize(-1));
    toolbar.querySelector('#lt-font-plus').addEventListener('click', () => adjustFontSize(1));
    toolbar.querySelector('#lt-get-css').addEventListener('click', showResultCard);

    resizeHandle.onpointerdown = startResize;
  }

  // ---- 5. Move (via dedicated handle only) ----
  function startMove(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = selection.el;
    el.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    const baseX = selection.offsetX, baseY = selection.offsetY;
    document.body.style.userSelect = 'none';

    function move(ev) {
      selection.offsetX = baseX + (ev.clientX - startX);
      selection.offsetY = baseY + (ev.clientY - startY);
      el.style.transform = `translate(${selection.offsetX}px, ${selection.offsetY}px)`;
      renderSelectionUI();
    }
    function up(ev) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // ---- 6. Resize (corner handle: width + height together) ----
  function startResize(e) {
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
    function up(ev) {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // ---- 7. Font size stepper ----
  function adjustFontSize(deltaPx) {
    const el = selection.el;
    const current = parseFloat(getComputedStyle(el).fontSize) || 16;
    el.style.fontSize = Math.max(1, current + deltaPx) + 'px';
    renderSelectionUI();
  }

  // ---- 8. Result card: final CSS, aware of position/size/font changes ----
  let resultCard = null;
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
      <pre style="background:#111;padding:6px 8px;border-radius:4px;font-size:12px;margin:0 0 6px 0;white-space:pre-wrap;">${code}</pre>
      <button id="lt-copy" style="font-size:12px;">Copy</button>
      <button id="lt-dismiss" style="font-size:12px;margin-left:6px;">Dismiss</button>
    `;
    Object.assign(resultCard.style, {
      position: 'fixed', top: Math.min(rect.bottom + 8, window.innerHeight - 200) + 'px',
      left: Math.min(rect.left, window.innerWidth - 280) + 'px',
      zIndex: 2147483647, background: '#1e1e1e', color: '#fff', padding: '10px 12px',
      borderRadius: '8px', fontFamily: 'system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      maxWidth: '260px'
    });
    document.body.appendChild(resultCard);
    resultCard.querySelector('#lt-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(code);
      resultCard.querySelector('#lt-copy').textContent = 'Copied!';
    });
    resultCard.querySelector('#lt-dismiss').addEventListener('click', () => {
      resultCard.remove(); resultCard = null;
    });
  }

  // ---- 9. Teardown: revert every temp-touched element, remove all UI ----
  function teardown() {
    panel.remove();
    highlightBox.remove();
    toolbar.remove();
    resizeHandle.remove();
    if (resultCard) resultCard.remove();
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

  console.log('Layout tool loaded. Tap an element to select it; tap the same spot again to reach layers underneath.');
})();
