const api = window.collet

let view     = 'invoices'
let invoices = []
let logs     = []
let stats    = {}
let settings = {}
let connState = {}
let openTpl  = null

// ── Navigation ─────────────────────────────────────────────────────────────

const VIEW_TITLES = {
  invoices:    'Invoices',
  activity:    'Activity Log',
  templates:   'Email Templates',
  connections: 'Connections',
  settings:    'Settings',
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
    el.classList.add('active')
    view = el.dataset.view
    document.getElementById('view-title').textContent = VIEW_TITLES[view] || ''
    openTpl = null
    render()
  })
})

// ── Top actions ────────────────────────────────────────────────────────────

document.getElementById('scan-btn').addEventListener('click', async () => {
  const btn = document.getElementById('scan-btn')
  btn.disabled = true
  btn.textContent = '⟳ Scanning…'
  setStatus('on')
  try { await api.dashboard.scanNow() } catch {}
  await loadAll()
  btn.disabled = false
  btn.textContent = '▶ Run Scan'
  setStatus('off')
  toast('Scan complete')
})

document.getElementById('refresh-btn').addEventListener('click', async () => {
  await loadAll()
  toast('Refreshed')
})

// ── Status ─────────────────────────────────────────────────────────────────

function setStatus(s) {
  document.getElementById('s-dot').className = 's-dot ' + (s === 'on' ? 'on' : '')
  document.getElementById('s-text').textContent = s === 'on' ? 'Scanning…' : 'Idle'
}

function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), 2400)
}

// ── Data ────────────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    const d = await api.dashboard.getData()
    invoices = d.invoices || []
    logs     = d.logs     || []
    stats    = d.stats    || {}
    settings = d.settings || {}

    // Derive connection state from settings returned by main process
    connState = {
      gmail:       settings.email_provider      === 'gmail',
      outlook:     settings.email_provider      === 'outlook',
      quickbooks:  settings.accounting_source   === 'quickbooks',
      xero:        settings.accounting_source   === 'xero',
      freshbooks:  settings.accounting_source   === 'freshbooks',
      wave:        settings.accounting_source   === 'wave',
      hubspot:     settings.crm_source          === 'hubspot',
      salesforce:  settings.crm_source          === 'salesforce',
      zoho:        settings.crm_source          === 'zoho',
      stripe:      settings.payment_source      === 'stripe',
      paypal:      settings.payment_source      === 'paypal',
    }

    if (stats.lastScan) {
      const t = new Date(stats.lastScan)
      document.getElementById('last-scan').textContent =
        'Last scan: ' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    render()
  } catch(e) { console.error('loadAll', e) }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function daysOff(due) {
  const d = new Date(due), t = new Date()
  d.setHours(0,0,0,0); t.setHours(0,0,0,0)
  return Math.round((t - d) / 86400000)
}

function statusBadge(inv) {
  if (inv.status === 'paid') return badge('PAID', 'b-green')
  const d = daysOff(inv.due_date)
  if (d < -1)  return badge(`DUE IN ${Math.abs(d)}d`, 'b-blue')
  if (d <= 0)  return badge('DUE TODAY', 'b-amber')
  if (d <= 7)  return badge(`OVERDUE ${d}d`, 'b-amber')
  return badge(`OVERDUE ${d}d`, 'b-red')
}

function lastStage(id) {
  const sent = logs.filter(l => l.invoice_id === id)
  if (!sent.length) return '<span style="color:var(--muted);font-size:12px">—</span>'
  const s = sent[sent.length - 1].stage || ''
  return badge(s.replace(/-/g,' ').toUpperCase(), 'b-blue')
}

function badge(text, cls) {
  return `<span class="badge ${cls}">${text}</span>`
}

// ── Render dispatch ──────────────────────────────────────────────────────────

function render() {
  document.getElementById('content').innerHTML = ({
    invoices:    renderInvoices,
    activity:    renderActivity,
    templates:   renderTemplates,
    connections: renderConnections,
    settings:    renderSettings,
  }[view] || renderInvoices)()

  afterRender()
}

function afterRender() {
  if (view === 'connections') bindConnButtons()
  if (view === 'settings')    bindSettingsForm()
  if (view === 'templates')   bindTemplates()
}

// ── Invoices ─────────────────────────────────────────────────────────────────

function renderInvoices() {
  const open    = invoices.filter(i => i.status !== 'paid')
  const paid    = invoices.filter(i => i.status === 'paid')
  const totalAR = open.reduce((s, i) => s + i.amount, 0)
  const overdue = open.filter(i => daysOff(i.due_date) > 0)

  return `
    <div class="stats-row">
      <div class="stat">
        <div class="stat-label">Open Invoices</div>
        <div class="stat-val">${open.length}</div>
        <div class="stat-sub">${overdue.length} overdue</div>
      </div>
      <div class="stat">
        <div class="stat-label">Total AR Outstanding</div>
        <div class="stat-val">${fmt(totalAR)}</div>
        <div class="stat-sub">across ${open.length} invoices</div>
      </div>
      <div class="stat">
        <div class="stat-label">Sequences Active</div>
        <div class="stat-val">${stats.active || 0}</div>
        <div class="stat-sub">invoices in follow-up</div>
      </div>
      <div class="stat">
        <div class="stat-label">Paid This Run</div>
        <div class="stat-val">${paid.length}</div>
        <div class="stat-sub">invoices collected</div>
      </div>
    </div>

    <div class="section">
      <div class="sec-head">
        <span class="sec-title">All Invoices (${invoices.length})</span>
      </div>
      <div class="card">
        ${invoices.length ? `
        <table>
          <thead><tr>
            <th>Invoice #</th>
            <th>Client</th>
            <th>Amount</th>
            <th>Due Date</th>
            <th>Status</th>
            <th>Last Stage Sent</th>
          </tr></thead>
          <tbody>
            ${invoices.map(inv => `
              <tr>
                <td class="mono">${inv.id}</td>
                <td>
                  <div style="font-weight:500">${inv.client_name}</div>
                  <div style="font-size:11px;color:var(--muted);margin-top:2px">${inv.client_email}</div>
                </td>
                <td style="font-weight:600">${fmt(inv.amount)}</td>
                <td class="mono" style="color:var(--muted)">${inv.due_date}</td>
                <td>${statusBadge(inv)}</td>
                <td>${lastStage(inv.id)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<div class="empty">No invoices yet — click Run Scan to fetch from your accounting system.</div>'}
      </div>
    </div>`
}

// ── Activity ──────────────────────────────────────────────────────────────────

function renderActivity() {
  return `
    <div class="section">
      <div class="sec-head">
        <span class="sec-title">Activity Log (${logs.length} events)</span>
      </div>
      <div class="card">
        ${logs.length ? logs.map(l => {
          const t = new Date(l.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          const stage = (l.stage || '').replace(/-/g, ' ')
          return `
            <div class="log-item">
              <span class="log-time">${t}</span>
              <div class="log-content">
                <span class="log-bold">${l.client_name || l.email_to}</span>
                &nbsp;·&nbsp;<span style="text-transform:capitalize">${stage}</span>
                &nbsp;<span style="color:var(--muted)">— ${l.subject || ''}</span>
              </div>
              ${badge(l.status === 'sent' ? 'SENT' : (l.status||'').toUpperCase(), l.status === 'sent' ? 'b-green' : 'b-gray')}
            </div>`
        }).join('') : '<div class="empty">No activity yet — run a scan to trigger sequences.</div>'}
      </div>
    </div>`
}

// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'pre-due',
    name: 'Pre-Due Reminder',
    trigger: 'Sent 3 days before due date',
    subject: 'Upcoming payment reminder — Invoice #{{invoice_number}}',
    body: `Hi {{client_name}},

This is a friendly reminder that Invoice #{{invoice_number}} for {{amount}} is due on {{due_date}} — just 3 days away.

If you have already processed this payment, please disregard this message.

{{pay_link}}

Best regards,
{{sender_name}}`,
  },
  {
    id: 'due-today',
    name: 'Due Today',
    trigger: 'Sent on the due date',
    subject: 'Invoice #{{invoice_number}} is due today — {{amount}}',
    body: `Hi {{client_name}},

Invoice #{{invoice_number}} for {{amount}} is due today.

Please process payment at your earliest convenience to avoid any late fees.

{{pay_link}}

Best regards,
{{sender_name}}`,
  },
  {
    id: 'follow-up',
    name: 'First Follow-Up',
    trigger: 'Sent 7 days after due date',
    subject: 'Following up — Invoice #{{invoice_number}}',
    body: `Hi {{client_name}},

We noticed that Invoice #{{invoice_number}} for {{amount}}, which was due on {{due_date}}, remains unpaid.

Could you let us know when we can expect payment? If there is an issue, we're happy to discuss.

{{pay_link}}

Best regards,
{{sender_name}}`,
  },
  {
    id: 'notice',
    name: 'Overdue Notice',
    trigger: 'Sent 14 days after due date',
    subject: 'Outstanding balance — Invoice #{{invoice_number}}',
    body: `Dear {{client_name}},

Invoice #{{invoice_number}} for {{amount}} remains outstanding, now {{days_overdue}} days past the due date of {{due_date}}.

Per the terms of our agreement, we request payment at your earliest convenience.

{{pay_link}}

Regards,
{{sender_name}}`,
  },
  {
    id: 'final-notice',
    name: 'Final Notice',
    trigger: 'Sent 30 days after due date',
    subject: 'Final notice — Invoice #{{invoice_number}} ({{amount}})',
    body: `Dear {{client_name}},

This is a final notice regarding Invoice #{{invoice_number}} for {{amount}}, now {{days_overdue}} days overdue.

If payment is not received within 7 days, we may need to escalate this matter. We strongly encourage you to resolve this immediately.

{{pay_link}}

Regards,
{{sender_name}}`,
  },
]

const VARS = ['{{invoice_number}}','{{client_name}}','{{amount}}','{{due_date}}','{{days_overdue}}','{{sender_name}}','{{pay_link}}']

function renderTemplates() {
  return `
    <div class="section">
      <div class="sec-head">
        <span class="sec-title">Collection Sequence — 5 Stages</span>
        <span style="font-size:11px;color:var(--muted)">Click any stage to edit subject & body</span>
      </div>
      <div class="template-list">
        ${TEMPLATES.map((tpl, i) => `
          <div>
            <div class="tpl-row ${openTpl === tpl.id ? 'open' : ''}" data-tpl="${tpl.id}">
              <div class="tpl-num">${i + 1}</div>
              <div class="tpl-info">
                <div class="tpl-name">${tpl.name}</div>
                <div class="tpl-trigger">${tpl.trigger}</div>
                <div class="tpl-subject mono">${tpl.subject}</div>
              </div>
              <span style="color:var(--muted);font-size:18px">${openTpl === tpl.id ? '›' : '›'}</span>
            </div>
            <div class="tpl-expand ${openTpl === tpl.id ? 'open' : ''}">
              <div class="tpl-field">
                <div class="tpl-field-label">Subject Line</div>
                <input class="tpl-input" id="subj-${tpl.id}" value="${tpl.subject}" />
              </div>
              <div class="tpl-field">
                <div class="tpl-field-label">Email Body</div>
                <textarea class="tpl-input" id="body-${tpl.id}" rows="8">${tpl.body}</textarea>
              </div>
              <div style="margin-top:8px;margin-bottom:10px">
                <div class="tpl-field-label" style="margin-bottom:6px">Available variables</div>
                <div class="tpl-vars">
                  ${VARS.map(v => `<span class="tpl-var">${v}</span>`).join('')}
                </div>
              </div>
              <button class="btn btn-primary" style="font-size:12px" data-save="${tpl.id}">Save Template</button>
            </div>
          </div>`
        ).join('')}
      </div>
    </div>`
}

function bindTemplates() {
  document.querySelectorAll('.tpl-row').forEach(row => {
    row.addEventListener('click', () => {
      openTpl = openTpl === row.dataset.tpl ? null : row.dataset.tpl
      render()
    })
  })

  document.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const id   = btn.dataset.save
      const tpl  = TEMPLATES.find(t => t.id === id)
      if (!tpl) return
      tpl.subject = document.getElementById(`subj-${id}`).value
      tpl.body    = document.getElementById(`body-${id}`).value
      toast('Template saved')
    })
  })
}

// ── Connections ───────────────────────────────────────────────────────────────

// ── Connection catalogue ───────────────────────────────────────────────────
// credFields: shown in the modal before launching OAuth / API connect
//   { key, label, type, placeholder, hint, hintLink }
// settingKey: which settings value determines "connected" state

const CONNECTIONS = [
  {
    group: 'Email',
    items: [
      {
        id: 'gmail', name: 'Gmail', icon: 'G',
        desc: 'Send follow-ups & detect payments via Gmail',
        settingKey: 'email_provider',
        oauthFn: () => api.setup.oauthGmail(),
        credFields: [
          { key: 'GOOGLE_CLIENT_ID',     label: 'Google Client ID',     type: 'text',     placeholder: '123456789.apps.googleusercontent.com' },
          { key: 'GOOGLE_CLIENT_SECRET', label: 'Google Client Secret', type: 'password', placeholder: 'GOCSPX-…' },
        ],
        hint: 'Create OAuth 2.0 credentials in the',
        hintLink: { text: 'Google Cloud Console', url: 'https://console.cloud.google.com/apis/credentials' },
      },
      {
        id: 'outlook', name: 'Outlook / M365', icon: 'M',
        desc: 'Send follow-ups & detect payments via Outlook',
        settingKey: 'email_provider',
        oauthFn: () => api.setup.oauthOutlook(),
        credFields: [
          { key: 'OUTLOOK_CLIENT_ID',     label: 'Azure App (Client) ID',     type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
          { key: 'OUTLOOK_CLIENT_SECRET', label: 'Azure Client Secret Value', type: 'password', placeholder: '~xxxxxx…' },
          { key: 'OUTLOOK_TENANT_ID',     label: 'Directory (Tenant) ID',     type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx or "common"' },
        ],
        hint: 'Register an app in the',
        hintLink: { text: 'Azure Portal', url: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
      },
    ]
  },
  {
    group: 'Accounting',
    items: [
      {
        id: 'quickbooks', name: 'QuickBooks Online', icon: 'QB',
        desc: 'Sync unpaid invoices automatically',
        settingKey: 'accounting_source',
        oauthFn: () => api.setup.oauthQuickBooks(),
        credFields: [
          { key: 'QB_CLIENT_ID',     label: 'QuickBooks Client ID',     type: 'text',     placeholder: 'ABxxxxxx…' },
          { key: 'QB_CLIENT_SECRET', label: 'QuickBooks Client Secret', type: 'password', placeholder: 'xxxxxxxxxx…' },
        ],
        hint: 'Create an app on the',
        hintLink: { text: 'Intuit Developer Portal', url: 'https://developer.intuit.com/app/developer/myapps' },
      },
      {
        id: 'xero', name: 'Xero', icon: 'X',
        desc: 'Sync unpaid invoices from Xero',
        settingKey: 'accounting_source',
        oauthFn: () => api.setup.oauthXero(),
        credFields: [
          { key: 'XERO_CLIENT_ID',     label: 'Xero Client ID',     type: 'text',     placeholder: 'xxxxxxxx-xxxx-…' },
          { key: 'XERO_CLIENT_SECRET', label: 'Xero Client Secret', type: 'password', placeholder: 'xxxxxxxxxx…' },
        ],
        hint: 'Register an app in the',
        hintLink: { text: 'Xero Developer Portal', url: 'https://developer.xero.com/app/manage' },
      },
      {
        id: 'freshbooks', name: 'FreshBooks', icon: 'FB',
        desc: 'Sync outstanding invoices from FreshBooks',
        settingKey: 'accounting_source',
        oauthFn: () => api.setup.oauthFreshBooks(),
        credFields: [
          { key: 'FRESHBOOKS_CLIENT_ID',     label: 'FreshBooks Client ID',     type: 'text',     placeholder: 'xxxxxxxxxx…' },
          { key: 'FRESHBOOKS_CLIENT_SECRET', label: 'FreshBooks Client Secret', type: 'password', placeholder: 'xxxxxxxxxx…' },
        ],
        hint: 'Create an app in the',
        hintLink: { text: 'FreshBooks Developer Portal', url: 'https://my.freshbooks.com/#/developer' },
      },
      {
        id: 'wave', name: 'Wave', icon: 'W',
        desc: 'Sync invoices via Wave API',
        settingKey: 'accounting_source',
        connectFn: (creds) => api.setup.connectWave(creds['WAVE_API_KEY']),
        credFields: [
          { key: 'WAVE_API_KEY', label: 'Wave Full Access Token', type: 'password', placeholder: 'xxxxxxxxxx…' },
        ],
        hint: 'Generate a token in',
        hintLink: { text: 'Wave Developer Settings', url: 'https://developer.waveapps.com/hc/en-us/articles/360019968212' },
      },
    ]
  },
  {
    group: 'CRM',
    items: [
      {
        id: 'hubspot', name: 'HubSpot CRM', icon: 'HS',
        desc: 'Log activity & sync contact status',
        settingKey: 'crm_source',
        oauthFn: () => api.setup.oauthHubSpot(),
        credFields: [
          { key: 'HUBSPOT_CLIENT_ID',     label: 'HubSpot App Client ID',     type: 'text',     placeholder: 'xxxxxxxx-xxxx-…' },
          { key: 'HUBSPOT_CLIENT_SECRET', label: 'HubSpot App Client Secret', type: 'password', placeholder: 'xxxxxxxxxx…' },
        ],
        hint: 'Create a private app in',
        hintLink: { text: 'HubSpot Settings → Integrations', url: 'https://app.hubspot.com/developer-docs/api' },
      },
      {
        id: 'salesforce', name: 'Salesforce', icon: 'SF',
        desc: 'Log Tasks & close Opportunities on payment',
        settingKey: 'crm_source',
        oauthFn: () => api.setup.oauthSalesforce(),
        credFields: [
          { key: 'SALESFORCE_CLIENT_ID',     label: 'Salesforce Consumer Key',    type: 'text',     placeholder: '3MVG9…' },
          { key: 'SALESFORCE_CLIENT_SECRET', label: 'Salesforce Consumer Secret', type: 'password', placeholder: 'xxxxxxxxxx…' },
        ],
        hint: 'Create a Connected App in',
        hintLink: { text: 'Salesforce Setup → App Manager', url: 'https://login.salesforce.com' },
      },
      {
        id: 'zoho', name: 'Zoho CRM', icon: 'ZH',
        desc: 'Log Notes & close Deals on payment',
        settingKey: 'crm_source',
        oauthFn: () => api.setup.oauthZoho(),
        credFields: [
          { key: 'ZOHO_CLIENT_ID',     label: 'Zoho Client ID',     type: 'text',     placeholder: '1000.xxxxxxxxxx…' },
          { key: 'ZOHO_CLIENT_SECRET', label: 'Zoho Client Secret', type: 'password', placeholder: 'xxxxxxxxxx…' },
        ],
        hint: 'Register an app in the',
        hintLink: { text: 'Zoho API Console', url: 'https://api-console.zoho.com/' },
      },
    ]
  },
  {
    group: 'Payment Detection',
    items: [
      {
        id: 'stripe', name: 'Stripe', icon: 'S',
        desc: 'Auto-mark invoices paid via Stripe charges',
        settingKey: 'payment_source',
        connectFn: (creds) => api.setup.connectStripe(creds['STRIPE_SECRET_KEY']),
        credFields: [
          { key: 'STRIPE_SECRET_KEY', label: 'Stripe Secret Key', type: 'password', placeholder: 'sk_live_… or sk_test_…' },
        ],
        hint: 'Find your keys in',
        hintLink: { text: 'Stripe Dashboard → Developers', url: 'https://dashboard.stripe.com/apikeys' },
      },
      {
        id: 'paypal', name: 'PayPal', icon: 'PP',
        desc: 'Auto-mark invoices paid via PayPal transactions',
        settingKey: 'payment_source',
        oauthFn: () => api.setup.oauthPayPal(),
        credFields: [
          { key: 'PAYPAL_CLIENT_ID',     label: 'PayPal App Client ID',     type: 'text',     placeholder: 'AxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxA' },
          { key: 'PAYPAL_CLIENT_SECRET', label: 'PayPal App Secret',        type: 'password', placeholder: 'ExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxE' },
        ],
        hint: 'Create an app in',
        hintLink: { text: 'PayPal Developer Dashboard', url: 'https://developer.paypal.com/dashboard/applications' },
      },
    ]
  },
]

// ── Modal state ──────────────────────────────────────────────────────────────

let modalItem    = null
let modalResolve = null

function openCredModal(item) {
  modalItem = item
  document.getElementById('modal-title').textContent = `Connect ${item.name}`
  document.getElementById('modal-sub').textContent   = item.desc

  const fieldsHtml = item.credFields.map(f => `
    <div class="modal-field">
      <label class="modal-label">${f.label}</label>
      <input class="modal-input"
        id="mf-${f.key}"
        type="${f.type || 'text'}"
        placeholder="${f.placeholder || ''}"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  `).join('')

  const hintHtml = item.hint ? `
    <div class="modal-hint">
      ${item.hint} <a href="#" data-href="${item.hintLink.url}">${item.hintLink.text}</a>.
    </div>` : ''

  document.getElementById('modal-fields').innerHTML = fieldsHtml + hintHtml

  // Wire hint links to open externally
  document.querySelectorAll('#modal-fields a[data-href]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault()
      api.openExternal(a.dataset.href)
    })
  })

  document.getElementById('cred-modal').style.display = 'flex'

  // Focus first input
  const first = document.querySelector('#modal-fields .modal-input')
  if (first) setTimeout(() => first.focus(), 50)
}

function closeCredModal() {
  document.getElementById('cred-modal').style.display = 'none'
  modalItem    = null
  modalResolve = null
}

document.getElementById('modal-close').addEventListener('click',  closeCredModal)
document.getElementById('modal-cancel').addEventListener('click', closeCredModal)
document.getElementById('cred-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('cred-modal')) closeCredModal()
})

document.getElementById('modal-connect').addEventListener('click', async () => {
  if (!modalItem) return

  // Collect field values
  const creds = {}
  let missing = false
  for (const f of modalItem.credFields) {
    const val = (document.getElementById(`mf-${f.key}`)?.value || '').trim()
    if (!val) { missing = true; document.getElementById(`mf-${f.key}`)?.focus(); break }
    creds[f.key] = val
  }
  if (missing) { toast('Please fill in all fields'); return }

  const btn = document.getElementById('modal-connect')
  btn.disabled    = true
  btn.textContent = 'Connecting…'

  try {
    // Save credentials to keychain via IPC
    await api.setup.saveCredentials(creds)

    // Launch OAuth or direct connect
    let res
    if (modalItem.connectFn) {
      res = await modalItem.connectFn(creds)
    } else {
      res = await modalItem.oauthFn()
    }

    if (res && res.ok) {
      closeCredModal()
      await loadAll()
      toast(`${modalItem.name} connected successfully`)
    } else {
      toast(`Failed: ${res?.error || 'unknown error'}`)
    }
  } catch (e) {
    toast(`Error: ${e.message}`)
  } finally {
    btn.disabled    = false
    btn.textContent = 'Save & Connect →'
  }
})

// ── Keyboard shortcut ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCredModal()
  if (e.key === 'Enter' && document.getElementById('cred-modal').style.display !== 'none') {
    document.getElementById('modal-connect').click()
  }
})

// ── Connections rendering ────────────────────────────────────────────────────

function isConnected(item) {
  return (settings[item.settingKey] || '') === item.id
}

function renderConnections() {
  return CONNECTIONS.map(group => `
    <div class="conn-section">
      <div class="conn-section-title">${group.group}</div>
      <div class="conn-grid">
        ${group.items.map(item => {
          const conn = isConnected(item)
          const addrLine = (item.id === 'gmail' || item.id === 'outlook') && conn && settings.email_address
            ? `<div class="conn-addr">${settings.email_address}</div>` : ''

          return `
            <div class="conn-card ${conn ? 'connected' : ''}" id="card-${item.id}">
              <div class="conn-lft">
                <div class="conn-icon">${item.icon}</div>
                <div>
                  <div class="conn-name">${item.name}</div>
                  <div class="conn-meta">${item.desc}</div>
                  ${addrLine}
                </div>
              </div>
              <div class="conn-rgt">
                <span class="conn-st ${conn ? 'on' : 'off'}">${conn ? '● Connected' : '○ Not connected'}</span>
                <button class="btn-conn ${conn ? 'connected' : ''}" data-id="${item.id}">
                  ${conn ? '↻ Reconnect' : 'Connect →'}
                </button>
              </div>
            </div>`
        }).join('')}
      </div>
    </div>`
  ).join('')
}

function bindConnButtons() {
  document.querySelectorAll('.btn-conn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.id
      const item = CONNECTIONS.flatMap(g => g.items).find(i => i.id === id)
      if (item) openCredModal(item)
    })
  })
}

// ── Settings ──────────────────────────────────────────────────────────────────

function renderSettings() {
  const s = settings
  return `
    <div class="settings-grid">
      <div class="settings-block">
        <div class="settings-block-title">Scan Behaviour</div>
        <div class="field">
          <label class="field-label">Scan Frequency</label>
          <select class="f-input" id="s-freq">
            <option value="0 * * * *"      ${s.scan_frequency==='0 * * * *'      ?'selected':''}>Every hour</option>
            <option value="0 */2 * * *"    ${s.scan_frequency==='0 */2 * * *'    ?'selected':''}>Every 2 hours</option>
            <option value="0 */4 * * *"    ${s.scan_frequency==='0 */4 * * *'    ?'selected':''}>Every 4 hours</option>
            <option value="0 */6 * * *"    ${s.scan_frequency==='0 */6 * * *'    ?'selected':''}>Every 6 hours</option>
            <option value="0 */12 * * *"   ${s.scan_frequency==='0 */12 * * *'   ?'selected':''}>Every 12 hours</option>
            <option value="0 9,17 * * 1-5" ${s.scan_frequency==='0 9,17 * * 1-5'?'selected':''}>9am & 5pm, weekdays</option>
            <option value="0 9 * * 1-5"    ${s.scan_frequency==='0 9 * * 1-5'   ?'selected':''}>9am weekdays only</option>
          </select>
        </div>
      </div>

      <div class="settings-block">
        <div class="settings-block-title">Sender Identity</div>
        <div class="field">
          <label class="field-label">Sender Name</label>
          <input class="f-input" id="s-sender" value="${s.sender_name || ''}" placeholder="Accounts Receivable" />
          <div class="field-hint">Shown as the "From" name in outgoing emails</div>
        </div>
        <div class="field">
          <label class="field-label">Payment Link</label>
          <input class="f-input" id="s-paylink" value="${s.pay_link || ''}" placeholder="https://pay.yourcompany.com" />
          <div class="field-hint">Included as a CTA button in every email</div>
        </div>
      </div>
    </div>

    <div style="margin-top:20px">
      <button class="btn btn-primary" id="save-settings-btn">Save Settings</button>
    </div>`
}

function bindSettingsForm() {
  document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
    const freq   = document.getElementById('s-freq').value
    const sender = document.getElementById('s-sender').value.trim()
    const paylink= document.getElementById('s-paylink').value.trim()
    await api.setup.saveSetting('scan_frequency', freq)
    await api.setup.saveSetting('sender_name', sender || 'Accounts Receivable')
    if (paylink) await api.setup.saveSetting('pay_link', paylink)
    await loadAll()
    toast('Settings saved')
  })
}

// ── Boot ───────────────────────────────────────────────────────────────────────

loadAll()
setInterval(loadAll, 8000)
