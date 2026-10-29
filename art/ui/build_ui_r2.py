"""Reproducible native UI round 2 artwork and proof; Python + Pillow.
Do not import this module: running it rebuilds its owned output files.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json, math, hashlib
from r2_motifs import P,O,canvas,poly,spark,gem,symbol,framed_symbol
ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'art/ui';OUT=ROOT/'apps/client/public/assets/sprites';META=ROOT/'apps/client/public/assets/metadata'
PRE=ART/'r2';PRE.mkdir(exist_ok=True)
C=json.loads((ART/'r2-content.json').read_text(encoding='utf-8'));A=[];CELLS={}
def emit(stem,frames,kind,loop=False,fps=10,extra=None,folder='ui'):
 w,h=frames[0].size;n=len(frames);assert all(f.size==(w,h) for f in frames)
 sheet=canvas(w*n,h)
 for i,f in enumerate(frames):sheet.paste(f,(i*w,0))
 (OUT/folder).mkdir(exist_ok=True);fn=stem+'_v001.png';path=OUT/folder/fn;sheet.save(path)
 a=dict(assetId=stem,version=1,status='grid_ready',file=f'/assets/sprites/{folder}/{fn}',frameWidth=w,frameHeight=h,columns=n,rows=1,frameCount=n,padding=0,spacing=0,origin=[0,0],groundOffset=0,directions=[],layers=['ui'],shadowAsset=None,animations=[dict(name='loop' if loop else 'pop' if kind=='popup' else 'play',frames=list(range(n)),fps=fps,loop=loop)] if n>1 else [],allowedFlip=dict(x=False,y=False),kind=kind,nineSlice=None,nativeSize=[w,h],staticFrame=0,productionApproved=False,verifiedDisplaySizes=[],proofDisplaySizes=[[w,h]],completion='repeat' if loop else 'hide' if n>1 else 'hold',sha256=hashlib.sha256(path.read_bytes()).hexdigest())
 if extra:a.update(extra)
 (META/(stem+'_v001.json')).write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');A.append(a);CELLS[stem]=frames
 if n>1:
  proof=Image.new('RGBA',(w*n*3,h*3),P['bg']);proof.alpha_composite(sheet.resize((w*n*3,h*3),Image.Resampling.NEAREST));proof.convert('RGB').save(PRE/(stem+'_strip.png'))
 return a

# 10x14 native ink from original 5x7 glyph recipes; no raster scaling.
DIGITS=['11111/10001/10011/10101/11001/10001/11111','00100/01100/00100/00100/00100/00100/01110','11110/00001/00001/01110/10000/10000/11111','11110/00001/00001/01110/00001/00001/11110','10010/10010/10010/11111/00010/00010/00010','11111/10000/10000/11110/00001/00001/11110','01111/10000/10000/11110/10001/10001/01110','11111/00001/00010/00100/01000/01000/01000','01110/10001/10001/01110/10001/10001/01110','01110/10001/10001/01111/00001/00001/11110','00000/00100/00100/11111/00100/00100/00000','00000/00000/00000/11111/00000/00000/00000']
for style,col in [('damage',P['white']),('crit',P['gold']),('heal',P['green']),('shield',P['blue'])]:
 for g,bits in zip(list('0123456789')+['plus','minus'],DIGITS):
  frames=[]
  for f,dy in enumerate([0,-3,-2,-1,0]):
   im=canvas(16,24);d=ImageDraw.Draw(im);pts=[(3+x*2,6+y*2+dy) for y,row in enumerate(bits.split('/')) for x,v in enumerate(row) if v=='1']
   for x,y in pts:d.rectangle((x-1,y-1,x+2,y+2),fill=O)
   for x,y in pts:d.rectangle((x,y,x+1,y+1),fill=P['cream'] if f==1 else col)
   if f==2:d.point((14,3),fill=col)
   frames.append(im)
  emit(f'ui_number_{style}_{g}',frames,'popup',extra=dict(glyph=g,style=style,advance=12,inkHeight=14,baseline=20,completion='hold-until-owner-removes',motion='readable -> rise 3px/flash -> settle; no scaling'))
for slug,word in [('dodge','หลบ'),('miss','MISS'),('critical','คริ!')]:
 font=ImageFont.truetype('C:/Windows/Fonts/tahoma.ttf',16);b=font.getbbox(word);mask=Image.new('1',(b[2]-b[0],b[3]-b[1]));ImageDraw.Draw(mask).text((-b[0],-b[1]),word,font=font,fill=1)
 frames=[];w=mask.width+8;h=max(24,mask.height+10)
 for f,dy in enumerate([0,-3,-2,-1,0]):
  im=canvas(w,h);im.paste(O,(3,7+dy),mask);im.paste(P['gold'] if slug=='critical' else P['white'],(3,6+dy),mask)
  if f==1:ImageDraw.Draw(im).point((w-2,3),P['cream'])
  frames.append(im)
 emit('ui_popup_'+slug,frames,'popup',extra=dict(text=word,fontSource='Windows Tahoma raster output; no font file distributed',completion='hold-until-owner-removes'))

ELEMENTS=dict(fire=('flame','red'),water=('drop','blue'),earth=('rock','brass'),wind=('wind','teal'),light=('star','gold'),shadow=('moon','purple'),neutral=('slash','white'))
for eid,(motif,color) in ELEMENTS.items():
 base=symbol(motif,P[color]);emit('ui_element_'+eid,[base],'element',extra=dict(contentId=eid.upper()));frames=[]
 for f in range(4):
  im=base.copy();d=ImageDraw.Draw(im)
  # Fixed readable body with shifting material highlight and local emissions.
  x,y=[(6,5),(9,6),(10,9),(7,11)][f];d.point((x,y),P['cream']);d.point([(2,2),(13,2),(13,13),(2,13)][f],P[color]);frames.append(im)
 emit('ui_element_'+eid+'_loop',frames,'element',True,8,dict(contentId=eid.upper(),staticAsset='ui_element_'+eid))
 frames=[]
 for f in range(6):
  im=canvas(32);d=ImageDraw.Draw(im);r=[5,9,12,13,13,12][f];col=P[color]
  if f<3:
   if eid=='neutral':
    poly(d,[(6,24),(12,13-f),(26,5),(21,16+f)],col);d.line((9,22,23,8),fill=P['cream'])
   elif eid=='fire':
    poly(d,[(8,22),(6,15),(11,17),(13,6-f),(18,12),(22,8),(25,17),(22,24),(15,26)],col);poly(d,[(12,22),(15,14),(20,22),(16,25)],P['gold'])
   elif eid=='light':
    pts=[]
    for k in range(16):
     ang=k*math.pi/8;rr=r if k%2==0 else max(2,r//3);pts.append((16+round(math.cos(ang)*rr),16+round(math.sin(ang)*rr)))
    poly(d,pts,col);gem(d,16,16,P['cream'],max(2,5-f))
   elif eid=='water':d.arc((16-r,18-r//2,16+r,18+r//2),0,320,fill=col,width=2)
   elif eid=='earth':
    for k in range(3):poly(d,[(8+k*6,22),(9+k*6,17-r//2-k),(13+k*6,14-r//3+k),(15+k*6,22)],col)
   elif eid=='wind':
    d.arc((16-r,16-r,16+r,16+r),20+f*40,210+f*40,fill=col,width=2);d.arc((20-r,14-r,20+r,14+r),180+f*30,310+f*30,fill=P['cream'])
   else:poly(d,[(16,3+f),(21,12),(28-f,16),(20,20),(16,29-f),(12,20),(4+f,16),(12,11)],col);gem(d,16,16,O,4)
  for k in range(6):
   ang=k*math.pi/3+.2;rr=4+f*2;x=16+round(math.cos(ang)*rr);y=16+round(math.sin(ang)*rr)+(max(0,f-3) if eid in ('earth','water') else 0)
   if f<5 or k%2==0:
    if eid=='water':d.line((x,y,x,y+max(1,3-f//2)),fill=col,width=2 if f<3 else 1)
    elif eid=='earth':d.rectangle((x,y,x+1,y+1),fill=col)
    elif eid=='shadow':d.line((x,y,x-1,y-2),fill=col)
    else:spark(d,x,y,P['cream'] if f==1 else col,1 if f<4 else 0)
  frames.append(im)
 emit('ui_hit_'+eid,frames,'hit',False,10,dict(element=eid.upper(),contactFrame=1,attachment=[16,16],completion='hide'))
frames=[]
for f in range(6):
 im=canvas(32);d=ImageDraw.Draw(im)
 for k in range(3 if f<4 else 2):
  x=8+k*8;y=23-f*3+(k%2)*3;r=3 if f<3 else 2 if f<5 else 1
  d.line((x-r,y,x+r,y),fill=P['green'],width=2 if f<4 else 1);d.line((x,y-r,x,y+r),fill=P['green'],width=2 if f<4 else 1);d.point((x,y),P['cream'])
 frames.append(im)
emit('ui_heal_burst',frames,'heal',False,10,dict(attachment=[16,24],completion='hide'))

# Synchronized top/back and bottom/front brackets accommodate variable actor height.
for name,col in [('selected',P['gold']),('turn_ally',P['teal']),('turn_enemy',P['red'])]:
 for half in ('back','front'):
  frames=[]
  for f in range(6):
   im=canvas(60,16);d=ImageDraw.Draw(im);bounds=(2,-9 if half=='front' else 3,57,12 if half=='front' else 24)
   d.arc(bounds,0 if half=='front' else 180,180 if half=='front' else 360,fill=O,width=4);d.arc(bounds,0 if half=='front' else 180,180 if half=='front' else 360,fill=col,width=2)
   ang=([.2,.65,1.1,1.55,1.1,.65][f])+(0 if half=='front' else math.pi);x=round(30+25*math.cos(ang));y=round((2 if half=='front' else 14)+10*math.sin(ang));spark(d,x,min(14,max(1,y)),P['cream'],1);frames.append(im)
  emit(f'ui_target_{name}_{half}',frames,'target',True,10,dict(assembly='split_vertical',part=half,attachment='actor-top-6' if half=='back' else 'actor-bottom-10',pair=f'ui_target_{name}',phaseSync=True,layoutWidth=60,noStretch=True))
frames=[]
for dy in [0,-1,-2,-3,-2,-1]:
 im=canvas(60,20);d=ImageDraw.Draw(im);poly(d,[(24,6+dy),(35,6+dy),(35,10+dy),(30,16+dy),(24,10+dy)],P['gold']);d.line((26,7+dy,33,7+dy),fill=P['cream']);frames.append(im)
emit('ui_target_arrow',frames,'target',True,10,dict(attachment='actor-top-20',noStretch=True))

SM={'stun':'star','sleep':'moon','freeze':'star','petrify':'rock','paralyze':'bolt','fear':'skull','silence':'mouth','disarm':'sword','root':'root','confuse':'wind','charm':'heart','berserk':'fist','taunt':'mouth','mini':'person','doom':'skull','poison':'drop','toxic':'skull','burn':'flame','bleed':'drop','frostbite':'star','shock':'bolt','corrode':'shield','leech':'heart','mana_burn':'flame','blind':'eye','atk':'sword','matk':'staff','def':'shield','mdef':'shield','spd':'boot','evasion':'wing','crit':'star','res':'shell','vulnerable':'shield','mark':'target','anti_heal':'heart','unbuffable':'star','seal':'lock','skill_lock':'staff','mp_cost_up':'bottle','link':'chain','zombie':'skull','wet':'drop','oil':'bottle','accuracy':'target','regen':'heart','mp_regen':'bottle','dmg_reduction':'shield','reflect':'shield','thorns':'root','immunity':'shell','endure':'fist','invincible':'crown','stealth':'eye','counter':'sword','protect':'shield','shield':'shield','focus':'eye','imbue':'sword','element_ward':'shell','lifesteal_up':'heart','rage':'flame'}
for s in C['statuses']:
 sid=s['id'];key=sid.removesuffix('_up').removesuffix('_down');motif=SM.get(sid,SM.get(key));assert motif,sid
 col=P['red'] if s['harmful'] else P['teal']
 if sid in ('freeze','frostbite','wet','mp_regen','mdef_up','mdef_down','matk_up','matk_down'):col=P['blue']
 if sid in ('poison','toxic','corrode'):col=P['green']
 if sid in ('sleep','fear','doom','mana_burn','seal','zombie'):col=P['purple']
 base=symbol(motif,col);d=ImageDraw.Draw(base)
 d.rectangle((10,10,15,15),fill=O);d.line((11,13,14,13),fill=P['red'] if s['harmful'] else P['teal'])
 if not s['harmful']:d.line((13,11,13,14),fill=P['teal'])
 if sid.endswith('_up') or sid.endswith('_down'):
  pts=[(1,8),(3,6),(5,8)] if sid.endswith('_up') else [(1,6),(3,8),(5,6)];d.line(pts,fill=P['cream'])
 if sid in ('silence','disarm','blind','anti_heal','unbuffable','skill_lock'):d.line((2,12,12,2),fill=O,width=3);d.line((2,12,12,2),fill=P['red'])
 if sid in ('petrify','corrode','vulnerable','frostbite'):d.line([(7,3),(5,7),(8,8),(6,11)],fill=O)
 if sid in ('mark','focus','reflect','counter','protect','immunity','element_ward'):gem(d,3,3,P['gold'],2)
 if sid in ('doom','toxic','rage','berserk'):d.line((3,0,11,0),fill=P['red'])
 # Specific semantic refinements for otherwise similar states.
 if sid=='shock':d.line([(1,3),(3,3),(3,5)],fill=P['gold'])
 if sid=='zombie':d.line((4,10,10,10),fill=P['green'])
 if sid=='leech':d.line([(2,3),(2,1),(6,1)],fill=P['purple'])
 if sid=='reflect':d.line([(7,2),(5,4),(7,6)],fill=P['cream'])
 if sid=='protect':d.line((6,9,10,9),fill=P['gold'],width=2)
 if sid=='element_ward':spark(d,8,7,P['purple'],2)
 if sid=='dmg_reduction':d.line((4,9,10,9),fill=O,width=2)
 if sid=='imbue':spark(d,3,3,P['purple'],2)
 if sid=='lifesteal_up':d.line((1,2,1,7),fill=P['red'],width=2)
 frames=[]
 for x,y in [(1,1),(13,1),(8,0),(1,4)]:
  im=base.copy();ImageDraw.Draw(im).point((x,y),P['cream']);frames.append(im)
 emit('ui_status_'+sid,frames,'status',True,8,dict(contentId=sid,harmful=s['harmful'],category=s['category'],motif=motif,polarityBadge='minus' if s['harmful'] else 'plus',motion='stable readable glyph; subtle 1px travelling glint'))

for h in (4,6,8):
 frames=[]
 for f in range(6):
  im=canvas(64,h);d=ImageDraw.Draw(im)
  for k in range(3):
   x=(5+k*21+f*3)%62+1;spark(d,x,max(1,h//2),P['cream'] if k==1 else P['purple'],1)
  frames.append(im)
 emit(f'ui_bar_ascend_full_h{h}',frames,'overlay',True,10,dict(attachment='overlay full ascend fill only',tileAxis='x',resize='repeat/crop horizontally; keep native pixels'))
for name,col in [('ascend',P['purple']),('skill',P['blue'])]:
 frames=[]
 perimeter=[(5,1),(40,1),(54,23),(50,46),(15,46),(1,23)]
 for f in range(6):
  im=canvas(56,48);d=ImageDraw.Draw(im);d.line([(5,1),(50,1),(54,5),(54,42),(50,46),(5,46),(1,42),(1,5),(5,1)],fill=col)
  for j in range(2):
   x,y=perimeter[(f+j*3)%6];spark(d,x,y,P['cream'],1)
  frames.append(im)
 emit('ui_ready_'+name,frames,'overlay',True,10,dict(attachment='56x48 command bounds; above button below label',noStretch=True))

MENUS={'stats':'person','equipment':'armor','skill_tree':'tree','class':'helmet','team':'paw','companion_skills':'chain','rebirth':'flame','shop':'coin','armory':'sword','craft':'hammer','vault':'chest','mail':'mail','market':'coin','quests':'scroll','orders':'scroll','secret_quests':'lock','tower':'tower','practice':'target','auto_hunt':'bow','party':'person','journal':'book'}
for sid,motif in MENUS.items():
 im=framed_symbol(motif,24,P['teal'] if sid in ('team','companion_skills','party') else P['gold']);d=ImageDraw.Draw(im)
 if sid=='market':d.line([(2,19),(6,22),(20,22),(22,19)],fill=P['teal'],width=2)
 if sid=='orders':gem(d,19,6,P['blue'],3)
 if sid=='party':im.alpha_composite(symbol('person',P['blue']),(0,6))
 emit('ui_menu_'+sid,[im],'menu',extra=dict(contentId=sid))
 if sid in ('mail','quests'):
  frames=[]
  for f in range(4):
   fr=im.copy();d=ImageDraw.Draw(fr);gem(d,19,4,P['red'],3);spark(d,19,4,P['cream'],1 if f%2 else 0);d.point([(16,1),(22,1),(22,7),(16,7)][f],P['gold']);frames.append(fr)
  emit('ui_menu_'+sid+'_new',frames,'menu',True,8,dict(contentId=sid,notification=True))
for sid,motif,col in [('guardian','shield','blue'),('striker','fist','red'),('ranger','bow','green'),('arcanist','staff','purple'),('warden','leaf','green'),('binder','chain','teal'),('rogue','mask','purple'),('alchemist','bottle','blue'),('bard','lyre','gold')]:emit('ui_class_'+sid,[framed_symbol(motif,32,P[col])],'class',extra=dict(contentId=sid))
for sid,motif,col in [('human','person','gold'),('sylvan','leaf','green'),('stonekin','rock','brass'),('wildkin','paw','red'),('runeborn','star','purple'),('tideborn','shell','teal'),('skyborn','wing','blue'),('veilborn','moon','purple')]:
 im=framed_symbol(motif,32,P[col]);d=ImageDraw.Draw(im);d.rectangle((6,23,8,25),P['cream']);d.rectangle((23,23,25,25),P['cream']);emit('ui_race_'+sid,[im],'race',extra=dict(contentId=sid))

def species_motif(s):return 'crab' if 'crab' in s else 'fox' if 'fox' in s else 'shell' if 'snail' in s else 'paw' if 'mole' in s else 'bell'
def item_art(rec,group):
 slug=rec['id'].split(':',1)[1];motif=None;col=P['gold'];tier=1
 if group=='sigils' or rec.get('kind')=='sigil':motif=species_motif(slug);col=P['purple']
 elif rec.get('kind')=='capture':motif=species_motif(slug);col=P['teal']
 elif group=='equipment':
  motif=next((m for k,m in [('sword','sword'),('bow','bow'),('staff','staff'),('wand','staff'),('dagger','sword'),('tunic','armor'),('armor','armor'),('plate','armor'),('cap','helmet'),('boots','boot'),('sandals','boot'),('shield','shield'),('buckler','shield'),('charm','star')] if k in slug),None)
  tier=min(5,rec.get('requiredLevel',1)//10+1);col=[P['brass'],P['green'],P['blue'],P['purple'],P['gold']][tier-1]
 elif 'scroll' in slug:motif='scroll';col=P['blue'] if 'skill' in slug else P['gold']
 elif 'feather' in slug:motif='feather';col=P['red'] if 'phoenix' in slug else P['gold']
 elif 'herb' in slug:motif='leaf';col=P['green']
 elif rec.get('kind') in ('heal','mana','support','attack'):
  motif='bottle' if 'bomb' not in slug else 'bolt';col=P['blue'] if rec['kind']=='mana' else P['red'] if rec['kind'] in ('heal','attack') else P['gold']
 else:
  motif=next((m for k,m in [('shell','shell'),('ash','flame'),('slime','drop'),('fur','paw'),('hide','paw'),('shard','star'),('pebble','rock'),('stone','rock'),('ward','shield'),('core','star'),('gem','star')] if k in slug),None)
  tier=next((i for i in range(1,5) if '_t'+str(i) in slug),1);col=[P['teal'],P['green'],P['blue'],P['purple']][tier-1]
 assert motif,rec['id'];im=framed_symbol(motif,32,col);d=ImageDraw.Draw(im)
 if rec.get('kind')=='capture':d.arc((3,3,28,28),20,160,fill=P['teal'],width=2);d.arc((3,3,28,28),200,340,fill=P['teal'],width=2)
 if group=='sigils' or rec.get('kind')=='sigil':
  for x,y in [(16,2),(29,16),(16,29),(2,16)]:gem(d,x,y,P['purple'],2)
 for i in range(tier):d.rectangle((9+i*3,26,10+i*3,27),fill=col)
 if slug.startswith('refine_ward_') and '_p' in slug:
  for i in range(int(slug.rsplit('_p',1)[1])-5):d.point((8+i*3,5),fill=P['cream'])
 if 'crystal_crab' in slug:gem(d,16,5,P['blue'],3)
 if 'elite_core' in slug:gem(d,16,5,P['red'],2)
 if 'rift_core' in slug:d.line((7,6,24,6),fill=P['purple'])
 if 'wild_gem' in slug:gem(d,6,6,P['gold'],2)
 if 'wand' in slug:d.line((11,23,14,23),fill=P['cream'])
 if slug=='river_pebble':d.line([(12,16),(16,14),(21,17)],fill=P['blue'],width=2)
 if slug=='ember_fang_dagger':d.line([(15,16),(21,10)],fill=P['red'],width=3);gem(d,9,24,P['red'],2)
 if slug=='crystal_shell_plate':gem(d,16,17,P['blue'],4);d.line((5,6,26,6),fill=P['blue'])
 if slug=='mole_sandals':d.line((14,18,21,18),fill=O,width=2);d.line((14,20,21,20),fill=P['cream'])
 if slug=='bell_feather_cap':d.line([(20,14),(24,6),(26,5)],fill=P['cream'],width=2)
 if slug=='crab_buckler':d.line([(11,17),(7,14),(6,10)],fill=P['red'],width=2);d.line([(20,17),(24,14),(25,10)],fill=P['red'],width=2)
 if slug in ('power_tonic','war_drum_tonic','fire_flask'):im.alpha_composite(symbol({'power_tonic':'sword','war_drum_tonic':'fist','fire_flask':'flame'}[slug],P['gold']),(15,15))
 return im,motif
for group in ('items','equipment','sigils'):
 for rec in C[group]:
  im,motif=item_art(rec,group);slug=rec['id'].split(':',1)[1];emit('item_'+slug,[im],'item',extra=dict(contentId=rec['id'],contentGroup=group,motif=motif),folder='items')

# Last-priority title, direct native re-authoring; large AI concept is not rescaled.
from r2_title import title_layers
title,twinkles=title_layers()
emit('ui_title_scene',[title],'title',extra=dict(logo='PIXEL GAME',logoStatus='working project title; replace when approved',source='native re-authoring inspired by art/ui/reference/title-concept-r2.png',layerOrder=0))
emit('ui_title_sparkles',twinkles,'title',True,8,dict(attachment=[0,0],layerOrder=1,baseAsset='ui_title_scene',motion='fixed glints and two closed firefly paths'))
titleproof=[]
for overlay in twinkles:
 fr=Image.new('RGBA',(580,540),P['bg']);fr.alpha_composite(title);fr.alpha_composite(overlay);titleproof.append(fr.convert('RGB'))
titleproof[0].save(PRE/'title-native.png')
titleproof[0].save(PRE/'title-loop.gif',save_all=True,append_images=titleproof[1:],duration=125,loop=0,disposal=2)

def finish():
 index=META/'index.json';old=json.loads(index.read_text());entries=[Path(a['file']).stem+'.json' for a in A];index.write_text(json.dumps(sorted(set(old+entries)),indent=2)+'\n')
 (ART/'ui-kit-r2-manifest.json').write_text(json.dumps(dict(baseCommit='2e8a8b8',count=len(A),assets=A),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 font=ImageFont.load_default()
 small=[a for a in A if a['kind']!='title']
 for page in range(math.ceil(len(small)/48)):
  subset=small[page*48:(page+1)*48];sheet=Image.new('RGB',(1200,math.ceil(len(subset)/6)*156),P['bg']);d=ImageDraw.Draw(sheet)
  for i,a in enumerate(subset):
   x=i%6*200;y=i//6*156;im=CELLS[a['assetId']][0];sheet.paste(im,(x+6,y+3),im);zoom=im.resize((im.width*3,im.height*3),Image.Resampling.NEAREST)
   if zoom.width<=144 and zoom.height<=110:sheet.paste(zoom,(x+50,y+3),zoom)
   elif zoom.width<=190 and zoom.height<=72:sheet.paste(zoom,(x+5,y+35),zoom)
   d.text((x+5,y+120),a['assetId'].removeprefix('ui_').removeprefix('item_')[:30],fill=P['cream'],font=font);d.text((x+5,y+135),f"{a['frameWidth']}x{a['frameHeight']} / {a['frameCount']}f",fill=P['light'],font=font)
  sheet.save(PRE/f'overview-{page+1:02}.png')
 # Exact frame timing; reduced-motion uses frame 0, no image interpolation.
 html='''<!doctype html><meta charset="utf-8"><title>UI round 2 animation proof</title><style>body{background:#14121c;color:#fff0bc;font:14px system-ui}main{display:flex;flex-wrap:wrap;gap:12px}article{background:#242033;padding:12px;width:210px;overflow:auto}canvas{image-rendering:pixelated;background:repeating-conic-gradient(#14121c 0% 25%,#30283f 0% 50%) 0/16px 16px;max-width:none}button{padding:8px}small{display:block}</style><h1>UI round 2 — animation proof</h1><button id="play">Pause / frame 0</button> <button id="restart">Replay once clips</button><p>Native and 3x nearest. Once clips hold last frame here for inspection; hide on completion in game. Game integration pending.</p><main></main><script>const assets=DATA;let paused=matchMedia('(prefers-reduced-motion: reduce)').matches,start=performance.now();document.querySelector('#play').onclick=()=>{paused=!paused;start=performance.now()};document.querySelector('#restart').onclick=()=>start=performance.now();for(const a of assets){const el=document.createElement('article'),c=document.createElement('canvas');c.width=a.frameWidth;c.height=a.frameHeight;c.style.width=(a.frameWidth*(a.frameWidth>100?1:3))+'px';el.append(c);const label=document.createElement('small');label.textContent=a.assetId+' — '+a.frameCount+' frames';el.append(label);document.querySelector('main').append(el);const ctx=c.getContext('2d'),img=new Image();img.src='../../../apps/client/public'+a.file;img.onload=()=>{function draw(t){const anim=a.animations[0],n=a.frameCount;let f=paused||!anim?0:Math.floor((t-start)*anim.fps/1000);f=anim?.loop?f%n:Math.min(f,n-1);ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(img,f*c.width,0,c.width,c.height,0,0,c.width,c.height);requestAnimationFrame(draw)}requestAnimationFrame(draw)}}</script>'''.replace('DATA',json.dumps(A,ensure_ascii=False)).replace('<\\/script>','</script>')
 (PRE/'preview.html').write_text(html,encoding='utf-8');print(json.dumps(dict(assets=len(A),animated=sum(a['frameCount']>1 for a in A),frames=sum(a['frameCount'] for a in A))))
finish()
