/**
 * Dò xem Marketing API cho phép đọc những trường thanh toán nào.
 * Chạy: npm run fb:probe -- act_1697594428130036
 * File tạm để khảo sát, không phải một phần của CLI.
 */
import { get, GraphError } from './graph.js'

const FIELDS = [
  'amount_spent',
  'balance',
  'currency',
  'spend_cap',
  'account_status',
  'is_prepay_account',
  'funding_source',
  'funding_source_details',
  'next_bill_date',
  'owner',
  'business',
  'created_time',
  'disable_reason',
  'adtrust_dsl',
  'tax_id_status',
]

const EDGES = [
  'transactions',
  'adspaymentcycle',
  'payment_methods',
  'invoices',
  'assigned_users',
  'agencies',
  'adspixels',
]

/** ID không có tiền tố act_ được coi là Business, dò bộ trường/edge khác hẳn. */
const BUSINESS_FIELDS = [
  'name',
  'verification_status',
  'created_time',
  'primary_page',
  'is_hidden',
  'two_factor_type',
]

const BUSINESS_EDGES = [
  'business_invoices',
  'extendedcredits',
  'owned_ad_accounts',
  'client_ad_accounts',
  'system_users',
  'owned_pages',
]

async function probeField(accountId: string, field: string): Promise<void> {
  try {
    const data = await get<Record<string, unknown>>(accountId, { fields: field })
    const value = data[field]
    const shown = typeof value === 'object' ? JSON.stringify(value) : String(value)
    console.log(`  OK    ${field.padEnd(24)} ${shown?.slice(0, 90) ?? '(rỗng)'}`)
  } catch (error) {
    const reason = error instanceof GraphError ? `code ${error.code}: ${error.message}` : String(error)
    console.log(`  LỖI   ${field.padEnd(24)} ${reason.slice(0, 90)}`)
  }
}

async function probeEdge(accountId: string, edge: string): Promise<void> {
  try {
    const data = await get<{ data?: unknown[] }>(`${accountId}/${edge}`, { limit: 2 })
    const rows = data.data ?? []
    console.log(`  OK    ${edge.padEnd(24)} ${rows.length} bản ghi mẫu`)
    if (rows[0]) console.log(`        ${JSON.stringify(rows[0]).slice(0, 300)}`)
  } catch (error) {
    const reason = error instanceof GraphError ? `code ${error.code}: ${error.message}` : String(error)
    console.log(`  LỖI   ${edge.padEnd(24)} ${reason.slice(0, 90)}`)
  }
}

const objectId = process.argv[2]
if (!objectId) throw new Error('Thiếu <ad-account-id | business-id>')

const isAdAccount = objectId.startsWith('act_')
const fields = isAdAccount ? FIELDS : BUSINESS_FIELDS
const edges = isAdAccount ? EDGES : BUSINESS_EDGES

console.log(`\n=== Trường trên ${objectId} (${isAdAccount ? 'ad account' : 'business'}) ===`)
for (const field of fields) await probeField(objectId, field)

console.log(`\n=== Edge trên ${objectId} ===`)
for (const edge of edges) await probeEdge(objectId, edge)
