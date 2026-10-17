import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isMapsUrl,mapsLink} from '../src/lib/location.ts';
test('Maps links accept shared Google formats and reject deceptive hosts and scripts',()=>{
 for(const value of ['', 'https://maps.app.goo.gl/Abc123','https://goo.gl/maps/Abc123','https://www.google.com/maps?q=Centro','https://maps.google.com/?q=Centro','https://www.google.com.br/maps/place/Centro'])assert.equal(isMapsUrl(value),true,value);
 for(const value of ['javascript:alert(1)','https://evil.test/maps','https://www.google.com@evil.test/maps','https://www.google.com.evil.test/maps','https://www.google.com/maps.evil','https://maps.app.goo.gl.evil.test/Abc','http://maps.google.com/','https://maps.google.com/ bad'])assert.equal(isMapsUrl(value),false,value);
});
test('address searches encode the location and explicit links take precedence',()=>{
 const link=mapsLink('Rua A & B, 10','Centro');const url=new URL(link);
 assert.equal(url.searchParams.get('api'),'1');assert.equal(url.searchParams.get('query'),'Rua A & B, 10, Centro, São Leopoldo - RS');
 assert.equal(mapsLink('Rua A','Centro','https://maps.app.goo.gl/Test123'),'https://maps.app.goo.gl/Test123');
 assert.equal(mapsLink('','Centro'),'');
});
