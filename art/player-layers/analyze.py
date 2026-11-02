from PIL import Image,ImageFilter
from pathlib import Path
import json,colorsys
R=Path(__file__).resolve().parents[2]
def headbox(f,state):
 mask=Image.new('L',(64,64));p=mask.load()
 for y in range(64 if state=='ko' else 38):
  for x in range(64):
   r,g,b,a=f.getpixel((x,y));h,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
   if a and 0.025<h<.19 and s>.19 and v>.35:p[x,y]=255
 mask=mask.filter(ImageFilter.MaxFilter(3));seen=set();groups=[]
 for y in range(64):
  for x in range(64):
   if (x,y) in seen or not mask.getpixel((x,y)):continue
   q=[(x,y)];seen.add((x,y));pts=[]
   while q:
    xx,yy=q.pop();pts.append((xx,yy))
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
     v=(xx+dx,yy+dy)
     if 0<=v[0]<64 and 0<=v[1]<64 and v not in seen and mask.getpixel(v):seen.add(v);q.append(v)
   groups.append(pts)
 pts=max(groups,key=len);return [min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts)+1,max(y for x,y in pts)+1]
if __name__=='__main__':
 out={}
 for path in sorted((R/'apps/client/public/assets/metadata').glob('player_human_*_v001.json')):
  m=json.loads(path.read_text());im=Image.open(R/'apps/client/public'/m['file'].lstrip('/')).convert('RGBA');state=m['animations'][0]['name']
  out[m['assetId'].replace('player_human_','')]=[headbox(im.crop((i*64,0,i*64+64,64)),state) for i in range(m['frameCount'])]
 print(json.dumps(out,indent=2));(R/'art/player-layers/source/head-regions.json').write_text(json.dumps(out,indent=2))
