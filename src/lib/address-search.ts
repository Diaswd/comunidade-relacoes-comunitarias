export type Place={label:string;neighborhood:string;mapsUrl:string};
export function parsePlaces(data:any):Place[]{
 const seen=new Set<string>();return (Array.isArray(data?.features)?data.features:[]).flatMap((f:any)=>{
  const p=f?.properties||{},c=f?.geometry?.coordinates;
  if(!Array.isArray(c)||!Number.isFinite(c[0])||!Number.isFinite(c[1])||Math.abs(c[0])>180||Math.abs(c[1])>90)return [];
  const text=(v:unknown)=>typeof v==='string'?v.trim():'';
  const street=[text(p.street)||text(p.name),text(p.housenumber)].filter(Boolean).join(', ');
  const label=[street,text(p.district),text(p.city)||text(p.county),text(p.state)].filter(Boolean).join(' · ').slice(0,500);
  if(!street||seen.has(label))return [];seen.add(label);
  return [{label,neighborhood:text(p.district),mapsUrl:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(c[1]+','+c[0])}];
 }).slice(0,5);
}
const cache=new Map<string,Place[]>();
export async function searchAddresses(query:string,signal:AbortSignal){
 const q=query.trim();if(q.length<3)return [];if(cache.has(q))return cache.get(q)!;
 const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q,limit:'5',lat:'-29.7604',lon:'-51.1469',bbox:'-51.35,-30.05,-50.85,-29.45'}).toString();
 const res=await fetch(url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!res.ok)throw Error('Busca indisponível');
 const results=parsePlaces(await res.json());if(cache.size>=50)cache.delete(cache.keys().next().value!);cache.set(q,results);return results;
}
