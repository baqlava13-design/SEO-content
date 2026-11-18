import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';

const STOP = new Set(`the and for are with from that this have has had was were will would should could into about your you our their they them these those its it's not but can may also all any each than then when where what which who why how more most some such other over under between through during because while use used using make made get got does did one two three best top guide tips including like very much many here there being been page home contact privacy cookie cookies menu navigation skip content read learn click search share follow sign subscribe login log in sign up updated author posted article articles website site www https http com org net amp nbsp plus via per new`.split(/\s+/));
const normalize = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const slug = s => normalize(s).replace(/\s+/g, '-').slice(0, 85) || 'keyword';
export const words = s => (String(s || '').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []);
export const countWords = s => words(s).length;
export const median = xs => { if (!xs.length) return 0; const a = [...xs].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
export function dbOpen() {
  mkdirSync('.cache', {recursive:true});
  const db = new Database(join('.cache','seo.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS cache (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(kind,key))');
  return db;
}
export function cached(db, kind, key) { const row=db.prepare('SELECT value FROM cache WHERE kind=? AND key=?').get(kind,key); return row ? JSON.parse(row.value) : undefined; }
export function put(db,kind,key,value) { db.prepare('INSERT OR REPLACE INTO cache(kind,key,value) VALUES(?,?,?)').run(kind,key,JSON.stringify(value)); }
async function fetchTimeout(url, options={}, timeout=16000) { return fetch(url,{...options,signal:AbortSignal.timeout(timeout)}); }
export async function serp(db, keyword) {
  const key = JSON.stringify({keyword, gl:process.env.SERPER_GL||'us', hl:process.env.SERPER_HL||'en', num:10});
  const hit=cached(db,'serp',key); if(hit) { console.error('SERP: cache hit'); return hit; }
  if(!process.env.SERPER_API_KEY) throw new Error('SERPER_API_KEY missing in .env');
  const res=await fetchTimeout('https://google.serper.dev/search',{method:'POST',headers:{'X-API-KEY':process.env.SERPER_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({q:keyword,num:10,gl:process.env.SERPER_GL||'us',hl:process.env.SERPER_HL||'en'})});
  if(!res.ok) throw new Error(`Serper HTTP ${res.status}: ${(await res.text()).slice(0,300)}`);
  const data=await res.json();
  const results=(data.organic||[]).slice(0,10).filter(x=>/^https?:\/\//.test(x.link||'')).map(x=>({title:x.title||'',url:x.link}));
  if(!results.length) throw new Error('Serper returned no organic results');
  put(db,'serp',key,results); return results;
}
export function extract(html,url) {
  const $=cheerio.load(html);
  $('script,style,nav,footer,header,aside,form,iframe,noscript,svg').remove();
  const headings=[];
  $('h2,h3').each((_,el)=>{const t=$(el).text().replace(/\s+/g,' ').trim(); if(t)headings.push({level:el.tagName.toUpperCase(),text:t.slice(0,250)});});
  const fallback=$('main').first().text()||$('article').first().text()||$('body').text();
  let title=$('title').first().text().trim();
  let body='';
  try {
    const dom=new JSDOM(html,{url});
    const article=new Readability(dom.window.document).parse();
    title=article?.title||title;
    body=article?.textContent||'';
    dom.window.close();
  } catch {}
  body=(body||fallback).replace(/\s+/g,' ').trim();
  return {title,headings,body,wordCount:countWords(body)};
}
export async function page(db,url) {
  const hit=cached(db,'page',url); if(hit) return hit;
  try {
    const res=await fetchTimeout(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; PersonalSEOBrief/1.0; local research)','Accept':'text/html,application/xhtml+xml'}});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const type=res.headers.get('content-type')||'';
    if(!type.includes('html')) throw new Error(`Unsupported content-type: ${type}`);
    const html=await res.text();
    const data=extract(html.slice(0,4_000_000),url);
    if(data.wordCount<50) throw new Error('Less than 50 readable words');
    put(db,'page',url,data);
    return data;
  } catch(err) {
    // Cache failed fetches too, to avoid repeated requests and ensure reproducible re-runs.
    const failed={error:String(err.message||err)};
    put(db,'page',url,failed); return failed;
  }
}
export function analyze(pages) {
  const docs=pages.filter(p=>!p.error&&p.wordCount>=50);
  if(!docs.length) throw new Error('No pages could be extracted. Try a different keyword.');
  const freq=new Map(), df=new Map();
  for(const d of docs) {
    const tokens=words(normalize(d.body)).filter(t=>t.length>=3&&!STOP.has(t)&&!/^\d+$/.test(t));
    const counts=new Map(); for(const t of tokens) counts.set(t,(counts.get(t)||0)+1);
    for(const [t,n] of counts){freq.set(t,(freq.get(t)||0)+n);df.set(t,(df.get(t)||0)+1);}
  }
  const N=docs.length;
  const terms=[...freq.keys()].map(term=>({term,documentFrequency:df.get(term),score:freq.get(term)*Math.log(1+(N+1)/(df.get(term)+1))})).sort((a,b)=>b.score-a.score).slice(0,30);
  const headings=new Map();
  for(const d of docs) {
    const unique=new Map();
    for(const h of d.headings) {const key=normalize(h.text); if(key.length<5)continue; if(!unique.has(key))unique.set(key,h);}
    for(const [key,h] of unique){const x=headings.get(key)||{text:h.text,level:h.level,count:0};x.count++;headings.set(key,x);}
  }
  const recurring=[...headings.values()].filter(x=>x.count>=2).sort((a,b)=>b.count-a.count).slice(0,25);
  return {medianWordCount:Math.round(median(docs.map(d=>d.wordCount))),terms,recurring,analyzed:docs.length,failed:pages.length-docs.length};
}
export async function generateBrief(keyword,analysis,pages) {
  if(!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing in .env');
  const source={keyword,analysis,pages:pages.map(p=>({url:p.url,title:p.title,wordCount:p.wordCount,error:p.error}))};
  const res=await fetchTimeout('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',temperature:0.2,messages:[{role:'system',content:'You are an evidence-grounded SEO content strategist. Return ONLY valid JSON, no markdown fences. Do not invent search volumes, keyword difficulty, or claims about ranking. Match search intent. Use supplied evidence only. JSON schema: {"intent":"string","audience":"string","targetWordCount":number,"outline":[{"level":"H2"|"H3","heading":"string"}],"questions":["string"],"notes":["string"]}. All H3s must follow an H2. Prefer 5-10 H2s and useful H3s.'},{role:'user',content:JSON.stringify(source)}]})},45000);
  if(!res.ok)throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0,400)}`);
  const data=await res.json();
  const raw=data.choices?.[0]?.message?.content||'';
  let parsed;try{parsed=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw new Error('LLM did not return valid JSON');}
  if(!Array.isArray(parsed.outline)||!Array.isArray(parsed.questions))throw new Error('LLM response missing outline/questions');
  return parsed;
}
export function renderBrief(keyword,analysis,plan,pages,date) {
  const safe=s=>String(s||'').replace(/[\r\n|]/g,' ').trim();
  const outline=plan.outline.filter(h=>['H2','H3'].includes(h.level)&&h.heading).map(h=>`${h.level==='H2'?'##':'###'} ${safe(h.heading)}`).join('\n');
  const terms=analysis.terms.map(x=>`| ${safe(x.term)} | ${x.documentFrequency}/${analysis.analyzed} |`).join('\n');
  return `# SEO Content Brief: ${safe(keyword)}\n\nGenerated: ${date}\n\n## Search intent\n${safe(plan.intent)}\n\n**Audience:** ${safe(plan.audience)}\n\n**Target word count:** ${Math.max(300,Math.round(Number(plan.targetWordCount)||analysis.medianWordCount))} (competitor median: ${analysis.medianWordCount}; based on ${analysis.analyzed} readable pages out of ${pages.length})\n\n## Suggested outline\n${outline}\n\n## Terms to cover\n| Term | Pages containing term |\n| --- | ---: |\n${terms}\n\n## Questions to answer\n${plan.questions.map(q=>`- ${safe(q)}`).join('\n')}\n\n## Editorial notes\n${(plan.notes||[]).map(n=>`- ${safe(n)}`).join('\n')||'- Prioritize helpful, accurate answers over mechanical term repetition.'}\n\n## Recurring competitor headings\n${analysis.recurring.length?analysis.recurring.map(h=>`- ${safe(h.text)} (${h.count} pages)`).join('\n'):'No identical normalized H2/H3 headings repeated across the extracted pages.'}\n\n## Sources inspected\n${pages.map((p,i)=>`${i+1}. ${p.error?'FAILED: '+safe(p.error):safe(p.title)} — ${p.url}${p.error?'':` (${p.wordCount} words)`}`).join('\n')}\n\n<!-- scoring-data:${JSON.stringify({keyword,terms:analysis.terms.map(t=>t.term),outline:plan.outline.filter(h=>['H2','H3'].includes(h.level)).map(h=>({level:h.level,heading:h.heading}))}).replace(/-->/g,'--\\u003e')} -->\n`;
}
export function scoreDraft(draft,brief) {
  const match=brief.match(/<!-- scoring-data:(.*?) -->/s);
  if(!match)throw new Error('Brief missing scoring-data marker');
  const data=JSON.parse(match[1]);
  const parsed=marked.lexer(draft);
  const headings=parsed.filter(x=>x.type==='heading').map(x=>({depth:x.depth,text:normalize(x.text.replace(/<[^>]*>/g,' '))}));
  const prose=normalize(draft.replace(/```[\s\S]*?```/g,' ').replace(/<[^>]+>/g,' '));
  const padded=` ${prose} `;
  const terms=data.terms.map(term=>({term,covered:padded.includes(` ${normalize(term)} `)}));
  const outline=data.outline.map(h=>({heading:h.heading,covered:headings.some(x=>x.depth===(h.level==='H2'?2:3)&&x.text===normalize(h.heading))}));
  const covered=terms.filter(x=>x.covered).length+outline.filter(x=>x.covered).length;
  const total=terms.length+outline.length;
  return {percentage:total?Math.round(covered/total*100):100,terms,outline,covered,total,wordCount:countWords(draft)};
}
