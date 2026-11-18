import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.post('/api/brief',async(req,res)=>{
 let keyword;try{keyword=cleanKeyword(req.body?.keyword)}catch(e){return res.status(400).json({error:e.message})}
 const id=crypto.randomUUID();const task={id,status:'running',step:'Starting SERP analysis',keyword};tasks.set(id,task);res.status(202).json({id});
 (async()=>{let db;try{db=dbOpen();const results=await serp(db,keyword);const pages=[];for(let i=0;i<results.length;i++){task.step=`Reading competitor ${i+1}/${results.length}`;const r=results[i];const extracted=await page(db,r.url);pages.push({...extracted,url:r.url,title:extracted.title||r.title})}task.step='Calculating competitor statistics';const stats=analyze(pages);task.step='Generating AI brief';const plan=await generateBrief(keyword,stats,pages);const date=new Date().toISOString().slice(0,10);const filename=`${slug(keyword)}-${date}.md`;const markdown=renderBrief(keyword,stats,plan,pages,date);writeFileSync(join('briefs',filename),markdown);Object.assign(task,{status:'complete',step:'Complete',filename,markdown,stats:{analyzed:stats.analyzed,failed:stats.failed,medianWordCount:stats.medianWordCount,terms:stats.terms,recurring:stats.recurring},pages:pages.map(p=>({url:p.url,title:p.title,error:p.error,wordCount:p.wordCount}))})}catch(e){Object.assign(task,{status:'error',step:'Failed',error:e.message})}finally{db?.close()}})();
});
app.get('/api/tasks/:id',(req,res)=>{const task=tasks.get(req.params.id);if(!task)return res.status(404).json({error:'Task not found'});res.json(task)});
app.get('/api/brief',(req,res)=>{try{const keyword=cleanKeyword(req.query.keyword);res.json(findBrief(keyword))}catch(e){res.status(404).json({error:e.message})}});
app.post('/api/score',(req,res)=>{try{const keyword=cleanKeyword(req.body?.keyword);const draft=req.body?.draft;if(typeof draft!=='string'||draft.length>1_000_000)throw Error('Draft must be Markdown under 1 MB');const brief=findBrief(keyword);res.json({filename:brief.filename,...scoreDraft(draft,brief.markdown)})}catch(e){res.status(400).json({error:e.message})}});
const port=Number(process.env.PORT||3001);app.listen(port,'0.0.0.0',()=>console.log(`SEO API listening on ${port}`));
