// Existing local implementation stays available only as a development/demo mode.
if(process.env.DATABASE_URL){const {startApplication}=await import('./application/server.mjs');await startApplication();}
else {if(['production','staging'].includes(process.env.NODE_ENV))throw new Error('DATABASE_URL is required; JSON persistence is development/demo only.');const {server}=await import('./server.mjs');server.listen(Number(process.env.FABRIC_PORT||process.env.FLUX_PORT||8787),process.env.FABRIC_HOST||process.env.FLUX_HOST||'127.0.0.1');}
