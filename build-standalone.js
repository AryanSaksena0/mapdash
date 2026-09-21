/* Inlines the whole site into one portable HTML file.
   Usage:  node build-standalone.js  →  Mapdash-standalone.html
   Solo play works from that file with a double-click; 1v1 needs a served
   origin, so use the real site for matches.                              */
const fs=require('fs'), p=require('path'), d=__dirname;
const html=fs.readFileSync(p.join(d,'index.html'),'utf8');
const inline=f=>fs.readFileSync(p.join(d,f),'utf8');
const out=html
  .replace('<script src="data/world-data.js"></script>','<script>\n'+inline('data/world-data.js')+'\n</script>')
  .replace('<script src="config.js"></script>','<script>\n'+inline('config.js')+'\n</script>')
  .replace('<script src="js/mapdash.js"></script>','<script>\n'+inline('js/mapdash.js')+'\n</script>')
  .replace(/<link rel="manifest"[^>]*>/,'')
  .replace(/<link rel="icon"[^>]*>/,'')
  .replace(/<link rel="apple-touch-icon"[^>]*>/,'');
fs.writeFileSync(p.join(d,'..','Mapdash-standalone.html'), out);
console.log('Mapdash-standalone.html  '+(out.length/1024).toFixed(0)+'KB');
