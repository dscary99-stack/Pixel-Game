"""Native layered proof. Fixed component transforms; explicit per-frame attachment data.
Existing authored limb poses are retained. No edits to game source.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
import json,colorsys,math,re,hashlib
R=Path(__file__).resolve().parents[2];A=R/'art/player-layers';P=R/'apps/client/public/assets';M=P/'metadata';S=P/'sprites/characters'
for p in [A/'review',A/'source',S]:p.mkdir(parents=True,exist_ok=True)
def rgb(s):return tuple(bytes.fromhex(s.lstrip('#')))
KEY={k:list(map(rgb,v)) for k,v in {'skin':['8a4f3a','c98a6a','f2c4a0'],'hair':['3a2a4a','6a4f7a','9a7fa8','cbb4d4'],'eye':['1f3a5a','4f8ac0'],'trim':['5a5a64','8a8a96','c0c0cc']}.items()}
RESERVED=set(sum(KEY.values(),[]));PAL=[tuple(c) for c in json.loads((R/'art/ui/cute-rebuild/palette.json').read_text()) if tuple(c) not in RESERVED]
def nearest(c,pal):return min(pal,key=lambda q:sum((c[i]-q[i])**2 for i in range(3)))
OUTLINE=nearest((33,27,51),PAL);WHITE=nearest((253,253,237),PAL);MOUTH=nearest((109,54,84),PAL)
def blank():return Image.new('RGBA',(64,64))
def cleanup(f,limit=3):
 seen=set();out=f.copy()
 for y in range(64):
  for x in range(64):
   if (x,y) in seen or not f.getpixel((x,y))[3]:continue
   q=[(x,y)];seen.add((x,y));points=[]
   while q:
    xx,yy=q.pop();points.append((xx,yy))
    for dx in [-1,0,1]:
     for dy in [-1,0,1]:
      p=(xx+dx,yy+dy)
      if 0<=p[0]<64 and 0<=p[1]<64 and p not in seen and f.getpixel(p)[3]:seen.add(p);q.append(p)
   if len(points)<=limit:
    for p in points:out.putpixel(p,(0,0,0,0))
 return out
def source_parts(name,role):
 src=Image.open(A/'masters'/name).convert('RGBA');out=[]
 for i in range(4):
  # One uniform 1/16 source transform, shared by all views and all frames.
  im=src.crop((i%2*768,i//2*512,(i%2+1)*768,(i//2+1)*512)).resize((48,32),Image.Resampling.NEAREST)
  f=blank()
  for y in range(32):
   for x in range(48):
    r,g,b,a=im.getpixel((x,y))
    if a<128:continue
    ismaterial=(r>b*1.1 and r>75) if role=='skin' else max(r,g,b)>68
    col=nearest((r,g,b),KEY[role] if ismaterial else PAL)
    yy=y-5 if role=='hair' else y
    if yy>=0:f.putpixel((x,yy),col+(255,))
  out.append(cleanup(f))
 return out
HEADS=source_parts('bald-heads.png','skin');HAIRS=source_parts('hair01.png','hair')
# Original head bounds, reviewed against native v001 cels. Rectangles exclude raised hands.
BOX={
'battle_idle':[[20,5,56,36],[20,5,56,36],[17,5,54,36],[15,5,53,36]],
'battle_hurt':[[21,7,59,36],[18,7,54,36]],
'battle_attack':[[18,5,56,36],[18,11,56,40],[19,5,54,35],[21,6,56,36],[18,7,55,37],[14,5,52,36]],
'battle_cast':[[17,5,55,35],[15,5,53,36],[13,4,49,34],[13,5,50,36],[15,5,53,36],[14,5,52,35]],
'battle_ko':[[21,5,59,37],[26,14,61,48],[29,22,61,53],[28,24,62,55]],
'battle_attack_physical_ranged':[[20,10,50,35],[18,10,49,35],[16,10,47,35],[20,8,51,33],[17,7,48,33],[18,7,48,33]]}
for direction in ['down','left','right','up']:
 for state in ['idle','walk']:
  vals=json.loads((A/'source/head-regions.json').read_text())[f'world_{state}_{direction}']
  end={'down':34,'left':32,'right':33,'up':34}[direction]
  BOX[f'world_{state}_{direction}']=[[x0-1,y0-1,x1+1,end] for x0,y0,x1,y1 in vals]
HAND={
'idle':[[(27,48),(48,47)]]*4,
'hurt':[[(25,39),(44,38)],[(29,44),(49,48)]],
'attack':[[(28,42),(48,42)],[(29,46),(47,47)],[(17,31),(40,39)],[(56,37),(28,44)],[(50,46),(28,43)],[(28,44),(47,43)]],
'cast':[[(31,42),(43,43)],[(37,41),(30,44)],[(54,20),(31,37)],[(55,29),(30,43)],[(34,42),(45,47)],[(24,46),(44,44)]],
'ko':[[(26,46),(54,43)],[(32,53),(48,54)],[(39,53),(58,51)],[(40,53),(53,54)]],
'ranged':[[(45,40),(27,39)],[(54,35),(31,34)],[(54,35),(31,34)],[(54,33),(31,32)],[(54,33),(30,33)],[(45,40),(27,39)]]}
def face(view,expression):
 f=blank();d=ImageDraw.Draw(f);bb=HEADS[view].getbbox();cx=(bb[0]+bb[2])//2;bottom=bb[3]-1
 if view==3:return f
 xs=([cx-2,cx+5] if view==0 else [cx+5] if view==1 else [cx-5,cx+3]);yy=bottom-(8 if view<2 else 9)
 for x in xs:
  if expression=='ko':
   d.line((x,yy,x+3,yy+3),fill=OUTLINE+(255,));d.line((x+3,yy,x,yy+3),fill=OUTLINE+(255,))
  elif expression in ['hurt','blink']:
   d.line([(x,yy+1),(x+1,yy+2),(x+3,yy+1)],fill=OUTLINE+(255,))
  else:
   # Authored rounded eye cel: clipped corners, bright pupil catchlight, no square rim.
   for dy,row in enumerate(['.DD.','DWED','DEeD','.ee.']):
    for dx,ch in enumerate(row):
     if ch!='.':d.point((x+dx,yy+dy),fill={'D':OUTLINE,'W':WHITE,'E':KEY['eye'][0],'e':KEY['eye'][1]}[ch]+(255,))
 mouthx=cx+3 if view==0 else cx+7 if view==1 else cx-1
 d.line([(mouthx,bottom-3),(mouthx+1,bottom-2),(mouthx+3,bottom-3)],fill=MOUTH+(255,))
 return f
def pose_part(part,pivot,at,angle,flip=False):
 f=part.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if flip else part
 px=63-pivot[0] if flip else pivot[0]
 # Rotate about the same authored head attachment on every component.
 f=f.rotate(angle,Image.Resampling.NEAREST,center=(px,pivot[1]));out=blank();out.alpha_composite(f,(at[0]-px,at[1]-pivot[1]));return out
ASSETS={};MANIFEST=[];RIG={};RECORD=[]
def emit(key,frames,meta,role,version):
 name=f'{key}_v{version:03}';sheet=Image.new('RGBA',(64*len(frames),64))
 for i,f in enumerate(frames):sheet.alpha_composite(f,(i*64,0))
 sheet.save(S/(name+'.png'));m=dict(meta,assetId=key,version=version,file=f'/assets/sprites/characters/{name}.png',frameWidth=64,frameHeight=64,columns=len(frames),rows=1,frameCount=len(frames),padding=0,spacing=0,origin=[.5,1],groundOffset=4,headOffset=[0,0],status='grid_ready',layer=role,sourceAtlas='art/player-layers/source',palette='cute-v002 + exact appearance keys',recolorParts={'body':['skin','trim'],'hair_back':['hair'],'hair_front':['hair'],'face':['skin','eye']}[role],headRig='human-v002-proof')
 if role!='body':
  for field in ['shadowAsset','artId','contentGroup','weaponFamily','elementRendering']:m.pop(field,None)
 if role=='face' and key.endswith('_up'):m['intentionallyTransparent']='up-facing has no face'
 (M/(name+'.json')).write_text(json.dumps(m,indent=2)+'\n');MANIFEST.append(name+'.json');ASSETS[key]=(frames,m)
 return m
def build():
 for path in sorted(M.glob('player_human_*_v001.json')):
  old=json.loads(path.read_text());suffix=old['assetId'].replace('player_human_','');state=old['animations'][0]['name'];world=suffix.startswith('world');direction=old.get('facing','right');view={'down':2,'up':3,'left':1,'right':1}[direction] if world else 0;flip=world and direction=='left'
  src=Image.open(P.parent/old['file'].lstrip('/')).convert('RGBA');head=HEADS[view];hair=HAIRS[view];bb=head.getbbox();pivot=((bb[0]+bb[2])//2,bb[3]-1)
  back=hair.copy();front=blank()
  for y in range(64):
   for x in range(64):
    if hair.getpixel((x,y))[3] and head.getpixel((x,y))[3]:front.putpixel((x,y),hair.getpixel((x,y)))
  output={k:[] for k in ['body','hair_back','face','hair_front']};rig=[]
  for i,box in enumerate(BOX[suffix]):
   original=src.crop((i*64,0,i*64+64,64));body=original.copy();x0,y0,x1,y1=box
   at=[(x0+x1)//2,y1-2];angle=0
   if not world and state=='ko':at=[(40,35),(40,44),(32,48),(31,49)][i];angle=[0,-18,-55,-65][i]
   elif not world and state=='attack':angle=[0,8,-6,0,8,0][i]
   elif not world and state=='cast':angle=[0,5,-8,-5,5,0][i]
   # Remove the old complete head, preserving only scarf pixels at the neck seam.
   for y in range(max(0,y0),min(64,y1)):
    for x in range(max(0,x0),min(64,x1)):
     rr,gg,bb_,aa=body.getpixel((x,y));h,s,v=colorsys.rgb_to_hsv(rr/255,gg/255,bb_/255)
     preserve_scarf=y>=y1-4 and .32<h<.60 and s>.15
     preserve_ko_cloth=state=='ko' and y>y0+(y1-y0)*.58 and ((.62<h<.86 and v>.42 and s>.12) or (s<.13 and v>.82))
     if not(preserve_scarf or preserve_ko_cloth):body.putpixel((x,y),(0,0,0,0))
   hands=HAND['ranged' if 'physical_ranged' in suffix else state][i] if not world else {'down':[(23,42),(44,42)],'up':[(22,42),(44,42)],'right':[(26,43),(44,43)],'left':[(22,43),(40,43)]}[direction]
   skinmask=Image.new('L',(64,64));trimmask=Image.new('L',(64,64))
   for y in range(64):
    for x in range(64):
     r,g,b,a=body.getpixel((x,y))
     if not a:continue
     h,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255);nearhand=any(abs(x-hx)<=5 and abs(y-hy)<=5 for hx,hy in hands)
     if nearhand and .025<h<.115 and r>100 and .13<s<.52:
      body.putpixel((x,y),nearest((r,g,b),KEY['skin'])+(255,));skinmask.putpixel((x,y),255)
     elif .32<h<.60 and s>.15 and v>.32:
      body.putpixel((x,y),KEY['trim'][0 if v<.54 else 1 if v<.80 else 2]+(255,));trimmask.putpixel((x,y),255)
     elif (r,g,b) in RESERVED:body.putpixel((x,y),nearest((r,g,b),PAL)+(255,))
   expression='ko' if state=='ko' else 'hurt' if state=='hurt' else 'blink' if state=='idle' and i==2 else 'smile'
   posed={k:pose_part(vv,pivot,at,angle,flip) for k,vv in {'head':head,'hair_back':back,'face':face(view,expression),'hair_front':front}.items()}
   body.alpha_composite(posed['head']);body=cleanup(body,7);output['body'].append(body)
   posed['head'].getchannel('A').save(A/'source'/f'{suffix}_{i}_head-mask.png')
   for k in ['hair_back','face','hair_front']:output[k].append(posed[k])
   for y in range(64):
    for x in range(64):
     if posed['head'].getpixel((x,y))[:3] in KEY['skin'] and posed['head'].getpixel((x,y))[3]:skinmask.putpixel((x,y),255)
   skinmask.save(A/'source'/f'{suffix}_{i}_skin-mask.png');trimmask.save(A/'source'/f'{suffix}_{i}_trim-mask.png')
   rig.append({'headAnchor':at,'angle':angle,'view':view,'mirrorComponent':flip,'sourcePivot':pivot,'oldHeadRegion':box,'expression':expression,'hands':hands})
  RIG[suffix]=rig
  for role,prefix,ver in [('body','player_human_',2),('hair_back','hair_01_back_',1),('face','face_01_',1),('hair_front','hair_01_front_',1)]:emit(prefix+suffix,output[role],old,role,ver)
 index=json.loads((M/'index.json').read_text(encoding='utf-8-sig'));index=[n for n in index if not(n.startswith('player_human_') and n.endswith('_v001.json'))];(M/'index.json').write_text(json.dumps(sorted(set(index+MANIFEST)),indent=2)+'\n')
 (A/'manifest.json').write_text(json.dumps(MANIFEST,indent=2)+'\n');(A/'source/head-rig.json').write_text(json.dumps(RIG,indent=2)+'\n')
 for i,(head,hair) in enumerate(zip(HEADS,HAIRS)):
  head.save(A/'source'/f'head-view-{i}.png');hair.save(A/'source'/f'hair-view-{i}.png')
 print('Exported',len(MANIFEST),'sheets',sum(len(f) for f,m in ASSETS.values()),'frames')
if __name__=='__main__':build()
