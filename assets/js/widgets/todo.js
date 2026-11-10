class TodoWidget extends BaseWidget {
  constructor(id, options) {
    super(id, options);
    this.size = options.size || 'medium';
    this.apiUrl = options.apiUrl || '/api/todo';
    this._defaultConfig = {
      maxItems: 15,
      showPriority: true,
      showDue: true,
      filterStatus: 'all'
    };
    this._configSchema = [
      { key: 'maxItems', label: 'Max items to show', type: 'number', min: 5, max: 50, step: 5 },
      { key: 'showPriority', label: 'Show priority badge', type: 'checkbox' },
      { key: 'showDue', label: 'Show due date', type: 'checkbox' },
      { key: 'filterStatus', label: 'Filter by status', type: 'select', options: [
        { value: 'all', label: 'All' },
        { value: 'pending', label: 'Pending only' },
        { value: 'done', label: 'Done only' }
      ]}
    ];
  }

  render() {
    this.element.innerHTML = `
      <div class="widget-header">
        <h3>TODO</h3>
        <div class="widget-header-actions">
          ${this.hasSettings() ? '<button class="widget-settings-btn" title="Settings">⚙</button>' : ''}
        </div>
      </div>
      <div class="widget-body" id="todo-list"></div>
    `;
    this.element.classList.add('widget-scroll');
    const btn = this.element.querySelector('.widget-settings-btn');
    if (btn) btn.addEventListener('click', () => this.toggleSettings());
  }

  async update() {
    const maxItems = this.getConfig('maxItems', 15);
    const showPriority = this.getConfig('showPriority', true);
    const showDue = this.getConfig('showDue', true);
    const filterStatus = this.getConfig('filterStatus', 'all');
    const list = this.element.querySelector('#todo-list');
    const count = this.element.querySelector('#todo-count');
    let d;
    try {
      const response = await fetch(this.apiUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      d = await response.json();
    } catch (e) {
      if (count) count.textContent = 'Unavailable';
      if (list) list.innerHTML = '<div class="empty-state">Tasks are unavailable.</div>';
      return;
    }
    if (!list) return;
    if (d?.error || !Array.isArray(d?.tasks)) {
      if (count) count.textContent = 'Unavailable';
      list.innerHTML = '<div class="empty-state">Tasks are unavailable.</div>';
      return;
    }
    if (count) count.textContent = `${d.pending || 0} \u0438\u0437 ${d.count || 0}`;
    let items = d.tasks;
    if (filterStatus === 'pending') items = items.filter(t => t.status !== 'done');
    else if (filterStatus === 'done') items = items.filter(t => t.status === 'done');
    items = items.slice(0, maxItems);
    if (!items.length) {
      // Empty-state copy is selected from fixed literals, never API content.
      const message = filterStatus === 'all' ? 'All done! 🎉' : 'No tasks match this filter.';
      list.innerHTML = `<div class="empty-state">${message}</div>`;
      return;
    }
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const statuses = new Set(['pending', 'in_progress', 'active', 'done']);
    const priorities = new Set(['low', 'medium', 'high']);
    // Task text/date are escaped; CSS classes are restricted to known values.
    list.innerHTML = items.map(t => {
      const status = statuses.has(t.status) ? t.status : 'pending';
      const priority = priorities.has(t.priority) ? t.priority : 'medium';
      return `
        <div class="todo-item ${status}">
          ${showPriority ? `<span class="todo-priority ${priority}">${priority[0].toUpperCase()}</span>` : ''}
          <span class="todo-text">${escape(t.text)}</span>
          ${showDue && t.due ? `<span class="todo-due">${escape(t.due)}</span>` : ''}
        </div>
      `;
    }).join('');
  }
}
window.TodoWidget = TodoWidget;
