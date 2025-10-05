import { GRID, AIRPORT_POP_THRESHOLD, POI_TYPES } from './constants.js';
import { clamp, mulberry32 } from './utils.js';

const iconFor = key => POI_TYPES.find(p=>p.key===key)?.icon || '';
const boostFor = key => POI_TYPES.find(p=>p.key===key)?.jobsBoost || 0;

export function poiIcon(key){ return iconFor(key); }
export function poiJobsBoost(key){ return boostFor(key); }

export function generatePOIs(seed, population){
  const rng = mulberry32(seed*999);
  const count = Math.round(GRID*GRID*0.08);
  const poiMap = new Map();
  const downtown = { x: Math.floor(GRID/2), y: Math.floor(GRID/2) };
  const sat1 = { x: Math.floor(GRID*0.25), y: Math.floor(GRID*0.3) };
  const sat2 = { x: Math.floor(GRID*0.75), y: Math.floor(GRID*0.7) };

  function pick(){ const r=rng(); if(r<0.45) return 'retail'; if(r<0.65) return 'school'; if(r<0.90) return 'tourism'; return 'retail'; }
  function placeNear(center, share){
    const n = Math.round(count*share);
    for(let i=0;i<n;i++){
      const dx = Math.round((rng()-0.5)*6), dy = Math.round((rng()-0.5)*6);
      const x = clamp(center.x+dx, 0, GRID-1), y = clamp(center.y+dy, 0, GRID-1);
      const key = `${x},${y}`; if(!poiMap.has(key)) poiMap.set(key, pick());
    }
  }
  function placeRandom(share){
    const n = Math.round(count*share);
    for(let i=0;i<n;i++){
      const x = Math.floor(rng()*GRID), y = Math.floor(rng()*GRID);
      const key = `${x},${y}`; if(!poiMap.has(key)) poiMap.set(key, pick());
    }
  }

  placeNear(downtown, 0.6); placeNear(sat1, 0.1); placeNear(sat2, 0.1); placeRandom(0.2);
  if(population >= AIRPORT_POP_THRESHOLD){
    const edge = rng() < 0.5 ? { x: GRID-2, y: Math.floor(GRID*0.2) } : { x: 1, y: Math.floor(GRID*0.8) };
    poiMap.set(`${edge.x},${edge.y}`, 'airport');
  }
  return poiMap;
}
