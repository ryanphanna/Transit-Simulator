export const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));
export const distance = (a,b)=> Math.hypot(a.x-b.x, a.y-b.y);
export function mulberry32(a){ return function(){ let t=(a+=0x6D2B79F5); t=Math.imul(t^(t>>>15), t|1); t^= t + Math.imul(t^(t>>>7), t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
export function polylineLengthKm(points){ if(points.length<2) return 0; let s=0; for(let i=1;i<points.length;i++) s+=distance(points[i-1],points[i]); return s*0.1; }
