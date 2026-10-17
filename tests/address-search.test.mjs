import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaces} from '../src/lib/address-search.ts';
test('address suggestions validate coordinates, deduplicate and build a Maps location',()=>{
 const place={properties:{name:'Rua Independência',district:'Centro',city:'São Leopoldo',state:'RS'},geometry:{coordinates:[-51.15,-29.76]}};
 const result=parsePlaces({features:[place,place,{...place,geometry:{coordinates:['javascript:',0]}},{...place,geometry:{coordinates:[0,91]}}]});
 assert.equal(result.length,1);assert.equal(result[0].label,'Rua Independência · Centro · São Leopoldo · RS');assert.equal(result[0].neighborhood,'Centro');assert.equal(result[0].mapsUrl,'https://www.google.com/maps/search/?api=1&query=-29.76%2C-51.15');
 assert.deepEqual(parsePlaces({features:'bad'}),[]);
});
