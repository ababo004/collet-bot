/**
 * Wave integration — GraphQL API with API key
 *
 * Wave uses a single API key (no OAuth).
 * Required env var:  WAVE_API_KEY  (or stored in keychain)
 *
 * Wave API: https://developer.waveapps.com/hc/en-us/articles/360019968212
 */

const keytar = require('../main/keytar-safe')
const axios  = require('axios')
const log    = require('electron-log')
const { getSetting, setSetting } = require('../main/db')

const SERVICE_NAME = 'com.collet.app'
const API_URL      = 'https://gql.waveapps.com/graphql/public'

// ── Connect (store API key) ───────────────────────────────────────────────────

async function connectWave(apiKey) {
  if (!apiKey) return { ok: false, error: 'No API key provided' }

  // Validate the key with a lightweight query
  try {
    const res = await axios.post(
      API_URL,
      { query: '{ user { id email } }' },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    )

    if (res.data?.errors?.length) {
      return { ok: false, error: res.data.errors[0].message }
    }

    const email = res.data?.data?.user?.email
    await keytar.setPassword(SERVICE_NAME, 'wave_api_key', apiKey)
    setSetting('accounting_source', 'wave')

    log.info(`Wave connected (user: ${email})`)
    return { ok: true, email, provider: 'wave' }
  } catch (err) {
    log.error('Wave connect error:', err.message)
    return { ok: false, error: err.message }
  }
}

async function getBusinessId() {
  let businessId = getSetting('wave_business_id')
  if (businessId) return businessId

  const apiKey = await keytar.getPassword(SERVICE_NAME, 'wave_api_key')
  if (!apiKey) throw new Error('Wave not authenticated')

  const query = `{ businesses(page: 1, pageSize: 1) { edges { node { id name } } } }`
  const res = await axios.post(
    API_URL,
    { query },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
  )

  businessId = res.data?.data?.businesses?.edges?.[0]?.node?.id
  if (!businessId) throw new Error('No Wave business found')
  setSetting('wave_business_id', businessId)
  return businessId
}

async function fetchInvoices() {
  const apiKey     = await keytar.getPassword(SERVICE_NAME, 'wave_api_key')
  if (!apiKey) throw new Error('Wave not authenticated')
  const businessId = await getBusinessId()

  const query = `
    query($businessId: ID!) {
      business(id: $businessId) {
        invoices(page: 1, pageSize: 100, isOverdue: false) {
          edges {
            node {
              id
              invoiceNumber
              status
              dueDate
              amountDue { value currency { code } }
              customer {
                name
                email
              }
            }
          }
        }
      }
    }
  `

  const res = await axios.post(
    API_URL,
    { query, variables: { businessId } },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
  )

  const edges = res.data?.data?.business?.invoices?.edges || []

  return edges
    .map(e => e.node)
    .filter(inv => ['UNPAID', 'PARTIAL'].includes(inv.status) && inv.customer?.email)
    .map(inv => ({
      id:           `WAVE-${inv.id}`,
      client_name:  inv.customer.name || 'Unknown',
      client_email: inv.customer.email,
      amount:       parseFloat(inv.amountDue?.value || 0),
      currency:     inv.amountDue?.currency?.code || 'USD',
      due_date:     inv.dueDate,
      source:       'wave',
      status:       'open',
    }))
}

module.exports = { connectWave, fetchInvoices }
