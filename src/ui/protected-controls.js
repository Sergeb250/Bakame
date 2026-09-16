/* All transient controls live in the protected BrowserWindow, never native popups. */
(() => {
  let active = null;
  let confirmation = null;
  const resized = () => document.dispatchEvent(new Event('protected-ui-size'));
  function dismiss(restore = false) {
    if (!active) return;
    const previous = active;
    active = null;
    previous.panel.remove();
    previous.trigger?.setAttribute('aria-expanded', 'false');
    if (restore) previous.trigger?.focus();
    resized();
  }
  function place(panel, anchor) {
    const rect = anchor.getBoundingClientRect();
    const toolbar = !!document.querySelector('.command-tab');
    const width = Math.min(260, Math.max(170, rect.width));
    panel.style.width = `${Math.min(width, window.innerWidth - 12)}px`;
    panel.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - width - 6))}px`;
    const height = Math.min(panel.scrollHeight, 240);
    panel.style.top = `${!toolbar && rect.bottom + height > window.innerHeight - 8
      ? Math.max(6, rect.top - height - 4) : rect.bottom + 4}px`;
    resized();
  }
  function enhance(select) {
    if (select.dataset.protected) return;
    select.dataset.protected = 'true';
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `${select.className} protected-select`;
    trigger.id = `${select.id}-control`;
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.id.replace(/([A-Z])/g, ' $1'));
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    select.after(trigger);
    const sync = () => {
      trigger.textContent = `${select.selectedOptions[0]?.textContent || 'Choose'} ▾`;
      trigger.disabled = select.disabled;
      if (active?.trigger === trigger) dismiss();
      resized();
    };
    // Keep the existing settings/value/change contract, including programmatic updates.
    for (const property of ['value', 'selectedIndex', 'disabled']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, property);
      Object.defineProperty(select, property, {
        configurable: true,
        get: () => descriptor.get.call(select),
        set: value => { descriptor.set.call(select, value); sync(); }
      });
    }
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
    select.addEventListener('change', sync);
    const open = () => {
      if (trigger.disabled) return;
      if (active?.trigger === trigger) { dismiss(true); return; }
      dismiss();
      const panel = document.createElement('div');
      panel.className = 'protected-floating protected-listbox';
      panel.id = `${select.id}-options`;
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', trigger.getAttribute('aria-label'));
      trigger.setAttribute('aria-controls', panel.id);
      for (const option of select.options) {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.dataset.value = option.value;
        item.disabled = option.disabled;
        item.textContent = option.textContent;
        item.addEventListener('click', () => {
          dismiss(true);
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        panel.append(item);
      }
      active = { panel, trigger };
      document.body.append(panel);
      trigger.setAttribute('aria-expanded', 'true');
      place(panel, trigger);
      const items = [...panel.querySelectorAll('button:not(:disabled)')];
      (items.find(item => item.dataset.value === select.value) || items[0])?.focus();
      let typed = '', lastTyped = 0;
      panel.addEventListener('keydown', event => {
        const index = items.indexOf(document.activeElement);
        let next;
        if (event.key === 'ArrowDown') next = (index + 1) % items.length;
        if (event.key === 'ArrowUp') next = (index + items.length - 1) % items.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = items.length - 1;
        if (event.key.length === 1 && event.key !== ' ') {
          typed = (Date.now() - lastTyped > 700 ? '' : typed) + event.key.toLowerCase();
          lastTyped = Date.now();
          next = items.findIndex(item => item.textContent.toLowerCase().startsWith(typed));
        }
        if (next !== undefined && next >= 0) { event.preventDefault(); items[next]?.focus(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(true); }
        if (event.key === 'Tab') dismiss(true);
      });
    };
    trigger.addEventListener('click', open);
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); open(); }
    });
    sync();
  }
  window.protectedUI = {
    dismiss,
    confirm(message, acceptLabel = 'Clear') {
      if (confirmation) return confirmation;
      dismiss();
      confirmation = new Promise(resolve => {
        const previous = document.activeElement;
        const backdrop = document.createElement('div');
        backdrop.className = 'protected-backdrop';
        const dialog = document.createElement('section');
        dialog.className = 'protected-dialog';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', message);
        const text = document.createElement('p');
        text.textContent = message;
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        const accept = document.createElement('button');
        accept.textContent = acceptLabel;
        accept.className = 'protected-accept';
        const finish = result => {
          backdrop.remove(); previous?.focus(); confirmation = null; resolve(result);
        };
        cancel.onclick = () => finish(false);
        accept.onclick = () => finish(true);
        backdrop.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
          if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === cancel ? accept : cancel).focus(); }
        });
        dialog.append(text, cancel, accept);
        backdrop.append(dialog);
        document.body.append(backdrop);
        cancel.focus();
      });
      return confirmation;
    }
  };
  document.addEventListener('pointerdown', event => {
    if (active && !active.panel.contains(event.target) && !active.trigger?.contains(event.target)) dismiss();
  });
  window.addEventListener('blur', () => dismiss());
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('select').forEach(enhance);
    // Native title tooltips are separate windows on Windows. Use DOM tooltips instead.
    const convertTitles = root => {
      const nodes = [...(root.querySelectorAll?.('[title]') || [])];
      if (root.hasAttribute?.('title')) nodes.push(root);
      for (const node of nodes) {
        node.dataset.tooltip = node.getAttribute('title');
        node.removeAttribute('title');
      }
    };
    convertTitles(document);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') convertTitles(record.target);
        else record.addedNodes.forEach(convertTitles);
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    document.addEventListener('pointerover', event => {
      const trigger = event.target.closest('[data-tooltip]');
      if (!trigger || active || !trigger.dataset.tooltip) return;
      const panel = document.createElement('div');
      panel.className = 'protected-floating protected-tooltip';
      panel.setAttribute('role', 'tooltip');
      panel.textContent = trigger.dataset.tooltip;
      active = { panel, trigger };
      document.body.append(panel);
      place(panel, trigger);
    });
    document.addEventListener('pointerout', event => {
      if (active?.panel.classList.contains('protected-tooltip') && !active.trigger.contains(event.relatedTarget)) dismiss();
    });
  });
})();
