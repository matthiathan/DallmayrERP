'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ComparisonLineChart, type ComparisonPoint } from './ComparisonLineChart';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelemetryAnalytics.module.css';

type Period = 'day' | 'week' | 'month' | 'six_months';
type Dataset = 'production' | 'simulation';
type Branch = 'all' | 'jhb' | 'cpt' | 'kzn' | 'national';
type Summary = { units_sold:number; revenue_cents:number; failed_vends:number; active_machines:number; reporting_devices:number; online_devices:number; offline_devices:number; unassigned_devices:number };
type Daily = { date:string; units_sold:number; revenue_cents:number; failed_vends:number };
type BranchRow = { branch:string; units_sold:number; revenue_cents:number; failed_vends:number };
type Item = { product_key:string; sku:string|null; product_name:string|null; brand:string|null; units_sold:number; revenue_cents:number; failed_vends:number };
type Machine = { machine_id:string|null; machine_name:string|null; serial_number:string|null; location:string|null; branch:string; units_sold:number; revenue_cents:number; failed_vends:number };
type Sale = { id:string; sales_date:string; machine_name:string|null; serial_number:string|null; location:string|null; branch:string; selection_code:string; sku:string|null; product_name:string|null; units_sold:number; failed_vends:number; revenue_cents:number; last_received_at:string };
type Payload = { date_from:string; date_to:string; availability?:{production_rows?:number;simulation_rows?:number;active_simulation_devices?:number}; summary:Summary; daily_trend:Daily[]; by_branch:BranchRow[]; top_items:Item[]; top_machines:Machine[]; recent_sales:Sale[] };

const periods: Record<Period,string> = { day:'Today', week:'Last 7 days', month:'Last 30 days', six_months:'Last 6 months' };
const branches: Record<Branch,string> = { all:'All branches', jhb:'Johannesburg', cpt:'Cape Town', kzn:'KwaZulu-Natal', national:'National' };

function n(value: unknown){ const parsed=Number(value??0); return Number.isFinite(parsed)?parsed:0; }
function money(cents:number){return new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR',maximumFractionDigits:0}).format(n(cents)/100)}
function shortDate(value:string){return new Date(`${value}T00:00:00`).toLocaleDateString('en-ZA',{day:'2-digit',month:'2-digit'})}
function normalise(value:unknown):Payload{const v=(value??{}) as Partial<Payload>;const s=(v.summary??{}) as Partial<Summary>;return{date_from:v.date_from??'',date_to:v.date_to??'',availability:v.availability,summary:{units_sold:n(s.units_sold),revenue_cents:n(s.revenue_cents),failed_vends:n(s.failed_vends),active_machines:n(s.active_machines),reporting_devices:n(s.reporting_devices),online_devices:n(s.online_devices),offline_devices:n(s.offline_devices),unassigned_devices:n(s.unassigned_devices)},daily_trend:(v.daily_trend??[]).map(r=>({...r,units_sold:n(r.units_sold),revenue_cents:n(r.revenue_cents),failed_vends:n(r.failed_vends)})),by_branch:(v.by_branch??[]).map(r=>({...r,units_sold:n(r.units_sold),revenue_cents:n(r.revenue_cents),failed_vends:n(r.failed_vends)})),top_items:(v.top_items??[]).map(r=>({...r,units_sold:n(r.units_sold),revenue_cents:n(r.revenue_cents),failed_vends:n(r.failed_vends)})),top_machines:(v.top_machines??[]).map(r=>({...r,units_sold:n(r.units_sold),revenue_cents:n(r.revenue_cents),failed_vends:n(r.failed_vends)})),recent_sales:(v.recent_sales??[]).map(r=>({...r,units_sold:n(r.units_sold),revenue_cents:n(r.revenue_cents),failed_vends:n(r.failed_vends)}))}}

function previousRows(current:Payload,history:Payload){
  if(!current.date_from||!current.date_to||!history.daily_trend.length)return [] as Daily[];
  const from=new Date(`${current.date_from}T00:00:00`);const to=new Date(`${current.date_to}T00:00:00`);const days=Math.max(1,Math.round((to.getTime()-from.getTime())/86400000)+1);if(days>190)return [];
  const end=new Date(from);end.setDate(end.getDate()-1);const start=new Date(end);start.setDate(start.getDate()-days+1);const a=formatLocalDate(start);const b=formatLocalDate(end);return history.daily_trend.filter(r=>r.date>=a&&r.date<=b);
}

function Metric({label,value,helper,tone=''}:{label:string;value:string;helper:string;tone?:''|'green'|'red'|'amber'|'gold'}){return <article className={`${styles.metric} ${tone?styles[tone]:''}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>}

export function TelemetryAnalytics(){
  const [period,setPeriod]=useState<Period>('month');
  const [branch,setBranch]=useState<Branch>('all');
  const [dataset,setDataset]=useState<Dataset>('production');
  const [data,setData]=useState<Payload|null>(null);
  const [history,setHistory]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [updated,setUpdated]=useState<Date|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError(null);const client=getSupabaseClient();
    const [currentResult,historyResult]=await Promise.all([
      client.rpc('get_telemetry_reporting',{p_period:period,p_branch:branch,p_dataset:dataset}),
      client.rpc('get_telemetry_reporting',{p_period:'six_months',p_branch:branch,p_dataset:dataset}),
    ]);
    if(currentResult.error||historyResult.error){setError(currentResult.error?.message??historyResult.error?.message??'Could not load analytics.');setLoading(false);return;}
    const next=normalise(currentResult.data);setData(next);setHistory(normalise(historyResult.data));setUpdated(new Date());setLoading(false);
  },[branch,dataset,period]);

  useEffect(()=>{load().catch(e=>{setError(e instanceof Error?e.message:'Could not load analytics.');setLoading(false)})},[load]);

  const previous=useMemo(()=>data&&history?previousRows(data,history):[],[data,history]);
  const currentChart=useMemo<ComparisonPoint[]>(()=>(data?.daily_trend??[]).map(r=>({key:r.date,label:shortDate(r.date),value:r.units_sold,detail:money(r.revenue_cents)})),[data?.daily_trend]);
  const previousChart=useMemo<ComparisonPoint[]>(()=>previous.map(r=>({key:r.date,label:shortDate(r.date),value:r.units_sold,detail:money(r.revenue_cents)})),[previous]);
  const summary=data?.summary;
  const units=summary?.units_sold??0;const failed=summary?.failed_vends??0;const attempts=units+failed;const success=attempts?units/attempts*100:100;const availability=(summary?.reporting_devices??0)?(summary?.online_devices??0)/(summary?.reporting_devices??1)*100:0;
  const previousUnits=previous.reduce((s,r)=>s+r.units_sold,0);const change=previousUnits?((units-previousUnits)/previousUnits)*100:0;
  const maxBranch=Math.max(1,...(data?.by_branch??[]).map(r=>r.units_sold));

  function exportCsv(){if(!data)return;const rows=[['Date','Machine','Serial','Location','Item','Units','Failed','Revenue'],...data.recent_sales.map(r=>[r.sales_date,r.machine_name??'',r.serial_number??'',r.location??'',r.product_name??r.sku??r.selection_code,r.units_sold,r.failed_vends,money(r.revenue_cents)])];const csv=rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`dallmayr-telemetry-${data.date_from}-${data.date_to}.csv`;a.click();URL.revokeObjectURL(url)}

  return <section className={styles.analytics} data-analytics="televend-v3">
    <header className={styles.header}><div><h1>Analytics</h1><p>Compare sales, vends, reliability and machine performance across periods.</p></div><button disabled={!data} onClick={exportCsv} type="button">Export CSV</button></header>
    <section className={styles.controls}><label><span>Period</span><select value={period} onChange={e=>setPeriod(e.target.value as Period)}>{(Object.keys(periods) as Period[]).map(v=><option key={v} value={v}>{periods[v]}</option>)}</select></label><label><span>Branch</span><select value={branch} onChange={e=>setBranch(e.target.value as Branch)}>{(Object.keys(branches) as Branch[]).map(v=><option key={v} value={v}>{branches[v]}</option>)}</select></label><label><span>Dataset</span><select value={dataset} onChange={e=>setDataset(e.target.value as Dataset)}><option value="production">Production telemetry</option><option value="simulation">POC simulation</option></select></label><button disabled={loading} onClick={()=>load()} type="button">{loading?'Refreshing…':'Refresh'}</button><span className={styles.updated}>Updated {updated?updated.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'}):'—'}</span></section>
    {error?<div className={styles.error} role="alert">{error}</div>:null}{dataset==='simulation'?<div className={styles.simulation}>Simulation telemetry is isolated from production totals.</div>:null}{loading&&!data?<HamsterLoader label="Loading analytics"/>:null}
    {data?<><section className={styles.metrics}><Metric helper={`${change>=0?'+':''}${change.toFixed(1)}% vs previous`} label="Items sold" value={units.toLocaleString('en-ZA')}/><Metric helper={`${data.date_from} – ${data.date_to}`} label="Revenue" tone="gold" value={money(summary?.revenue_cents??0)}/><Metric helper={`${summary?.online_devices??0} online`} label="Availability" tone="green" value={`${availability.toFixed(1)}%`}/><Metric helper={`${failed} failed`} label="Vend success" tone={success>=98?'green':success>=95?'amber':'red'} value={`${success.toFixed(1)}%`}/><Metric helper="Machines with sales" label="Active machines" tone="amber" value={(summary?.active_machines??0).toLocaleString('en-ZA')}/><Metric helper={`${summary?.unassigned_devices??0} unassigned`} label="Reporting devices" value={(summary?.reporting_devices??0).toLocaleString('en-ZA')}/></section>
      <section className={styles.grid}><article className={`${styles.card} ${styles.comparison}`}><header className={`${styles.cardHeader} ${styles.redHeader}`}><div><span>{periods[period]}</span><h2>Sales comparison</h2></div><strong>{change>=0?'+':''}{change.toFixed(1)}%</strong></header><div className={styles.cardBody}>{currentChart.length?<ComparisonLineChart current={currentChart} currentLabel="This period" previous={previousChart} previousLabel="Previous period" valueLabel="vends"/>:<div className={styles.empty}>No sales data for this period.</div>}</div><footer className={styles.footer}><span>Total revenue</span><strong>{money(summary?.revenue_cents??0)}</strong></footer></article>
      <article className={styles.card}><header className={styles.cardHeader}><div><span>Branches</span><h2>Sales by branch</h2></div><strong>{data.by_branch.length}</strong></header><div className={styles.branchList}>{data.by_branch.map(row=><div className={styles.branchRow} key={row.branch}><span>{row.branch.toUpperCase()}</span><div className={styles.track}><i style={{width:`${row.units_sold/maxBranch*100}%`}}/></div><b>{row.units_sold.toLocaleString('en-ZA')}</b></div>)}{!data.by_branch.length?<div className={styles.empty}>No branch totals.</div>:null}</div></article></section>
      <section className={styles.gridThree}><article className={styles.card}><header className={styles.cardHeader}><div><span>Product ranking</span><h2>Top products</h2></div></header><div className={styles.rankList}><div className={styles.rankHead}><span>#</span><span>Product</span><span>Vends</span><span>Failed</span></div>{data.top_items.slice(0,10).map((r,i)=><div className={styles.rankRow} key={r.product_key}><b>{i+1}</b><span className={styles.rankName}>{r.product_name??r.sku??r.product_key}</span><span className={styles.rankValue}>{r.units_sold.toLocaleString('en-ZA')}</span><span className={styles.rankFail}>{r.failed_vends.toLocaleString('en-ZA')}</span></div>)}</div></article><article className={styles.card}><header className={styles.cardHeader}><div><span>Machine ranking</span><h2>Top machines</h2></div></header><div className={styles.rankList}><div className={styles.rankHead}><span>#</span><span>Machine</span><span>Vends</span><span>Failed</span></div>{data.top_machines.slice(0,10).map((r,i)=><div className={styles.rankRow} key={r.machine_id??String(i)}><b>{i+1}</b><span className={styles.rankName}>{r.machine_name??r.serial_number??'Unassigned'}</span><span className={styles.rankValue}>{r.units_sold.toLocaleString('en-ZA')}</span><span className={styles.rankFail}>{r.failed_vends.toLocaleString('en-ZA')}</span></div>)}</div></article><article className={styles.card}><header className={styles.cardHeader}><div><span>Reliability</span><h2>Period totals</h2></div></header><div className={styles.branchList}><div className={styles.branchRow}><span>Successful</span><div className={styles.track}><i style={{width:`${success}%`}}/></div><b>{units}</b></div><div className={styles.branchRow}><span>Failed</span><div className={styles.track}><i style={{width:`${attempts?failed/attempts*100:0}%`}}/></div><b>{failed}</b></div><div className={styles.branchRow}><span>Online</span><div className={styles.track}><i style={{width:`${availability}%`}}/></div><b>{summary?.online_devices??0}</b></div></div></article></section>
      <article className={styles.card}><header className={styles.cardHeader}><div><span>Transaction counters</span><h2>Recent vend activity</h2></div><strong>{data.recent_sales.length}</strong></header><div style={{overflowX:'auto'}}><table className={styles.recent}><thead><tr><th>Date</th><th>Machine</th><th>Item</th><th>Units</th><th>Failed</th><th>Revenue</th></tr></thead><tbody>{data.recent_sales.slice(0,50).map(r=><tr key={r.id}><td>{r.sales_date}</td><td><strong>{r.machine_name??r.serial_number??r.branch.toUpperCase()}</strong></td><td>{r.product_name??r.sku??r.selection_code}</td><td>{r.units_sold}</td><td>{r.failed_vends}</td><td>{money(r.revenue_cents)}</td></tr>)}</tbody></table><div className={styles.mobileRecent}>{data.recent_sales.slice(0,30).map(r=><div className={styles.recentRow} key={r.id}><strong>{r.product_name??r.sku??r.selection_code}</strong><b>{r.units_sold}</b><span>{r.machine_name??r.serial_number??r.branch.toUpperCase()} · {r.sales_date}</span></div>)}</div></div></article>
    </>:null}
  </section>
}
