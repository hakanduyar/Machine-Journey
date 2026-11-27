import { it, expect } from 'vitest';
import { CityBag } from '../../src/journey/cityBag';
import { CITIES } from '../../src/journey/globe';
it('visits every real city once per cycle, stable peek, no boundary repeat, seeded reproducibility',()=>{
 const ids=CITIES.map(c=>c.id),available=new Set(ids);
 const run=(seed:number)=>{const bag=new CityBag(ids,seed),out:string[]=[];let current:string|null='butlerville';for(let i=0;i<ids.length*3;i++) {const id: string=bag.peek(available,current)!;expect(bag.peek(available,current)).toBe(id);if(current)expect(id).not.toBe(current);out.push(id);bag.arrive(id);current=id;}return out;};
 const a=run(45);expect(run(45)).toEqual(a);expect(run(46)).not.toEqual(a);
 for(let i=0;i<ids.length*3;i+=ids.length)expect([...a.slice(i,i+ids.length)].sort()).toEqual([...ids].sort());
 expect(a).toContain('istanbul');expect(a).toContain('los-angeles');expect(a).not.toContain('london');
});
it('skips failed sources without consuming other available cities',()=>{const b=new CityBag(['a','b','c'],3),ok=new Set(['a','c']);const first=b.peek(ok,null)!;b.arrive(first);expect(b.peek(ok,first)).not.toBe(first);});
