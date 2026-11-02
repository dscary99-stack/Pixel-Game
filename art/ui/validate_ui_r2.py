"""Structural/coverage regression QA; visual and runtime review are separate gates."""
from pathlib import Path
from PIL import Image, ImageChops
import json,hashlib,collections,re,subprocess
R=Path(__file__).resolve().parents[2];ART=R/'art/ui';META=R/'apps/client/public/assets/metadata';PUB=R/'apps/client/public'
manifest=json.loads((ART/'ui-kit-r2-manifest.json').read_text(encoding='utf-8'));assets=manifest['assets'];c=json.loads((ART/'r2-content.json').read_text(encoding='utf-8'))
v1=json.loads((ART/'ui-kit-manifest.json').read_text());palette=set()
for a in v1['assets']:
 p=PUB/a['file'].lstrip('/');assert hashlib.sha256(p.read_bytes()).hexdigest()==a['sha256'],'v001 changed '+str(p)
 palette.update(px[:3] for px in Image.open(p).convert('RGBA').getdata() if px[3])
index=json.loads((META/'index.json').read_text());assert len(index)==len(set(index));assert len(assets)==manifest['count'];assert len({a['assetId'] for a in assets})==len(assets)
families=collections.Counter();hashgroups=collections.defaultdict(list);records=[]
for a in assets:
 p=PUB/a['file'].lstrip('/');assert re.fullmatch(r'(ui|item)_[a-z0-9_]+_v001.png',p.name)
 assert p.with_suffix('.json').name in index
 assert json.loads((META/p.with_suffix('.json').name).read_text(encoding='utf-8'))==a
 assert hashlib.sha256(p.read_bytes()).hexdigest()==a['sha256'];im=Image.open(p);assert im.mode=='RGBA'
 w,h,n=a['frameWidth'],a['frameHeight'],a['frameCount'];assert im.size==(w*n,h) and a['columns']==n and a['rows']==1
 assert a['origin']==[0,0] and a['status']=='grid_ready' and a['padding']==a['spacing']==0
 px=list(im.getdata());assert {v[3] for v in px}<={0,255};assert any(v[3]==0 for v in px)
 assert {v[:3] for v in px if v[3]}<=palette,'palette '+p.name
 frames=[im.crop((i*w,0,(i+1)*w,h)) for i in range(n)];assert all(f.getbbox() for f in frames),p.name
 if n>1:
  assert len(a['animations'])==1;anim=a['animations'][0];assert anim['frames']==list(range(n));assert 8<=anim['fps']<=12;assert isinstance(anim['loop'],bool)
  assert len({f.tobytes() for f in frames})>=min(3,n),'insufficient authored changes '+p.name
  assert (ART/'r2'/(a['assetId']+'_strip.png')).exists()
 else:assert a['animations']==[]
 families[a['kind']]+=1;hashgroups[(a['kind'],frames[0].tobytes())].append(a['assetId'])
 records.append(dict(asset=a['assetId'],size=[w,h],frames=n,uniqueCels=len({f.tobytes() for f in frames}),firstFrameBBox=frames[0].getbbox()))
for group,kind in [('statuses','status'),('items','item'),('equipment','item'),('sigils','item')]:
 actual={a['contentId'] for a in assets if a['kind']==kind and (kind!='item' or a['contentGroup']==group)}
 assert actual=={v['id'] for v in c[group]},(group,actual.symmetric_difference({v['id'] for v in c[group]}))
assert families['class']==9 and families['race']==8 and families['menu']==23 and families['status']==70
assert len([a for a in assets if a['kind']=='element' and a['frameCount']==1])==7
assert len([a for a in assets if a['kind']=='element' and a['frameCount']==4])==7
assert families['popup']==51 and families['hit']==7 and families['heal']==1
duplicates=[v for (k,b),v in hashgroups.items() if len(v)>1 and k not in ('element',)]
report=dict(round=2,baseCommit='2e8a8b8',assetCount=len(assets),animated=sum(a['frameCount']>1 for a in assets),sourceFrames=sum(a['frameCount'] for a in assets),families=dict(families),checks=dict(nativeGrid='pass',rgba='pass',binaryAlpha='pass',v001Palette='pass',metadataAndIndex='pass',sourceCoverage='pass',v001Unchanged='pass',firstFrameNonempty='pass',animationStrips='pass'),sharedFirstFrames=duplicates,records=records,visualReview='pending',gameIntegration='pending Claude; runtime source untouched',npmCheck='pending')
review=ART/'r2/review.json'
if review.exists():report.update(json.loads(review.read_text(encoding='utf-8')))
(ART/'qa-report-r2.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ART/'qa-report.json').write_text(json.dumps(dict(latestRound=2,v001Report='qa-report-v001.json',round2Report='qa-report-r2.json',v001Preserved=True,totalPngCount=51+len(assets),round2Assets=len(assets),round2Animated=report['animated'],checks=report['checks'],npmCheck=report['npmCheck'],gameIntegration=report['gameIntegration']),indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='records'},ensure_ascii=True,indent=2))
