import { list, insert, notify } from './store.js'

const DAY = 86400000
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10)
const daysAhead = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)

export function loadSampleBusiness(tenant, ownerUserId) {
  const currency = tenant.currency || 'NGN'

  const productSpecs = [
    { name: 'Consulting Retainer', unitPrice: 250000, unit: 'month' },
    { name: 'Product Design Package', unitPrice: 150000, unit: 'project' },
    { name: 'Cloud Setup & Support', unitPrice: 90000, unit: 'setup' },
    { name: 'Training Workshop', unitPrice: 120000, unit: 'session' },
  ]
  const products = productSpecs.map((p) =>
    insert(tenant, 'products', { ...p, description: '', sku: p.name.slice(0, 3).toUpperCase() + Math.floor(Math.random() * 900 + 100), active: true })
  )

  const customerSpecs = [
    { name: 'Kess Labs', email: 'hello@kesslabs.com', phone: '+234 801 111 0001', status: 'active' },
    { name: 'Adewole Foods', email: 'orders@adewolefoods.com', phone: '+234 802 222 0002', status: 'active' },
    { name: 'Brightline Realty', email: 'info@brightlinerealty.com', phone: '+234 803 333 0003', status: 'active' },
    { name: 'Novatech Retail', email: 'support@novatechretail.com', phone: '+234 804 444 0004', status: 'inactive' },
    { name: 'Harmony Clinics', email: 'admin@harmonyclinics.com', phone: '+234 805 555 0005', status: 'active' },
  ]
  const customers = customerSpecs.map((c) => insert(tenant, 'customers', { ...c, tags: ['seeded'] }))

  const leadSpecs = [
    { name: 'Greenfield Logistics', email: 'ops@greenfieldlogistics.com', phone: '+234 810 000 1001', source: 'Referral', status: 'new', ownerUserId, followUpDate: daysAhead(2) },
    { name: 'Urban Suites Hotel', email: 'gm@urbansuites.com', phone: '+234 811 000 1002', source: 'WhatsApp', status: 'contacted', ownerUserId, followUpDate: daysAhead(1) },
    { name: 'Freshmart Mart', email: 'buyer@freshmartmart.com', phone: '+234 812 000 1003', source: 'Website', status: 'qualified', ownerUserId, followUpDate: daysAhead(4) },
  ]
  leadSpecs.forEach((l) => insert(tenant, 'leads', l))

  const dealSpecs = [
    { name: 'Kess Labs — Growth Retainer', customerId: customers[0].id, amount: 3000000, stage: 'negotiation', ownerUserId, closeDate: daysAhead(15) },
    { name: 'Harmony Clinics — Cloud Setup', customerId: customers[4].id, amount: 950000, stage: 'proposal', ownerUserId, closeDate: daysAhead(10) },
    { name: 'Adewole Foods — Training', customerId: customers[1].id, amount: 360000, stage: 'qualification', ownerUserId, closeDate: daysAhead(30) },
    { name: 'Novatech — Design Package', customerId: customers[3].id, amount: 450000, stage: 'won', ownerUserId, closeDate: daysAgo(8) },
  ]
  dealSpecs.forEach((d) => insert(tenant, 'deals', d))

  const invoiceSpecs = [
    { customerId: customers[0].id, product: products[0], qty: 1, status: 'paid', dueOffset: -40, paid: true },
    { customerId: customers[1].id, product: products[2], qty: 1, status: 'paid', dueOffset: -25, paid: true },
    { customerId: customers[2].id, product: products[1], qty: 2, status: 'overdue', dueOffset: -12, paid: false },
    { customerId: customers[4].id, product: products[3], qty: 1, status: 'sent', dueOffset: 12, paid: false },
    { customerId: customers[0].id, product: products[0], qty: 1, status: 'sent', dueOffset: 6, paid: false },
    { customerId: customers[3].id, product: products[2], qty: 1, status: 'partial', dueOffset: -20, paid: 0.4 },
  ]
  let inv = 1001
  invoiceSpecs.forEach((spec) => {
    const lineItems = [{ productId: spec.product.id, name: spec.product.name, qty: spec.qty, unitPrice: spec.product.unitPrice, total: spec.qty * spec.product.unitPrice }]
    const total = lineItems.reduce((s, l) => s + l.total, 0)
    const paidAmount = spec.paid === true ? total : spec.paid === false ? 0 : Math.round(total * spec.paid)
    const invoice = insert(tenant, 'invoices', {
      invoiceNumber: 'INV-' + inv++,
      customerId: spec.customerId,
      status: spec.status,
      issueDate: daysAgo(45),
      dueDate: daysAhead(spec.dueOffset),
      lineItems,
      total,
      paidAmount,
    })
    if (paidAmount > 0) {
      insert(tenant, 'payments', { invoiceId: invoice.id, amount: paidAmount, method: 'Bank transfer', date: daysAgo(30), note: '' })
    }
  })

  const expenseSpecs = [
    { title: 'Office rent', category: 'Rent', amount: 500000, date: daysAgo(5), status: 'approved', submittedBy: ownerUserId },
    { title: 'Marketing adverts', category: 'Marketing', amount: 180000, date: daysAgo(3), status: 'pending', submittedBy: ownerUserId },
    { title: 'Internet subscription', category: 'Utilities', amount: 60000, date: daysAgo(2), status: 'approved', submittedBy: ownerUserId },
    { title: 'Team lunch', category: 'Operations', amount: 45000, date: daysAgo(1), status: 'rejected', submittedBy: ownerUserId },
  ]
  expenseSpecs.forEach((e) => insert(tenant, 'expenses', { ...e, note: '', approvedBy: e.status === 'approved' ? ownerUserId : '' }))

  const taskSpecs = [
    { title: 'Follow up on Urban Suites Hotel lead', assigneeId: ownerUserId, dueDate: daysAhead(1), priority: 'high', status: 'todo' },
    { title: 'Send proposal to Harmony Clinics', assigneeId: ownerUserId, dueDate: daysAhead(3), priority: 'medium', status: 'todo' },
    { title: 'Update product pricing', assigneeId: ownerUserId, dueDate: daysAgo(1), priority: 'medium', status: 'done' },
    { title: 'Chase Brightline Realty payment', assigneeId: ownerUserId, dueDate: daysAhead(2), priority: 'high', status: 'in_progress' },
  ]
  taskSpecs.forEach((t) => insert(tenant, 'tasks', { ...t, createdBy: ownerUserId }))

  notify(tenant, ownerUserId, 'welcome', 'Welcome to Jovalen', 'A sample business has been loaded so you can explore the platform.', '#/dashboard')

  return { products, customers }
}