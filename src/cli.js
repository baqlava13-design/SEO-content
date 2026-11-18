#!/usr/bin/env node
import 'dotenv/config';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {dbOpen,serp,page,analyze,generateBrief,renderBrief,scoreDraft,slug} from './core.js';
const [command,...args]=process.argv.slice(2);
function usage(){console.log('Usage:\n  node src/cli.js brief "keyword"\n  node src/cli.js score draft.md "keyword"');}
async function main(){
 if(command==='brief'){
  const keyword=args.join(' ').trim();if(!keyword){usage();process.exitCode=1;return;}
  const db=dbOpen();try{
   const results=await serp(db,keyword);
   const pages=[];
   for(let i=0;i<results.length;i++){
    const result=results[i];const extracted=await page(db,result.url);
    pages.push({...extracted,url:result.url,title:extracted.title||result.title});
    console.error(`[${i+1}/${results.length}] ${extracted.error?'Skipped: '+extracted.error:'Read '+extracted.wordCount+' words'} ${result.url}`);
   }
   const stats=analyze(pages);
   console.error(`Analyzed ${stats.analyzed}/${pages.length}; median ${stats.medianWordCount} words; ${stats.terms.length} terms`);
   const plan=await generateBrief(keyword,stats,pages);
   const date=new Date().toISOString().slice(0,10);
   mkdirSync('briefs',{recursive:true});
   const path=join('briefs',`${slug(keyword)}-${date}.md`);
   writeFileSync(path,renderBrief(keyword,stats,plan,pages,date));
   console.log(`\nBrief saved: ${path}`);
  }finally{db.close();}
 }else if(command==='score'){
  if(args.length<2){usage();process.exitCode=1;return;}
  const draftPath=resolve(args[0]);const keyword=args.slice(1).join(' ').trim();
  const files=readdirSync('briefs').filter(f=>f.startsWith(`${slug(keyword)}-`)&&/^.+-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  if(!files.length)throw new Error(`No brief found for "${keyword}". Run brief first.`);
  const brief=readFileSync(join('briefs',files[0]),'utf8');
  const draft=readFileSync(draftPath,'utf8');
  const result=scoreDraft(draft,brief);
  console.log(`\nBrief: ${files[0]}\nDraft words: ${result.wordCount}\nCoverage: ${result.percentage}% (${result.covered}/${result.total} checks)`);
  console.log(`Terms: ${result.terms.filter(t=>t.covered).length}/${result.terms.length} | Outline: ${result.outline.filter(t=>t.covered).length}/${result.outline.length}`);
  console.log('\nMissing terms:');
  console.table(result.terms.filter(t=>!t.covered).map(t=>({term:t.term})));
  console.log('Missing outline headings (exact normalized H2/H3 match):');
  console.table(result.outline.filter(h=>!h.covered).map(h=>({heading:h.heading})));
 }else{usage();process.exitCode=1;}
}
main().catch(e=>{console.error('Error:',e.message);process.exitCode=1;});
