import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3161, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), MILES_NO_SCHEDULER: '1' }, stdio: 'inherit' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<50;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
function iso(days,h,m){ const d=new Date(); d.setDate(d.getDate()-days); d.setHours(h,m,0,0); return d.toISOString(); }
try {
  await up();
  const su = await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'sched@miles.ai',password:'password123',name:'Sam Cole'})});
  const token = /miles_session=([^;]+)/.exec(su.headers.get('set-cookie'))[1];
  const H = { 'content-type':'application/json', cookie:`miles_session=${token}` };
  await fetch(BASE+'/api/profile',{method:'PUT',headers:H,body:JSON.stringify({businessName:'Rivera Plumbing & AC',industry:'Home Services',zip:'85001',serviceAreas:'Phoenix'})});
  const agents=[
    {id:'ag1',name:'Daily morning brief',task:'morning_brief',time:'08:30',days:[1,2,3,4,5],enabled:true,tzOffset:new Date().getTimezoneOffset(),createdAt:iso(1,0,0)},
    {id:'ag2',name:'Marketing performance report',task:'cpa_report',time:'09:00',days:[1,2,3,4,5],enabled:true,tzOffset:new Date().getTimezoneOffset(),createdAt:iso(1,0,0)},
  ];
  await fetch(BASE+'/api/schedules',{method:'PUT',headers:H,body:JSON.stringify({agents})});
  const run = await (await fetch(BASE+'/api/schedules/run',{method:'POST',headers:H,body:JSON.stringify({id:'ag1'})})).json();
  console.log('BRIEF:\n'+(run.run?run.run.body:JSON.stringify(run)));
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:1200,height:1050}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:token, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage();
  await page.goto(BASE+'/', { waitUntil:'networkidle' }); await sleep(1000);
  await page.click('a[data-page="schedules"]'); await sleep(800);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/schedules.png', fullPage:true });
  // open the brief run
  await page.click('#schedules-body button:has-text("View")'); await sleep(500);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/brief.png', fullPage:true });
  await b.close(); console.log('OK');
} catch(e){ console.error('ERR', e); } finally { srv.kill('SIGKILL'); }
