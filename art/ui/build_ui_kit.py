"""Rebuild original native UI proof. Python 3.10+ / Pillow; no game code."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'apps/client/public/assets/sprites/ui'
META = ROOT/'apps/client/public/assets/metadata'
ART = ROOT/'art/ui'
for folder in (OUT,META,ART): folder.mkdir(parents=True,exist_ok=True)
P = dict(bg='#14121c', outline='#0c0b14', panel='#242033', rim='#625770',
         light='#b9a7bf', brass='#bc8851', gold='#efc477', cream='#fff0bc',
         teal='#4fc5b0', blue='#5c9ded', purple='#be82e9', red='#e26779',
         green='#72bf83', muted='#797383', white='#e4e6ec')
assets=[]
images={}
def canvas(w,h): return Image.new('RGBA',(w,h))
def polygon(d,pts,fill,outline=P['outline']):
    d.polygon(pts,fill=fill)
    if outline: d.line(pts+[pts[0]],fill=outline,width=1)
def gem(d,x,y,color):
    polygon(d,[(x,y-2),(x+2,y),(x,y+2),(x-2,y)],color)
def panel(size,fill,rim,hi,ornament=False,inset=False):
    w,h=size;im=canvas(w,h);d=ImageDraw.Draw(im)
    pts=[(4,0),(w-5,0),(w-1,4),(w-1,h-5),(w-5,h-1),(4,h-1),(0,h-5),(0,4)]
    polygon(d,pts,P['outline'])
    polygon(d,[(4,2),(w-5,2),(w-3,4),(w-3,h-5),(w-5,h-3),(4,h-3),(2,h-5),(2,4)],rim,None)
    d.rectangle((4,4,w-5,h-5),fill)
    d.line([(5,h-5),(w-5,h-5),(w-5,5)],fill=P['outline'],width=1)
    d.line([(4,h-6),(4,4),(w-6,4)],fill=hi if not inset else P['outline'],width=1)
    d.line([(6,6),(w-7,6)],fill=hi if not inset else rim,width=1)
    if ornament:
        for x,y,sx,sy in [(7,7,1,1),(w-8,7,-1,1),(7,h-8,1,-1),(w-8,h-8,-1,-1)]:
            d.line([(x,y+5*sy),(x,y),(x+5*sx,y)],fill=P['brass'],width=2)
            gem(d,x+2*sx,y+2*sy,P['gold'])
    return im
def save(piece,variant,im,kind='icon',slice_=None,extra=None):
    stem=f'ui_{piece}_{variant}_v001'; fn=stem+'.png'; im.save(OUT/fn)
    w,h=im.size
    record=dict(assetId='ui:'+piece+':'+variant,version=1,status='grid_ready',
        file='/assets/sprites/ui/'+fn,frameWidth=w,frameHeight=h,columns=1,rows=1,
        frameCount=1,padding=0,spacing=0,origin=[0,0],groundOffset=0,directions=[],
        layers=['ui'],shadowAsset=None,animations=[],allowedFlip={'x':False,'y':False},
        kind=kind,nineSlice=slice_,paletteVariants=[],nativeSize=[w,h],
        verifiedDisplaySizes=[],proofDisplaySizes=[[w,h]],productionApproved=False)
    if extra:record.update(extra)
    record['sha256']=hashlib.sha256((OUT/fn).read_bytes()).hexdigest()
    (META/(stem+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    assets.append(record);images[stem]=im
    return stem
s16=dict(left=16,right=16,top=16,bottom=16,minWidth=33,minHeight=33)
save('window','frame',panel((48,48),P['panel'],P['rim'],P['light'],True),'nine_slice',s16)
fill=canvas(48,48);fill.paste(P['panel'],(0,0,48,48))
save('window','background',fill,'fill',None,{'resize':'nearest-stretch'})
save('window','title',panel((48,48),'#30283f',P['rim'],P['brass'],True),'nine_slice',s16,{'contentInsets':[16,12,16,12]})
button_styles={
 'normal':('#302c43',P['rim'],P['light'],False),
 'selected':('#163d48',P['teal'],'#93e3cc',True),
 'primary':('#6a492d',P['gold'],P['cream'],False),
 'disabled':('#292733','#494653','#67626e',False),
 'danger':('#512435','#bd5a6a','#f4a18e',False)}
for state,(f,r,h,inset) in button_styles.items():
    save('button',state,panel((64,48),f,r,h,state!='disabled',inset),'nine_slice',
        dict(left=16,right=16,top=16,bottom=16,minWidth=33,minHeight=48),
        {'recommendedHeight':48,'minimumTouchHeight':48,'contentInsets':[16,10,16,10],
         'textOffset':[0,1 if inset else 0]})
rarities={'common':'#9a99ab','uncommon':'#72bf83','rare':'#5c9ded','epic':'#be82e9','legendary':'#efad57'}
for size in (48,64):
 for rank,(rarity,col) in enumerate(rarities.items(),1):
    im=panel((size,size),'#1c1928',col,col)
    d=ImageDraw.Draw(im)
    # Rarity markers provide a non-color cue; never baked quantity text.
    start=size//2-rank*2+1
    for i in range(rank):d.rectangle((start+i*4,3,start+i*4+1,4),P['cream'])
    d.line((7,7,7,size-8),fill='#342d43')
    d.line((7,7,size-8,7),fill='#342d43')
    save('slot',f'{size}_{rarity}',im,'slot',extra={'rarity':rarity.upper(),'contentRect':[8,8,size-16,size-16],'lockOffset':[size-18,size-18],'quantityText':'runtime-bottom-right; move when locked'})
im=canvas(16,16);d=ImageDraw.Draw(im)
d.rectangle((4,1,11,9),P['outline']);d.rectangle((5,2,10,8),P['gold']);d.rectangle((7,4,8,8),(0,0,0,0))
d.rectangle((2,7,13,14),P['outline']);d.rectangle((3,8,12,13),P['brass']);d.line((3,8,12,8),fill=P['cream']);d.rectangle((7,10,8,12),P['outline'])
save('badge','lock',im,'overlay',extra={'attachment':'slot lower-right inset 2px'})
bar_colors={'hp_ally':('#327d53','#72cf88'),'mp':('#315f9a','#78bdf4'),'exp':('#967334','#f4d477'),
            'hp_enemy':('#963a54','#ef7a87'),'ascend':('#704d9f','#cda0ff')}
for height in (4,6,8):
 track=canvas(64,height);d=ImageDraw.Draw(track);d.rectangle((0,0,63,height-1),P['outline']);d.rectangle((1,1,62,height-2),'#30283f')
 save('bar',f'track_h{height}',track,'bar_track',extra={'resize':'horizontal-nearest-stretch','contentInsets':[1,1,1,1]})
 for name,(dark,light) in bar_colors.items():
    im=canvas(64,height);d=ImageDraw.Draw(im)
    d.rectangle((1,1,62,height-2),dark);d.line((1,1,62,1),fill=light)
    if height>=6:d.line((1,2,62,2),fill=light)
    save('bar',f'{name}_h{height}',im,'bar_fill',extra={'track':'ui:bar:track_h'+str(height),
         'fillRule':'Stretch full image to track dimensions first; clip x from 1 to 1+floor((width-2)*clamp(value/max,0,1)). Hide fill at zero. Keep height fixed.',
         'contentInsets':[1,1,1,1]})
def icon(name):
 im=canvas(24,24);d=ImageDraw.Draw(im);o=P['outline'];gold=P['gold'];cream=P['cream'];blue=P['blue'];teal=P['teal']
 def poly(points,c):polygon(d,points,c)
 def rect(box,c):d.rectangle(box,c)
 def line(points,c,w=1):d.line(points,fill=c,width=w)
 if name=='attack':
    poly([(7,15),(16,4),(21,2),(20,7),(10,18)],'#a3bed5')
    line([(10,14),(18,5)],P['white'],2);line([(6,12),(12,18)],gold,3)
    line([(8,17),(4,21)],o,5);line([(8,17),(4,21)],P['brass'],2);gem(d,4,21,gold)
 elif name=='skill':
    poly([(12,2),(15,9),(22,12),(15,15),(12,22),(9,15),(2,12),(9,9)],blue)
    poly([(12,6),(14,10),(18,12),(14,14),(12,18),(10,14),(6,12),(10,10)],'#b6e5ff')
    rect((11,10,12,13),P['white']);rect((3,3,4,4),gold);rect((19,19,20,20),gold)
 elif name=='guard':
    poly([(3,5),(12,2),(20,5),(19,15),(15,19),(12,22),(6,18),(3,13)],gold)
    poly([(6,7),(12,5),(17,7),(16,14),(12,18),(8,14)],'#35658c')
    line([(12,6),(12,16)],'#96c5db',2);line([(8,10),(16,10)],'#96c5db',2)
 elif name=='potion':
    rect((9,2,14,5),o);rect((10,2,13,4),P['brass'])
    poly([(8,5),(15,5),(15,9),(19,13),(19,19),(16,22),(7,22),(4,19),(4,13),(8,9)],'#c5e2df')
    poly([(7,12),(16,12),(17,15),(17,18),(15,20),(8,20),(6,18),(6,15)],P['red'])
    line([(8,14),(8,17)],'#ffced0',2);line([(9,6),(13,6)],P['white'])
 elif name=='revive':
    poly([(5,19),(5,13),(9,7),(17,3),(20,3),(20,8),(16,14),(10,18)],cream)
    line([(5,20),(17,6)],P['brass'],2)
    line([(10,12),(13,12)],P['gold']);line([(13,8),(16,8)],P['gold'])
    line([(3,8),(3,3),(6,3)],teal,2);poly([(1,5),(3,1),(6,5)],teal)
    gem(d,20,19,gold)
 elif name=='capture':
    line([(7,3),(3,7),(3,17),(7,21)],gold,3);line([(17,3),(21,7),(21,17),(17,21)],gold,3)
    poly([(12,6),(17,12),(12,18),(7,12)],teal)
    rect((11,10,13,13),cream)
 elif name=='flee':
    poly([(10,4),(17,4),(16,12),(20,15),(22,16),(21,20),(10,20),(7,17),(10,12)],P['brass'])
    line([(11,6),(15,6)],gold,2);line([(10,18),(20,18)],'#e1ba85',2)
    line([(1,8),(6,8)],blue,2);line([(2,12),(7,12)],blue,2);line([(0,16),(4,16)],blue,2)
 elif name=='ascend':
    poly([(12,1),(14,7),(19,4),(18,12),(21,16),(18,21),(6,21),(3,16),(6,10),(8,13),(9,6)],P['purple'])
    poly([(12,5),(16,14),(12,21),(8,14)],gold);line([(12,9),(12,16)],cream,2)
 elif name=='auto':
    line([(4,10),(4,7),(8,3),(15,3),(19,7)],teal,3)
    poly([(16,5),(21,5),(21,11),(16,9)],'#a0e6bc')
    line([(19,14),(19,17),(15,21),(8,21),(4,17)],teal,3)
    poly([(2,13),(7,15),(7,19),(2,19)],'#a0e6bc')
    poly([(10,8),(15,12),(10,16)],cream)
 elif name=='character':
    poly([(8,3),(15,3),(18,6),(17,11),(14,14),(9,14),(6,10),(6,6)],gold)
    rect((8,5,10,8),cream)
    poly([(8,14),(15,14),(20,18),(20,22),(3,22),(3,18)],P['brass'])
    poly([(9,15),(14,15),(12,19)],cream)
 elif name=='companion':
    for box in [(2,5,6,10),(8,2,11,8),(13,2,16,8),(18,5,21,10)]:
        d.ellipse(box,fill=gold,outline=o)
    poly([(8,12),(15,12),(19,17),(18,21),(14,22),(11,20),(7,22),(4,19),(5,16)],gold)
    line([(9,14),(13,14)],cream,2)
 elif name=='inventory':
    poly([(8,3),(15,3),(17,6),(6,6)],P['brass'])
    poly([(5,6),(18,6),(21,10),(20,21),(3,21),(2,10)],P['brass'])
    poly([(4,7),(19,7),(18,13),(5,13)],'#895133')
    line([(5,8),(17,8)],gold)
    rect((10,11,14,16),o);rect((11,12,13,15),gold);rect((12,13,12,14),o)
    line([(5,16),(5,19)],gold)
 elif name=='activities':
    poly([(5,3),(19,3),(21,6),(19,8),(17,8),(17,18),(19,20),(17,22),(4,22),(2,19),(4,17),(6,17),(6,7),(3,7),(2,5)],gold)
    rect((7,5,16,18),cream);line([(9,8),(14,8)],P['brass']);line([(9,11),(14,11)],P['brass'])
    gem(d,15,17,P['red']);rect((14,18,16,21),P['red'])
 elif name=='social':
    d.ellipse((3,4,10,11),fill=gold,outline=o);d.ellipse((13,4,20,11),fill=blue,outline=o)
    poly([(4,12),(9,12),(12,16),(12,21),(1,21),(1,16)],P['brass'])
    poly([(14,12),(19,12),(22,16),(22,21),(13,21),(13,16)],'#376ca3')
    rect((5,5,6,6),cream);rect((15,5,16,6),'#aed8f4')
 return im
battle=['attack','skill','guard','potion','revive','capture','flee','ascend','auto']
menus=['character','companion','inventory','activities','social']
for name in battle:save('command',name,icon(name),extra={'semantic':name,'hitArea':[48,48],'text':'runtime'})
for name in menus:save('menu',name,icon(name),extra={'semantic':name,'hitArea':[48,48],'text':'runtime'})
# Preserve unrelated manifest entries if this generator is used again.
index=META/'index.json'
existing=json.loads(index.read_text()) if index.exists() else []
if not isinstance(existing,list):raise ValueError('Existing index format is not a list; manual integration required')
entries=[a['file'].split('/')[-1].replace('.png','.json') for a in assets]
index.write_text(json.dumps(sorted(set(existing+entries)),indent=2)+'\n')
(ART/'ui-kit-manifest.json').write_text(json.dumps({'version':1,'status':'proof','canvas':[960,540],'background':P['bg'],'count':len(assets),'assets':assets},indent=2)+'\n')
def nine(im,size,border=16):
 w,h=size;sw,sh=im.size;result=canvas(w,h)
 xs=[0,border,sw-border,sw];ys=[0,border,sh-border,sh]
 tx=[0,border,w-border,w];ty=[0,border,h-border,h]
 for yy in range(3):
  for xx in range(3):
   tile=im.crop((xs[xx],ys[yy],xs[xx+1],ys[yy+1]))
   result.paste(tile.resize((tx[xx+1]-tx[xx],ty[yy+1]-ty[yy]),Image.Resampling.NEAREST),(tx[xx],ty[yy]))
 return result
font=ImageFont.load_default()
def label(im,pos,text,c=P['light']):ImageDraw.Draw(im).text(pos,text,fill=c,font=font)
def paste(im,key,xy,scale=1):
 src=images['ui_'+key+'_v001'];im.alpha_composite(src.resize((src.width*scale,src.height*scale),Image.Resampling.NEAREST),xy)
# Inventory of EVERY shipped sprite. Text exists only in proof images.
sheet=Image.new('RGBA',(960,940),P['bg'])
label(sheet,(24,16),'PIXEL-GAME / UI KIT v001    NATIVE PROOF    51 ASSETS',P['gold'])
label(sheet,(24,42),'WINDOW PARTS / 48px sources / fixed 16px corners')
for i,key in enumerate(['window_background','window_frame','window_title']):
 paste(sheet,key,(24+i*150,66));label(sheet,(24+i*150,122),key.split('_')[1])
sheet.alpha_composite(nine(images['ui_window_frame_v001'],(440,94)),(492,60))
label(sheet,(516,92),'9-SLICE / 440 x 94 / corners unchanged',P['cream'])
label(sheet,(24,156),'BUTTON STATES / 48px high / text supplied at runtime')
for i,key in enumerate(button_styles):
 sheet.alpha_composite(nine(images['ui_button_'+key+'_v001'],(168,48)),(24+i*184,182))
 label(sheet,(24+i*184,238),key)
label(sheet,(24,272),'SLOTS / 48px and 64px / rarity markers + separate lock badge')
for i,key in enumerate(rarities):
 paste(sheet,'slot_48_'+key,(24+i*164,300))
 paste(sheet,'slot_64_'+key,(82+i*164,292))
 label(sheet,(24+i*164,364),key.upper())
paste(sheet,'badge_lock',(886,312));label(sheet,(865,364),'LOCK 16')
label(sheet,(24,400),'BARS / 4, 6, 8px high / shared tracks + 5 resource fills')
for i,key in enumerate(['track']+list(bar_colors)):
 x=24+i*152;label(sheet,(x,428),key)
 for j,h in enumerate((4,6,8)):
  paste(sheet,f'bar_track_h{h}',(x,452+j*24))
  if key!='track':paste(sheet,f'bar_{key}_h{h}',(x,452+j*24))
  label(sheet,(x+72,448+j*24),str(h)+'px')
label(sheet,(24,550),'BATTLE COMMANDS / native 24px and 3x inspection')
for i,key in enumerate(battle):
 x=24+i*102;paste(sheet,'command_'+key,(x,580));paste(sheet,'command_'+key,(x,620),3);label(sheet,(x,702),key)
label(sheet,(24,742),'MENU GROUPS / native 24px and 3x inspection')
for i,key in enumerate(menus):
 x=24+i*180;paste(sheet,'menu_'+key,(x,774));paste(sheet,'menu_'+key,(x+40,768),3);label(sheet,(x,852),key)
label(sheet,(24,910),'GRID_READY / visual proof only / no Phaser integration or mobile approval',P['gold'])
sheet.save(ART/'ui-preview-sheet-v001.png')
# 960x540 placement proof, not a replacement game screen.
proof=Image.new('RGBA',(960,540),P['bg'])
proof.alpha_composite(nine(images['ui_window_frame_v001'],(912,492)),(24,24))
proof.alpha_composite(nine(images['ui_window_title_v001'],(880,48)),(40,40))
label(proof,(64,60),'UI PLACEMENT PROOF / 960 x 540',P['cream'])
for i,key in enumerate(menus):
 proof.alpha_composite(nine(images['ui_button_normal_v001'],(160,48)),(48+i*174,104))
 paste(proof,'menu_'+key,(60+i*174,116));label(proof,(91+i*174,121),key)
for i,key in enumerate(rarities):
 paste(proof,'slot_64_'+key,(64+i*82,190))
 if i==4:paste(proof,'badge_lock',(64+i*82+46,236))
for j,(key,ratio) in enumerate(zip(bar_colors,[.8,.6,.45,.65,.9])):
 x,y=544,188+j*23;label(proof,(x,y-3),key)
 track=images['ui_bar_track_h8_v001'].resize((192,8),Image.Resampling.NEAREST)
 fill=images['ui_bar_'+key+'_h8_v001'].resize((192,8),Image.Resampling.NEAREST)
 proof.alpha_composite(track,(664,y));proof.alpha_composite(fill.crop((0,0,1+int(190*ratio),8)),(664,y))
label(proof,(64,294),'Rarity uses color + 1-5 pips. Locked quantities need layout space.')
for i,key in enumerate(battle):
 state='selected' if key=='guard' else 'normal'
 proof.alpha_composite(nine(images['ui_button_'+state+'_v001'],(80,48)),(64+i*92,336))
 paste(proof,'command_'+key,(92+i*92,348));label(proof,(64+i*92,394),key)
for i,key in enumerate(['primary','disabled','danger']):
 proof.alpha_composite(nine(images['ui_button_'+key+'_v001'],(248,48)),(64+i*280,436))
 label(proof,(84+i*280,454),key)
proof.save(ART/'ui-layout-proof-960x540-v001.png')
# Contact sheet against light/dark backgrounds, native icons at 4x.
checks=Image.new('RGBA',(960,320),P['bg'])
for row,bg in enumerate([P['bg'],'#eee4d2']):
 ImageDraw.Draw(checks).rectangle((0,row*160,959,row*160+159),bg)
 for i,key in enumerate(battle+menus):
  family='command' if key in battle else 'menu'
  src=images[f'ui_{family}_{key}_v001'].resize((48,48),Image.Resampling.NEAREST)
  checks.alpha_composite(src,(20+i*66,row*160+50))
checks.save(ART/'ui-icon-contrast-v001.png')
print(f'Generated {len(assets)} PNGs and per-asset metadata.')

