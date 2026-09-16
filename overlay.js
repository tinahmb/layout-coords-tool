(function () {
  'use strict';

  // Avoid double-injection if the user clicks the bookmarklet twice
  if (window.__layoutToolActive) {
    console.log('Layout tool already active.');
    return;
  }
  window.__layoutToolActive = true;

  // ---- 1. Category definitions ----
  // Each category maps a human label to a CSS selector.
  // This is what powers the checkboxes ("Buttons", "Images", etc.)
  const CATEGORIES = {
    buttons: { label: 'Buttons', selector: 'button, [role="button"], input[type="submit"], input[type="button"], a.btn, a.button' },
    images: { label: 'Images', selector: 'img, svg, picture, canvas' },
    text: { label: 'Text', selector: 'p, span, h1, h2, h3, h4, h5, h6, a:not([role="button"])' },
    containers: { label: 'Containers', selector: 'div, section, header, footer, nav, main, aside, article' }
  };

  // Track which categories are enabled. Buttons + Images default ON,
  // matching the example we sketched earlier.
  const enabled = { buttons: true, images: true, text: false, containers: false };

  // ---- 2. Build the floating control panel ----
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
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: 2147483647, // stay on top of the host page's own UI
    background: '#1e1e1e',
    color: '#fff',
    padding: '10px 12px',
    borderRadius: '8px',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
  });
  document.body.appendChild(panel);

  // Wire up checkboxes to the `enabled` map
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      enabled[cb.dataset.cat] = cb.checked;
    });
  });

  // "Remove tool" — full teardown, leaves zero trace (our "no risk" promise)
  document.getElementById('layout-tool-close').addEventListener('click', teardown);

  function teardown() {
    panel.remove();
    if (highlightBox) highlightBox.remove();
    if (resultCard) resultCard.remove();
    document.removeEventListener('mouseover', onHover);
    document.removeEventListener('pointerdown', onPointerDown, true);
    if (dragState) {
      dragState.el.removeEventListener('pointermove', onPointerMove);
      dragState.el.removeEventListener('pointerup', onPointerUp);
      dragState.el.removeEventListener('pointercancel', onPointerUp);
    }

    // Restore any element still showing a drag-preview transform, so the
    // page returns to exactly how it looked before the tool was added.
    document.querySelectorAll('[data-layout-tool-orig-transform]').forEach(el => {
      el.style.transform = el.dataset.layoutToolOrigTransform;
      delete el.dataset.layoutToolOrigTransform;
      el.style.cursor = '';
      el.style.touchAction = '';
    });

    window.__layoutToolActive = false;
  }

  // ---- 3. Hover highlighting ----
  // A single reusable "highlight box" div we move around via inset positioning,
  // rather than modifying the outline of the actual page elements (safer — never
  // touches the host page's own styles).
  const highlightBox = document.createElement('div');
  Object.assign(highlightBox.style, {
    position: 'fixed',
    pointerEvents: 'none',
    border: '2px solid #4f9dff',
    background: 'rgba(79,157,255,0.15)',
    zIndex: 2147483646,
    display: 'none'
  });
  document.body.appendChild(highlightBox);

  function isSelectable(el) {
    return Object.keys(CATEGORIES).some(key =>
      enabled[key] && el.matches(CATEGORIES[key].selector)
    );
  }

  function onHover(e) {
    const el = e.target;
    if (el === panel || panel.contains(el) || el === highlightBox) {
      highlightBox.style.display = 'none';
      return;
    }
    if (!isSelectable(el)) {
      highlightBox.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(highlightBox.style, {
      display: 'block',
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px'
    });
  }

  document.addEventListener('mouseover', onHover);

  // ---- 4. Drag-to-reposition, then read the NEW position ----
  // Uses Pointer Events (not mouse events) so this works with mouse,
  // touch (iPad/phone), and stylus through the same code path.
  let resultCard = null;
  let dragState = null; // { el, startX, startY, origRect, offsetX, offsetY }

  function onPointerDown(e) {
    const el = e.target;
    if (el === panel || panel.contains(el)) return;
    if (resultCard && (el === resultCard || resultCard.contains(el))) return;
    if (!isSelectable(el)) return;

    e.preventDefault();
    e.stopPropagation();

    // Explicitly kill native browser drag (images/links are draggable by
    // default) and text selection — both can swallow our move events
    // before our own drag logic sees them.
    el.setAttribute('draggable', 'false');
    document.body.style.userSelect = 'none';
    // Stops iOS Safari from treating the gesture as a page-scroll instead
    // of a drag — critical for touch devices.
    el.style.touchAction = 'none';

    // Route all subsequent pointer events to this element even if the
    // finger/cursor moves off it mid-drag — required for touch to track
    // correctly past the element's original bounds.
    el.setPointerCapture(e.pointerId);

    const origRect = el.getBoundingClientRect();
    dragState = {
      el,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origRect,
      offsetX: 0,
      offsetY: 0
    };
    console.log('[layout-tool] drag started on', el.tagName, el.className);

    // Neutralize any transform the page itself might already use, so our
    // drag offset is the only thing in play. We restore this on teardown.
    if (!el.dataset.layoutToolOrigTransform) {
      el.dataset.layoutToolOrigTransform = el.style.transform || '';
    }
    el.style.cursor = 'grabbing';

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    dragState.offsetX = e.clientX - dragState.startX;
    dragState.offsetY = e.clientY - dragState.startY;
    dragState.el.style.transform =
      `translate(${dragState.offsetX}px, ${dragState.offsetY}px)`;

    // live-update the highlight box so it tracks the element while dragging
    const rect = dragState.el.getBoundingClientRect();
    Object.assign(highlightBox.style, {
      display: 'block',
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px'
    });
  }

  function onPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const { el, origRect, offsetX, offsetY } = dragState;

    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    document.body.style.userSelect = '';
    el.style.cursor = '';

    console.log('[layout-tool] drag ended, offset:', offsetX, offsetY);

    // Only treat it as a "move" if they actually dragged (a plain tap/click
    // with ~0 movement just reads the current position instead).
    const moved = Math.abs(offsetX) > 2 || Math.abs(offsetY) > 2;

    const info = analyzeElement(el, origRect, offsetX, offsetY, moved);
    showResultCard(el, info);

    dragState = null;
  }

  document.addEventListener('pointerdown', onPointerDown, true);

  function analyzeElement(el, origRect, offsetX, offsetY, moved) {
    const style = getComputedStyle(el);
    const position = style.position; // 'static', 'relative', 'absolute', 'fixed', 'sticky'
    const isPositioned = position !== 'static';

    // Target position = where they DRAGGED it to, not just where it started.
    const raw = {
      x: Math.round(origRect.left + offsetX),
      y: Math.round(origRect.top + offsetY),
      width: Math.round(origRect.width),
      height: Math.round(origRect.height)
    };

    return { position, isPositioned, raw, moved };
  }

  function buildSnippet(info) {
    if (info.isPositioned) {
      // Case A: already positioned -> top/left is correct and will work directly
      return {
        label: '✅ This element is positioned (' + info.position + ') — use directly:',
        code: `top: ${info.raw.y}px;\nleft: ${info.raw.x}px;`
      };
    }
    // Case B: static (default flow) -> top/left would silently do nothing.
    // Offer margin as the safe default.
    return {
      label: '⚠️ This element is not positioned (position: static).\nMargin is the safer option — it won\'t break the surrounding layout:',
      code: `margin-top: ${info.raw.y}px;\nmargin-left: ${info.raw.x}px;`,
      altLabel: 'Or, if you want absolute positioning instead (removes it from normal flow):',
      altCode: `position: absolute;\ntop: ${info.raw.y}px;\nleft: ${info.raw.x}px;`
    };
  }

  function showResultCard(el, info) {
    if (resultCard) resultCard.remove();

    const snippet = buildSnippet(info);
    const rect = el.getBoundingClientRect();

    resultCard = document.createElement('div');
    resultCard.id = 'layout-tool-result';
    resultCard.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px;">Selected: &lt;${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}&gt;</div>
      <div style="font-size:11px;opacity:0.7;margin-bottom:4px;">${info.moved ? '📍 Position after your drag:' : '📍 Current position (no drag detected):'}</div>
      <div style="font-size:12px;opacity:0.8;margin-bottom:6px;">x=${info.raw.x}, y=${info.raw.y}, w=${info.raw.width}, h=${info.raw.height}</div>
      <div style="font-size:12px;white-space:pre-line;margin-bottom:4px;">${snippet.label}</div>
      <pre style="background:#111;padding:6px 8px;border-radius:4px;font-size:12px;margin:0 0 6px 0;">${snippet.code}</pre>
      <button class="layout-tool-copy" data-code="${encodeURIComponent(snippet.code)}" style="font-size:12px;">Copy</button>
      ${snippet.altCode ? `
        <div style="font-size:12px;white-space:pre-line;margin:8px 0 4px 0;">${snippet.altLabel}</div>
        <pre style="background:#111;padding:6px 8px;border-radius:4px;font-size:12px;margin:0 0 6px 0;">${snippet.altCode}</pre>
        <button class="layout-tool-copy" data-code="${encodeURIComponent(snippet.altCode)}" style="font-size:12px;">Copy</button>
      ` : ''}
      <button id="layout-tool-dismiss" style="font-size:12px;display:block;margin-top:6px;">Dismiss</button>
    `;
    Object.assign(resultCard.style, {
      position: 'fixed',
      top: Math.min(rect.bottom + 8, window.innerHeight - 220) + 'px',
      left: Math.min(rect.left, window.innerWidth - 300) + 'px',
      zIndex: 2147483647,
      background: '#1e1e1e',
      color: '#fff',
      padding: '10px 12px',
      borderRadius: '8px',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      maxWidth: '280px'
    });
    document.body.appendChild(resultCard);

    resultCard.querySelectorAll('.layout-tool-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = decodeURIComponent(btn.dataset.code);
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => (btn.textContent = 'Copy'), 1200);
        });
      });
    });
    resultCard.querySelector('#layout-tool-dismiss').addEventListener('click', () => {
      resultCard.remove();
      resultCard = null;
    });
  }

  console.log('Layout tool loaded. Hover to see selectable elements, click one to get its coordinates.');
})();
