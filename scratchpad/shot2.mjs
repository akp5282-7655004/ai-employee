import { spawn } from 'node:child_process';
import pkg from '/home/user/leadman/node_modules/playwright-core/index.js';
const { chromium } = pkg;
const PORT = 3151, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['dist/index.js'], { cwd: '/home/user/ai-employee', env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function up(){ for(let i=0;i<50;i++){ try{ if((await fetch(BASE+'/health')).ok) return; }catch(e){} await sleep(200);} throw 0; }
try {
  await up();
  const su = await fetch(BASE+'/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'studio@miles.ai',password:'password123',name:'Dana Reyes'})});
  const token = /miles_session=([^;]+)/.exec(su.headers.get('set-cookie'))[1];
  const H = { 'content-type':'application/json', cookie:`miles_session=${token}` };
  await fetch(BASE+'/api/profile',{method:'PUT',headers:H,body:JSON.stringify({businessName:'Rivera Plumbing & AC',industry:'Home Services',services:'drain cleaning, water heaters, AC repair',serviceAreas:'Phoenix, Scottsdale',zip:'85001'})});
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless:true });
  const ctx = await b.newContext({ viewport:{width:1200,height:1000}, deviceScaleFactor:2 });
  await ctx.addCookies([{ name:'miles_session', value:token, domain:'127.0.0.1', path:'/' }]);
  const page = await ctx.newPage();
  await page.goto(BASE+'/', { waitUntil:'networkidle' }); await sleep(1000);
  await page.click('a[data-page="studio"]'); await sleep(700);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/studio-image.png', fullPage:true });
  // switch to Ad copy and generate (uses server fallback text, no key needed)
  await page.click('#studio-types button:has-text("Ad copy")'); await sleep(300);
  await page.fill('#studio-prompt','summer AC tune-up special, drive booked calls'); await sleep(200);
  await page.click('#studio-go'); await sleep(1200);
  await page.screenshot({ path:'/home/user/ai-employee/scratchpad/studio-copy.png', fullPage:true });
  await b.close(); console.log('OK');
} catch(e){ console.error('ERR', e); } finally { srv.kill('SIGKILL'); }
