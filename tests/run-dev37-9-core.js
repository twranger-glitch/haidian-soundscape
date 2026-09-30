'use strict';
const cp=require('child_process'),path=require('path');
const names=['shadow-core','provider-lifecycle','route-core','patch-lock'];
if(process.argv.includes('--browser'))names.push('browser-core');
for(const name of names){const r=cp.spawnSync(process.execPath,[path.join(__dirname,`test-v900-dev37-9-${name}.js`)],{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status||1);}
