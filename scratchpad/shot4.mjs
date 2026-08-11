import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3171, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT), MILES_NO_SCHEDULER:'1' }, stdio: 'inherit' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<50;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
try {
  await up();
  const su = await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'wf@miles.ai',password:'password123',name:'Wf'})});
  const token = /miles_session=([^;]+)/.exec(su.headers.get('set-cookie'))[1];
  const H = { 'content-type':'application/json', cookie:`miles_session=${token}` };
  await fetch(BASE+'/api/profile',{method:'PUT',headers:H,body:JSON.stringify({businessName:'Painters In Philly',industry:'Home Services',serviceAreas:'Philadelphia'})});
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:1200,height:950}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:token, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.goto(BASE+'/', { waitUntil:'networkidle' }); await sleep(1000);
  await page.click('a[data-page="studio"]'); await sleep(500);
  // generate image (demo, no url) then copy — neither should touch deploy
  await page.fill('#studio-prompt','puppy mascot'); await page.click('#studio-go'); await sleep(700);
  await page.click('#studio-types button:has-text("Ad copy")'); await sleep(200);
  await page.click('#studio-go'); await sleep(900);
  const deploy1 = await (await fetch(BASE+'/api/deploy',{headers:H})).json();
  const queued = (deploy1.deploy&&deploy1.deploy.queue)||[];
  console.log('AFTER GENERATE — deploy queue length:', queued.length, '(expect 0)');
  console.log('JS errors:', errs.length? errs : 'none');
  await b.close();
} catch(e){ console.error('ERR', e); } finally { srv.kill('SIGKILL'); }
