"""Illustrated motif families and authored small UI motion for the cute rebuild."""
from PIL import Image,ImageDraw,ImageFont
import math,colorsys,re,json
def run(ctx):
 R,byname,jobs,add,blank=(ctx[k] for k in ('R','byname','jobs','add','blank'))
 def done(n):return any(j[0]==n for j in jobs)
 def icon(m,w,h=None):
  h=h or w
  if m in ('moon','bolt'):
   out=blank(w,h);d=ImageDraw.Draw(out)
   if m=='moon':
    d.ellipse((2,1,w-3,h-2),fill='#4c375f');d.ellipse((3,1,w-3,h-3),fill='#eebd88');d.ellipse((4,2,w-4,h-4),fill='#fff0c3');d.ellipse((w//2,0,w,h-6),fill=(0,0,0,0))
   else:
    pts=[(w//2,1),(w-3,1),(w//2+1,h//2-1),(w-3,h//2-1),(3,h-2),(w//2-1,h//2+1),(2,h//2+1)];d.polygon(pts,fill='#5a3b5d');d.line(pts+[pts[0]],fill='#5a3b5d',width=2);d.polygon(pts,fill='#f8bf74');d.line((w//2+1,2,w//2-1,h//2),fill='#fff1c5',width=2)
   return out
  aliases={'bottle':'potion','helmet':'cap','root':'leaf','mouth':'person','lock':'bag','rock':'stone','flame':'fire','drop':'water','star':'light','slash':'neutral'}
  m=aliases.get(m,m);p=R/'masters'/(m+'-master.png');sheet=False
  if not p.exists():p=R/'masters'/(m+'-sheet-master.png');sheet=True
  if not p.exists():return None
  im=Image.open(p).convert('RGBA')
  if sheet:
   # The light opening spark is intentionally tiny in the VFX. Use its peak
   # source cel for a legible standalone element/status emblem.
   cell=1 if m=='light' else 0;cw=im.width//3
   im=im.crop((cell*cw,0,(cell+1)*cw,im.height//2))
  box=im.getchannel('A').point(lambda v:255 if v>=128 else 0).getbbox()
  if not box:return None
  im=im.crop(box);s=min((w-2)/im.width,(h-2)/im.height);im=im.resize((max(1,round(im.width*s)),max(1,round(im.height*s))),Image.Resampling.NEAREST);im.putalpha(im.getchannel('A').point(lambda v:255 if v>=128 else 0));out=blank(w,h);out.paste(im,((w-im.width)//2,(h-im.height)//2));return out
 def tint(im,angle):
  out=im.copy();px=[]
  for r,g,b,a in im.getdata():
   hh,ss,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
   if ss>.25 and v>.25:hh=(hh+angle)%1
   nr,ng,nb=colorsys.hsv_to_rgb(hh,ss,v);px.append((round(nr*255),round(ng*255),round(nb*255),a))
  out.putdata(px);return out
 def spark(d,x,y,c,r=1):d.line((x-r,y,x+r,y),fill=c);d.line((x,y-r,x,y+r),fill=c)
 def subtle(base,n=4,notice=False):
  fs=[];w,h=base.size
  for i in range(n):
   f=base.copy();d=ImageDraw.Draw(f)
   if notice:
    d.ellipse((w-8,1,w-2,7),fill='#ed859c',outline='#3b294f');spark(d,w-5,4,'#fff4ce',1 if i in (1,2) else 0)
   else:
    points=[(w//3,2),(w//3+1,2),(w//3+1,3),(w//3,3)];x,y=points[i%4]
    if f.getpixel((x,y))[3]:d.point((x,y),fill=['#fff3ce','#ffdfb1','#e8b9be','#c59bc8'][i%4])
    else:d.point([(w-3,1),(w-2,2),(w-3,3),(w-4,2)][i%4],fill='#fff3ce')
   fs.append(f)
  return fs
 menus={'stats':'person','equipment':'armor','skill_tree':'tree','class':'cap','team':'paw','companion_skills':'chain','rebirth':'fire','shop':'coin','armory':'sword','craft':'hammer','vault':'chest','mail':'mail','market':'coin','quests':'scroll','orders':'scroll','secret_quests':'bag','tower':'tower','practice':'target','auto_hunt':'bow','party':'person','journal':'book','character':'person','companion':'paw','inventory':'bag','activities':'scroll','social':'person'}
 classes=dict(guardian='shield',striker='fist',ranger='bow',arcanist='staff',warden='leaf',binder='chain',rogue='mask',alchemist='potion',bard='lyre')
 races=dict(human='person',sylvan='leaf',stonekin='stone',wildkin='paw',runeborn='crystal',tideborn='shell',skyborn='wing',veilborn='moon')
 for n,a in byname.items():
  if done(n):continue
  m=None;w,h=a['frameWidth'],a['frameHeight'];notice=False
  if n.startswith('ui_menu_'):
   sid=n.removeprefix('ui_menu_');notice=sid.endswith('_new');sid=sid.removesuffix('_new');m=menus.get(sid)
  elif n.startswith('ui_class_'):m=classes[n.removeprefix('ui_class_')]
  elif n.startswith('ui_race_'):m=races[n.removeprefix('ui_race_')]
  elif n.startswith('ui_element_'):m=n.removeprefix('ui_element_').removesuffix('_loop')
  elif n.startswith('ui_status_'):m={'freeze':'crystal','frostbite':'crystal','doom':'clock','seal':'ward','element_ward':'ward'}.get(a['contentId'],a['motif'])
  elif n.startswith('item_'):m=a['motif']
  elif n=='ui_command_ascend':m='crystal'
  if not m:continue
  if n.startswith('item_') and (a.get('contentGroup')=='sigils' or n.endswith(('_capture','_sigil'))):
   m=next((v for k,v in [('crystal_crab','crystalcrab'),('armor_crab','crab'),('ember_fox','fox'),('lantern_snail','snail'),('supply_mole','mole'),('bell_bird','bird')] if k in n),m)
  elif n.startswith('item_'):
   m=next((v for k,v in [('hide','hide'),('fur','hide'),('pebble','stone'),('refine_stone','stone'),('slime','slime'),('ash','ash'),('refine_ward','ward'),('bomb','bomb'),('core','crystal'),('gem','crystal'),('shard','crystal')] if k in n),m)
  im=icon(m,w,h)
  if im is None:continue
  if n.startswith('ui_status_'):
   sid=a['contentId'];harm=a['harmful'];im=tint(im,.04 if harm else 0);d=ImageDraw.Draw(im)
   # Explicit polarity badge remains legible at16px, separate from the illustration.
   d.rectangle((11,11,15,15),fill='#30213e');d.line((12,13,14,13),fill='#ff98a6' if harm else '#a7e8bb')
   if not harm:d.line((13,12,13,14),fill='#a7e8bb')
   if sid.endswith(('_up','_down')):
    up=sid.endswith('_up');d.polygon([(1,4 if up else 1),(3,1 if up else 4),(5,4 if up else 1)],fill='#a7e8bb' if up else '#ff98a6')
   if sid in ('silence','disarm','blind','anti_heal','seal','skill_lock','unbuffable'):d.line((2,12,12,2),fill='#30213e',width=3);d.line((2,12,12,2),fill='#ff98a6')
   if sid in ('toxic','doom'):im=tint(im,.14)
   if sid in ('freeze','frostbite'):im=tint(im,-.04)
   if sid in ('poison','corrode'):im=tint(im,.25)
   if sid=='bleed':im=tint(im,.45)
   if sid in ('burn','rage'):im=tint(im,-.08)
   d=ImageDraw.Draw(im)
   if sid in ('root','thorns'):
    d.line([(3,7),(4,10),(1,14)],fill='#8e654f');d.line([(4,10),(7,14)],fill='#8e654f');d.point((2,12),fill='#fff0c3')
   if sid=='reflect':d.line((2,10,8,4),fill='#fff0c3',width=2)
   if sid=='protect':d.polygon([(1,4),(2,2),(4,3),(6,2),(7,4),(4,7)],fill='#ff9fa9')
   if sid=='shield':d.line((1,1,7,1),fill='#a6e4f5',width=2)
   if sid=='mdef_up' or sid=='mdef_down':spark(d,3,3,'#d7b2f2',2)
   if sid=='dmg_reduction':d.line((1,3,7,3),fill='#fff0c3');d.line((2,5,6,5),fill='#fff0c3')
   if sid=='counter':d.arc((0,0,8,7),160,350,fill='#ffd58f',width=1);d.polygon([(6,1),(8,3),(5,3)],fill='#ffd58f')
   if sid=='lifesteal_up':d.line((1,1,1,5),fill='#fff0c3');d.line((5,1,5,5),fill='#fff0c3')
   if sid=='focus':d.rectangle((1,1,7,5),outline='#ffe3a7')
   if sid=='stealth':d.line((1,7,8,7),fill='#574361',width=2)
   if sid=='wet':d.ellipse((1,1,3,4),fill='#a4e6f1')
   if sid=='shock':spark(d,3,3,'#bdeaf8',1)
   if sid=='mana_burn':spark(d,3,3,'#a4e6f1',1)
   if sid=='rage':d.polygon([(1,5),(3,1),(5,5)],fill='#ffb488')
   if sid=='oil':d.rectangle((1,1,4,4),fill='#61496a')
   if sid=='mp_cost_up':d.polygon([(1,5),(3,1),(5,5)],fill='#a8e8f5')
   if sid=='taunt':d.line((1,1,4,1),fill='#fff0c3');d.point((5,3),fill='#fff0c3')
   if sid=='mini':
    mini=icon('person',9);im=blank(w,h)
    if mini:im.paste(mini,(2,6));d=ImageDraw.Draw(im);d.polygon([(1,1),(5,1),(3,4)],fill='#ffa6ae');d.line((12,13,14,13),fill='#ffa6ae')
  if n.startswith('item_'):
   tier=re.search(r'(?:_t|_lv)(\d+)',n) or (re.search(r'_(\d+)$',n) if n.startswith('item_shop_') else None);t=int(tier.group(1)) if tier else 1;t=min(5,t//10+1) if t>=10 else t
   if t>1:im=tint(im,[0,0,.17,.43,.65,0][min(t,5)])
   if 'mana_potion' in n:im=tint(im,.55)
   if 'power_tonic' in n or 'war_drum' in n:im=tint(im,.12)
   if 'skill_reset' in n:im=tint(im,.48)
   d=ImageDraw.Draw(im)
   if tier:
    for i in range(min(t,5)):d.rectangle((3+i*3,h-3,4+i*3,h-2),fill='#ffe4ac')
   strength=re.search(r'_p(\d+)',n)
   if strength:
    for i in range(int(strength.group(1))-5):d.rectangle((3+i*4,1,4+i*4,2),fill='#fff4ce')
   if n.endswith('_capture'):d.arc((1,1,w-2,h-2),25,155,fill='#7cdec7',width=1);d.arc((1,1,w-2,h-2),205,335,fill='#7cdec7',width=1)
   if a.get('contentGroup')=='sigils' or n.endswith('_sigil'):
    for x,y in [(2,2),(w-3,2),(2,h-3),(w-3,h-3)]:spark(d,x,y,'#c4a1ec')
  if n in ('ui_menu_party','ui_menu_social'):
   little=icon('person',12);im=blank(w,h)
   if little:im.alpha_composite(little,(1,8));im.alpha_composite(tint(little,.38),(11,8))
  if n=='ui_menu_market':ImageDraw.Draw(im).line((3,h-2,w-4,h-2),fill='#83d7bf',width=2)
  if n=='ui_menu_orders':spark(ImageDraw.Draw(im),w-5,4,'#9ed8fb',2)
  fs=subtle(im,a['frameCount'],notice) if a['frameCount']>1 else [im]
  add(n,fs,'illustrated master family '+m+'; native modifiers in extras.py')

 # Numerals keep original legible glyph shapes, new pastel enamel/shadow and authored pop.
 for n,a in byname.items():
  if a['kind']!='popup' or done(n):continue
  w,h=a['frameWidth'],a['frameHeight'];source=Image.open(ctx['PUBLIC']/a['file'].lstrip('/')).convert('RGBA').crop((0,0,w,h))
  mask=source.getchannel('A');fs=[];style=a.get('style','crit' if 'critical' in n else 'damage');col=dict(damage='#fff0d4',crit='#ffc976',heal='#9be0b2',shield='#a5d9f5')[style]
  # Extract foreground from old bitmap, retaining glyph proportions and Thai shaping only.
  ink=Image.new('1',(w,h));ip=ink.load()
  for y in range(h):
   for x in range(w):
    r,g,b,aa=source.getpixel((x,y))
    if aa and max(r,g,b)>80:ip[x,y]=1
  for i,dy in enumerate([0,-2,-3,-1,0]):
   fr=blank(w,h)
   for dx,ddy in [(-1,0),(1,0),(0,-1),(0,1),(1,2)]:fr.paste('#3d294f',(dx,dy+ddy),ink)
   fr.paste('#fff7dc' if i==1 else col,(0,dy),ink)
   if i in (1,2,3):spark(ImageDraw.Draw(fr),w-2,2+i,'#fff0c2',0)
   fs.append(fr)
  add(n,fs,'original glyph geometry; new native enamel pop in extras.py')

 for n,a in byname.items():
  if done(n):continue
  w,h=a['frameWidth'],a['frameHeight'];fs=[]
  if n=='ui_command_auto':
   im=blank(w,h);d=ImageDraw.Draw(im);d.arc((3,3,20,20),200,355,fill='#adebd2',width=3);d.arc((3,3,20,20),20,175,fill='#dfb5f2',width=3);d.polygon([(19,3),(22,9),(16,8)],fill='#adebd2');d.polygon([(2,15),(8,16),(5,21)],fill='#dfb5f2');d.polygon([(10,8),(16,12),(10,16)],fill='#ffe3ac');fs=[im]
  elif n.startswith(('ui_target_','ui_turn_')):
   color='#a1e5cb' if 'ally' in n else '#f5a1b6' if 'enemy' in n else '#ffdc95'
   for i in range(a['frameCount']):
    im=blank(w,h);d=ImageDraw.Draw(im)
    if 'arrow' in n:
     yy=[0,1,2,2,1,0][i];d.polygon([(24,3+yy),(35,3+yy),(35,8+yy),(40,8+yy),(30,16+yy),(20,8+yy),(24,8+yy)],fill='#382344');d.polygon([(26,4+yy),(33,4+yy),(33,10+yy),(36,10+yy),(30,14+yy),(24,10+yy),(26,10+yy)],fill=color);d.line((27,5+yy,32,5+yy),fill='#fff4d5')
    else:
     back=n.endswith('back');start,end=(180,360) if back else (0,180);d.arc((2,1,57,14),start,end,fill='#34213e',width=4);d.arc((3,2,56,13),start,end,fill=color,width=2)
     ang=math.radians(start+20+i*24);x=round(29.5+26*math.cos(ang));y=round(7.5+5.5*math.sin(ang));spark(d,x,y,'#fff4d5',1)
    fs.append(im)
  elif n.startswith('ui_ready_') or n.startswith('ui_bar_ascend_full_'):
   for i in range(a['frameCount']):
    im=blank(w,h);d=ImageDraw.Draw(im)
    if n.startswith('ui_ready_'):
     d.rounded_rectangle((1,1,w-2,h-2),radius=8,outline='#c4a1ec' if 'ascend' in n else '#a4dfed',width=1)
     points=[(9,1),(w//2,1),(w-3,8),(w-10,h-2),(w//2,h-2),(2,h-9)]
     for j in (i,(i+3)%6):spark(d,*points[j],'#fff0bc',1)
    else:
     for j in range(3):spark(d,(3+j*21+i*3)%(w-2)+1,h//2,'#fff0bc' if j==1 else '#dfb4f7',1)
    fs.append(im)
  if fs:add(n,fs,'native authored motion in extras.py')

 # Preserve the actual generated title illustration; logo and sparkles are separate authored pixels.
 p=R/'masters/title-master.png'
 if p.exists():
  src=Image.open(p).convert('RGBA');bbox=src.getchannel('A').point(lambda v:255 if v>=128 else 0).getbbox();src=src.crop(bbox)
  ratio=min(540/src.width,440/src.height);dw,dh=round(src.width*ratio),round(src.height*ratio);src=src.resize((dw,dh),Image.Resampling.NEAREST);src.putalpha(src.getchannel('A').point(lambda v:255 if v>=128 else 0))
  scene=blank(580,540);scene.paste(src,((580-dw)//2,90+(440-dh)//2));d=ImageDraw.Draw(scene)
  glyphs={'P':['11110','10001','10001','11110','10000','10000','10000'],'I':['111','010','010','010','010','010','111'],'X':['10001','10001','01010','00100','01010','10001','10001'],'E':['11111','10000','10000','11110','10000','10000','11111'],'L':['10000','10000','10000','10000','10000','10000','11111'],'G':['01111','10000','10000','10111','10001','10001','01110'],'A':['01110','10001','10001','11111','10001','10001','10001'],'M':['10001','11011','10101','10101','10001','10001','10001']}
  text='PIXEL GAME';unit=5;width=sum((len(glyphs[c][0])+1)*unit if c!=' ' else 3*unit for c in text)-unit;x=(580-width)//2;pts=[]
  for ch in text:
   if ch==' ':x+=3*unit;continue
   for yy,row in enumerate(glyphs[ch]):
    for xx,b in enumerate(row):
     if b=='1':pts.append((x+xx*unit,24+yy*unit,yy))
   x+=(len(glyphs[ch][0])+1)*unit
  for x,y,yy in pts:d.rectangle((x-2,y-2,x+unit+1,y+unit+4),fill='#382744')
  for x,y,yy in pts:d.rectangle((x,y,x+unit-1,y+unit-1),fill='#fff1c5' if yy<2 else '#f5bf77' if yy<5 else '#d89170')
  add('ui_title_scene',[scene],'title-master.png + native original bitmap logo',dict(fixedCrop=bbox,scale=ratio,offset=[(580-dw)//2,90+(440-dh)//2]))
  fs=[]
  for i in range(6):
   fr=blank(580,540);d=ImageDraw.Draw(fr)
   for j,(x,y) in enumerate([(78,129),(430,116),(500,220),(91,363),(329,290),(420,432)]):
    radius=[1,2,3,2,1,0][(i+j)%6];spark(d,x,y,'#fff0bd',radius)
   fs.append(fr)
  add('ui_title_sparkles',fs,'native six-cel sparkle loop in extras.py')
