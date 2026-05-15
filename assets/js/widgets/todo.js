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
    let d;
    try { d = await (await fetch(this.apiUrl)).json(); } catch(e) { return; }
    const list = this.element.querySelector('#todo-list');
    const count = this.element.querySelector('#todo-count');
    if(count) count.textContent = `${d.pending||0} \u0438\u0437 ${d.count||0}`;
    if(!list) return;
    let items = d.tasks || [];
    if (filterStatus === 'pending') items = items.filter(t => t.status !== 'done');
    else if (filterStatus === 'done') items = items.filter(t => t.status === 'done');
    items = items.slice(0, maxItems);
    if(!items.length) { list.innerHTML = '<div class="empty-state">All done! \uD83C\uDF89</div>'; return; }
    list.innerHTML = items.map(t => `
      <div class="todo-item ${t.status}">
        ${showPriority ? `<span class="todo-priority ${t.priority}">${t.priority[0].toUpperCase()}</span>` : ''}
        <span class="todo-text">${t.text}</span>
        ${showDue && t.due ? `<span class="todo-due">${t.due}</span>` : ''}
      </div>
    `).join('');
  }
}
window.TodoWidget = TodoWidget;
