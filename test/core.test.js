import test from 'node:test';
import assert from 'node:assert/strict';
import {median,slug,analyze,scoreDraft,renderBrief} from '../src/core.js';
test('median even and odd',()=>{assert.equal(median([2,8,4]),4);assert.equal(median([2,8]),5);});
test('safe slug',()=>assert.equal(slug('Custom Socks Manufacturer!'),'custom-socks-manufacturer'));
test('analysis reports repeated headings and terms',()=>{
 const pages=[{body:'cotton socks printing cotton custom socks production',wordCount:60,headings:[{level:'H2',text:'Materials'}]},{body:'cotton socks design custom socks factory',wordCount:80,headings:[{level:'H2',text:'Materials'}]}];
 const a=analyze(pages);assert.equal(a.medianWordCount,70);assert.equal(a.recurring[0].count,2);assert.ok(a.terms.some(t=>t.term==='cotton'));
});
test('render and score term and heading coverage',()=>{
 const a={medianWordCount:600,analyzed:2,terms:[{term:'cotton',documentFrequency:2},{term:'printing',documentFrequency:1}],recurring:[]};
 const plan={intent:'Buy',audience:'Businesses',targetWordCount:650,outline:[{level:'H2',heading:'Materials'}],questions:['What material?']};
 const brief=renderBrief('custom socks',a,plan,[{title:'Page',url:'https://example.org',wordCount:600}],'2026-11-17');
 const r=scoreDraft('# Intro\n## Materials\nCotton socks are great.',brief);
 assert.equal(r.percentage,67);assert.equal(r.terms.filter(t=>!t.covered)[0].term,'printing');
});
