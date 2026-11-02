from PIL import Image,ImageDraw
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];A=R/'art/player-layers'
files=sorted((R/'apps/client/public/assets/metadata').glob('player_human_*_v001.json'))
canvas=Image.new('RGB',(960,len(files)*150),'#14121c');d=ImageDraw.Draw(canvas)
for row,path in enumerate(files):
 m=json.loads(path.read_text());im=Image.open(R/'apps/client/public'/m['file'].lstrip('/'));d.text((2,row*150),m['assetId'],fill='white')
 for i in range(m['frameCount']):
  f=im.crop((64*i,0,64*i+64,64));canvas.paste(f.resize((128,128),Image.Resampling.NEAREST),(i*156,row*150+18),f.resize((128,128),Image.Resampling.NEAREST));d.text((i*156+110,row*150+18),str(i),fill='yellow')
canvas.save(A/'review/source-poses.png')
