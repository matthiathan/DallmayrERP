import { expect, test } from '@playwright/test';
import { installSupabaseAuthFixture } from './helpers/supabase-auth-fixture.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const origin = 'https://egbiiizxsqlarqpnzxxs.supabase.co';
const userId = '10000000-0000-4000-8000-000000000219';
const staffId = '20000000-0000-4000-8000-000000000219';
const statuses = ['new', 'assigned', 'in_progress', 'completed'];
const summary = { active_jobs: 181, overdue: 4, due_soon: 5, unassigned: 65, in_progress: 60,
  completed_30d: 30, reported_30d: 200, plans_due: 2, active_plans: 10 };

function reply(data) {
  return { status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' },
    body: JSON.stringify(data) };
}
function session() {
  const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({sub:userId,email:'maintenance-test@example.com',role:'authenticated',exp:Math.floor(Date.now()/1000)+7200})).toString('base64url');
  return { access_token: header+'.'+payload+'.test-signature',refresh_token:'maintenance-test-refresh',
    token_type:'bearer',expires_in:7200,expires_at:Math.floor(Date.now()/1000)+7200,
    user:{id:userId,aud:'authenticated',role:'authenticated',email:'maintenance-test@example.com',
      app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00.000Z'} };
}
function job(status,index,date) {
  return { id: `90000000-0000-4000-8000-${String(index+statuses.indexOf(status)*200).padStart(12,'0')}`,
    job_number:`JOB-${status}-${index}`,incident_number:`INC-${index}`,status,priority:'medium',
    reported_at:date,due_at:date,summary:`Maintenance work ${index}`,assigned_to:null,machine_id:null,
    customer_name_snapshot:'Demo Customer',customers:{customer_name:'Demo Customer'},
    machines:{machine_name:'Mock Machine',serial_number:'M-1'},customer_sites:{site_name:'Mock Site',address:'Mock Street'} };
}
async function openPage(browser, handler) {
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  const page = await context.newPage();
  const auth = session();
  await installSupabaseAuthFixture(page,baseURL,auth);
  await page.addInitScript(s=>{localStorage.setItem('dallmayrerp-auth-persistence','device');
    localStorage.setItem('dallmayrerp-supabase-auth',JSON.stringify(s));},auth);
  await page.route(origin+'/**',async route=>{
    const url=new URL(route.request().url());
    if(route.request().method()==='OPTIONS') return route.fulfill({...reply(null),status:204});
    if(url.pathname==='/auth/v1/user') return route.fulfill(reply(auth.user));
    if(url.pathname.startsWith('/auth/v1/token')) return route.fulfill(reply(auth));
    if(url.pathname==='/rest/v1/users') return route.fulfill(reply({
      id:staffId,auth_user_id:userId,email:auth.user.email,is_active:true,account_scope:'dallmayr',customer_id:null,access_note:null,access_updated_by:null,access_updated_at:null,created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'}));
    if(url.pathname==='/rest/v1/user_details') return route.fulfill(reply({
      id:'details-maintenance',user_id:staffId,role:'admin',branch:'national',telemetry_region:'south_africa',first_name:'Test',last_name:'Operator',phone_number:'0110000000',birthday:'1990-01-01',emergency_contact_name:'Test',emergency_contact_phone:'0820000000',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'}));
    if(url.pathname==='/rest/v1/rpc/claim_current_app_user') return route.fulfill(reply(null));
    if(url.pathname==='/rest/v1/rpc/list_assignable_technicians') return route.fulfill(reply([]));
    if(url.pathname==='/rest/v1/rpc/get_telemetry_maintenance_directory') {
      return route.fulfill(reply(handler(route.request().postDataJSON() ?? {})));
    }
    if(url.pathname.startsWith('/rest/v1/')) return route.fulfill(reply([]));
    return route.fulfill(reply({}));
  });
  await page.goto(baseURL+'/maintenance',{waitUntil:'domcontentloaded'});
  await expect(page.locator('[data-maintenance-workspace="telemetry-v1"]')).toBeVisible({timeout:20000});
  return {page,context};
}

test('Kanban shows full totals and navigates one column independently',async ({browser})=>{
  const calls=[];
  const {page,context}=await openPage(browser,args=>{
    calls.push(args);
    const status=args.p_status;
    const offset=args.p_offset??0;
    const count=status==='new'?65:status==='assigned'?56:status==='in_progress'?60:status==='completed'?30:181;
    const rows=Array.from({length:Math.max(0,Math.min(50,count-offset))},(_,i)=>
      job(statuses.includes(status)?status:'new',offset+i,'2026-10-21T10:00:00+02:00'));
    return {rows,total:count,summary};
  });
  await page.getByRole('button',{name:'Kanban',exact:true}).click();
  await expect(page.getByText('JOB-new-0',{exact:true})).toBeVisible();
  await expect(page.getByText('JOB-new-49',{exact:true})).toBeVisible();
  const newColumn = page.locator('section').filter({has:page.getByText('JOB-new-0',{exact:true})}).last();
  await newColumn.getByRole('button',{name:'Next'}).click();
  await expect.poll(()=>calls.some(x=>x.p_status==='new'&&x.p_offset===50)).toBe(true);
  await expect(page.getByText('JOB-new-50',{exact:true})).toBeVisible();
  await expect(page.getByText('JOB-assigned-0',{exact:true})).toBeVisible();
  await context.close();
});

test('Calendar queries a seven-day window and paginates independently',async ({browser})=>{
  const calls=[];
  const {page,context}=await openPage(browser,args=>{
    calls.push(args);
    const calendar=Boolean(args.p_from);
    const date=calendar?new Date(args.p_from).toISOString():'2026-10-21T10:00:00.000Z';
    const offset=args.p_offset??0;
    return {rows:Array.from({length:calendar?Math.min(50,61-offset):1},(_,i)=>job('new',offset+i,date)),
      total:calendar?61:1,summary};
  });
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  await expect.poll(()=>calls.some(x=>x.p_from&&x.p_until)).toBe(true);
  const first=calls.find(x=>x.p_from&&x.p_until);
  expect(new Date(first.p_until).getTime()-new Date(first.p_from).getTime()).toBe(7*86400000);
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await page.getByRole('button',{name:'Next'}).click();
  await expect.poll(()=>calls.some(x=>x.p_from&&x.p_offset===50)).toBe(true);
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await context.close();
});

test('Empty service-job results show a helpful table state',async ({browser})=>{
  const {page,context}=await openPage(browser,()=>({rows:[],total:0,summary:{...summary,active_jobs:0}}));
  await expect(page.getByText('No maintenance jobs match the selected filters.')).toBeVisible();
  await expect(page.getByText('Page 1 of 1')).toBeVisible();
  await context.close();
});
