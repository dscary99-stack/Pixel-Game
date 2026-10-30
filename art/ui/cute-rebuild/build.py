"""Cute rebuild, native authored UI + inspected illustrated masters. No runtime edits.
Run from any cwd. Only listed sources are exported; coverage never fabricates completion.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import json, hashlib, copy, math
R=Path(__file__).resolve().parent
ROOT=R.parents[2]; PUBLIC=ROOT/'apps/client/public'; META=PUBLIC/'assets/metadata'
OUT=R/'review'; OUT.mkdir(exist_ok=True)
old=[]
for name in ('ui-kit-manifest.json','ui-kit-r2-manifest.json'):
 old+=json.loads((R.parent/name).read_text(encoding='utf8'))['assets']
byname={Path(a['file']).stem.removesuffix('_v001'):a for a in old}
jobs=[]
def add(name,frames,source,framing=None):
 assert name in byname,name
 a=byname[name];assert all(f.size==(a['frameWidth'],a['frameHeight']) for f in frames),name
 jobs.append((name,frames,source,framing))
def blank(w,h):return Image.new('RGBA',(w,h))
def rounded(d,box,r,fill):
 # Native integer staircase; no anti-aliasing, fixed corners inside 16px slices.
 x,y,X,Y=box;r=min(r,(X-x)//2,(Y-y)//2)
 d.rectangle((x+r,y,X-r,Y),fill);d.rectangle((x,y+r,X,Y-r),fill)
 for i in range(r):
  inset=round(r-math.sqrt(max(0,r*r-(r-i-.5)**2)))
  d.line((x+inset,y+i,X-inset,y+i),fill=fill)
  d.line((x+inset,Y-i,X-inset,Y-i),fill=fill)
def panel(w,h,face,edge,hi,pressed=False,ornament=False):
 im=blank(w,h);d=ImageDraw.Draw(im)
 for inset,r,c in [(0,9,'#21182f'),(1,8,'#352943'),(2,7,edge),(3,6,hi),(4,5,edge),(6,4,'#46344d'),(7,3,face)]:
  rounded(d,(inset,inset,w-1-inset,h-1-inset),r,c)
 d.line((11,5,w-12,5),fill=hi);d.line((5,11,5,h-12),fill=hi)
 d.line((11,h-4,w-12,h-4),fill='#80556a')
 if pressed:
  d.line((10,8,w-11,8),fill='#21182f');d.line((8,10,8,h-11),fill='#21182f')
 if ornament:
  for x,y in [(9,9),(w-10,9),(9,h-10),(w-10,h-10)]:
   d.rectangle((x-1,y-1,x+1,y+1),fill='#f5ba76');d.point((x-1,y-1),fill='#fff4d1');d.point((x+1,y+1),fill='#98617e')
 return im
styles={'normal':('#44334f','#bc8fa8','#f6d3c0'),'selected':('#254e58','#72c9bb','#d9ffe1'),'primary':('#75503e','#edb567','#fff1b2'),'disabled':('#39323f','#74687e','#9e8da4'),'danger':('#683b50','#e38a9d','#ffcfbf')}
for n,a in byname.items():
 if a['frameCount']!=1:continue
 w,h=a['frameWidth'],a['frameHeight'];im=None
 if n=='ui_window_background':im=Image.new('RGBA',(w,h),'#2d243b')
 elif n.startswith('ui_window_'):im=panel(w,h,'#2d243b' if n.endswith('frame') else '#49344f','#bb8d9d','#ffe2b0',ornament=True)
 elif n.startswith('ui_button_'):
  state=n.removeprefix('ui_button_');f,e,hi=styles[state];im=panel(w,h,f,e,hi,state=='selected',state!='disabled')
 elif n.startswith('ui_slot_'):
  rank=n.split('_')[-1];ranks=['common','uncommon','rare','epic','legendary'];ranki=ranks.index(rank)+1
  edge=['#a89db7','#83c49c','#79b9e8','#bd94e3','#f0bc6c'][ranki-1]
  im=panel(w,h,'#30283f',edge,'#fff0ce');d=ImageDraw.Draw(im)
  for i in range(ranki):d.rectangle((w//2-ranki*2+i*4,3,w//2-ranki*2+i*4+1,4),fill='#fff4d1')
 elif n.startswith('ui_bar_'):
  im=blank(w,h);d=ImageDraw.Draw(im)
  if '_track_' in n:
   rounded(d,(0,0,w-1,h-1),min(2,h//2),'#2b2039');d.line((2,h-1,w-3,h-1),fill='#8c688d')
  else:
   kind=n.removeprefix('ui_bar_').rsplit('_h',1)[0]
   lo,mid,hi={'hp_ally':('#397c76','#70cda1','#d1ffd2'),'hp_enemy':('#a54468','#ee8391','#ffcab3'),'mp':('#4d69a5','#79b9e8','#d1f4ff'),'exp':('#a77548','#eaba6b','#fff1ba'),'ascend':('#7756a6','#b996e9','#f3d5ff')}[kind]
   d.rectangle((1,1,w-2,h-2),fill=mid);d.line((2,1,w-3,1),fill=hi)
   if h>4:d.line((2,h-2,w-3,h-2),fill=lo)
 elif n=='ui_badge_lock':
  im=blank(w,h);d=ImageDraw.Draw(im);rounded(d,(4,1,11,10),3,'#30213e');rounded(d,(5,2,10,9),2,'#ffe4a2');d.rectangle((7,4,8,8),fill=(0,0,0,0));rounded(d,(2,7,13,14),3,'#30213e');rounded(d,(3,8,12,13),2,'#d9985c');d.line((5,8,10,8),fill='#fff1bc');d.rectangle((7,10,8,12),fill='#604365')
 if im is not None:add(n,[im],'native authored rounded bevels in build.py')

def adapt(name,source,grid=(1,1)):
 p=R/'masters'/source
 if not p.exists():return
 a=byname[name];w,h=a['frameWidth'],a['frameHeight'];im=Image.open(p).convert('RGBA');cols,rows=grid
 assert im.width%cols==0 and im.height%rows==0,source
 cw,ch=im.width//cols,im.height//rows
 cells=[im.crop((x*cw,y*ch,(x+1)*cw,(y+1)*ch)) for y in range(rows) for x in range(cols)]
 # Water master crosses the row boundary: remove only the previous row's tail.
 if source=='water-sheet-master.png':
  for c in cells[3:]:ImageDraw.Draw(c).rectangle((0,0,cw-1,60),fill=(0,0,0,0))
 bbs=[c.getchannel('A').point(lambda v:255 if v>=128 else 0).getbbox() for c in cells];assert all(bbs),source
 box=(max(0,min(b[0] for b in bbs)-3),max(0,min(b[1] for b in bbs)-3),min(cw,max(b[2] for b in bbs)+3),min(ch,max(b[3] for b in bbs)+3))
 scale=min((w-2)/(box[2]-box[0]),(h-2)/(box[3]-box[1]));dw,dh=round((box[2]-box[0])*scale),round((box[3]-box[1])*scale);offset=((w-dw)//2,(h-dh)//2)
 frames=[]
 for c in cells:
  body=c.crop(box).resize((dw,dh),Image.Resampling.NEAREST);body.putalpha(body.getchannel('A').point(lambda v:255 if v>=128 else 0));fr=blank(w,h);fr.paste(body,offset);frames.append(fr)
 add(name,frames,source,dict(sourceGrid=grid,fixedCrop=box,fixedOffset=offset,scale=scale))
adapt('item_small_potion','potion-master.png')
adapt('ui_command_potion','potion-master.png')
adapt('ui_command_skill','fire-skill-master.png')
for e in ['fire','water','earth','wind','light','shadow','neutral']:
 adapt('ui_hit_'+e,e+'-sheet-master.png',(3,2))
adapt('ui_heal_burst','heal-sheet-master.png',(3,2))
for master,names in {'shield':['ui_command_guard','item_crab_buckler'],'sword':['ui_command_attack'],'feather':['ui_command_revive','item_phoenix_feather'],'boot':['ui_command_flee'],'crystal':['ui_command_capture'],'bag':['ui_menu_inventory']}.items():
 for n in names:adapt(n,master+'-master.png')

import extras
extras.run(globals())
# Shared palette for this rebuild; re-derived deterministically as new masters enter.
pixels=[]
for _,fs,_,_ in jobs:
 for f in fs:
  visible=[p[:3] for p in f.getdata() if p[3]]
  pixels.extend(visible[::max(1,math.ceil(len(visible)/512))])
strip=Image.new('RGB',(len(pixels),1));strip.putdata(pixels);palette=strip.quantize(colors=128,method=Image.Quantize.MEDIANCUT)
pal=palette.getpalette()[:384];(R/'palette.json').write_text(json.dumps([pal[i:i+3] for i in range(0,len(pal),3)],indent=2)+'\n')
records=[];index=json.loads((META/'index.json').read_text());views=[];checks=[]
for name,frames,source,framing in jobs:
 a=copy.deepcopy(byname[name]);new=[]
 for f in frames:
  alpha=f.getchannel('A');q=f.convert('RGB').quantize(palette=palette,dither=Image.Dither.NONE).convert('RGBA');q.putalpha(alpha);new.append(q)
 w,h=new[0].size;n=len(new);sheet=blank(w*n,h)
 for i,f in enumerate(new):sheet.paste(f,(i*w,0))
 a.update(version=2,file=a['file'].replace('_v001','_v002'),columns=n,frameCount=n,rows=1,origin=[0,0],staticFrame=0,status='grid_ready',productionApproved=False,sourceMaster=source,framing=framing)
 assert n==byname[name]['frameCount'],(name,n,byname[name]['frameCount'])
 dest=PUBLIC/a['file'].lstrip('/');sheet.save(dest);a['sha256']=hashlib.sha256(dest.read_bytes()).hexdigest()
 fn=dest.stem+'.json';(META/fn).write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 oldfn=name+'_v001.json';index=[x for x in index if x!=oldfn]
 if fn not in index:index.append(fn)
 records.append(a);views.append((name,new));sheet.save(OUT/(name+'-strip.png'))
 if n>1:
  preview=[]
  for f in new:
   zoom=min(6,max(1,256//max(w,h)));bg=Image.new('RGBA',(w,h),'#14121c');bg.alpha_composite(f);preview.append(bg.resize((w*zoom,h*zoom),Image.Resampling.NEAREST).convert('RGB'))
  loop=a['animations'][0]['loop'];duration=[round(1000/a['animations'][0]['fps'])]*n
  if not loop:preview.append(Image.new('RGB',(w*zoom,h*zoom),'#14121c'));duration.append(700)
  preview[0].save(OUT/(name+'.gif'),save_all=True,append_images=preview[1:],duration=duration,loop=0,disposal=2)
 checks.append(dict(name=name,size=list(sheet.size),alpha=sorted(set(sheet.getchannel('A').getdata())),uniqueFrames=len({f.tobytes() for f in new}),frameCount=n,source=source))
(META/'index.json').write_text(json.dumps(sorted(index),indent=2)+'\n')
remaining=[n for n in byname if n not in {j[0] for j in jobs}]
(R/'manifest.json').write_text(json.dumps(dict(status='proof_ready' if not remaining else 'in_progress',count=len(records),total=len(old),remaining=remaining,assets=records),ensure_ascii=False,indent=2)+'\n',encoding='utf8')
(R/'qa-report.json').write_text(json.dumps(dict(status='structural_checks_only',checks=checks,remainingCount=len(remaining)),indent=2)+'\n')
# Run proofs.py for the paginated final catalog.
print(json.dumps(dict(exported=len(records),remaining=len(remaining))))
