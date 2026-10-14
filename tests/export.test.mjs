import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32} from 'node:zlib';
import {buildExport} from '../src/lib/export-data.ts';

// Read the actual ZIP directory and validate each file, not the writer's internal objects.
function unzip(bytes){
 const b=Buffer.from(bytes),end=b.length-22;
 assert.equal(b.readUInt32LE(end),0x06054b50);
 const count=b.readUInt16LE(end+10),files={};let p=b.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  assert.equal(b.readUInt32LE(p),0x02014b50);
  assert.equal(b.readUInt16LE(p+10),0);
  const length=b.readUInt32LE(p+24),nameLength=b.readUInt16LE(p+28),local=b.readUInt32LE(p+42);
  assert.equal(b.readUInt32LE(local),0x04034b50);
  const name=b.toString('utf8',p+46,p+46+nameLength),start=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
  const data=b.subarray(start,start+length);
  assert.equal(data.length,length);assert.equal(crc32(data),b.readUInt32LE(p+16));
  files[name]=data.toString('utf8');p+=46+nameLength+b.readUInt16LE(p+30)+b.readUInt16LE(p+32);
 }
 assert.equal(p,end);return files;
}
const decode=s=>s.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function rows(xml){return [...xml.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)].map(r=>[...r[1].matchAll(/<c\b[^>]*>(.*?)<\/c>/gs)].map(c=>{const n=c[1].match(/<v>(.*?)<\/v>/s);return n?Number(n[1]):decode(c[1].match(/<t\b[^>]*>(.*?)<\/t>/s)?.[1]||'')}))}
const demand=(id,extra={})=>({id,code:'RC-'+id,title:'Visita '+id,neighborhood:'Centro',description:'Descrição fictícia',priority:'Normal',ownerId:'member',due:'2026-10-13',status:'Nova',nextStep:'Agendar',createdAt:'2026-10-12T15:00:00Z',closedAt:null,...extra});
const state={today:'2026-10-14',members:[{id:'member',name:'Pessoa de teste'}],demands:[
 demand('1',{title:'=HYPERLINK("https://example.test")',description:'Praça & <pátio>\u0000',createdAt:'2026-10-12T02:59:59Z'}),
 demand('2',{status:'Concluída',createdAt:'2026-10-12T03:00:00Z',closedAt:'2026-10-19T02:59:59Z'}),
 demand('3',{neighborhood:'Outro bairro'}),
 demand('4',{status:'Concluída',createdAt:'2026-10-19T03:00:00Z',closedAt:'2026-10-19T03:00:00Z'})
],referrals:[{demandId:'1',department:'Área incluída'},{demandId:'3',department:'Área excluída'}],events:[
 {title:'Domingo anterior',date:'2026-10-11'},{title:'Reunião de segunda',date:'2026-10-12'},
 {title:'Visita de domingo',date:'2026-10-18'},{title:'Próxima segunda',date:'2026-10-19'}]};

test('Excel respects demand filters and linked referrals, preserving text as text',()=>{
 const result=buildExport(state,{neighborhood:'Centro'},'2026-10-14'),files=unzip(result.bytes);
 assert.equal(result.count,3);assert.equal(result.start,'2026-10-12');
 assert.equal(Object.keys(files).length,9);
 assert.match(files['xl/workbook.xml'],/Agenda da semana/);
 const demands=rows(files['xl/worksheets/sheet1.xml']);
 assert.deepEqual(demands.slice(1).map(r=>r[0]),['RC-1','RC-2','RC-4']);
 assert.equal(demands[1][1],'=HYPERLINK("https://example.test")');
 assert.equal(demands[1][3],'Praça & <pátio>');
 assert.doesNotMatch(files['xl/worksheets/sheet1.xml'],/<f[\s>]/);
 assert.deepEqual(rows(files['xl/worksheets/sheet3.xml']).slice(1).map(r=>r.slice(0,2)),[['RC-1','Área incluída']]);
});
test('weekly report uses São Paulo dates and keeps current pending counts distinct',()=>{
 const files=unzip(buildExport(state,{neighborhood:'Centro'},'2026-10-14').bytes);
 const summary=Object.fromEntries(rows(files['xl/worksheets/sheet2.xml']).slice(1));
 assert.equal(summary['Criadas no período'],1);assert.equal(summary['Concluídas no período'],1);
 assert.equal(summary['Em aberto hoje'],1);assert.equal(summary['Vencidas hoje'],1);
 assert.deepEqual(rows(files['xl/worksheets/sheet4.xml']).slice(1).map(r=>r[0]),['Reunião de segunda','Visita de domingo']);
});
test('empty filtered report remains a readable workbook with headers',()=>{
 const result=buildExport(state,{q:'inexistente'},''),files=unzip(result.bytes);
 assert.equal(result.count,0);assert.equal(rows(files['xl/worksheets/sheet1.xml']).length,1);
 assert.equal(rows(files['xl/worksheets/sheet3.xml']).length,1);
 assert.equal(Object.fromEntries(rows(files['xl/worksheets/sheet2.xml']))['Em aberto hoje'],0);
});
