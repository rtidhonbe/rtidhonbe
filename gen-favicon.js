'use strict';
// Render at 4× then scale down for sharper result
const { Resvg } = require('@resvg/resvg-js');
const fs   = require('fs');
const path = require('path');

const svg = fs.readFileSync(path.join(__dirname, 'public', 'favicon.svg'));

// Render at 128px for anti-aliasing quality, output 32px
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 128 },
  font: { loadSystemFonts: true },
});
const big = resvg.render();

// Downscale 128→32 by averaging 4×4 blocks (box filter)
const W = 32, SCALE = 4;
const src = big.pixels; // RGBA flat array, 128×128
const srcW = big.width;
const out = Buffer.alloc(W * W * 4);

for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    let r=0,g=0,b=0,a=0;
    for (let dy = 0; dy < SCALE; dy++) {
      for (let dx = 0; dx < SCALE; dx++) {
        const i = ((y*SCALE+dy)*srcW + (x*SCALE+dx)) * 4;
        r+=src[i]; g+=src[i+1]; b+=src[i+2]; a+=src[i+3];
      }
    }
    const n = SCALE*SCALE;
    const i = (y*W+x)*4;
    out[i]=r/n; out[i+1]=g/n; out[i+2]=b/n; out[i+3]=a/n;
  }
}

// Write PNG using raw encoder
const zlib = require('zlib');
function u32(n){ const b=Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function crc(buf){ let c=0xFFFFFFFF; for(const b of buf){c^=b;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xEDB88320:c>>>1;} return (c^0xFFFFFFFF)>>>0; }
function chunk(t,d){ const tb=Buffer.from(t,'ascii'); return Buffer.concat([u32(d.length),tb,d,u32(crc(Buffer.concat([tb,d])))]); }

const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(W,4); ihdr[8]=8; ihdr[9]=6; // RGBA
const rows=[];
for(let y=0;y<W;y++){
  const row=Buffer.alloc(1+W*4); row[0]=0;
  for(let x=0;x<W;x++){ const s=(y*W+x)*4; row[1+x*4]=out[s]; row[1+x*4+1]=out[s+1]; row[1+x*4+2]=out[s+2]; row[1+x*4+3]=out[s+3]; }
  rows.push(row);
}
const png=Buffer.concat([
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  chunk('IHDR',ihdr),
  chunk('IDAT',zlib.deflateSync(Buffer.concat(rows))),
  chunk('IEND',Buffer.alloc(0)),
]);
const outPath=path.join(__dirname,'public','favicon.png');
fs.writeFileSync(outPath,png);
console.log(`wrote ${png.length} bytes → ${outPath}`);
