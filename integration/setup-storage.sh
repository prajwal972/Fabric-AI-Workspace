#!/usr/bin/env bash
# Disposable CI infrastructure only. No production credentials are generated.
set -euo pipefail
ROOT=$(mktemp -d)
curl -fsSL https://github.com/seaweedfs/seaweedfs/releases/download/4.48/linux_amd64.tar.gz -o "$ROOT/weed.tar.gz"
tar xzf "$ROOT/weed.tar.gz" -C "$ROOT"
"$ROOT/weed" scaffold -config=security > "$ROOT/security.toml"
ROOT="$ROOT" python3 - <<'PY'
import os,json,secrets
from pathlib import Path
r=Path(os.environ['ROOT']);p=r/'security.toml';p.write_text(p.read_text().replace('kek = ""','kek = "'+secrets.token_hex(32)+'"'));(r/'s3.json').write_text(json.dumps({'identities':[{'name':'test','credentials':[{'accessKey':os.environ['S3_ACCESS_KEY_ID'],'secretKey':os.environ['S3_SECRET_ACCESS_KEY']}],'actions':['Admin','Read','Write','List','Tagging']}]}))
PY
mkdir "$ROOT/objects"
(cd "$ROOT" && nohup ./weed server -dir="$ROOT/objects" -ip=127.0.0.1 -ip.bind=127.0.0.1 -master.port=29333 -master.volumeSizeLimitMB=64 -volume.max=100 -volume.port=28080 -filer -filer.port=28888 -s3 -s3.port=29000 -s3.config="$ROOT/s3.json" > "$ROOT/storage.log" 2>&1 &)
for i in $(seq 1 30);do if curl -s http://127.0.0.1:29000/ >/dev/null;then break;fi;sleep 1;done
node --input-type=module - <<'JS'
import {createInfrastructure} from './src/infrastructure/services.mjs';import {CreateBucketCommand} from '@aws-sdk/client-s3';const i=createInfrastructure();try{await i.s3.send(new CreateBucketCommand({Bucket:process.env.S3_BUCKET}));}finally{await i.close();}
JS
