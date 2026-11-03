"""Shared export and original-body adaptation utilities. Run adapt_sources.py to build.
Final heads/hair/faces come from independently generated pose atlases in masters/.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import importlib.util, json, math, colorsys, argparse
import zipfile

A=Path(__file__).resolve().parent; R=A.parents[2]; OLD=A.parent
spec=importlib.util.spec_from_file_location('legacy',OLD/'build.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
KEY=old.KEY; PAL=old.PAL; OUT=old.OUTLINE; WHITE=old.WHITE
RIG=json.loads((OLD/'source/head-rig.json').read_text())
P=R/'apps/client/public/assets'; ST=A/'staging'; DATA={}; RECIPES={}
for p in [ST/'sprites',ST/'metadata',A/'cels',A/'review']:p.mkdir(parents=True,exist_ok=True)

def blank():return Image.new("RGBA",(64,64))

def package_cels():
 with zipfile.ZipFile(A/'native-cels.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
  for p in sorted((A/'cels').glob('*.png')):
   info=zipfile.ZipInfo('cels/'+p.name,date_time=(2026,11,3,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,p.read_bytes())

def torso(suffix,i,rig):
 meta=json.loads((P/'metadata'/f'player_human_{suffix}_v001.json').read_text());im=Image.open(P.parent/meta['file'].lstrip('/')).convert('RGBA');b=im.crop((i*64,0,(i+1)*64,64))
 x0,y0,x1,y1=rig['oldHeadRegion'];state=meta['animations'][0]['name']
 for y in range(max(0,y0),min(64,y1)):
  for x in range(max(0,x0),min(64,x1)):
   r,g,bb,a=b.getpixel((x,y));h,s,v=colorsys.rgb_to_hsv(r/255,g/255,bb/255)
   scarf=y>=y1-4 and .32<h<.60 and s>.15
   cloth=state=='ko' and y>y0+(y1-y0)*.58 and ((.62<h<.86 and v>.42 and s>.12) or (s<.13 and v>.82))
   if not(scarf or cloth):b.putpixel((x,y),(0,0,0,0))
 # Semantic flesh components: include the whole exposed arm and cream/red skin
 # shades, not a loose square around the hand that also catches a boot or belt.
 candidates=set();seeds=set();clothrows={}
 for yy in range(64):
  xs=[]
  for xx in range(64):
   rr,gg,bb,aa=b.getpixel((xx,yy));hh,ss,vv=colorsys.rgb_to_hsv(rr/255,gg/255,bb/255)
   if aa and .62<hh<.90 and ss>.18 and vv>.30:xs.append(xx)
  if xs:clothrows[yy]=(min(xs),max(xs))
 for yy in range(64):
  for xx in range(64):
   rr,gg,bb,aa=b.getpixel((xx,yy));hh,ss,vv=colorsys.rgb_to_hsv(rr/255,gg/255,bb/255)
   nearhand=any(abs(xx-hx)<=4 and abs(yy-hy)<=4 for hx,hy in rig['hands'])
   insidecloth=yy in clothrows and clothrows[yy][0]<xx<clothrows[yy][1]
   fleshtone=bb>gg*.85 and rr>gg+10
   if aa and rr>bb+5 and rr>=gg-3 and (hh<.18 or hh>.90) and .035<ss<.80 and (not insidecloth or nearhand or fleshtone):
    candidates.add((xx,yy))
    if rr>200 and gg>120 and bb>115 and rr-gg>18 and 25<rr-bb<140:seeds.add((xx,yy))
 skinpoints=set();pending=set(candidates)
 while pending:
  first=pending.pop();stack=[first];part=[first]
  while stack:
   xx,yy=stack.pop()
   for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
    pp=(xx+dx,yy+dy)
    if pp in pending:pending.remove(pp);part.append(pp);stack.append(pp)
  seedcount=sum(p in seeds for p in part);height=max(y for x,y in part)-min(y for x,y in part)+1
  near=any(abs(x-hx)<=4 and abs(y-hy)<=4 for x,y in part for hx,hy in rig['hands'])
  if seedcount>=2 and (near or height>=6):skinpoints.update(part)
 for y in range(64):
  for x in range(64):
   r,g,bb,a=b.getpixel((x,y))
   if not a:continue
   h,s,v=colorsys.rgb_to_hsv(r/255,g/255,bb/255);near=any(abs(x-hx)<=6 and abs(y-hy)<=6 for hx,hy in rig['hands'])
   if (x,y) in skinpoints:
    b.putpixel((x,y),old.nearest((r,g,bb),KEY['skin'])+(255,))
   elif .32<h<.60 and s>.15 and v>.32:b.putpixel((x,y),KEY['trim'][0 if v<.54 else 1 if v<.80 else 2]+(255,))
   elif (r,g,bb) in old.RESERVED:b.putpixel((x,y),old.nearest((r,g,bb),PAL)+(255,))
 return old.cleanup(b,3),meta

def emit(key,frames,meta,role,version):
 name=f'{key}_v{version:03}';sheet=Image.new('RGBA',(64*len(frames),64))
 for i,f in enumerate(frames):sheet.alpha_composite(f,(64*i,0));f.save(A/'cels'/f'{name}_{i:02}.png')
 sheet.save(ST/'sprites'/f'{name}.png')
 m=dict(meta,assetId=key,version=version,file=f'/assets/sprites/characters/{name}.png',frameWidth=64,frameHeight=64,columns=len(frames),rows=1,frameCount=len(frames),origin=[.5,1],groundOffset=4,headOffset=[0,0],padding=0,spacing=0,status='grid_ready',layer=role,sourceAtlas='art/player-layers/rebuild-v003/native-cels.zip',headRig='art/player-layers/source/head-rig.json',recolorParts={'body':['skin','trim'],'hair_back':['hair'],'hair_front':['hair'],'face':['skin','eye']}[role],palette='cute-v002 + exact appearance keys')
 if role!='body':
  for field in ['shadowAsset','artId','contentGroup','weaponFamily','elementRendering']:m.pop(field,None)
 if role=='face' and key.endswith('_up'):m['intentionallyTransparent']='up-facing has no face'
 if role=='hair_back' and key.endswith('_up'):m['intentionallyTransparent']='back-facing visible hair is in front layer to cover the back of the body'
 (ST/'metadata'/f'{name}.json').write_text(json.dumps(m,indent=2)+'\n');DATA[key]=(frames,m)
