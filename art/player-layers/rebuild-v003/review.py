from pathlib import Path
from PIL import Image,ImageDraw
import json,re,hashlib
import draw_cels as b
A=b.A;OUT=A/'review';DATA={}
for n in json.loads((A/'manifest.json').read_text()):
 m=json.loads((b.ST/'metadata'/n).read_text());im=Image.open(b.ST/'sprites'/Path(m['file']).name).convert('RGBA');DATA[m['assetId']]=([im.crop((i*64,0,(i+1)*64,64)) for i in range(m['frameCount'])],m)
source=(b.R/'packages/shared/src/appearance.ts').read_text(encoding='utf-8-sig')
RAMPS={id:list(map(b.old.rgb,re.findall(r'#[a-f0-9]{6}',s))) for id,s in re.findall(r'id: "((?:skin|haircolor|eye):\d+)".*?ramp: \[([^\]]+)\]',source)}
def recolor(im,parts,skin=2,hair=3,eye=2):
 ramps={'skin':RAMPS[f'skin:{skin:02}'],'hair':RAMPS[f'haircolor:{hair:02}'],'eye':RAMPS[f'eye:{eye:02}'],'trim':list(map(b.old.rgb,['1a5a3a','3aa86a','8ae0a8']))}
 swap={k:v for part in parts for k,v in zip(b.KEY[part],ramps[part])};out=im.copy()
 for y in range(64):
  for x in range(64):
   p=im.getpixel((x,y))
   if p[3] and p[:3] in swap:out.putpixel((x,y),swap[p[:3]]+(255,))
 return out
def composite(s,i,h=1,f=1,skin=2,color=3,bald=False):
 out=b.blank()
 layers=['player_human_'] if bald else [f'hair_{h:02}_back_','player_human_',f'face_{f:02}_',f'hair_{h:02}_front_']
 for prefix in layers:
  fs,m=DATA[prefix+s];out.alpha_composite(recolor(fs[i],m['recolorParts'],skin,color))
 return out
def gif(fs,path,clip,z):
 pics=[]
 for f in fs:
  im=Image.new('RGBA',(64,64),'#14121c');im.alpha_composite(f);pics.append(im.convert('RGB').resize((64*z,64*z),Image.Resampling.NEAREST))
 durations=[10*(round((i+1)*100/clip['fps'])-round(i*100/clip['fps'])) for i in range(len(fs))]
 kw={'loop':0} if clip['loop'] else {}
 pics[0].save(path,save_all=True,append_images=pics[1:],duration=durations,disposal=2,**kw)
def main():
 suffixes=list(b.RIG);summary=Image.new('RGBA',(640,4*220),'#14121c');d=ImageDraw.Draw(summary)
 for h in range(1,5):
  y=(h-1)*220;d.text((8,y+4),f'Hair {h:02} / Faces 01-03',fill='white')
  for j,f in enumerate([1,2,3]):summary.alpha_composite(composite('battle_idle',0,h,f).resize((128,128),Image.Resampling.NEAREST),(j*128,y+20))
  for j,di in enumerate(['down','right','up','left']):summary.alpha_composite(composite('world_idle_'+di,0,h,1),(j*80,y+150))
  summary.alpha_composite(composite('battle_idle',0,h,1,bald=True).resize((128,128),Image.Resampling.NEAREST),(440,y+20))
 summary.convert('RGB').save(OUT/'styles.png')
 cards=[]
 for h in range(1,5):
  for f in range(1,4):
   for s in suffixes:
    fs,m=DATA['player_human_'+s];frames=[composite(s,i,h,f) for i in range(len(fs))];name=f'h{h:02}_f{f:02}_{s}'
    for z in [1,4]:gif(frames,OUT/f'{name}_{z}x.gif',m['animations'][0],z)
    cards.append({'hair':h,'face':f,'clip':s,'file':name})
  for mode in ['battle','world']:
   names=[s for s in suffixes if s.startswith(mode)];page=Image.new('RGBA',(400,len(names)*84),'#14121c');pd=ImageDraw.Draw(page)
   for row,s in enumerate(names):
    pd.text((2,row*84),s,fill='white')
    for i in range(len(DATA['player_human_'+s][0])):page.alpha_composite(composite(s,i,h,1),(i*64,row*84+18))
   page.resize((800,page.height*2),Image.Resampling.NEAREST).save(OUT/f'h{h:02}-{mode}-cels.png')
 table=Image.new('RGBA',(700,440),'#14121c');td=ImageDraw.Draw(table)
 for skin in range(1,7):
  td.text((0,skin*68-50),f'S{skin}',fill='white')
  for color in range(1,11):table.alpha_composite(composite('battle_idle',0,1,1,skin,color),(30+(color-1)*66,12+(skin-1)*68))
 table.save(OUT/'skin6-hair10.png')
 body=Image.new('RGBA',(400,14*80),'#ddd3c7');bd=ImageDraw.Draw(body)
 for row,s in enumerate(suffixes):
  bd.text((2,row*80),s,fill='#14121c')
  for i in range(len(DATA['player_human_'+s][0])):body.alpha_composite(composite(s,i,bald=True),(i*64,row*80+16))
 body.save(OUT/'bare-body.png')
 html='''<!doctype html><meta charset="utf-8"><title>Player layers — rebuild v003</title><style>body{background:#14121c;color:#fff0d0;font:16px system-ui;margin:24px}img{image-rendering:pixelated}section{display:flex;flex-wrap:wrap;gap:12px}figure{margin:8px}select,button{padding:10px;margin:6px}a{color:#91e9cc}p:has(select){position:sticky;top:0;background:#14121c;z-index:2;padding:8px}</style><h1>Player layers — rebuild v003</h1><p>New proof / not approved. 4 hairstyles × 3 faces. 1× and 4×, all 14 clips.</p><p>Hair <select id="hair"><option>1</option><option>2</option><option>3</option><option>4</option></select> Face <select id="face"><option>1</option><option>2</option><option>3</option></select><button id="replay">Replay</button></p><section id="clips"></section><h2>Style comparison</h2><img src="review/styles.png"><h2>Skin / hair colours</h2><img src="review/skin6-hair10.png"><p><a href="review/bare-body.png">Bare body / all frames</a></p><script>const cards='''+json.dumps(cards)+''';function show(){document.querySelector('#clips').innerHTML=cards.filter(c=>c.hair==document.querySelector('#hair').value&&c.face==document.querySelector('#face').value).map(c=>`<figure><figcaption>${c.clip}</figcaption><img src="review/${c.file}_1x.gif?t=${Date.now()}"><img src="review/${c.file}_4x.gif?t=${Date.now()}"></figure>`).join('')}document.querySelectorAll('select').forEach(s=>s.onchange=show);document.querySelector('#replay').onclick=show;show();</script>'''
 (A/'preview.html').write_text(html,encoding='utf-8')
 print('Rendered',len(cards)*2,'GIFs')
if __name__=='__main__':main()
