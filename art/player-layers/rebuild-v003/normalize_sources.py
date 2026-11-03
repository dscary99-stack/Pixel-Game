"""Extract generated pose components, retain a shared scale, pad source cells.
These are master components, not trimmed game frames. Game export stays 64×64.
"""
from PIL import Image
from pathlib import Path
import numpy as np,json
A=Path(__file__).resolve().parent/'masters'
def components(im):
 a=np.array(im.getchannel('A'));seen=np.zeros(a.shape,np.uint8);out=[];height,width=a.shape
 for y,x in zip(*np.where(a>=180)):
  if seen[y,x]:continue
  stack=[(int(x),int(y))];seen[y,x]=1;pts=[]
  while stack:
   xx,yy=stack.pop();pts.append((xx,yy))
   for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]:
    nx,ny=xx+dx,yy+dy
    if 0<=nx<width and 0<=ny<height and not seen[ny,nx] and a[ny,nx]>=180:seen[ny,nx]=1;stack.append((nx,ny))
  if len(pts)>1000:
   xs,ys=zip(*pts);box=(min(xs),min(ys),max(xs)+1,max(ys)+1);out.append((box,pts))
 return out
def run(filename,mode,cols,rows,count,scale=1,world=False):
 im=Image.open(A/filename).convert('RGBA');im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.NEAREST)
 blobs=sorted(components(im),key=lambda p:len(p[1]),reverse=True)[:count]
 if len(blobs)<count:
  # A source fringe touches its neighbour in one generated row. Separate at the
  # known source-column boundary; inspect/repair the resulting native contour.
  for col in range(1,cols):
   xx=round(col*im.width/cols)
   for yy in range(im.height):im.putpixel((xx,yy),(0,0,0,0))
  blobs=sorted(components(im),key=lambda p:len(p[1]),reverse=True)[:count]
 if len(blobs)!=count:raise ValueError((filename,len(blobs),count))
 blobs.sort(key=lambda p:(p[0][1]+p[0][3])/2)
 ordered=[]
 for r in range(rows):ordered+=sorted(blobs[r*cols:(r+1)*cols],key=lambda p:p[0][0])
 if world:ordered=ordered[24:56];rows=4
 out=Image.new('RGBA',(cols*256,rows*256));padded=Image.new('RGBA',(cols*384,rows*384));records=[]
 for i,(box,pts) in enumerate(ordered):
  cell=Image.new('RGBA',(256,256));dx=128-(box[0]+box[2])//2;dy=240-box[3]
  for x,y in pts:
   nx,ny=x+dx,y+dy
   if 0<=nx<256 and 0<=ny<256:cell.putpixel((nx,ny),im.getpixel((x,y)))
  x=i%cols;y=i//cols;out.alpha_composite(cell,(x*256,y*256));padded.alpha_composite(cell,(x*384+64,y*384+64));records.append({'sourceBox':box,'sourceScale':scale,'translation':[dx,dy]})
 out.save(A/f'{mode}-normalized.png');padded.save(A/f'{mode}-padded.png')
 (A/f'{mode}-registration.json').write_text(json.dumps(records,indent=2)+'\n')
 print(mode,len(ordered),flush=True)
if __name__=='__main__':
 run('battle-hair01.png','battle',6,5,28)
 run('head-atlas-draft.png','world',8,8,60,1.65,True)
