import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {googleStatus,googleAuthorize,googleCallback,searchConsole,keywordIdeas,research,evaluateDraft} from './intelligence.js';
import {listProjects,getProject,saveProject,buildMap,writePage,cleanWebsite} from './growth.js';
import { dbOpen, serp, page, analyze, generateBrief, renderBrief, scoreDraft, slug } from './core.js';
const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
const origins=(process.env.FRONTEND_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
app.use(cors({origin:(origin,cb)=>cb(null,!origin||origins.includes(origin))}));
const dir=process.env.DATA_DIR||process.cwd();
mkdirSync(dir,{recursive:true});
process.chdir(dir);
mkdirSync('briefs',{recursive:true});
const tasks=new Map();
const cleanKeyword=x=>{if(typeof x!=='string'||!x.trim()||x.length>180)throw Error('Keyword must be 1–180 characters');return x.trim()};
const findBrief=keyword=>{const files=readdirSync('briefs').filter(f=>f.startsWith(slug(keyword)+'-')&&/^.+-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();if(!files.length)throw Error('No brief found for this keyword. Generate one first.');return {filename:files[0],markdown:readFileSync(join('briefs',files[0]),'utf8')}};
const googleGuard=(req,res,next)=>{if(!process.env.ADMIN_API_KEY)return res.status(503).json({error:'Set ADMIN_API_KEY on Railway to enable Google integrations'});if(req.get('x-admin-key')!==process.env.ADMIN_API_KEY)return res.status(401).json({error:'Invalid admin key'});next()};
app.get('/api/google/status',(_req,res)=>res.json({...googleStatus(),adminKeyRequired:true}));
app.get('/api/google/connect',googleGuard,(req,res)=>{try{res.json({url:googleAuthorize()})}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/google/callback',async(req,res)=>{try{await googleCallback(req.query.code,req.query.state);res.type('html').send('<h2>Google connected successfully.</h2><p>Return to SEO Content Engine and refresh.</p>')}catch(e){res.status(400).type('text').send('Google connection failed: '+e.message)}});
app.get('/api/google/search-console',googleGuard,async(req,res)=>{try{const site=String(req.query.site||'');if(!site.startsWith('https://')&&!site.startsWith('sc-domain:'))throw Error('Use exact GSC property URL or sc-domain:domain.com');res.json(await searchConsole(site))}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/google/keyword-ideas',googleGuard,async(req,res)=>{try{const keywords=(req.body?.keywords||[]).filter(x=>typeof x==='string').slice(0,10);if(!keywords.length)throw Error('Keywords required');res.json({ideas:await keywordIdeas(keywords,String(req.body?.language||'1000'),String(req.body?.geo||'2840'))})}catch(e){res.status(400).json({error:e.message})}});
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.post('/api/brief',async(req,res)=>{
 let keyword;try{keyword=cleanKeyword(req.body?.keyword)}catch(e){return res.status(400).json({error:e.message})}
 const id=crypto.randomUUID();const task={id,status:'running',step:'Starting SERP analysis',keyword};tasks.set(id,task);res.status(202).json({id});
 (async()=>{let db;try{
  db=dbOpen();
  console.log(`[${id}] SERP lookup: ${keyword}`);
  const results=await serp(db,keyword);
  const pages=new Array(results.length);
  let completed=0;
  // Bounded concurrency prevents a single slow competitor from blocking all others.
  const worker=async()=>{while(true){const i=cursor++;if(i>=results.length)return;const r=results[i];
    const extracted=await page(db,r.url);
    pages[i]={...extracted,url:r.url,title:extracted.title||r.title};
    completed++;task.step=`Reading competitors ${completed}/${results.length}`;
    console.log(`[${id}] Competitor ${completed}/${results.length}: ${extracted.error?'failed ('+extracted.error+')':'extracted'} ${r.url}`);
  }};
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,results.length)},()=>worker()));
  task.step='Calculating competitor statistics';
  const stats=analyze(pages);
  task.step='Generating AI brief';console.log(`[${id}] Generating AI brief from ${stats.analyzed} pages`);
  const plan=await generateBrief(keyword,stats,pages);
  const date=new Date().toISOString().slice(0,10);
  const filename=`${slug(keyword)}-${date}.md`;
  const markdown=renderBrief(keyword,stats,plan,pages,date);
  writeFileSync(join('briefs',filename),markdown);
  Object.assign(task,{status:'complete',step:'Complete',filename,markdown,stats:{analyzed:stats.analyzed,failed:stats.failed,medianWordCount:stats.medianWordCount,terms:stats.terms,recurring:stats.recurring},pages:pages.map(p=>({url:p.url,title:p.title,error:p.error,wordCount:p.wordCount}))});
  console.log(`[${id}] Brief complete: ${filename}`);
 }catch(e){console.error(`[${id}] Brief failed:`,e);Object.assign(task,{status:'error',step:'Failed',error:e.message})}finally{db?.close()}})();
});
app.get('/api/tasks/:id',(req,res)=>{const task=tasks.get(req.params.id);if(!task)return res.status(404).json({error:'Task not found'});res.json(task)});
app.get('/api/brief',(req,res)=>{try{const keyword=cleanKeyword(req.query.keyword);res.json(findBrief(keyword))}catch(e){res.status(404).json({error:e.message})}});
app.post('/api/score',(req,res)=>{try{const keyword=cleanKeyword(req.body?.keyword);const draft=req.body?.draft;if(typeof draft!=='string'||draft.length>1_000_000)throw Error('Draft must be Markdown under 1 MB');const brief=findBrief(keyword);res.json({filename:brief.filename,...scoreDraft(draft,brief.markdown)})}catch(e){res.status(400).json({error:e.message})}});
// Growth projects are stored on the existing Railway DATA_DIR volume.
app.get('/api/growth/projects',(_req,res)=>{try{res.json(listProjects())}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/growth/projects/:id',(req,res)=>{try{res.json(getProject(req.params.id))}catch(e){res.status(404).json({error:e.message})}});
app.post('/api/growth/projects',async(req,res)=>{
 try{
 const website=cleanWebsite(String(req.body?.website||''));
 const seedKeywords=String(req.body?.seedKeywords||'').split(/[\n,]/).map(x=>x.trim()).filter(Boolean).slice(0,12);
 if(!seedKeywords.length)throw Error('Enter at least one seed keyword');
 const market=String(req.body?.market||'International').slice(0,120);
 const audience=String(req.body?.audience||'').slice(0,500);
 const brandFacts=String(req.body?.brandFacts||'').slice(0,4000);
 const id=slug(new URL(website).hostname)+'-'+Date.now().toString(36);
 const task={id:crypto.randomUUID(),status:'running',step:'Generating topical map'};tasks.set(task.id,task);res.status(202).json({id:task.id,projectId:id});
 (async()=>{try{const map=await buildMap({website,seedKeywords,market,audience});const p=saveProject({id,website,seedKeywords,market,audience,brandFacts,...map});Object.assign(task,{status:'complete',step:'Map ready',project:p})}catch(e){console.error('Growth map failed',e);Object.assign(task,{status:'error',error:e.message})}})();
 }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/growth/projects/:id/pages/:pageId/research',(req,res)=>{
 let p;try{p=getProject(req.params.id);if(!p.pages.some(x=>x.id===req.params.pageId))throw Error('Page not found')}catch(e){return res.status(404).json({error:e.message})}
 const task={id:crypto.randomUUID(),status:'running',step:'Benchmarking Google competitors and buyer questions'};tasks.set(task.id,task);res.status(202).json({id:task.id});
 (async()=>{try{const pg=p.pages.find(x=>x.id===req.params.pageId);const result=await research(pg.primaryKeyword);pg.benchmark=result;pg.quality=pg.content?evaluateDraft(pg.content,result):null;saveProject(p);Object.assign(task,{status:'complete',step:'Research ready',project:p})}catch(e){Object.assign(task,{status:'error',error:e.message})}})();
});
app.patch('/api/growth/projects/:id', (req,res)=>{try{const p=getProject(req.params.id);const updates=req.body||{};if(typeof updates.brandFacts==='string')p.brandFacts=updates.brandFacts.slice(0,4000);if(Array.isArray(updates.pages)){for(const u of updates.pages){const page=p.pages.find(x=>x.id===u.id);if(page){if(u.status==='approved'&&(!page.content||!page.editorNotes?.trim()))throw Error('Review and edit content; record human editorial sign-off before approval');for(const key of ['title','primaryKeyword','url','status','priority','content','editorNotes'])if(u[key]!==undefined)page[key]=u[key]}}}res.json(saveProject(p))}catch(e){res.status(400).json({error:e.message})}});
app.post('/api/growth/projects/:id/pages/:pageId/generate',(req,res)=>{
 let p;try{p=getProject(req.params.id);if(!p.pages.some(x=>x.id===req.params.pageId))throw Error('Page not found')}catch(e){return res.status(404).json({error:e.message})}
 const task={id:crypto.randomUUID(),status:'running',step:'Writing full SEO page'};tasks.set(task.id,task);res.status(202).json({id:task.id});
 (async()=>{try{const page=p.pages.find(x=>x.id===req.params.pageId);if(!page.benchmark)throw Error('Run competitor research first for this page');const output=await writePage(p,page);page.content=output.markdown;page.seoTitle=output.seoTitle;page.metaDescription=output.metaDescription;page.faq=output.faq;page.verificationNotes=output.verificationNotes;page.quality=output.quality;page.status='draft';saveProject(p);Object.assign(task,{status:'complete',step:'Draft ready',project:p})}catch(e){console.error('Content generation failed',e);Object.assign(task,{status:'error',error:e.message})}})();
});
// Railway-only deployment: serve the compiled React application from this Node service.
// Resolve assets relative to the source file, not DATA_DIR (which points to the persistent volume).
const appRoot=join(dirname(fileURLToPath(import.meta.url)),'..');
const frontendDir=join(appRoot,'dist');
app.use(express.static(frontendDir,{index:false}));
app.get(/^(?!\/api(?:\/|$)).*/,(_req,res)=>res.sendFile(join(frontendDir,'index.html')));
const port=Number(process.env.PORT||3001);app.listen(port,'0.0.0.0',()=>console.log(`SEO API listening on ${port}`));
