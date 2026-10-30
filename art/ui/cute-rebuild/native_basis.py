"""Native-size adaptation of approved cute visual masters; inspection required.
One fixed transform per clip, binary alpha, one shared palette, no shape substitution.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,math
R=Path(__file__).resolve().parent;O=R/'native-basis';O.mkdir(exist_ok=True)
records=[];allframes=[];groups=[]
def draft(name,source,size,grid=(1,1)):
 im=Image.open(R/'masters'/source).convert('RGBA');cols,rows=grid;cw,ch=im.width//cols,im.height//rows
 cells=[im.crop((x*cw,y*ch,(x+1)*cw,(y+1)*ch)) for y in range(rows) for x in range(cols)]
 bbs=[c.getchannel('A').point(lambda a:255 if a>=128 else 0).getbbox() for c in cells]
 bbs=[b for b in bbs if b];left=min(b[0] for b in bbs);top=min(b[1] for b in bbs);right=max(b[2] for b in bbs);bottom=max(b[3] for b in bbs)
 # Fixed union across every animation cel: shrinking effects must shrink in place.
 crop=(max(0,left-3),max(0,top-3),min(cw,right+3),min(ch,bottom+3));sw,sh=crop[2]-crop[0],crop[3]-crop[1]
 scale=min((size-2)/sw,(size-2)/sh);dw,dh=max(1,round(sw*scale)),max(1,round(sh*scale));offset=((size-dw)//2,(size-dh)//2)
 native=[]
 for c in cells:
  body=c.crop(crop).resize((dw,dh),Image.Resampling.NEAREST);body.putalpha(body.getchannel('A').point(lambda a:255 if a>=128 else 0));fr=Image.new('RGBA',(size,size));fr.paste(body,offset);native.append(fr);allframes.append(fr)
 groups.append((name,native));records.append(dict(name=name,source=source,nativeSize=[size,size],sourceGrid=list(grid),frameCount=len(native),fixedSourceCrop=crop,scale=scale,offset=offset,status='needs_visual_review'))
draft('item_small_potion','potion-master.png',32)
draft('ui_command_skill','fire-skill-master.png',24)
draft('ui_hit_fire','fire-sheet-master.png',32,(3,2))
colors=[p[:3] for fr in allframes for p in fr.getdata() if p[3]];strip=Image.new('RGB',(len(colors),1));strip.putdata(colors);pal=strip.quantize(colors=64,method=Image.Quantize.MEDIANCUT)
palette=pal.getpalette();(R/'palette-cute-64.json').write_text(json.dumps([palette[i:i+3] for i in range(0,192,3)],indent=2)+'\n')
board=Image.new('RGB',(1024,540),'#14121c');d=ImageDraw.Draw(board);font=ImageFont.load_default();d.text((20,12),'APPROVED CUTE STYLE / NATIVE-SIZE ADAPTATION',font=font,fill='#fff0bc')
for row,(name,frames) in enumerate(groups):
 native=[]
 for i,fr in enumerate(frames):
  a=fr.getchannel('A');out=fr.convert('RGB').quantize(palette=pal,dither=Image.Dither.NONE).convert('RGBA');out.putalpha(a);out.save(O/f'{name}-{i:02}.png');native.append(out)
 sheet=Image.new('RGBA',(native[0].width*len(native),native[0].height))
 for i,fr in enumerate(native):sheet.paste(fr,(i*fr.width,0))
 sheet.save(O/f'{name}_v002.png')
 y=55+row*155;d.text((20,y),name,font=font,fill='#fff0bc');board.paste(native[0],(20,y+24),native[0])
 for i,fr in enumerate(native):
  z=fr.resize((fr.width*4,fr.height*4),Image.Resampling.NEAREST);board.paste(z,(170+i*138,y),z)
 if len(native)>1:
  proof=[]
  for fr in native:
   bg=Image.new('RGBA',fr.size,'#14121c');bg.alpha_composite(fr);proof.append(bg.resize((256,256),Image.Resampling.NEAREST).convert('RGB'))
  proof[0].save(O/'fire-native-preview.gif',save_all=True,append_images=proof[1:]+[Image.new('RGB',(256,256),'#14121c')],duration=[100]*6+[700],loop=0,disposal=2)
board.save(O/'native-review.png');(O/'framing.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records))
