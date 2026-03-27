// ui/radial-menu.js — Contextual radial command menu

export class RadialMenu {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'radial-menu';
    container.appendChild(this.el);
    this._onSelect = null;
    this._entity = null;

    // Close on outside click
    document.addEventListener('mousedown', e => {
      if (!this.el.contains(e.target)) this.close();
    });
  }

  open(x, y, entity, items = []) {
    this._entity = entity;
    this.el.classList.add('open');
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';

    const radius = 65;
    let html = '';
    const count = items.length;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i - Math.PI / 2;
      const ix = Math.cos(angle) * radius - 24;
      const iy = Math.sin(angle) * radius - 24;
      html += `
        <div class="radial-item" data-action="${items[i].id}"
             style="left:${ix}px; top:${iy}px;">
          ${items[i].icon || items[i].label[0]}
          <span class="radial-label">${items[i].label}</span>
        </div>`;
    }

    this.el.innerHTML = html;

    this.el.querySelectorAll('.radial-item').forEach(item => {
      item.addEventListener('click', () => {
        if (this._onSelect) this._onSelect(item.dataset.action, this._entity);
        this.close();
      });
    });
  }

  close() {
    this.el.classList.remove('open');
    this.el.innerHTML = '';
    this._entity = null;
  }

  onSelect(fn) {
    this._onSelect = fn;
  }
}
