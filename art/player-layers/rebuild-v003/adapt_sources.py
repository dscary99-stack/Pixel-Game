"""Adapt individually generated pose cels; no bitmap rotation or pose duplication.
Source extraction, uniform per-atlas sampling, semantic key mapping and registration.
"""
from PIL import Image,ImageDraw,ImageFilter
from pathlib import Path
import numpy as np,json,math,statistics
import draw_cels as b
import normalize_sources as n
A=b.A;MA=A/'masters';CACHE=A/'source-cache';CACHE.mkdir(exist_ok=True)
MAPPING={'battle_idle':list(range(4)),'battle_hurt':[4,5],'battle_attack':list(range(6,12)),'battle_attack_physical_ranged':list(range(12,18)),'battle_cast':list(range(18,24)),'battle_ko':list(range(24,28))}
for row,di in enumerate(['down','left','right','up']):
 for part,st in enumerate(['idle','walk']):MAPPING[f'world_{st}_{di}']=list(range(row*8+part*4,row*8+part*4+4))
def warm(p):
 r,g,bb,a=p
 return a>=128 and r>g+7 and g>bb+4 and r>100 and g>65 and bb>30 and .15<(r-bb)/max(1,r)<.70
def skinpoints(im):return [(x,y) for y in range(im.height) for x in range(im.width) if warm(im.getpixel((x,y)))]
def extract(mode,style,kind='hair'):
 cache=CACHE/(f'{mode}{style:02}' if kind=='hair' else f'{mode}-{kind}{style:02}');cache.mkdir(exist_ok=True)
 paths=list(cache.glob('*.png'))
 if len(paths)==(28 if mode=='battle' else 32):return [Image.open(p).convert('RGBA') for p in sorted(paths)]
 file=MA/(f'{mode}-bald.png' if kind=='bald' else f'{mode}-{kind}{style:02}.png' if not(mode=='world' and style==1 and kind=='hair') else 'head-atlas-draft.png')
 im=Image.open(file).convert('RGBA');cols=6 if mode=='battle' else 8;count=28 if mode=='battle' else 60 if style==1 and kind=='hair' else 32
 blobs=sorted(n.components(im),key=lambda p:len(p[1]),reverse=True)
 if len(blobs)<count:
  for col in range(1,cols):
   xx=round(col*im.width/cols)
   for yy in range(im.height):im.putpixel((xx,yy),(0,0,0,0))
  blobs=sorted(n.components(im),key=lambda p:len(p[1]),reverse=True)
 if len(blobs)<count:raise ValueError((mode,style,len(blobs),count))
 blobs=blobs[:count];blobs.sort(key=lambda p:(p[0][1]+p[0][3])/2);ordered=[]
 for row in range(math.ceil(count/cols)):ordered+=sorted(blobs[row*cols:(row+1)*cols],key=lambda p:p[0][0])
 if mode=='world' and style==1 and kind=='hair':ordered=ordered[24:56]
 out=[]
 for i,(box,pts) in enumerate(ordered):
  crop=Image.new('RGBA',(box[2]-box[0],box[3]-box[1]))
  for x,y in pts:crop.putpixel((x-box[0],y-box[1]),im.getpixel((x,y)))
  crop.save(cache/f'{i:02}.png');out.append(crop)
 return out
def spread(im):
 pts=skinpoints(im)
 if len(pts)<20:return None
 xs=[x for x,y in pts];return float(np.quantile(xs,.9)-np.quantile(xs,.1))
def centroid(im,up=False):
 pts=skinpoints(im)
 if not pts:return ((im.width-1)/2,im.height-2)
 return (float(np.median([x for x,y in pts])),float(np.median([y for x,y in pts])))
def register(im,scale,rig,up=False):
 # Every source in an atlas uses exactly this same scale, regardless of pose.
 im=im.resize((max(1,round(im.width*scale)),max(1,round(im.height*scale))),Image.Resampling.NEAREST)
 cx,cy=centroid(im,up);a=math.radians(rig['angle']);v=rig['view'];dx=0 if v in [2,3] else -3 if rig['mirrorComponent'] else 3;dy=0 if up else -3
 tx,ty=rig['headAnchor'];tx+=round(dx*math.cos(a)+dy*math.sin(a));ty+=round(-dx*math.sin(a)+dy*math.cos(a));at=(round(tx-cx),round(ty-cy))
 out=b.blank();out.alpha_composite(im,at);return out,{'scale':scale,'translation':at,'sourceSize':im.size}
def low_skin(im):
 pts=skinpoints(im)
 if not pts:return ((im.width-1)/2,im.height-1)
 bottom=max(y for x,y in pts);pts=[p for p in pts if p[1]>=bottom-1]
 return (float(np.median([x for x,y in pts])),float(np.median([y for x,y in pts])))
def highlights(im):
 return [(x,y) for y in range(im.height) for x in range(im.width) if (lambda p:p[3]>=180 and min(p[:3])>220 and max(p[:3])-min(p[:3])<25 and p[0]>=p[2] and p[1]>=p[2]-10)(im.getpixel((x,y)))]
def align_reference(source,scale,reference,eyes=True):
 im=source.resize((max(1,round(source.width*scale)),max(1,round(source.height*scale))),Image.Resampling.NEAREST)
 p,q=highlights(im),highlights(reference)
 alignment="lower skin attachment"
 if eyes:
  alignment="skin centroid"
  a=centroid(im);z=centroid(reference)
  if p and q:
   ea=np.median(p,axis=0);ez=np.median(q,axis=0)
   if max(abs((ez[k]-ea[k])-(z[k]-a[k])) for k in [0,1])<=1:a,z=ea,ez;alignment="eye highlights"
 else:a=low_skin(im);z=low_skin(reference)
 at=(round(z[0]-a[0]),round(z[1]-a[1]));out=b.blank();out.alpha_composite(im,at)
 return out,{'scale':scale,'translation':at,'sourceSize':im.size,'alignment':alignment}
def bald_keys(im):
 out=b.blank();pts=skinpoints(im);area=Image.new('L',(64,64))
 if pts:ImageDraw.Draw(area).polygon(hull(pts),fill=255)
 for y in range(64):
  for x in range(64):
   r,g,bb,a=im.getpixel((x,y))
   if a<180 or (r>180 and g<55 and bb<55):continue
   col=b.old.nearest((r,g,bb),b.KEY['skin']) if warm((r,g,bb,a)) or area.getpixel((x,y)) else b.OUT
   out.putpixel((x,y),col+(255,))
 return out
def hull(points):
 pts=sorted(set(points))
 if len(pts)<3:return pts
 def cross(o,a,z):return (a[0]-o[0])*(z[1]-o[1])-(a[1]-o[1])*(z[0]-o[0])
 lo=[]
 for p in pts:
  while len(lo)>=2 and cross(lo[-2],lo[-1],p)<=0:lo.pop()
  lo.append(p)
 hi=[]
 for p in reversed(pts):
  while len(hi)>=2 and cross(hi[-2],hi[-1],p)<=0:hi.pop()
  hi.append(p)
 return lo[:-1]+hi[:-1]
def pixel_components(points):
 todo=set(points);out=[]
 while todo:
  p=todo.pop();stack=[p];part=[p]
  while stack:
   x,y=stack.pop()
   for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
    q=(x+dx,y+dy)
    if q in todo:todo.remove(q);stack.append(q);part.append(q)
  out.append(part)
 return out
def split(im,up=False):
 skin=skinpoints(im);region=Image.new('L',(64,64));rd=ImageDraw.Draw(region)
 if skin and not up:rd.polygon(hull(skin),fill=255)
 cool=[]
 for y in range(64):
  for x in range(64):
   r,g,bb,a=im.getpixel((x,y))
   if a>=180 and bb>r and bb>g+8 and r>65:cool.append((x,y))
 hair=set(p for comp in pixel_components(cool) if len(comp)>=12 for p in comp)
 # Add the existing one-pixel ink border without flooding into the eye sockets.
 for x,y in list(hair):
  for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
   xx,yy=x+dx,y+dy
   if 0<=xx<64 and 0<=yy<64:
    r,g,bb,a=im.getpixel((xx,yy))
    if a>=180 and not warm((r,g,bb,a)) and max(r,g,bb)<100:hair.add((xx,yy))
 for y in range(64):
  for x in range(64):
   p=im.getpixel((x,y))
   if p[3]>=180 and not warm(p) and not region.getpixel((x,y)):hair.add((x,y))
 hairim=b.blank();face=b.blank();keyskin=b.blank()
 for y in range(64):
  for x in range(64):
   r,g,bb,a=im.getpixel((x,y))
   if a<180:continue
   if (x,y) in hair:
    color=b.OUT if max(r,g,bb)<55 else b.old.nearest((r,g,bb),b.KEY['hair']);hairim.putpixel((x,y),color+(255,))
   elif warm((r,g,bb,a)):
    color=b.old.nearest((r,g,bb),b.KEY['skin']);keyskin.putpixel((x,y),color+(255,));face.putpixel((x,y),color+(255,))
   elif region.getpixel((x,y)) and not up:
    if r>g+15 and r>bb:color=b.KEY['skin'][0]
    elif min(r,g,bb)>160 and max(r,g,bb)-min(r,g,bb)<55:color=b.WHITE
    elif max(r,g,bb)<70:color=b.OUT
    else:color=b.KEY['eye'][1 if max(r,g,bb)>135 else 0]
    face.putpixel((x,y),color+(255,))
 if up:face=b.blank()
 else:
  whites=[(x,y) for y in range(64) for x in range(64) if face.getpixel((x,y))==b.WHITE+(255,)]
  for y in range(64):
   for x in range(64):
    if face.getpixel((x,y))[:3] in b.KEY['eye'] and face.getpixel((x,y))[3]:
     if not any(abs(x-wx)<=3 and -2<=y-wy<=3 for wx,wy in whites):face.putpixel((x,y),b.KEY['skin'][0]+(255,))
 # Fill feature holes for the bare head using neighbouring skin, retain cheek planes.
 silhouette=im.getchannel('A').point(lambda v:255 if v>=180 else 0)
 skull=Image.new('L',(64,64));sb=silhouette.getbbox()
 if sb:
  xx,yy,xx1,yy1=sb
  ImageDraw.Draw(skull).ellipse((xx+3,yy+5,xx1-4,yy1-3),fill=255)
 sd=ImageDraw.Draw(skull)
 if skin:sd.polygon(hull(skin),fill=255)
 bodyhead=b.blank();sp=[(p,keyskin.getpixel(p)) for p in skin if keyskin.getpixel(p)[3]]
 for y in range(64):
  for x in range(64):
   if not skull.getpixel((x,y)):continue
   col=keyskin.getpixel((x,y))
   if not col[3]:
    if sp:col=min(sp,key=lambda q:abs(q[0][0]-x)+abs(q[0][1]-y))[1]
    else:col=b.KEY['skin'][1]+(255,)
   bodyhead.putpixel((x,y),col)
 # One-pixel outside outline, never a non-key interior skin shadow.
 dil=skull.filter(ImageFilter.MaxFilter(3));outlined=b.blank()
 for y in range(64):
  for x in range(64):
   if dil.getpixel((x,y)) and not skull.getpixel((x,y)):outlined.putpixel((x,y),b.OUT+(255,))
 outlined.alpha_composite(bodyhead)
 return outlined,face,hairim,skull
def main():
 sources={};scales={};registration={};coverage={};b.DATA.clear();faces={};bald={}
 for mode in ['battle','world']:
  base=extract(mode,1);basefactor=.15 if mode=='battle' else .24
  widths=[spread(im) for im in base[:24]];target=statistics.median(x for x in widths if x)*basefactor
  for style in range(1,5):
   poses=base if style==1 else extract(mode,style);med=statistics.median(x for x in [spread(im) for im in poses[:24]] if x)
   scales[f'{mode}{style}']=basefactor if style==1 else target/med
   if mode=='battle' and style==4:scales[f'{mode}{style}']=.22 # fixed atlas-wide calibration: covered ears must not enlarge the skull
   sources[mode,style]=poses
  for f in [2,3]:
   poses=extract(mode,f,'face');med=statistics.median(x for x in [spread(im) for im in poses[:24]] if x);scales[f'{mode}-face{f}']=target/med;faces[mode,f]=poses
  bald[mode]=extract(mode,1,'bald');scales[f'{mode}-bald']=.15 if mode=='battle' else .20
 print('Uniform source scales',scales,flush=True)
 for suffix,rigs in b.RIG.items():
  mode=suffix.split('_')[0];state='ranged' if 'physical_ranged' in suffix else suffix.split('_')[1];up=suffix.endswith('_up')
  groups={p:[] for p in ['player_human']+[f'hair_{n:02}_{side}' for n in range(1,5) for side in ['back','front']]+[f'face_{n:02}' for n in range(1,4)]}
  for i,rig in enumerate(rigs):
   sourceidx=MAPPING[suffix][i];im,reg=register(sources[mode,1][sourceidx],scales[f'{mode}1'],rig,up);fallback,face,hair,mask=split(im,up)
   baldsource,br=align_reference(bald[mode][sourceidx],scales[f'{mode}-bald'],im,False);head=bald_keys(baldsource)
   if state=='ko':
    limit=mask.filter(ImageFilter.MaxFilter(3))
    for y in range(64):
     for x in range(64):
      if not limit.getpixel((x,y)):head.putpixel((x,y),(0,0,0,0))
   for y in range(64):
    for x in range(64):
     if face.getpixel((x,y))[3] and not head.getpixel((x,y))[3]:head.putpixel((x,y),fallback.getpixel((x,y)) if fallback.getpixel((x,y))[3] else b.KEY['skin'][2]+(255,))
   mask=head.getchannel('A');body,meta=b.torso(suffix,i,rig);body.alpha_composite(head);groups['player_human'].append(body)
   registration[f'{suffix}_{i}']={'sourceIndex':sourceidx,'base':reg,'bald':br,'styles':{},'faces':{}}
   for style in range(1,5):
    if style==1:hh=hair;rr=reg
    else:
     vi,rr=align_reference(sources[mode,style][sourceidx],scales[f'{mode}{style}'],im,not up);_,_,hh,_=split(vi,up)
    front=b.blank();back=b.blank()
    for y in range(64):
     for x in range(64):
      p=hh.getpixel((x,y))
      if p[3]:
       (front if up or mask.getpixel((x,y)) or y<=rig['headAnchor'][1]-1 else back).putpixel((x,y),p)
    groups[f'hair_{style:02}_front'].append(front);groups[f'hair_{style:02}_back'].append(back);registration[f'{suffix}_{i}']['styles'][str(style)]=rr
   for f in range(1,4):
    if f==1 or up:ff=face
    else:
     fi,fr=align_reference(faces[mode,f][sourceidx],scales[f'{mode}-face{f}'],im);_,ff,_,_=split(fi,up)
     for y in range(64):
      for x in range(64):
       if not mask.getpixel((x,y)):ff.putpixel((x,y),(0,0,0,0))
    groups[f'face_{f:02}'].append(ff)
    registration[f'{suffix}_{i}']['faces'][str(f)]=reg if f==1 or up else fr
  for prefix,frames in groups.items():
   role='body' if prefix=='player_human' else 'face' if prefix.startswith('face') else 'hair_back' if prefix.endswith('back') else 'hair_front';version=3 if role=='body' else 2 if '_01' in prefix else 1
   b.emit(prefix+'_'+suffix,frames,meta,role,version)
 (A/'manifest.json').write_text(json.dumps([Path(m['file']).stem+'.json' for fs,m in b.DATA.values()],indent=2)+'\n')
 (A/'source-registration.json').write_text(json.dumps({'scales':scales,'frames':registration},indent=2)+'\n')
 b.package_cels()
 print('Adapted',len(b.DATA),'sheets')
if __name__=='__main__':main()
