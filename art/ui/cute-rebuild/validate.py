"""Independent native file/metadata/index/content preservation checks."""
from pathlib import Path
from PIL import Image
import json,hashlib,collections
R=Path(__file__).resolve().parent;ROOT=R.parents[2];P=ROOT/'apps/client/public';M=P/'assets/metadata'
manifest=json.loads((R/'manifest.json').read_text(encoding='utf8'));assets=manifest['assets'];errors=[];rows=[]
palette={tuple(c) for c in json.loads((R/'palette.json').read_text())}
index=json.loads((M/'index.json').read_text());assert len(index)==len(set(index))
old=[]
for file in ('ui-kit-manifest.json','ui-kit-r2-manifest.json'):old+=json.loads((R.parent/file).read_text(encoding='utf8'))['assets']
oldids={a['assetId']:a for a in old};assert len(oldids)==364
for a in assets:
 n=Path(a['file']).stem;fail=[];path=P/a['file'].lstrip('/');im=Image.open(path);w,h,k=a['frameWidth'],a['frameHeight'],a['frameCount'];prev=oldids[a['assetId']]
 def check(test,msg):
  if not test:fail.append(msg)
 check(im.mode=='RGBA','RGBA');check(im.size==(w*k,h),'dimensions');check(a['columns']==k and a['rows']==1,'grid')
 check((w,h,k)==(prev['frameWidth'],prev['frameHeight'],prev['frameCount']),'original geometry preserved')
 check(a['origin']==[0,0] and a['staticFrame']==0 and a['status']=='grid_ready','metadata contract')
 check(a['version']==2 and n.endswith('_v002'),'version');check(n+'.json' in index,'index')
 check(n.replace('_v002','_v001')+'.json' not in index,'superseded index entry')
 check(json.loads((M/(n+'.json')).read_text(encoding='utf8'))==a,'manifest metadata equality')
 check(hashlib.sha256(path.read_bytes()).hexdigest()==a['sha256'],'sha256')
 alpha=set(im.getchannel('A').getdata());check(alpha<={0,255},'binary alpha')
 check(all(tuple(p[:3]) in palette for p in im.getdata() if p[3]),'shared palette')
 frames=[im.crop((i*w,0,(i+1)*w,h)) for i in range(k)];check(all(f.getchannel('A').getbbox() for f in frames),'nonempty frames')
 unique=len({f.tobytes() for f in frames});check(k==1 or unique>1,'genuine frame variation')
 if k>1:
  check(len(a['animations'])==1,'clip count');clip=a['animations'][0];check(clip['frames']==list(range(k)),'frame order');check(8<=clip['fps']<=12,'fps')
  check((R/'review'/(n.removesuffix('_v002')+'.gif')).exists(),'GIF proof')
 else:check(a['animations']==[],'static animations')
 check(a['nineSlice']==prev['nineSlice'],'slice borders')
 rows.append(dict(file=n+'.png',passed=not fail,errors=fail,uniqueFrames=unique,sourceFrames=k,alpha=sorted(alpha)))
 errors += [n+': '+e for e in fail]
for a in old:
 if hashlib.sha256((P/a['file'].lstrip('/')).read_bytes()).hexdigest()!=a['sha256']:errors.append('v001 changed: '+a['file'])
if manifest['remaining']:errors.append('Unbuilt assets: '+str(len(manifest['remaining'])))
result=dict(status='pass' if not errors else 'incomplete_or_failed',exported=len(assets),expected=364,animated=sum(a['frameCount']>1 for a in assets),sourceFrames=sum(a['frameCount'] for a in assets),paletteColors=len(palette),errors=errors,assets=rows,visualReview='see VISUAL_REVIEW.md; automated checks do not assess style')
(R/'qa-report.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='assets'}));raise SystemExit(bool(errors))
