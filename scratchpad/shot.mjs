import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;

const PORT = 3117;
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' }, stdio: 'inherit' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitUp() { for (let i=0;i<50;i++){ try{ const r=await fetch(BASE+'/health'); if(r.ok) return; }catch(e){} await sleep(200);} throw new Error('server never came up'); }

function iso(daysAgo, h, m){ const d=new Date(); d.setDate(d.getDate()-daysAgo); d.setHours(h,m,0,0); return d.toISOString(); }

try {
  await waitUp();
  // sign up
  const su = await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'demo+logs@miles.ai',password:'password123',name:'Dave Rivera'})});
  const setCookie = su.headers.get('set-cookie');
  const token = /miles_session=([^;]+)/.exec(setCookie)[1];
  const H = { 'content-type':'application/json', cookie:`miles_session=${token}` };
  // minimal profile so the app doesn't force onboarding
  await fetch(BASE+'/api/profile',{method:'PUT',headers:H,body:JSON.stringify({profile:{business:'Rivera Plumbing & AC',vertical:'home_services',city:'Phoenix',state:'AZ'}})}).catch(()=>{});
  await fetch(BASE+'/api/autopilot',{method:'PUT',headers:H,body:JSON.stringify({autopilot:{autonomy:50,guardrails:{maxBudgetChangePct:10,protectProven:true,approveHighImpact:true}}})});
  // seed a realistic change log spanning two days, mixed statuses/autonomy
  const q = [
    {id:'chg_today_5', type:'campaign', label:'New campaign: “August AC Emergency — Meta”', ts:iso(0,14,32), status:'pending', autonomy:50, auto:false},
    {id:'chg_today_4', type:'creative', label:'Generated 3 ad creatives for AC Tune-up', ts:iso(0,13,10), status:'pending', autonomy:50, auto:false},
    {id:'chg_today_3', type:'trigger', label:'Weather trigger: Heat Advisory ≥ 108°F', ts:iso(0,11,45), status:'live', autonomy:50, auto:false, approvedAt:iso(0,11,50), deployedAt:iso(0,11,50)},
    {id:'chg_today_2', type:'profile', label:'Updated service area: added Scottsdale', ts:iso(0,9,20), status:'live', autonomy:100, auto:false, deployedAt:iso(0,9,20)},
    {id:'chg_today_1', type:'campaign', label:'Paused underperforming “Drain Cleaning” ad set', ts:iso(0,8,5), status:'live', autonomy:100, auto:false, deployedAt:iso(0,8,5)},
    {id:'chg_yday_3', type:'campaign', label:'New campaign: “Yesterday’s Plumbing push” (bad)', ts:iso(1,16,40), status:'live', autonomy:100, auto:false, deployedAt:iso(1,16,40)},
    {id:'chg_yday_2', type:'creative', label:'Refreshed homepage hero creative', ts:iso(1,12,15), status:'live', autonomy:50, auto:false, approvedAt:iso(1,12,20), deployedAt:iso(1,12,20)},
    {id:'chg_yday_1', type:'trigger', label:'Weather trigger: Monsoon storm → roof leads', ts:iso(1,10,0), status:'live', autonomy:50, auto:false, approvedAt:iso(1,10,5), deployedAt:iso(1,10,5)},
  ];
  await fetch(BASE+'/api/deploy',{method:'PUT',headers:H,body:JSON.stringify({deploy:{auto:false,queue:q,lastDeployedAt:iso(0,11,50)}})});
  // matching restore points (versions) for each change id
  for (const c of [...q].reverse()) {
    await fetch(BASE+'/api/versions',{method:'POST',headers:H,body:JSON.stringify({id:c.id,label:c.label,state:{hub:{campaigns:[]},weatherRules:[],autopilot:{autonomy:50}}})});
  }

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await browser.newContext({ viewport:{width:1360,height:1200}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:token, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage();
  await page.goto(BASE+'/', { waitUntil:'networkidle' });
  await sleep(1200);
  // Deploy tab
  await page.click('a[data-page="deploy"]');
  await sleep(900);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/deploy.png', fullPage:true });
  // Logs tab
  await page.click('a[data-page="logs"]');
  await sleep(1100);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/logs.png', fullPage:true });
  await browser.close();
  console.log('SHOTS_OK');
} catch (e) {
  console.error('SHOT_ERROR', e);
} finally {
  srv.kill('SIGKILL');
}
