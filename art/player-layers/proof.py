from PIL import Image,ImageDraw,ImageOps
from pathlib import Path
import json,re,hashlib
import build as b
A=b.A;REVIEW=A/'review';DATA={}
for n in json.loads((A/'manifest.json').read_text()):
 m=json.loads((b.M/n).read_text());im=Image.open(b.P.parent/m['file'].lstrip('/')).convert('RGBA');DATA[m['assetId']]=([im.crop((i*64,0,i*64+64,64)) for i in range(m['frameCount'])],m)
source=(b.R/'packages/shared/src/appearance.ts').read_text(encoding='utf-8-sig')
RAMPS={id:list(map(b.rgb,re.findall(r'#[a-f0-9]{6}',s))) for id,s in re.findall(r'id: "((?:skin|haircolor|eye):\d+)".*?ramp: \[([^\]]+)\]',source)}
def recolor(f,parts,skin='skin:02',hair='haircolor:03',eye='eye:02',trim=None):
 targets={'skin':RAMPS[skin],'hair':RAMPS[hair],'eye':RAMPS[eye],'trim':trim or list(map(b.rgb,['1a5a3a','3aa86a','8ae0a8']))};swaps={s:t for p in parts for s,t in zip(b.KEY[p],targets[p])};out=f.copy()
 for y in range(64):
  for x in range(64):
   c=out.getpixel((x,y))
   if c[3] and c[:3] in swaps:out.putpixel((x,y),swaps[c[:3]]+(255,))
 return out
def composite(suffix,i,skin='skin:02',hair='haircolor:03',bg=None,weapon=None):
 out=Image.new('RGBA',(64,64),bg) if bg else b.blank()
 for prefix in ['hair_01_back_','player_human_','face_01_','hair_01_front_']:
  fs,m=DATA[prefix+suffix];out.alpha_composite(recolor(fs[i%len(fs)],m['recolorParts'],skin,hair))
 if weapon:
  state=suffix.split('_')[1];p=b.P/'sprites/equipment'/f'weapon_{weapon}_battle_{state}_v001.png'
  if p.exists():im=Image.open(p).convert('RGBA');out.alpha_composite(im.crop((i*64,0,i*64+64,64)))
 return out
def gif(frames,path,clip,zoom=2):
 pics=[]
 for f in frames:
  bg=Image.new('RGBA',f.size,'#14121c');bg.alpha_composite(f);pics.append(bg.convert('RGB').resize((f.width*zoom,f.height*zoom),Image.Resampling.NEAREST))
 delays=[10*(round((i+1)*100/clip['fps'])-round(i*100/clip['fps'])) for i in range(len(pics))]
 opts={'save_all':True,'append_images':pics[1:],'duration':delays,'disposal':2}
 if clip['loop']:opts['loop']=0
 pics[0].save(path,**opts)
def proofs():
 suffixes=list(json.loads((A/'source/head-rig.json').read_text()));cards=[]
 for mode in ['battle','world']:
  names=[s for s in suffixes if s.startswith(mode)];page=Image.new('RGBA',(520,len(names)*88),'#14121c');d=ImageDraw.Draw(page)
  for row,s in enumerate(names):
   fs,m=DATA['player_human_'+s];frames=[composite(s,i) for i in range(len(fs))];d.text((3,row*88),s,fill='white')
   for i,f in enumerate(frames):page.alpha_composite(f,(i*80,row*88+20))
   gif(frames,REVIEW/(s+'.gif'),m['animations'][0]);cards.append(s)
  for scale in [1,2]:page.convert('RGB').resize((page.width*scale,page.height*scale),Image.Resampling.NEAREST).save(REVIEW/f'{mode}-proof-{scale}x.png')
 # Every source layer can be checked independently, including bald body and transparent up face.
 for role,prefix in [('body','player_human_'),('hair-back','hair_01_back_'),('face','face_01_'),('hair-front','hair_01_front_')]:
  page=Image.new('RGBA',(520,len(suffixes)*78),'#d7cec5');d=ImageDraw.Draw(page)
  for row,s in enumerate(suffixes):
   d.text((0,row*78),s,fill='#252039')
   for i,f in enumerate(DATA[prefix+s][0]):page.alpha_composite(f,(i*80,row*78+14))
  page.convert('RGB').save(REVIEW/(role+'-layers.png'))
 table=Image.new('RGBA',(820,560),'#14121c');d=ImageDraw.Draw(table)
 for j in range(10):d.text((65+j*75,8),f'H{j+1:02}',fill='white')
 for i in range(6):
  d.text((6,42+i*84),f'S{i+1:02}',fill='white')
  for j in range(10):table.alpha_composite(composite('battle_idle',0,f'skin:{i+1:02}',f'haircolor:{j+1:02}'),(55+j*75,28+i*84))
 for z in [1,2]:table.convert('RGB').resize((table.width*z,table.height*z),Image.Resampling.NEAREST).save(REVIEW/f'skin6-hair10-{z}x.png')
 for family in ['physical_melee','physical_ranged','magic','support']:
  s='battle_attack_physical_ranged' if family=='physical_ranged' else 'battle_cast' if family in ['magic','support'] else 'battle_attack';fs,m=DATA['player_human_'+s];gif([composite(s,i,weapon=family) for i in range(len(fs))],REVIEW/(family+'-weapon.gif'),m['animations'][0],3)
 stages=Image.new('RGBA',(320,84),'#d7cec5');d=ImageDraw.Draw(stages);acc=b.blank()
 for i,prefix in enumerate(['hair_01_back_','player_human_','face_01_','hair_01_front_']):
  fs,m=DATA[prefix+'battle_idle'];acc.alpha_composite(recolor(fs[0],m['recolorParts']));stages.alpha_composite(acc,(i*80,16));d.text((i*80,1),['back','+body','+face','+front'][i],fill='#252039')
 stages.resize((960,252),Image.Resampling.NEAREST).save(REVIEW/'stack-order.png')
 html='<!doctype html><meta charset="utf-8"><title>Player Layers Proof</title><style>body{background:#14121c;color:#f7ead1;font:16px system-ui;margin:24px}img{image-rendering:pixelated}a{color:#9de0cb}section{display:flex;flex-wrap:wrap;gap:24px}figure{margin:12px}button{padding:8px}</style><h1>Human v002 + Hair01 + Face01</h1><p>Proof only; remaining styles/faces/races wait for review. All colours from appearance.ts.</p><p><a href="review/battle-proof-2x.png">Battle 2x</a> · <a href="review/world-proof-2x.png">World 2x</a> · <a href="review/skin6-hair10-2x.png">Colours 2x</a></p><img src="review/stack-order.png"><h2>6 skin x 10 hair colours (1x)</h2><img src="review/skin6-hair10-1x.png"><h2>All poses</h2><img src="review/battle-proof-1x.png"><img src="review/world-proof-1x.png"><h2>Animations</h2><button onclick="document.querySelectorAll(\'img.anim\').forEach(i=>i.src=i.src.split(\'?\')[0]+\'?\'+Date.now())">Replay one-shot clips</button><section>'+''.join(f'<figure><figcaption>{s}</figcaption><img class="anim" src="review/{s}.gif"></figure>' for s in cards)+'</section>'
 (A/'preview.html').write_text(html,encoding='utf-8')
def qa():
 failures=[];entries=[];index=json.loads((b.M/'index.json').read_text());palette=set(b.PAL)|b.RESERVED
 for key,(fs,m) in DATA.items():
  errors=[];parts=m['recolorParts'];role=m['layer'];suffix=key.split('human_',1)[-1] if role=='body' else key.split('01_',1)[1].removeprefix('back_').removeprefix('front_');clip=m['animations'][0]
  if m['origin']!=[.5,1] or m['groundOffset']!=4 or m['headOffset']!=[0,0]:errors.append('anchor')
  if len(fs)!=m['frameCount'] or m['columns']!=len(fs):errors.append('grid')
  expected={'idle':(4,6,True),'walk':(4,8,True),'attack':(6,10,False),'cast':(6,10,False),'hurt':(2,8,False),'ko':(4,8,False)}[clip['name']]
  if (len(fs),clip['fps'],clip['loop'])!=expected:errors.append('timing')
  if clip['frames']!=list(range(len(fs))):errors.append('frame order')
  if clip['name']=='attack' and m.get('hitFrame')!=3:errors.append('hitFrame')
  if clip['name']=='ko' and not m.get('holdLastFrame'):errors.append('ko hold')
  counts={p:0 for p in b.KEY};bounds=[]
  for i,f in enumerate(fs):
   if f.size!=(64,64):errors.append('size')
   bounds.append(f.getbbox())
   masks={p:Image.open(A/'source'/f'{suffix}_{i}_{p}-mask.png') for p in ['skin','trim']} if role=='body' else {}
   headmask=Image.open(A/'source'/f'{suffix}_{i}_head-mask.png')
   for y in range(64):
    for x in range(64):
     *c,a=f.getpixel((x,y));c=tuple(c)
     if a not in [0,255]:errors.append('alpha')
     if not a:continue
     if role=='face' and not headmask.getpixel((x,y)):errors.append('face outside registered head')
     if x in [0,63] or y in [0,63]:errors.append('visible cell edge')
     if c not in palette:errors.append('palette')
     for part,ramp in b.KEY.items():
      if c in ramp:
       counts[part]+=1
       if part not in parts:errors.append('foreign key '+part)
       if masks and part in masks and not masks[part].getpixel((x,y)):errors.append('key outside semantic mask '+part)
   if role=='face' and suffix.endswith('_up') and f.getbbox():errors.append('up face visible')
  name=Path(m['file']).stem+'.json'
  if name not in index:errors.append('index')
  if errors:failures.append({'asset':key,'errors':sorted(set(errors))})
  entries.append({'asset':key,'frames':len(fs),'uniqueCels':len({f.tobytes() for f in fs}),'bounds':bounds,'keyPixels':counts,'sha256':hashlib.sha256((b.P.parent/m['file'].lstrip('/')).read_bytes()).hexdigest()})
 report={'status':'pass' if not failures else 'fail','assets':len(DATA),'frames':sum(len(fs) for fs,m in DATA.values()),'clips':14,'skinHairCombinations':60,'failures':failures,'entries':entries,'note':'Colour/geometry validation does not substitute for visual alignment review.'}
 (A/'qa-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='entries'},indent=2))
 if failures:raise SystemExit(1)
if __name__=='__main__':proofs();qa()
