// Compatibility entrypoint: exactly one production worker implementation.
import {startWorker} from './workers/production.mjs';
const runtime=await startWorker();for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>runtime.close().then(()=>process.exit(0)));
