export function isMapsUrl(value:string){
 return value===''||/^https:\/\/((www\.)?google\.com(\.br)?\/maps([/?#][^\s]*)?|maps\.google\.com(\.br)?\/[^\s]*|maps\.app\.goo\.gl\/[A-Za-z0-9]+([?#][^\s]*)?|goo\.gl\/maps\/[A-Za-z0-9]+([?#][^\s]*)?)$/.test(value);
}
export function mapsLink(address:string,neighborhood:string,explicit=''){
 if(explicit&&isMapsUrl(explicit))return explicit;
 return address.trim()?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent([address.trim(),neighborhood,'São Leopoldo - RS'].filter(Boolean).join(', ')):'';
}
