import { it, expect } from 'vitest';
import { stopsFor, stopFeeds } from '../../src/journey/cityContext';
import { planFloatRoute } from '../../src/journey/floatField';
import { planNeuralRoute } from '../../src/journey/neuralRoute';
const holds = Array.from({length:8}, (_,i)=>({screen:String(i),holdStart:i*5,holdEnd:i*5+2}));
it('carries 3..6 distinct feeds through both route planners when the city has them',()=>{
  for(const size of [5,14,19]) for(const requested of [3,4,5,6]) for(let visit=0;visit<12;visit++) {
    const pool=Array.from({length:size},(_,i)=>'own-'+i),n=stopsFor(requested,pool.length);
    const dest=stopFeeds(pool,pool[0],n-1,pool.slice(1));
    const f=planFloatRoute(pool[0],n,visit,dest),neu=planNeuralRoute(pool[0],n,visit,holds,dest);
    expect(n).toBe(Math.min(size,requested));
    for(const plan of [f,neu]) {expect(plan).not.toBeNull();expect(plan!.feeds).toHaveLength(n);expect(new Set(plan!.feeds).size).toBe(n);}
    const times=neu!.times;expect(times.slice(1).every((t,i)=>(t-times[i])*(times[1]-times[0])>0)).toBe(true);
  }
});
it('does not pretend low-supply cities have five distinct feeds',()=>{expect(stopsFor(6,2)).toBe(2);expect(stopsFor(6,3)).toBe(3);});
