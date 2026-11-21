'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LayoutDashboard, Users, Megaphone, Wallet, ChartNoAxesCombined, LogOut, Plus, Search, ShieldCheck, Receipt, DollarSign, TrendingDown, Coins, FileBarChart, FileText, UserCog, Printer } from 'lucide-react';
import { supabase, supabaseReady } from '@/lib/supabase';

type Client={id:string;name:string;business_name:string|null;phone:string|null;status:string;default_service_charge_type:string;default_service_charge_value:number};
type Campaign={id:string;client_id:string;name:string;budget_usd:number;spent_usd:number;exchange_rate:number;status:string};
type Payment={id:string;client_id:string;amount_bdt:number;payment_date:string;method:string;reference:string|null};
type Expense={id:string;title:string;category:string;amount_bdt:number;expense_date:string};
type Lot={id:string;purchase_date:string;vendor:string|null;amount_usd:number;remaining_usd:number;purchase_rate:number};
type Spend={id:string;campaign_id:string;purchase_lot_id:string;amount_usd:number;exchange_rate:number;client_rate:number;service_charge_type:string;service_charge_value:number;spend_date:string;ad_cost_bdt:number;service_charge_bdt:number;client_bill_bdt:number};
type Due={client_id:string;client_name:string;total_billed_bdt:number;paid_bdt:number;due_bdt:number;advance_bdt:number};
type Monthly={month:string;campaign_client_billed_bdt:number;service_revenue_bdt:number;fx_margin_bdt:number;actual_ad_cost_bdt:number;operating_expenses_bdt:number;net_profit_bdt:number};
type Invoice={id:string;invoice_number:string;client_id:string;issue_date:string;due_date:string|null;subtotal_bdt:number;status:string;notes:string|null};
type InvoiceItem={id:string;invoice_id:string;description:string;quantity:number;unit_price_bdt:number};
type InvoicePaymentAllocation={id:string;invoice_id:string;payment_id:string;amount_bdt:number;created_at:string};
type TeamMember={id:string;full_name:string|null;email:string|null;role:'admin'|'accountant'|'employee';approval_status:'pending'|'approved'|'rejected'|'suspended';created_at:string};
type Profile={full_name:string|null;role:'admin'|'accountant'|'employee';approval_status:'pending'|'approved'|'rejected'|'suspended'};
type ModuleKey='dashboard'|'clients'|'campaigns'|'campaign_spend'|'dollar_purchases'|'client_due'|'invoices'|'payments'|'expenses'|'reports';
type ModuleAccess='none'|'view'|'manage';
type EmployeeMonthly={month:string;campaign_client_billed_bdt:number;service_revenue_bdt:number;fx_margin_bdt:number;actual_ad_cost_bdt:number};
const MODULES=[
 {key:'dashboard',label:'Dashboard',scope:'Employee workspace overview',manageable:false},
 {key:'clients',label:'Clients',scope:'Admin-assigned clients only',manageable:false},
 {key:'campaigns',label:'Campaigns',scope:'Campaigns for assigned clients only',manageable:true},
 {key:'campaign_spend',label:'Campaign Spend',scope:'Spend records for assigned clients only',manageable:true},
 {key:'dollar_purchases',label:'Dollar Purchases',scope:'Company-wide USD wallet and purchase lots',manageable:true},
 {key:'client_due',label:'Client Due',scope:'Due summary for assigned clients only',manageable:false},
 {key:'invoices',label:'Invoices',scope:'Invoices for assigned clients only',manageable:true},
 {key:'payments',label:'Payments',scope:'Payments for assigned clients only',manageable:true},
 {key:'expenses',label:'Expenses',scope:'Company-wide operating expenses',manageable:true},
 {key:'reports',label:'Reports',scope:'Monthly aggregates for assigned clients only',manageable:false}
] as const;
const DEFAULT_MODULE_PERMISSIONS:Record<ModuleKey,ModuleAccess>={
 dashboard:'view',clients:'view',campaigns:'manage',campaign_spend:'view',
 dollar_purchases:'none',client_due:'view',invoices:'view',payments:'view',
 expenses:'none',reports:'none'
};
const MODULE_KEY_BY_LABEL:Record<string,ModuleKey>={
 Dashboard:'dashboard',Clients:'clients',Campaigns:'campaigns','Campaign Spend':'campaign_spend',
 'Dollar Purchases':'dollar_purchases','Client Due':'client_due',Invoices:'invoices',
 Payments:'payments',Expenses:'expenses',Reports:'reports'
};
const bdt=(n:number)=>'৳'+Number(n||0).toLocaleString('en-BD',{maximumFractionDigits:2});
const usd=(n:number)=>'$'+Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export default function Home(){
 const [session,setSession]=useState<any>(null),[profile,setProfile]=useState<Profile|null>(null);
 const [clients,setClients]=useState<Client[]>([]),[campaigns,setCampaigns]=useState<Campaign[]>([]),[payments,setPayments]=useState<Payment[]>([]),[expenses,setExpenses]=useState<Expense[]>([]),[lots,setLots]=useState<Lot[]>([]),[spends,setSpends]=useState<Spend[]>([]),[monthly,setMonthly]=useState<Monthly[]>([]);
 const [invoices,setInvoices]=useState<Invoice[]>([]),[invoiceItems,setInvoiceItems]=useState<InvoiceItem[]>([]),[invoiceAllocations,setInvoiceAllocations]=useState<InvoicePaymentAllocation[]>([]),[teamMembers,setTeamMembers]=useState<TeamMember[]>([]);
 const [clientAssignmentDrafts,setClientAssignmentDrafts]=useState<Record<string,string[]>>({}),[savedClientAssignments,setSavedClientAssignments]=useState<Record<string,string[]>>({});
 const [myModulePermissions,setMyModulePermissions]=useState<Record<ModuleKey,ModuleAccess>>({...DEFAULT_MODULE_PERMISSIONS});
 const [modulePermissionDrafts,setModulePermissionDrafts]=useState<Record<string,Record<ModuleKey,ModuleAccess>>>({});
 const [savedModulePermissions,setSavedModulePermissions]=useState<Record<string,Record<ModuleKey,ModuleAccess>>>({});
 const [employeeMonthly,setEmployeeMonthly]=useState<EmployeeMonthly[]>([]);
 const [tab,setTab]=useState('Dashboard'),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[signup,setSignup]=useState(false),[search,setSearch]=useState(''),[showForm,setShowForm]=useState(false);
 const [clientForm,setClientForm]=useState({name:'',business_name:'',phone:'',default_service_charge_type:'percent',default_service_charge_value:'0'});
 const [campaignForm,setCampaignForm]=useState({client_id:'',name:'',budget_usd:'',exchange_rate:'125'});
 const [lotForm,setLotForm]=useState({purchase_date:today(),vendor:'',amount_usd:'',purchase_rate:'125',payment_reference:'',notes:''});
 const [spendForm,setSpendForm]=useState({campaign_id:'',purchase_lot_id:'',amount_usd:'',client_rate:'125',service_charge_type:'percent',service_charge_value:'0',spend_date:today(),platform_reference:'',notes:''});
 const [paymentForm,setPaymentForm]=useState({client_id:'',amount_bdt:'',payment_date:today(),method:'Bank transfer',reference:''});
 const [expenseForm,setExpenseForm]=useState({title:'',category:'Other',amount_bdt:'',expense_date:today(),notes:''});
 const [invoiceForm,setInvoiceForm]=useState({client_id:'',issue_date:today(),due_date:'',notes:''});
 const [invoiceLines,setInvoiceLines]=useState<{description:string;quantity:string;unit_price_bdt:string}[]>([{description:'Campaign management service',quantity:'1',unit_price_bdt:''}]);
 const [selectedInvoiceId,setSelectedInvoiceId]=useState('');
 const [roleChanges,setRoleChanges]=useState<Record<string,TeamMember['role']>>({}),[approvalChanges,setApprovalChanges]=useState<Record<string,TeamMember['approval_status']>>({});
 const finance=profile?.role==='admin'||profile?.role==='accountant';
 const moduleAccess=(key:ModuleKey):ModuleAccess=>finance?'manage':myModulePermissions[key]||'none';
 const canView=(key:ModuleKey)=>moduleAccess(key)==='view'||moduleAccess(key)==='manage';
 const canManage=(key:ModuleKey)=>moduleAccess(key)==='manage';
 useEffect(()=>{
  if(!loading&&profile?.role==='employee'&&myModulePermissions.dashboard==='none'){
   const first=MODULES.find(module=>module.key!=='dashboard'&&myModulePermissions[module.key]!=='none');
   setTab(first?.label||'No Access');
  }
 },[loading,profile?.role,myModulePermissions]);
 useEffect(()=>{if(!supabase){setLoading(false);return;}supabase.auth.getSession().then(({data})=>{setSession(data.session);if(data.session)void load(data.session.user.id);else setLoading(false)});const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>{setSession(s);if(s)void load(s.user.id);else{setProfile(null);setClients([]);setCampaigns([]);setPayments([]);setExpenses([]);setLots([]);setSpends([]);setMonthly([]);setInvoices([]);setInvoiceItems([]);setInvoiceAllocations([]);setTeamMembers([]);setLoading(false)}});return()=>subscription.unsubscribe()},[]);
 async function load(uid:string){
  if(!supabase)return;
  setLoading(true);setError('');
  const p=await supabase.from('profiles').select('full_name,role,approval_status').eq('id',uid).single();
  if(p.error){
   setProfile(null);setError('Access status could not be verified. Please contact the administrator.');setLoading(false);return;
  }
  setProfile(p.data as Profile);
  if(p.data.approval_status!=='approved'){
   setClients([]);setCampaigns([]);setPayments([]);setExpenses([]);setLots([]);setSpends([]);setMonthly([]);setEmployeeMonthly([]);setInvoices([]);setInvoiceItems([]);setInvoiceAllocations([]);setTeamMembers([]);setLoading(false);return;
  }

  const isFinanceRole=p.data.role==='admin'||p.data.role==='accountant';
  let activePermissions:Record<ModuleKey,ModuleAccess>={...DEFAULT_MODULE_PERMISSIONS};
  if(isFinanceRole){
   activePermissions={dashboard:'manage',clients:'manage',campaigns:'manage',campaign_spend:'manage',dollar_purchases:'manage',client_due:'manage',invoices:'manage',payments:'manage',expenses:'manage',reports:'manage'};
  }else{
   const mp=await supabase.from('employee_module_permissions').select('module_key,access_level').eq('employee_id',uid);
   if(mp.error)setError('Employee module permissions could not be loaded. Apply the module-permissions database migration first: '+mp.error.message);
   else for(const row of (mp.data||[]) as {module_key:ModuleKey;access_level:ModuleAccess}[]){
    if(row.module_key in activePermissions)activePermissions[row.module_key]=row.access_level;
   }
  }
  setMyModulePermissions(activePermissions);

  // Row Level Security returns only the module rows and assigned clients this
  // signed-in account is permitted to read.
  const [cl,ca,pm,ex,lo,sp,inv,itm,alloc]=await Promise.all([
   supabase.from('clients').select('*').order('created_at',{ascending:false}),
   supabase.from('campaigns').select('*').order('created_at',{ascending:false}),
   supabase.from('payments').select('*').order('payment_date',{ascending:false}),
   supabase.from('expenses').select('*').order('expense_date',{ascending:false}),
   supabase.from('dollar_purchase_lots').select('*').order('purchase_date',{ascending:false}),
   supabase.from('campaign_spend_entries').select('*').order('spend_date',{ascending:false}),
   supabase.from('invoices').select('*').order('issue_date',{ascending:false}),
   supabase.from('invoice_items').select('*'),
   supabase.from('invoice_payment_allocations').select('*').order('created_at',{ascending:true})
  ]);
  if(cl.error)setError(cl.error.message);else setClients(cl.data||[]);
  if(ca.error)setError(ca.error.message);else setCampaigns(ca.data||[]);
  if(pm.error)setError(pm.error.message);else setPayments(pm.data||[]);
  if(ex.error)setError(ex.error.message);else setExpenses(ex.data||[]);
  if(lo.error)setError(lo.error.message);else setLots(lo.data||[]);
  if(sp.error)setError(sp.error.message);else setSpends(sp.data||[]);
  if(inv.error)setError(inv.error.message);else setInvoices(inv.data||[]);
  if(itm.error)setError(itm.error.message);else setInvoiceItems(itm.data||[]);
  if(alloc.error)setError('Invoice payment allocations could not be loaded: '+alloc.error.message);else setInvoiceAllocations((alloc.data||[]) as InvoicePaymentAllocation[]);

  if(isFinanceRole){
   const mon=await supabase.from('finance_monthly_accrual_summary').select('*').order('month',{ascending:false});
   if(mon.error)setError(mon.error.message);else setMonthly(mon.data||[]);
   setEmployeeMonthly([]);
  }else if(activePermissions.reports!=='none'){
   const mon=await supabase.rpc('employee_assigned_client_monthly_report');
   if(mon.error)setError(mon.error.message);else setEmployeeMonthly((mon.data||[]) as EmployeeMonthly[]);
   setMonthly([]);
  }else{
   setMonthly([]);setEmployeeMonthly([]);
  }

  if(p.data.role==='admin'){
   const [tm,ac,mp]=await Promise.all([
    supabase.from('profiles').select('id,email,full_name,role,approval_status,created_at').order('created_at',{ascending:false}),
    supabase.from('employee_client_assignments').select('employee_id,client_id'),
    supabase.from('employee_module_permissions').select('employee_id,module_key,access_level')
   ]);
   if(tm.error)setError(tm.error.message);else setTeamMembers((tm.data||[]) as TeamMember[]);
   if(ac.error)setError(ac.error.message);else{
    const assignmentMap:Record<string,string[]>={};
    for(const row of (ac.data||[]) as {employee_id:string;client_id:string}[]){(assignmentMap[row.employee_id]??=[]).push(row.client_id)}
    setClientAssignmentDrafts(assignmentMap);setSavedClientAssignments(assignmentMap);
   }
   if(mp.error)setError('Employee module permissions could not be loaded: '+mp.error.message);else{
    const permissionMap:Record<string,Record<ModuleKey,ModuleAccess>>={};
    for(const member of (tm.data||[]) as TeamMember[]){
     if(member.role==='employee')permissionMap[member.id]={...DEFAULT_MODULE_PERMISSIONS};
    }
    for(const row of (mp.data||[]) as {employee_id:string;module_key:ModuleKey;access_level:ModuleAccess}[]){
     if(permissionMap[row.employee_id]&&row.module_key in permissionMap[row.employee_id])permissionMap[row.employee_id][row.module_key]=row.access_level;
    }
    setModulePermissionDrafts(permissionMap);setSavedModulePermissions(permissionMap);
   }
  }else{
   setTeamMembers([]);setModulePermissionDrafts({});setSavedModulePermissions({});
  }
  setLoading(false);
 }
 async function updateTeamAccess(memberId:string){if(!supabase||!session)return;if(memberId===session.user.id){setError('For safety, use another admin account to change your own access.');return;}const member=teamMembers.find(x=>x.id===memberId);if(!member)return;const role=roleChanges[memberId]||member.role;const approval_status=approvalChanges[memberId]||member.approval_status;if(approval_status==='approved'&&role==='admin'&&member.approval_status!=='approved'&&member.role!=='admin'){setNotice('You are granting full Admin access. Confirm this only for a trusted administrator.');}const result=await supabase.from('profiles').update({role,approval_status}).eq('id',memberId);if(result.error){setError(result.error.message);return;}setNotice(approval_status==='approved'?'Account approved. The user can now sign in to the workspace.':'Access status saved.');setRoleChanges(current=>{const next={...current};delete next[memberId];return next});setApprovalChanges(current=>{const next={...current};delete next[memberId];return next});await load(session.user.id);}
 async function saveClientAssignments(employeeId:string){if(!supabase||!session||profile?.role!=='admin')return;const clientIds=clientAssignmentDrafts[employeeId]||[];const result=await supabase.rpc('admin_set_employee_clients',{p_employee_id:employeeId,p_client_ids:clientIds});if(result.error){setError(result.error.message);return;}setNotice('Assigned clients saved. This Employee can now see only these clients and their campaigns.');await load(session.user.id);}
 async function saveModulePermissions(employeeId:string){
  if(!supabase||!session||profile?.role!=='admin')return;
  const permissions=modulePermissionDrafts[employeeId]||{...DEFAULT_MODULE_PERMISSIONS};
  const payload=Object.fromEntries(MODULES.map(module=>[module.key,permissions[module.key]]));
  const result=await supabase.rpc('admin_set_employee_module_permissions',{p_employee_id:employeeId,p_permissions:payload});
  if(result.error){setError(result.error.message);return;}
  setNotice('Module permissions saved. The Employee should refresh or sign in again to load the updated menu.');
  await load(session.user.id);
 }
 async function auth(e:FormEvent){e.preventDefault();if(!supabase)return;setError('');const r=signup?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});if(r.error)setError(r.error.message);else if(signup)setNotice('Registration received. Verify your email if required, then wait for Admin approval before accessing company data.');}
 async function save(e:FormEvent){e.preventDefault();if(!supabase||!session)return;setError('');setNotice('');let r:any;let savedInvoiceNumber='';
  if(tab==='Clients')r=await supabase.from('clients').insert({name:clientForm.name,business_name:clientForm.business_name||null,phone:clientForm.phone||null,default_service_charge_type:clientForm.default_service_charge_type,default_service_charge_value:Number(clientForm.default_service_charge_value),created_by:session.user.id});
  if(tab==='Campaigns')r=await supabase.from('campaigns').insert({client_id:campaignForm.client_id,name:campaignForm.name,budget_usd:Number(campaignForm.budget_usd),spent_usd:0,exchange_rate:Number(campaignForm.exchange_rate),status:'active',created_by:session.user.id});
  if(tab==='Dollar Purchases')r=await supabase.from('dollar_purchase_lots').insert({purchase_date:lotForm.purchase_date,vendor:lotForm.vendor||null,amount_usd:Number(lotForm.amount_usd),remaining_usd:Number(lotForm.amount_usd),purchase_rate:Number(lotForm.purchase_rate),payment_reference:lotForm.payment_reference||null,notes:lotForm.notes||null,created_by:session.user.id});
  if(tab==='Campaign Spend'){
   const c=campaigns.find(x=>x.id===spendForm.campaign_id);if(!c){setError('Select a campaign.');return;}
   const lot=lots.find(x=>x.id===spendForm.purchase_lot_id);
   const amountUsd=Number(spendForm.amount_usd);
   if(!lot){setError('Select a valid USD purchase lot.');return;}
   if(!Number.isFinite(amountUsd)||amountUsd<=0){setError('Spent USD must be greater than zero.');return;}
   if(amountUsd>Number(lot.remaining_usd)){setError('Insufficient USD in selected lot.');return;}
   r=await supabase.from('campaign_spend_entries').insert({campaign_id:spendForm.campaign_id,purchase_lot_id:spendForm.purchase_lot_id,amount_usd:amountUsd,exchange_rate:Number(lot.purchase_rate),client_rate:Number(spendForm.client_rate),service_charge_type:spendForm.service_charge_type,service_charge_value:Number(spendForm.service_charge_value),spend_date:spendForm.spend_date,platform_reference:spendForm.platform_reference||null,notes:spendForm.notes||null,created_by:session.user.id});
   if(!r.error){const newSpent=Number(c.spent_usd)+amountUsd;const up=await supabase.from('campaigns').update({spent_usd:newSpent}).eq('id',c.id);if(up.error)setError('Spend saved, but campaign total update failed: '+up.error.message);}
  }
  if(tab==='Invoices'){
   const validLines=invoiceLines.filter(x=>x.description.trim()&&Number(x.quantity)>0&&Number(x.unit_price_bdt)>=0);
   if(!invoiceForm.client_id){setError('Choose a client for this invoice.');return;}
   if(validLines.length===0){setError('Add at least one invoice item with a description and quantity.');return;}
   const subtotal=validLines.reduce((sum,x)=>sum+Number(x.quantity)*Number(x.unit_price_bdt),0);
   const created=await supabase.from('invoices').insert({client_id:invoiceForm.client_id,issue_date:invoiceForm.issue_date,due_date:invoiceForm.due_date||null,subtotal_bdt:subtotal,status:'unpaid',notes:invoiceForm.notes||null,created_by:session.user.id}).select('id,invoice_number').single();
   if(created.error){setError(created.error.message);return;}
   const lineResult=await supabase.from('invoice_items').insert(validLines.map(x=>({invoice_id:created.data.id,description:x.description.trim(),quantity:Number(x.quantity),unit_price_bdt:Number(x.unit_price_bdt)})));
   if(lineResult.error){await supabase.from('invoices').delete().eq('id',created.data.id);setError('Invoice items could not be saved. The incomplete invoice was rolled back: '+lineResult.error.message);return;}
   setSelectedInvoiceId(created.data.id);
   savedInvoiceNumber=created.data.invoice_number;
  }
  if(tab==='Payments')r=await supabase.from('payments').insert({client_id:paymentForm.client_id,amount_bdt:Number(paymentForm.amount_bdt),payment_date:paymentForm.payment_date,method:paymentForm.method,reference:paymentForm.reference||null,created_by:session.user.id});
  if(tab==='Expenses')r=await supabase.from('expenses').insert({title:expenseForm.title,category:expenseForm.category,amount_bdt:Number(expenseForm.amount_bdt),expense_date:expenseForm.expense_date,notes:expenseForm.notes||null,created_by:session.user.id});
  if(r?.error){setError(r.error.message);return;}setNotice(tab==='Payments'?'Payment saved. Available amounts were applied to the oldest open invoices first; any remainder stays unallocated to an invoice; all recorded payments still count in the overall Client Due balance.':tab==='Invoices'?'Invoice '+savedInvoiceNumber+' created successfully.':'Saved successfully.');setShowForm(false);if(tab==='Invoices'){setInvoiceForm({client_id:'',issue_date:today(),due_date:'',notes:''});setInvoiceLines([{description:'Campaign management service',quantity:'1',unit_price_bdt:''}]);}await load(session.user.id);
 }
 const names=Object.fromEntries(clients.map(c=>[c.id,c.name]));
 const allocatedForInvoice=(invoiceId:string)=>invoiceAllocations.filter(a=>a.invoice_id===invoiceId).reduce((sum,a)=>sum+Number(a.amount_bdt),0);
 const allocatedForPayment=(paymentId:string)=>invoiceAllocations.filter(a=>a.payment_id===paymentId).reduce((sum,a)=>sum+Number(a.amount_bdt),0);
 const invoiceBalance=(invoice:Invoice)=>Math.max(Number(invoice.subtotal_bdt)-allocatedForInvoice(invoice.id),0);
 const invoiceStatus=(invoice:Invoice)=>{
  if(invoice.status==='draft'||invoice.status==='void')return invoice.status;
  if(!canView('payments')){
   if(invoice.status==='paid')return 'paid';
   if(invoice.due_date&&invoice.due_date<today())return 'overdue';
   return invoice.status==='partially_paid'?'partially_paid':'unpaid';
  }
  const paid=allocatedForInvoice(invoice.id);
  if(Number(invoice.subtotal_bdt)>0&&paid>=Number(invoice.subtotal_bdt)-0.009)return 'paid';
  if(invoice.due_date&&invoice.due_date<today())return 'overdue';
  if(paid>0)return 'partially_paid';
  return 'unpaid';
 };
 const filtered=clients.filter(c=>(c.name+' '+(c.business_name||'')+' '+(c.phone||'')).toLowerCase().includes(search.toLowerCase()));
 // Derive Client Due from the RLS-filtered source rows visible to this user.
 // Draft and void invoices must never count as issued billings.
 const dues=useMemo<Due[]>(()=>{
  const clientIdByCampaign=new Map(campaigns.map(c=>[c.id,c.client_id] as const));
  const campaignBilledByClient=new Map<string,number>();
  const invoiceBilledByClient=new Map<string,number>();
  const paidByClient=new Map<string,number>();
  for(const spend of spends){
   const clientId=clientIdByCampaign.get(spend.campaign_id);
   if(clientId)campaignBilledByClient.set(clientId,(campaignBilledByClient.get(clientId)||0)+Number(spend.client_bill_bdt||0));
  }
  for(const invoice of invoices){
   if(invoice.status==='draft'||invoice.status==='void')continue;
   invoiceBilledByClient.set(invoice.client_id,(invoiceBilledByClient.get(invoice.client_id)||0)+Number(invoice.subtotal_bdt||0));
  }
  for(const payment of payments){
   paidByClient.set(payment.client_id,(paidByClient.get(payment.client_id)||0)+Number(payment.amount_bdt||0));
  }
  return clients.map(client=>{
   // Campaign Spend and its Invoice are two records of the same client bill.
   // Use the larger total as a legacy-safe fallback, never add both together.
   const campaignBilled=Number(campaignBilledByClient.get(client.id)||0);
   const invoiceBilled=Number(invoiceBilledByClient.get(client.id)||0);
   const totalBilled=Math.max(campaignBilled,invoiceBilled);
   const paid=Number(paidByClient.get(client.id)||0);
   return {client_id:client.id,client_name:client.name,total_billed_bdt:totalBilled,paid_bdt:paid,due_bdt:Math.max(totalBilled-paid,0),advance_bdt:Math.max(paid-totalBilled,0)};
  });
 },[clients,campaigns,spends,invoices,payments]);
 const totals=useMemo(()=>({budget:campaigns.reduce((s,x)=>s+Number(x.budget_usd),0),spent:spends.reduce((s,x)=>s+Number(x.amount_usd),0),received:payments.reduce((s,x)=>s+Number(x.amount_bdt),0),expenses:expenses.reduce((s,x)=>s+Number(x.amount_bdt),0),wallet:lots.reduce((s,x)=>s+Number(x.remaining_usd),0),billed:dues.reduce((s,x)=>s+Number(x.total_billed_bdt),0),due:dues.reduce((s,x)=>s+Number(x.due_bdt),0),profit:monthly.reduce((s,x)=>s+Number(x.net_profit_bdt),0)}),[campaigns,spends,payments,expenses,lots,dues,monthly]);
 const nav=[['Dashboard',LayoutDashboard],['Clients',Users],['Campaigns',Megaphone],['Campaign Spend',TrendingDown],['Dollar Purchases',Coins],['Client Due',FileBarChart],['Invoices',FileText],['Payments',Wallet],['Expenses',Receipt],['Reports',ChartNoAxesCombined],['Team Access',UserCog]] as const;
 const canAdd=MODULE_KEY_BY_LABEL[tab]?canManage(MODULE_KEY_BY_LABEL[tab]):false;
 if(!supabaseReady)return <main className="center"><section className="auth"><div className="logo">FH</div><h1>Connect your database</h1><p>Add Supabase URL and anon key to <code>.env.local</code>.</p></section></main>;
 if(!session)return <main className="center"><form className="auth" onSubmit={auth}><div className="logo">FH</div><small>FH HABIBUR TECH</small><h1>{signup?'Create account':'Welcome back'}</h1><p>Business Management System</p><label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" minLength={6} required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="error">{error}</p>}{notice&&<p>{notice}</p>}<button className="primary">{signup?'Create account':'Sign in'}</button><button type="button" className="textbutton" onClick={()=>setSignup(!signup)}>{signup?'Back to login':'Create account'}</button></form></main>;
 if(session&&loading&&!profile)return <main className="center"><section className="auth"><div className="logo">FH</div><h1>Checking account access</h1><p>Please wait while we verify your company account.</p></section></main>;
 if(session&&(!profile||profile.approval_status!=='approved'))return <main className="center"><section className="auth"><div className="logo">FH</div><small>FH HABIBUR TECH</small><h1>{!profile?'Access check required':profile.approval_status==='pending'?'Waiting for Admin approval':profile.approval_status==='rejected'?'Access request not approved':'Account access suspended'}</h1><p>{!profile?'We could not verify your access status. Company data remains locked. Please contact the administrator.':profile.approval_status==='pending'?'Your registration was received. You cannot access client, campaign or finance information until an Admin approves your account.':profile.approval_status==='rejected'?'Your access request was not approved. Contact the company administrator for details.':'Your account has been suspended. Contact the company administrator.'}</p><button className="primary" type="button" onClick={()=>supabase?.auth.signOut()}>Sign out</button></section></main>;
 return <div className="shell"><aside><div className="brand"><div className="logo">FH</div><b>FH Habibur Tech<small>Management System</small></b></div><p className="sectionlabel">WORKSPACE</p>{nav.filter(([label])=>label==='Team Access'?profile?.role==='admin':canView(MODULE_KEY_BY_LABEL[label])).map(([label,Icon])=><button className={tab===label?'nav active':'nav'} key={label} onClick={()=>{setTab(label);setShowForm(false);}}><Icon size={18}/>{label}</button>)}<div className="user"><ShieldCheck size={16}/><span>{profile?.role||'Unassigned'}</span><button onClick={()=>supabase?.auth.signOut()}><LogOut size={16}/></button></div></aside>
 <main className="main"><header><div><small>BUSINESS WORKSPACE</small><h2>{tab}</h2></div><span className="pill">{session.user.email}</span></header><div className="content">{error&&<p className="error">{error}</p>}{notice&&<p className="muted">{notice}</p>}{loading?<p>Loading…</p>:<>
 {tab==='No Access'&&<section className="panel"><h1>No module access</h1><p className="muted">No workspace modules have been assigned to this account yet. Contact your company Admin.</p></section>}{tab==='Dashboard'&&<><h1>Business overview</h1><p className="muted">Accrual-based agency overview. Amounts reflect only the information this account is permitted to view.</p><div className="stats">{canView('clients')&&<Metric label="Assigned clients" value={String(clients.length)}/>}{canView('campaigns')&&<Metric label="Campaign budget" value={usd(totals.budget)}/>}{canView('campaign_spend')&&<Metric label="USD spent" value={usd(totals.spent)}/>}{canView('dollar_purchases')&&<Metric label="USD wallet balance" value={usd(totals.wallet)}/>}</div>{finance&&<div className="stats"><Metric label="Client billings" value={bdt(totals.billed)}/><Metric label="Client due" value={bdt(totals.due)}/><Metric label="Collections received" value={bdt(totals.received)}/><Metric label="Operating expenses" value={bdt(totals.expenses)}/></div>}{canView('clients')&&<section className="panel"><h3>Recent clients</h3><Table headers={['Client','Business','Phone','Status']} rows={clients.slice(0,6).map(c=>[c.name,c.business_name||'—',c.phone||'—',c.status])}/></section>}{finance&&<section className="panel"><h3>Latest monthly campaign accrual report · Manual Invoices excluded</h3><Table headers={['Month','Service revenue','FX margin','Operating expenses','Net profit']} rows={monthly.slice(0,4).map(m=>[m.month,bdt(m.service_revenue_bdt),bdt(m.fx_margin_bdt),bdt(m.operating_expenses_bdt),bdt(m.net_profit_bdt)])}/></section>}</>}
 {tab==='Clients'&&<><Heading title="Clients" canAdd={finance} onAdd={()=>setShowForm(!showForm)}/>{finance&&showForm&&<form className="panel form" onSubmit={save}><h3>New client</h3><label>Client name<input required value={clientForm.name} onChange={e=>setClientForm({...clientForm,name:e.target.value})}/></label><label>Business name<input value={clientForm.business_name} onChange={e=>setClientForm({...clientForm,business_name:e.target.value})}/></label><label>Phone / WhatsApp<input value={clientForm.phone} onChange={e=>setClientForm({...clientForm,phone:e.target.value})}/></label><label>Default service charge type<select value={clientForm.default_service_charge_type} onChange={e=>setClientForm({...clientForm,default_service_charge_type:e.target.value})}><option value="fixed">Fixed BDT</option><option value="percent">Percentage</option></select></label><label>Default service charge value<input type="number" min="0" step="0.01" value={clientForm.default_service_charge_value} onChange={e=>setClientForm({...clientForm,default_service_charge_value:e.target.value})}/></label><button className="primary">Save client</button></form>}<section className="panel"><div className="heading"><h3>All clients ({clients.length})</h3><div className="search"><Search size={15}/><input placeholder="Search clients" value={search} onChange={e=>setSearch(e.target.value)}/></div></div><Table headers={['Client','Business','Phone','Default fee','Status']} rows={filtered.map(c=>[c.name,c.business_name||'—',c.phone||'—',`${c.default_service_charge_type==='fixed'?'৳':'%'}${c.default_service_charge_value}`,c.status])}/></section></>}
 {tab==='Campaigns'&&canView('campaigns')&&<><Heading title="Campaigns" canAdd={canManage('campaigns')} onAdd={()=>setShowForm(!showForm)}/>{showForm&&canManage('campaigns')&&<form className="panel form" onSubmit={save}><h3>Create campaign</h3><label>Client<select required value={campaignForm.client_id} onChange={e=>setCampaignForm({...campaignForm,client_id:e.target.value})}><option value="">Choose client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Campaign name<input required value={campaignForm.name} onChange={e=>setCampaignForm({...campaignForm,name:e.target.value})}/></label><label>Budget USD<input type="number" min="0.01" step="0.01" required value={campaignForm.budget_usd} onChange={e=>setCampaignForm({...campaignForm,budget_usd:e.target.value})}/></label><label>Default exchange rate<input type="number" min="0.01" step="0.01" required value={campaignForm.exchange_rate} onChange={e=>setCampaignForm({...campaignForm,exchange_rate:e.target.value})}/></label><button className="primary">Save campaign</button></form>}<section className="panel"><Table headers={['Campaign','Client','Budget','Spent ledger','Remaining']} rows={campaigns.map(c=>{const spent=spends.filter(s=>s.campaign_id===c.id).reduce((n,s)=>n+Number(s.amount_usd),0);return [c.name,names[c.client_id]||'—',usd(c.budget_usd),usd(spent),usd(Number(c.budget_usd)-spent)]})}/></section></>}
 {tab==='Dollar Purchases'&&canView('dollar_purchases')&&<><Heading title="Dollar Purchase Lots" canAdd={canManage('dollar_purchases')} onAdd={()=>setShowForm(!showForm)}/>{showForm&&canManage('dollar_purchases')&&<form className="panel form" onSubmit={save}><h3>Record a dollar purchase</h3><label>Purchase date<input type="date" required value={lotForm.purchase_date} onChange={e=>setLotForm({...lotForm,purchase_date:e.target.value})}/></label><label>Vendor / Seller<input value={lotForm.vendor} onChange={e=>setLotForm({...lotForm,vendor:e.target.value})}/></label><label>USD purchased<input type="number" min="0.01" step="0.01" required value={lotForm.amount_usd} onChange={e=>setLotForm({...lotForm,amount_usd:e.target.value})}/></label><label>Actual purchase rate (BDT/USD)<input type="number" min="0.01" step="0.0001" required value={lotForm.purchase_rate} onChange={e=>setLotForm({...lotForm,purchase_rate:e.target.value})}/></label><label>Payment reference<input value={lotForm.payment_reference} onChange={e=>setLotForm({...lotForm,payment_reference:e.target.value})}/></label><label>Notes<input value={lotForm.notes} onChange={e=>setLotForm({...lotForm,notes:e.target.value})}/></label><button className="primary">Save purchase lot</button></form>}<section className="panel"><h3>Wallet balance: {usd(totals.wallet)}</h3><Table headers={['Date','Seller','Purchased','Remaining','Purchase rate','Total cost']} rows={lots.map(l=>[l.purchase_date,l.vendor||'—',usd(l.amount_usd),usd(l.remaining_usd),bdt(l.purchase_rate),bdt(Number(l.amount_usd)*Number(l.purchase_rate))])}/></section></>}
 {tab==='Campaign Spend'&&canView('campaign_spend')&&<><Heading title="Campaign Spend & Client Billing" canAdd={canManage('campaign_spend')} onAdd={()=>setShowForm(!showForm)}/>{showForm&&canManage('campaign_spend')&&<form className="panel form" onSubmit={save}><h3>Record campaign spend</h3><label>Campaign<select required value={spendForm.campaign_id} onChange={e=>{const c=campaigns.find(x=>x.id===e.target.value);const client=clients.find(x=>x.id===c?.client_id);setSpendForm({...spendForm,campaign_id:e.target.value,service_charge_type:client?.default_service_charge_type||'percent',service_charge_value:String(client?.default_service_charge_value||0),client_rate:String(c?.exchange_rate||125)})}}><option value="">Choose campaign</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name} — {names[c.client_id]}</option>)}</select></label><label>USD purchase lot<select required value={spendForm.purchase_lot_id} onChange={e=>setSpendForm({...spendForm,purchase_lot_id:e.target.value})}><option value="">Choose available dollar lot</option>{lots.filter(l=>Number(l.remaining_usd)>0).map(l=><option key={l.id} value={l.id}>{l.purchase_date} · {l.vendor||'Seller'} · {usd(l.remaining_usd)} left @ {bdt(l.purchase_rate)}</option>)}</select></label><label>Spent USD<input type="number" min="0.01" step="0.01" required value={spendForm.amount_usd} onChange={e=>setSpendForm({...spendForm,amount_usd:e.target.value})}/></label><label>Client billing rate (BDT/USD)<input type="number" min="0.01" step="0.0001" required value={spendForm.client_rate} onChange={e=>setSpendForm({...spendForm,client_rate:e.target.value})}/></label><label>Service charge type<select value={spendForm.service_charge_type} onChange={e=>setSpendForm({...spendForm,service_charge_type:e.target.value})}><option value="fixed">Fixed BDT</option><option value="percent">Percentage of ad cost</option></select></label><label>Service charge value<input type="number" min="0" step="0.01" required value={spendForm.service_charge_value} onChange={e=>setSpendForm({...spendForm,service_charge_value:e.target.value})}/></label><label>Spend date<input type="date" required value={spendForm.spend_date} onChange={e=>setSpendForm({...spendForm,spend_date:e.target.value})}/></label><label>Platform reference<input value={spendForm.platform_reference} onChange={e=>setSpendForm({...spendForm,platform_reference:e.target.value})}/></label><label>Notes<input value={spendForm.notes} onChange={e=>setSpendForm({...spendForm,notes:e.target.value})}/></label><p className="muted">Estimated client bill: {bdt(Number(spendForm.amount_usd||0)*Number(spendForm.client_rate||0)+(spendForm.service_charge_type==='fixed'?Number(spendForm.service_charge_value||0):Number(spendForm.amount_usd||0)*Number(spendForm.client_rate||0)*Number(spendForm.service_charge_value||0)/100))}</p><button className="primary">Save spend & update USD lot</button></form>}<section className="panel"><Table headers={['Date','Campaign','Client','USD spent','Actual cost','Client ad bill','Service fee','Total client bill']} rows={spends.map(s=>{const c=campaigns.find(x=>x.id===s.campaign_id);return [s.spend_date,c?.name||'—',c?names[c.client_id]||'—':'—',usd(s.amount_usd),bdt(Number(s.amount_usd)*Number(s.exchange_rate||0)),bdt(s.ad_cost_bdt),bdt(s.service_charge_bdt),bdt(s.client_bill_bdt)]})}/></section></>}
 {tab==='Client Due'&&canView('client_due')&&<><h1>Client Due Summary</h1><p className="muted">Campaign Spend bill or its issued Invoice (counted once) − recorded client payments. Legacy invoices are retained when Campaign Spend ledger totals are unavailable.</p><section className="panel"><Table headers={['Client','Total billed','Paid','Due','Advance']} rows={dues.map(d=>[d.client_name,bdt(d.total_billed_bdt),bdt(d.paid_bdt),bdt(d.due_bdt),bdt(d.advance_bdt)])}/></section></>}
 {tab==='Invoices'&&canView('invoices')&&<><Heading title="Client Invoices" canAdd={canManage('invoices')} onAdd={()=>setShowForm(!showForm)}/><p className="muted">Create an itemized BDT invoice as the formal document for Campaign Spend billing, not an additional client charge. Client Due counts the Campaign Spend bill or its issued Invoice only once. Payments automatically apply to the oldest open invoice for that Client; any remainder stays unallocated to an invoice.</p>{showForm&&canManage('invoices')&&<form className="panel form" onSubmit={save}><h3>Create invoice</h3><p className="muted full-width invoice-number-note">Invoice number is assigned automatically when saved. Format: <strong>FHT-YYYY-00001</strong>.</p><label>Client<select required value={invoiceForm.client_id} onChange={e=>setInvoiceForm({...invoiceForm,client_id:e.target.value})}><option value="">Choose client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Issue date<input type="date" required value={invoiceForm.issue_date} onChange={e=>setInvoiceForm({...invoiceForm,issue_date:e.target.value})}/></label><label>Due date<input type="date" value={invoiceForm.due_date} onChange={e=>setInvoiceForm({...invoiceForm,due_date:e.target.value})}/></label><label className="full-width">Notes<textarea rows={2} value={invoiceForm.notes} onChange={e=>setInvoiceForm({...invoiceForm,notes:e.target.value})}/></label><div className="invoice-lines full-width"><h3>Invoice items</h3>{invoiceLines.map((line,index)=><div className="invoice-line" key={index}><label>Description<input required value={line.description} onChange={e=>setInvoiceLines(current=>current.map((x,i)=>i===index?{...x,description:e.target.value}:x))}/></label><label>Quantity<input type="number" min="0.01" step="0.01" required value={line.quantity} onChange={e=>setInvoiceLines(current=>current.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))}/></label><label>Unit price (BDT)<input type="number" min="0" step="0.01" required value={line.unit_price_bdt} onChange={e=>setInvoiceLines(current=>current.map((x,i)=>i===index?{...x,unit_price_bdt:e.target.value}:x))}/></label><button type="button" className="textbutton" onClick={()=>setInvoiceLines(current=>current.length>1?current.filter((_,i)=>i!==index):current)}>Remove</button></div>)}<button type="button" className="primary" onClick={()=>setInvoiceLines(current=>[...current,{description:'',quantity:'1',unit_price_bdt:''}])}>Add invoice item</button><p className="invoice-total">Invoice total: {bdt(invoiceLines.reduce((sum,x)=>sum+Number(x.quantity||0)*Number(x.unit_price_bdt||0),0))}</p></div><button className="primary">Save invoice</button></form>}<section className="panel"><h3>All invoices ({invoices.length})</h3><div className="tablewrap"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issue date</th><th>Due date</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th><th>Action</th></tr></thead><tbody>{invoices.map(inv=>{const status=invoiceStatus(inv);return <tr key={inv.id}><td>{inv.invoice_number}</td><td>{names[inv.client_id]||'—'}</td><td>{inv.issue_date}</td><td>{inv.due_date||'—'}</td><td><span className={'status status-'+status}>{status.replace(/_/g,' ')}</span></td><td>{bdt(inv.subtotal_bdt)}</td><td>{canView('payments')?bdt(allocatedForInvoice(inv.id)):'—'}</td><td>{canView('payments')?bdt(invoiceBalance(inv)):'—'}</td><td><button type="button" className="textbutton" onClick={()=>setSelectedInvoiceId(inv.id)}>View / Print</button></td></tr>})}{!invoices.length&&<tr><td colSpan={9} className="empty">No invoices created yet.</td></tr>}</tbody></table></div></section>{(()=>{const selected=invoices.find(x=>x.id===selectedInvoiceId);if(!selected)return null;const client=clients.find(x=>x.id===selected.client_id);const lines=invoiceItems.filter(x=>x.invoice_id===selected.id);const allocations=invoiceAllocations.filter(x=>x.invoice_id===selected.id);const paid=allocatedForInvoice(selected.id);const balance=invoiceBalance(selected);const status=invoiceStatus(selected);return <><section className="panel no-print invoice-actions"><h3>Invoice {selected.invoice_number}</h3><button className="primary" type="button" onClick={()=>window.print()}><Printer size={16}/> Print / Save PDF</button><button className="textbutton" type="button" onClick={()=>setSelectedInvoiceId('')}>Close preview</button></section><section className="panel invoice-print"><div className="invoice-brand"><div className="logo">FH</div><div><h1>FH Habibur Tech</h1><p>Digital Marketing & Advertising Services</p></div><div className="invoice-tag">INVOICE</div></div><div className="invoice-meta"><div><small>INVOICE TO</small><h2>{client?.name||'Client'}</h2><p>{client?.business_name||''}</p><p>{client?.phone||''}</p></div><div><p><b>Invoice No:</b> {selected.invoice_number}</p><p><b>Issue date:</b> {selected.issue_date}</p><p><b>Due date:</b> {selected.due_date||'—'}</p><p><b>Status:</b> <span className={'status status-'+status}>{status.replace(/_/g,' ')}</span></p></div></div><div className="tablewrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{lines.map(line=><tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{bdt(line.unit_price_bdt)}</td><td>{bdt(Number(line.quantity)*Number(line.unit_price_bdt))}</td></tr>)}</tbody></table></div><div className="invoice-payment-summary"><div><span>Invoice total</span><strong>{bdt(selected.subtotal_bdt)}</strong></div><div><span>Paid to date</span><strong>{canView('payments')?bdt(paid):'Restricted'}</strong></div><div><span>Balance due</span><strong>{canView('payments')?bdt(balance):'Restricted'}</strong></div></div>{canView('payments')&&allocations.length>0&&<div className="invoice-allocation-list"><h3>Payment allocation</h3><div className="tablewrap"><table><thead><tr><th>Payment date</th><th>Method</th><th>Reference</th><th>Applied amount</th></tr></thead><tbody>{allocations.map(a=>{const payment=payments.find(p=>p.id===a.payment_id);return <tr key={a.id}><td>{payment?.payment_date||'—'}</td><td>{payment?.method||'—'}</td><td>{payment?.reference||'—'}</td><td>{bdt(a.amount_bdt)}</td></tr>})}</tbody></table></div></div>}{selected.notes&&<p className="invoice-notes">Notes: {selected.notes}</p>}<div className="invoice-footer"><p>Thank you for your business.</p><small>FH Habibur Tech · {session.user.email}</small></div></section></>})()}</>}
 {tab==='Team Access'&&profile?.role==='admin'&&<><h1>Team Access Management</h1><p className="muted">New registrations enter Pending status and cannot see company data. Review each request, assign a role, then set access to Approved. Approved access takes effect after the user signs in again.</p><section className="panel"><h3>Registered accounts ({teamMembers.length})</h3><div className="tablewrap"><table><thead><tr><th>Email</th><th>Name</th><th>Current role</th><th>Approval status</th><th>Assign role</th><th>Access decision</th><th>Action</th></tr></thead><tbody>{teamMembers.map(member=><tr key={member.id}><td>{member.email||'—'}</td><td>{member.full_name||'—'}</td><td>{member.role}</td><td><span className={'status status-'+member.approval_status}>{member.approval_status}</span></td><td><select disabled={member.id===session.user.id} value={roleChanges[member.id]||member.role} onChange={e=>setRoleChanges(current=>({...current,[member.id]:e.target.value as TeamMember['role']}))}><option value="employee">Employee</option><option value="accountant">Accountant</option><option value="admin">Admin</option></select></td><td><select disabled={member.id===session.user.id} value={approvalChanges[member.id]||member.approval_status} onChange={e=>setApprovalChanges(current=>({...current,[member.id]:e.target.value as TeamMember['approval_status']}))}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option></select></td><td><button type="button" className="textbutton" disabled={member.id===session.user.id||((roleChanges[member.id]||member.role)===member.role&&(approvalChanges[member.id]||member.approval_status)===member.approval_status)} onClick={()=>void updateTeamAccess(member.id)}>Save changes</button></td></tr>)}{!teamMembers.length&&<tr><td colSpan={7} className="empty">No registered accounts found.</td></tr>}</tbody></table></div></section><p className="muted">Pending, Rejected and Suspended accounts cannot access client, campaign, invoice or finance data. Only an approved Admin can change these settings. Account approval does not send an invitation email.</p>{teamMembers.filter(member=>member.role==='employee').map(member=>{const draft=clientAssignmentDrafts[member.id]||[];const saved=savedClientAssignments[member.id]||[];const changed=draft.length!==saved.length||draft.some(id=>!saved.includes(id));return <section className="panel assignment-panel" key={member.id}><div className="heading"><div><h3>Client assignments · {member.email||member.full_name||'Employee'}</h3><p className="muted">Only the clients selected here will appear for this Employee. Their Campaigns are included automatically.</p></div><button type="button" className="primary" disabled={!changed} onClick={()=>void saveClientAssignments(member.id)}>Save assigned clients</button></div>{clients.length?<div className="assignment-grid">{clients.map(client=><label className="assignment-option" key={client.id}><input type="checkbox" checked={draft.includes(client.id)} onChange={e=>setClientAssignmentDrafts(current=>({...current,[member.id]:e.target.checked?[...(current[member.id]||[]),client.id]:(current[member.id]||[]).filter(id=>id!==client.id)}))}/><span><b>{client.name}</b><small>{client.business_name||'No business name'}</small></span></label>)}</div>:<p className="muted">No clients are available to assign yet.</p>}<p className="muted assignment-footnote">{draft.length} client(s) selected · Account status: {member.approval_status}</p></section>})}{teamMembers.filter(member=>member.role==='employee').map(member=>{const draft=modulePermissionDrafts[member.id]||{...DEFAULT_MODULE_PERMISSIONS};const saved=savedModulePermissions[member.id]||{...DEFAULT_MODULE_PERMISSIONS};const changed=MODULES.some(module=>draft[module.key]!==saved[module.key]);return <section className="panel assignment-panel" key={'permissions-'+member.id}><div className="heading"><div><h3>Module permissions · {member.email||member.full_name||'Employee'}</h3><p className="muted">Choose No Access, View Only, or Manage for each module. Client-linked sections remain limited to the Employee's assigned clients.</p></div><button type="button" className="primary" disabled={!changed} onClick={()=>void saveModulePermissions(member.id)}>Save module permissions</button></div><div className="tablewrap"><table><thead><tr><th>Module</th><th>Permission</th><th>Data scope</th></tr></thead><tbody>{MODULES.map(module=><tr key={module.key}><td><b>{module.label}</b></td><td><select value={draft[module.key]} onChange={e=>setModulePermissionDrafts(current=>({...current,[member.id]:{...(current[member.id]||DEFAULT_MODULE_PERMISSIONS),[module.key]:e.target.value as ModuleAccess}}))}><option value="none">No Access</option><option value="view">View Only</option>{module.manageable&&<option value="manage">Manage</option>}</select></td><td>{module.scope}</td></tr>)}</tbody></table></div><p className="muted assignment-footnote">Dollar Purchases and Expenses expose company-wide financial data. Campaign Spend Manage also requires Dollar Purchases Manage. Reports show assigned-client aggregates only.</p></section>})}</>}
{tab==='Payments'&&canView('payments')&&<><Heading title="Client Payments" canAdd={canManage('payments')} onAdd={()=>setShowForm(!showForm)}/>{showForm&&canManage('payments')&&<form className="panel form" onSubmit={save}><h3>Record client payment</h3><p className="muted">The payment is automatically allocated to the oldest outstanding invoice(s) for the selected Client. Any amount not applied to an invoice remains unallocated to an invoice. All recorded payments still count against the client's overall balance.</p><label>Client<select required value={paymentForm.client_id} onChange={e=>setPaymentForm({...paymentForm,client_id:e.target.value})}><option value="">Choose client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Amount BDT<input type="number" min="0.01" step="0.01" required value={paymentForm.amount_bdt} onChange={e=>setPaymentForm({...paymentForm,amount_bdt:e.target.value})}/></label><label>Payment date<input type="date" value={paymentForm.payment_date} onChange={e=>setPaymentForm({...paymentForm,payment_date:e.target.value})}/></label><label>Method<select value={paymentForm.method} onChange={e=>setPaymentForm({...paymentForm,method:e.target.value})}>{['Bank transfer','bKash','Nagad','Cash','Card'].map(x=><option key={x}>{x}</option>)}</select></label><label>Reference<input value={paymentForm.reference} onChange={e=>setPaymentForm({...paymentForm,reference:e.target.value})}/></label><button className="primary">Save payment</button></form>}<section className="panel">{canView('invoices')?<Table headers={['Date','Client','Method','Reference','Received','Allocated','Unallocated to invoice']} rows={payments.map(p=>{const allocated=allocatedForPayment(p.id);return [p.payment_date,names[p.client_id]||'—',p.method,p.reference||'—',bdt(p.amount_bdt),bdt(allocated),bdt(Math.max(Number(p.amount_bdt)-allocated,0))]})}/>:<Table headers={['Date','Client','Method','Reference','Amount']} rows={payments.map(p=>[p.payment_date,names[p.client_id]||'—',p.method,p.reference||'—',bdt(p.amount_bdt)])}/>}</section></>}
 {tab==='Expenses'&&canView('expenses')&&<><Heading title="Business Expenses" canAdd={canManage('expenses')} onAdd={()=>setShowForm(!showForm)}/>{showForm&&canManage('expenses')&&<form className="panel form" onSubmit={save}><h3>Record expense</h3><label>Title<input required value={expenseForm.title} onChange={e=>setExpenseForm({...expenseForm,title:e.target.value})}/></label><label>Category<select value={expenseForm.category} onChange={e=>setExpenseForm({...expenseForm,category:e.target.value})}>{['Other','Office','Internet','Software','Marketing','Transport','Utilities','Bank fees'].map(x=><option key={x}>{x}</option>)}</select></label><label>Amount BDT<input type="number" min="0.01" step="0.01" required value={expenseForm.amount_bdt} onChange={e=>setExpenseForm({...expenseForm,amount_bdt:e.target.value})}/></label><label>Date<input type="date" value={expenseForm.expense_date} onChange={e=>setExpenseForm({...expenseForm,expense_date:e.target.value})}/></label><label>Notes<input value={expenseForm.notes} onChange={e=>setExpenseForm({...expenseForm,notes:e.target.value})}/></label><button className="primary">Save expense</button></form>}<section className="panel"><Table headers={['Date','Title','Category','Amount']} rows={expenses.map(x=>[x.expense_date,x.title,x.category,bdt(x.amount_bdt)])}/></section></>}
 {tab==='Reports'&&canView('reports')&&<>{finance? <><h1>Monthly Campaign Accrual Reports</h1><p className="muted">Net profit here = Campaign Spend service charges + FX margin − operating expenses. Invoices are formal documents for the same Campaign Spend bill, so invoice totals are not added again as income or profit.</p><section className="panel"><Table headers={['Month','Client billed','Service revenue','FX margin','Actual ad cost','Operating expenses','Net profit']} rows={monthly.map(m=>[m.month,bdt(m.campaign_client_billed_bdt),bdt(m.service_revenue_bdt),bdt(m.fx_margin_bdt),bdt(m.actual_ad_cost_bdt),bdt(m.operating_expenses_bdt),bdt(m.net_profit_bdt)])}/></section></>:<><h1>Assigned Client Monthly Report</h1><p className="muted">This report includes aggregates from your Admin-assigned clients only. Company-wide expenses and net profit are not shown.</p><section className="panel"><Table headers={['Month','Client billed','Service revenue','FX margin','Actual ad cost']} rows={employeeMonthly.map(m=>[m.month,bdt(m.campaign_client_billed_bdt),bdt(m.service_revenue_bdt),bdt(m.fx_margin_bdt),bdt(m.actual_ad_cost_bdt)])}/></section></>}</>}
 </>}</div></main></div>;
}
function Metric({label,value}:{label:string;value:string}){return <article><small>{label}</small><strong>{value}</strong></article>}
function Heading({title,canAdd,onAdd}:{title:string;canAdd:boolean;onAdd:()=>void}){return <div className="heading"><div><h1>{title}</h1></div>{canAdd&&<button className="primary" onClick={onAdd}><Plus size={16}/> Add new</button>}</div>}
function Table({headers,rows}:{headers:string[];rows:(string|number)[][]}){return <div className="tablewrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v}</td>)}</tr>)}{!rows.length&&<tr><td colSpan={headers.length} className="empty">No records yet.</td></tr>}</tbody></table></div>}
