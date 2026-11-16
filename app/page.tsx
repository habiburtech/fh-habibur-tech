  const [spendForm, setSpendForm] = useState({ campaign_id: '', spent_usd: '' });

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (data.session) void load(data.session.user.id); else setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) void load(s.user.id);
      else { setProfile(null); setClients([]); setCampaigns([]); setPayments([]); setExpenses([]); setDollarTx([]); setInvoices([]); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function load(uid: string) {
    if (!supabase) return;
    setLoading(true); setError('');
    const p = await supabase.from('profiles').select('full_name,role').eq('id', uid).single();
    if (p.error) { setError(p.error.message); setLoading(false); return; }
    setProfile(p.data as Profile);
    const [c, a] = await Promise.all([
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('campaigns').select('*').order('created_at', { ascending: false })
    ]);
    if (c.error) setError(c.error.message); else setClients(c.data || []);
    if (a.error) setError(a.error.message); else setCampaigns(a.data || []);
    if (p.data.role === 'admin' || p.data.role === 'accountant') {
      const [pm, ex, dx, inv] = await Promise.all([
        supabase.from('payments').select('*').order('payment_date', { ascending: false }),
        supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
        supabase.from('dollar_transactions').select('*').order('transaction_date', { ascending: false }),
        supabase.from('invoices').select('*').order('issue_date', { ascending: false })
      ]);
      if (pm.error) setError(pm.error.message); else setPayments(pm.data || []);
      if (ex.error) setError(ex.error.message); else setExpenses(ex.data || []);
      if (dx.error) setError(dx.error.message); else setDollarTx(dx.data || []);
      if (inv.error) setError(inv.error.message); else setInvoices(inv.data || []);
    }
    setLoading(false);
  }

  async function auth(e: FormEvent) {
    e.preventDefault(); if (!supabase) return; setError('');
    const r = signup ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    if (r.error) setError(r.error.message);
    else if (signup) setError('Account created. Confirm your email if required, then ask Admin to assign your role.');
  }

  async function saveRow(e: FormEvent) {
    e.preventDefault(); if (!supabase || !session) return; setError('');
    let r: any;
    if (tab === 'Clients') r = await supabase.from('clients').insert({ ...clientForm, created_by: session.user.id });
    if (tab === 'Campaigns') r = await supabase.from('campaigns').insert({ client_id: campaignForm.client_id, name: campaignForm.name, budget_usd: Number(campaignForm.budget_usd), spent_usd: 0, exchange_rate: Number(campaignForm.exchange_rate), status: 'active', created_by: session.user.id });
    if (tab === 'Payments') r = await supabase.from('payments').insert({ client_id: paymentForm.client_id, amount_bdt: Number(paymentForm.amount_bdt), method: paymentForm.method, reference: paymentForm.reference || null, created_by: session.user.id });
    if (tab === 'Expenses') r = await supabase.from('expenses').insert({ ...expenseForm, amount_bdt: Number(expenseForm.amount_bdt), created_by: session.user.id });
    if (tab === 'Dollar Wallet') r = await supabase.from('dollar_transactions').insert({ transaction_type: dollarForm.transaction_type, amount_usd: Number(dollarForm.amount_usd), exchange_rate: Number(dollarForm.exchange_rate), client_id: dollarForm.client_id || null, notes: dollarForm.notes || null, created_by: session.user.id });
    if (tab === 'Invoices') r = await supabase.from('invoices').insert({ invoice_number: invoiceForm.invoice_number, client_id: invoiceForm.client_id, issue_date: invoiceForm.issue_date, due_date: invoiceForm.due_date || null, subtotal_bdt: Number(invoiceForm.subtotal_bdt), notes: invoiceForm.notes || null, created_by: session.user.id });
    if (tab === 'Campaign Spend') {
      const c = campaigns.find(x => x.id === spendForm.campaign_id);
      if (!c) { setError('Select a campaign first.'); return; }
      r = await supabase.from('campaigns').update({ spent_usd: Number(c.spent_usd) + Number(spendForm.spent_usd) }).eq('id', c.id);
    }
    if (r?.error) setError(r.error.message); else { setShowForm(false); await load(session.user.id); }
  }

  const finance = profile?.role === 'admin' || profile?.role === 'accountant';
  const names = Object.fromEntries(clients.map(c => [c.id, c.name]));
  const filtered = clients.filter(c => (c.name + ' ' + (c.business_name || '') + ' ' + (c.phone || '')).toLowerCase().includes(search.toLowerCase()));
  const totals = useMemo(() => ({
    budget: campaigns.reduce((s, x) => s + Number(x.budget_usd), 0),
    spent: campaigns.reduce((s, x) => s + Number(x.spent_usd), 0),
    received: payments.reduce((s, x) => s + Number(x.amount_bdt), 0),
    cost: expenses.reduce((s, x) => s + Number(x.amount_bdt), 0),
    wallet: dollarTx.reduce((s, x) => s + (['purchase', 'adjustment'].includes(x.transaction_type) ? Number(x.amount_usd) : -Number(x.amount_usd)), 0)
  }), [campaigns, payments, expenses, dollarTx]);

  if (!supabaseReady) return <main className="center"><section className="auth"><div className="logo">FH</div><h1>Connect your database</h1><p>Add Supabase URL and anon key to <code>.env.local</code>.</p></section></main>;
  if (!session) return <main className="center"><form className="auth" onSubmit={auth}><div className="logo">FH</div><small>FH HABIBUR TECH</small><h1>{signup ? 'Create account' : 'Welcome back'}</h1><p>Business Management System</p>
    <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>Password<input type="password" minLength={6} required value={password} onChange={e => setPassword(e.target.value)} /></label>
    {error && <p className="error">{error}</p>}<button className="primary">{signup ? 'Create account' : 'Sign in'}</button>
    <button type="button" className="textbutton" onClick={() => setSignup(!signup)}>{signup ? 'Back to login' : 'Create first account'}</button></form></main>;

  const nav = [['Dashboard', LayoutDashboard], ['Clients', Users], ['Campaigns', Megaphone], ['Campaign Spend', TrendingDown], ['Payments', Wallet], ['Expenses', Receipt], ['Dollar Wallet', DollarSign], ['Invoices', FileText], ['Reports', ChartNoAxesCombined]] as const;
  const canAdd = ['Clients', 'Campaigns', 'Campaign Spend', 'Payments', 'Expenses', 'Dollar Wallet', 'Invoices'].includes(tab) && (['Clients', 'Campaigns'].includes(tab) || finance);

  return <div className="shell"><aside><div className="brand"><div className="logo">FH</div><b>FH Habibur Tech<small>Management System</small></b></div><p className="sectionlabel">WORKSPACE</p>
    {nav.filter(([label]) => !['Campaign Spend', 'Payments', 'Expenses', 'Dollar Wallet', 'Invoices'].includes(label) || finance).map(([label, Icon]) =>
      <button className={tab === label ? 'nav active' : 'nav'} key={label} onClick={() => { setTab(label); setShowForm(false); }}><Icon size={18} />{label}</button>)}
    <div className="user"><ShieldCheck size={16} /><span>{profile?.role || 'Unassigned'}</span><button onClick={() => supabase?.auth.signOut()}><LogOut size={16} /></button></div></aside>
    <main className="main"><header><div><small>BUSINESS WORKSPACE</small><h2>{tab}</h2></div><span className="pill">{session.user.email}</span></header><div className="content">
      {error && <p className="error">{error}</p>}{loading ? <p>Loading…</p> : <>
        {tab === 'Dashboard' && <><h1>Business overview</h1><p className="muted">Your agency at a glance.</p><div className="stats">
          <article><small>Total clients</small><strong>{clients.length}</strong></article><article><small>Campaign budget</small><strong>{usd(totals.budget)}</strong></article><article><small>Payments received</small><strong>{finance ? bdt(totals.received) : 'Finance access required'}</strong></article><article><small>Campaign spent</small><strong>{usd(totals.spent)}</strong></article></div>
          {finance && <div className="stats"><article><small>Business expenses</small><strong>{bdt(totals.cost)}</strong></article><article><small>Dollar wallet</small><strong>{usd(totals.wallet)}</strong></article><article><small>Invoices</small><strong>{invoices.length}</strong></article><article><small>Collections minus expenses*</small><strong>{bdt(totals.received - totals.cost)}</strong></article></div>}
          <section className="panel"><h3>Recent clients</h3><ClientRows clients={clients.slice(0, 6)} /></section><section className="panel"><h3>Campaign usage</h3><b>{usd(totals.spent)} / {usd(totals.budget)}</b><div className="bar"><span style={{ width: `${totals.budget ? Math.min(100, totals.spent / totals.budget * 100) : 0}%` }} /></div></section>
          {finance && <p className="muted">*Simple cash summary from recorded collections minus recorded expenses; not a complete profit calculation.</p>}</>}
        {tab === 'Clients' && <><Heading title="Clients" canAdd={canAdd} onAdd={() => setShowForm(!showForm)} />{showForm && <form className="panel form" onSubmit={saveRow}><h3>New client</h3>
          <label>Client name<input required value={clientForm.name} onChange={e => setClientForm({ ...clientForm, name: e.target.value })} /></label><label>Business name<input value={clientForm.business_name} onChange={e => setClientForm({ ...clientForm, business_name: e.target.value })} /></label><label>Phone / WhatsApp<input value={clientForm.phone} onChange={e => setClientForm({ ...clientForm, phone: e.target.value })} /></label><button className="primary">Save client</button></form>}
          <section className="panel"><div className="heading"><h3>All clients ({clients.length})</h3><div className="search"><Search size={15} /><input placeholder="Search clients" value={search} onChange={e => setSearch(e.target.value)} /></div></div><ClientRows clients={filtered} /></section></>}
        {tab === 'Campaigns' && <><Heading title="Campaigns" canAdd={canAdd} onAdd={() => setShowForm(!showForm)} />{showForm && <form className="panel form" onSubmit={saveRow}><h3>Create campaign</h3>
          <label>Client<select required value={campaignForm.client_id} onChange={e => setCampaignForm({ ...campaignForm, client_id: e.target.value })}><option value="">Choose client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Campaign name<input required value={campaignForm.name} onChange={e => setCampaignForm({ ...campaignForm, name: e.target.value })} /></label><label>Budget USD<input type="number" min="0.01" step="0.01" required value={campaignForm.budget_usd} onChange={e => setCampaignForm({ ...campaignForm, budget_usd: e.target.value })} /></label><label>USD to BDT rate<input type="number" min="0.01" step="0.01" required value={campaignForm.exchange_rate} onChange={e => setCampaignForm({ ...campaignForm, exchange_rate: e.target.value })} /></label><button className="primary">Save campaign</button></form>}
          <section className="panel"><Table headers={['Campaign', 'Client', 'Budget', 'Spent', 'Remaining']} rows={campaigns.map(c => [c.name, names[c.client_id] || '—', usd(c.budget_usd), usd(c.spent_usd), usd(c.budget_usd - c.spent_usd)])} /></section></>}
        {tab === 'Campaign Spend' && finance && <><Heading title="Campaign Spend" canAdd={canAdd} onAdd={() => setShowForm(!showForm)} />{showForm && <form className="panel form" onSubmit={saveRow}><h3>Record spend</h3><label>Campaign<select required value={spendForm.campaign_id} onChange={e => setSpendForm({ ...spendForm, campaign_id: e.target.value })}><option value="">Choose campaign</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name} — {names[c.client_id]}</option>)}</select></label><label>Additional spend USD<input type="number" min="0.01" step="0.01" required value={spendForm.spent_usd} onChange={e => setSpendForm({ ...spendForm, spent_usd: e.target.value })} /></label><button className="primary">Save spend</button></form>}<section className="panel"><Table headers={['Campaign', 'Client', 'Budget', 'Spent', 'Remaining']} rows={campaigns.map(c => [c.name, names[c.client_id] || '—', usd(c.budget_usd), usd(c.spent_usd), usd(c.budget_usd - c.spent_usd)])} /></section></>}
        {tab === 'Payments' && finance && <><Heading title="Payments" canAdd={canAdd} onAdd={() => setShowForm(!showForm)} />{showForm && <form className="panel form" onSubmit={saveRow}><h3>Record payment</h3><label>Client<select required value={paymentForm.client_id} onChange={e => setPaymentForm({ ...paymentForm, client_id: e.target.value })}><option value="">Choose client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Amount BDT<input type="number" min="0.01" step="0.01" required value={paymentForm.amount_bdt} onChange={e => setPaymentForm({ ...paymentForm, amount_bdt: e.target.value })} /></label><label>Method<select value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value })}>{['Bank transfer', 'bKash', 'Nagad', 'Cash', 'Card'].map(x => <option key={x}>{x}</option>)}</select></label><label>Reference<input value={paymentForm.reference} onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })} /></label><button className="primary">Save payment</button></form>}<section className="panel"><Table headers={['Date', 'Client', 'Method', 'Reference', 'Amount']} rows={payments.map(p => [p.payment_date, names[p.client_id] || '—', p.method, p.reference || '—', bdt(p.amount_bdt)])} /></section></>}
        {tab === 'Expenses' && finance && <><Heading title="Business Expenses" canAdd={canAdd} onAdd={() => setShowForm(!showForm)} />{showForm && <form className="panel form" onSubmit={saveRow}><h3>Add expense</h3><label>Title<input required value={expenseForm.title} onChange={e => setExpenseForm({ ...expenseForm, title: e.target.value })} /></label><label>Category<select value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>{['Other', 'Salary', 'Office', 'Internet', 'Software', 'Marketing', 'Transport', 'Utilities'].map(x => <option key={x}>{x}</option>)}</select></label><label>Amount BDT<input type="number" min="0.01" step="0.01" required value={expenseForm.amount_bdt} onChange={e => setExpenseForm({ ...expenseForm, amount_bdt: e.target.value })} /></label><label>Date<input type="date" value={expenseForm.expense_date} onChange={e => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} /></label><button className="primary">Save expense</button></form>}<section className="panel"><Table headers={['Date', 'Title', 'Category', 'Amount']} rows={expenses.map(x => [x.expense_date, x.title, x.category, bdt(x.amount_bdt)])} /></section></>}
        {tab === 'Dollar Wallet' && finance && <><Heading title="Dollar Wallet" canAdd={canAdd} onAdd={() => setShowForm(!showForm)} />{showForm && <form className="panel form" onSubmit={saveRow}><h3>Dollar transaction</h3><label>Type<select value={dollarForm.transaction_type} onChange={e => setDollarForm({ ...dollarForm, transaction_type: e.target.value })}><option value="purchase">Purchase (+)</option><option value="usage">Use (−)</option><option value="sale">Sell (−)</option><option value="adjustment">Adjustment (+)</option></select></label><label>Amount USD<input type="number" min="0.01" step="0.01" required value={dollarForm.amount_usd} onChange={e => setDollarForm({ ...dollarForm, amount_usd: e.target.value })} /></label><label>Rate<input type="number" min="0" step="0.01" required value={dollarForm.exchange_rate} onChange={e => setDollarForm({ ...dollarForm, exchange_rate: e.target.value })} /></label><label>Client (optional)<select value={dollarForm.client_id} onChange={e => setDollarForm({ ...dollarForm, client_id: e.target.value })}><option value="">None</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Notes<input value={dollarForm.notes} onChange={e => setDollarForm({ ...dollarForm, notes: e.target.value })} /></label><button className="primary">Save transaction</button></form>}<section className="panel"><h3>Balance: {usd(totals.wallet)}</h3><Table headers={['Date', 'Type', 'Client', 'USD', 'Rate', 'BDT equivalent']} rows={dollarTx.map(x => [x.transaction_date, x.transaction_type, x.client_id ? names[x.client_id] || '—' : '—', usd(x.amount_usd), bdt(x.exchange_rate), bdt(x.amount_bdt)])} /></section></>}
        {tab === 'Invoices' && finance && <><Heading title="Invoices" canAdd={canAdd} onAdd={() => setShowForm(!showForm)} />{showForm && <form className="panel form" onSubmit={saveRow}><h3>Create invoice</h3><label>Invoice number<input required value={invoiceForm.invoice_number} onChange={e => setInvoiceForm({ ...invoiceForm, invoice_number: e.target.value })} /></label><label>Client<select required value={invoiceForm.client_id} onChange={e => setInvoiceForm({ ...invoiceForm, client_id: e.target.value })}><option value="">Choose client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Issue date<input type="date" required value={invoiceForm.issue_date} onChange={e => setInvoiceForm({ ...invoiceForm, issue_date: e.target.value })} /></label><label>Due date<input type="date" value={invoiceForm.due_date} onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} /></label><label>Total BDT<input type="number" min="0" step="0.01" required value={invoiceForm.subtotal_bdt} onChange={e => setInvoiceForm({ ...invoiceForm, subtotal_bdt: e.target.value })} /></label><button className="primary">Save invoice</button></form>}<section className="panel"><Table headers={['Invoice', 'Client', 'Issue', 'Due', 'Status', 'Total']} rows={invoices.map(x => [x.invoice_number, names[x.client_id] || '—', x.issue_date, x.due_date || '—', x.status, bdt(x.subtotal_bdt)])} /></section></>}
        {tab === 'Reports' && <><h1>Reports</h1><div className="stats"><article><small>Clients</small><strong>{clients.length}</strong></article><article><small>Ad budget USD</small><strong>{usd(totals.budget)}</strong></article><article><small>Ad spend USD</small><strong>{usd(totals.spent)}</strong></article>{finance && <><article><small>Collected BDT</small><strong>{bdt(totals.received)}</strong></article><article><small>Expenses BDT</small><strong>{bdt(totals.cost)}</strong></article><article><small>Dollar wallet</small><strong>{usd(totals.wallet)}</strong></article></>}</div></>}
      </>}</div></main></div>;
}

function Heading({ title, canAdd, onAdd }: { title: string; canAdd: boolean; onAdd: () => void }) {
  return <div className="heading"><div><h1>{title}</h1></div>{canAdd && <button className="primary" onClick={onAdd}><Plus size={16} /> Add new</button>}</div>;
}
function ClientRows({ clients }: { clients: Client[] }) {
  return <Table headers={['Client', 'Business', 'Phone', 'Status']} rows={clients.map(c => [c.name, c.business_name || '—', c.phone || '—', c.status])} />;
}
function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return <div className="tablewrap"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="empty">No records yet.</td></tr>}</tbody></table></div>;
}
