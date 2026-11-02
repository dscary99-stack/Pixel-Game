"""Build native animation review walls and a 10fps VFX montage, outside public."""
from pathlib import Path
import json
from PIL import Image,ImageDraw,ImageFont
R=Path(__file__).resolve().parents[2];ART=R/'art/ui';PRE=ART/'r2';PUB=R/'apps/client/public';BG='#14121c'
assets=json.loads((ART/'ui-kit-r2-manifest.json').read_text(encoding='utf-8'))['assets'];font=ImageFont.load_default()
clips=[a for a in assets if a['frameCount']>1 and a['kind']!='title']
for page in range((len(clips)+23)//24):
 part=clips[page*24:(page+1)*24];im=Image.new('RGB',(1200,((len(part)+2)//3)*112),BG);d=ImageDraw.Draw(im)
 for j,a in enumerate(part):
  x=j%3*400;y=j//3*112;src=Image.open(PUB/a['file'].lstrip('/'));d.text((x+5,y+5),a['assetId'],font=font,fill='#fff0bc');im.paste(src,(x+5,y+25),src)
  d.text((x+5,y+83),str(a['frameCount'])+' frames / '+str(a['animations'][0]['fps'])+' fps / '+('loop' if a['animations'][0]['loop'] else 'once'),font=font,fill='#b9a7bf')
 im.save(PRE/f'animation-wall-{page+1:02}.png')
effects=[a for a in assets if a['kind'] in ('hit','heal')];frames=[]
for f in range(12):
 im=Image.new('RGB',(640,256),BG);d=ImageDraw.Draw(im)
 for j,a in enumerate(effects):
  x=j%4*160;y=j//4*128;d.text((x+8,y+106),a['assetId'],font=font,fill='#fff0bc')
  if f<6:
   sheet=Image.open(PUB/a['file'].lstrip('/'));cel=sheet.crop((f*32,0,(f+1)*32,32)).resize((96,96),Image.Resampling.NEAREST);im.paste(cel,(x+32,y+5),cel)
 frames.append(im)
frames[0].save(PRE/'vfx-playback.gif',save_all=True,append_images=frames[1:],duration=100,loop=0,disposal=2)
# Loop repeats are only a review montage; actual effects are once + hide.
# Normalize the generated preview's literal script terminator and native scale.
p=PRE/'preview.html';s=p.read_text(encoding='utf-8').replace('<\\/script>','</script>').replace('max-width:200px','max-width:none').replace('overflow:hidden','overflow:auto').replace("(a.frameWidth*3)+'px'","(a.frameWidth*(a.frameWidth>100?1:3))+'px'")
p.write_text(s,encoding='utf-8')
