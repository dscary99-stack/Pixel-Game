"""Reproducible native exports from archived authored atlases. Run from any cwd.
Whole source cells share a fixed transform; no per-frame bounding-box fitting.
"""
from pathlib import Path
import json, hashlib, math
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'art/world'; PUBLIC=ROOT/'apps/client/public/assets'
META=PUBLIC/'metadata'; SPR=PUBLIC/'sprites'; REVIEW=ART/'review'
PALETTE=json.loads((ROOT/'art/ui/cute-rebuild/palette.json').read_text())
PAL=Image.new('P',(1,1)); PAL.putpalette(sum(PALETTE+[PALETTE[-1]]*(256-len(PALETTE)),[]))
REVIEW.mkdir(parents=True,exist_ok=True)
MANIFEST=[]; CACHE={}; SOURCES={}
SPECIES=['armor_crab','ember_fox','lantern_snail','supply_mole','bell_bird','crystal_crab_lord']
ELEMENTS=[['EARTH','WATER'],['FIRE','WIND','SHADOW'],['WATER','LIGHT'],['EARTH','WATER'],['WIND','LIGHT'],['WATER','EARTH']]
DIRS=['up','right','down','left']
STATES={'idle':([0,1,2,3],6,True),'hurt':([4,5],8,False),'attack':([6,7,8,9,10,11],10,False),'cast':([12,13,14,15,16,17],10,False),'ko':([18,19,20,21],8,False)}

def native(im):
    a=im.getchannel('A').point(lambda x:255 if x>=128 else 0)
    rgb=im.convert('RGB').quantize(palette=PAL,dither=Image.Dither.NONE).convert('RGBA')
    rgb.putalpha(a)
    # Canonical RGB in transparent pixels makes packed assets deterministic.
    blank=Image.new('RGBA',rgb.size); blank.paste(rgb,(0,0),a)
    return blank

def clean_fragments(im,limit=2,left_clip=None):
    """Drop only isolated one/two-pixel source-cell debris, never rescale the actor."""
    out=im.copy();a=im.getchannel('A');seen=set()
    for y in range(im.height):
        for x in range(im.width):
            if (x,y) in seen or not a.getpixel((x,y)):continue
            stack=[(x,y)];seen.add((x,y));component=[]
            while stack:
                xx,yy=stack.pop();component.append((xx,yy))
                for dx in [-1,0,1]:
                    for dy in [-1,0,1]:
                        p=(xx+dx,yy+dy)
                        if 0<=p[0]<im.width and 0<=p[1]<im.height and p not in seen and a.getpixel(p):seen.add(p);stack.append(p)
            if len(component)<=limit or (left_clip is not None and max(p[0] for p in component)<=left_clip):
                for p in component:out.putpixel(p,(0,0,0,0))
    return out

def atlas(id,cols,rows,size=64,extent=None,source_y_shift=0,native_y_shift=0):
    path=ART/'masters'/f'{id}.png'
    im=Image.open(path).convert('RGBA'); extent=extent or (size-8 if size==64 else size-16)
    frames=[]
    for y in range(rows):
        for x in range(cols):
            index=y*cols+x
            # Fixed-size extraction windows recover authored poses that cross nominal source cells.
            # These are measured integer registration corrections, never bounding-box fitting.
            sx=64 if id=='lantern_snail_attack_clean' and index in [3,4] else 24 if id=='supply_mole_attack_clean' and index==4 else 0
            box=tuple(map(round,(x*im.width/cols+sx,y*im.height/rows+source_y_shift,(x+1)*im.width/cols+sx,(y+1)*im.height/rows+source_y_shift)))
            cell=im.crop(box).resize((extent,extent),Image.Resampling.NEAREST)
            frame=Image.new('RGBA',(size,size)); frame.alpha_composite(native(cell),((size-extent)//2,(size-extent)//2+native_y_shift))
            # Spell particles are intentional. Other isolated tiny fragments are atlas debris.
            is_cast=id.endswith('_battle') and 12<=y*cols+x<18
            left_clip=(size-extent)//2+1 if id.endswith('_battle') else None
            if id=='crystal_crab_lord_battle' and index==16:left_clip+=7
            frames.append(clean_fragments(frame,0 if is_cast else 16 if id.endswith('_battle') and index>=18 else 2,left_clip))
    SOURCES[id]={'source':f'art/world/masters/{id}.png','sourceSize':list(im.size),'sourceGrid':[cols,rows],'nativeCell':[size,size],'fixedCellExtent':[extent,extent],'sourceGridYOffset':source_y_shift,'offset':[(size-extent)//2,(size-extent)//2+native_y_shift],'resampling':'nearest; one transform for entire atlas','alphaThreshold':128}
    if id=='lantern_snail_attack_clean':SOURCES[id]['sourceFrameXRegistration']={'3':64,'4':64}
    if id=='supply_mole_attack_clean':SOURCES[id]['sourceFrameXRegistration']={'4':24}
    if id=='crystal_crab_lord_battle':SOURCES[id]['cleanup']={'frame16':'remove disconnected previous-cell claw fragment at native x<=20; preserve body and cast particles'}
    return frames

def emit(stem,folder,frames,anim=None,fps=6,loop=False,extra=None):
    w,h=frames[0].size; assert all(f.size==(w,h) for f in frames)
    filename=stem+'_v001'; out=SPR/folder; out.mkdir(parents=True,exist_ok=True)
    sheet=Image.new('RGBA',(w*len(frames),h))
    for i,f in enumerate(frames): sheet.alpha_composite(f,(i*w,0))
    sheet.save(out/(filename+'.png'),optimize=True)
    m={'assetId':stem,'version':1,'file':f'/assets/sprites/{folder}/{filename}.png','frameWidth':w,'frameHeight':h,'columns':len(frames),'rows':1,'frameCount':len(frames),'origin':[0,0],'status':'grid_ready','staticFrame':0,'palette':'cute-ui-v002','animations':[]}
    if anim: m['animations']=[{'name':anim,'frames':list(range(len(frames))),'fps':fps,'loop':loop}]
    if extra: m.update(extra)
    (META/(filename+'.json')).write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    MANIFEST.append(filename+'.json'); CACHE[stem]=(frames,m)
    if anim:
        gif=[]
        for f in frames:
            bg=Image.new('RGBA',f.size,'#14121c');bg.alpha_composite(f)
            gif.append(bg.convert('RGB').quantize(colors=128).resize((w*4,h*4),Image.Resampling.NEAREST))
        opts={'save_all':True,'append_images':gif[1:],'duration':round(1000/fps),'disposal':2}
        if loop: opts['loop']=0
        gif[0].save(REVIEW/(filename+'.gif'),**opts)
    return m

def actors():
    for slug in SPECIES+['human']:
        prefix='player' if slug=='human' else 'mon'; size=128 if slug=='crystal_crab_lord' else 64
        base=atlas(slug+'_battle',6,4,size,extent=104 if size==128 else 52 if slug!='human' else 56,source_y_shift=12 if slug!='human' else 0,native_y_shift=4 if size==128 else 2 if slug!='human' else 0)
        attack_path=ART/'masters'/f'{slug}_attack_clean.png'
        attack=atlas(slug+'_attack_clean',3,2,size,extent=size,native_y_shift=4) if attack_path.exists() else None
        shared={'origin':[.5,1],'groundOffset':8 if size==128 else 4,'groundPoint':[size//2,size-(8 if size==128 else 4)],'hitPoint':[size//2,round(size*.25)],'castPoint':[round(size*.78),round(size*.47)],'allowedFlip':{'x':True,'y':False},'facing':'right','shadowAsset':'shadow_large' if size==128 else 'shadow_small','artId':'art:'+slug,'contentGroup':'players' if slug=='human' else 'species','elementRendering':{'mode':'external-vfx','allowedElements':ELEMENTS[SPECIES.index(slug)] if slug in SPECIES else []}}
        for state,(indices,fps,loop) in STATES.items():
            extra=dict(shared,sourceAtlas=slug+'_battle')
            if state=='attack': extra.update(hitFrame=3,events=[{'frame':3,'name':'hit'}])
            if state=='cast': extra.update(castFrame=3,events=[{'frame':3,'name':'cast'}])
            if state=='ko': extra.update(holdLastFrame=True)
            if state=='attack' and attack:extra['sourceAtlas']=slug+'_attack_clean'
            emit(f'{prefix}_{slug}_battle_{state}','characters' if slug=='human' else 'monsters',attack if state=='attack' and attack else [base[i] for i in indices],state,fps,loop,extra)
        world=atlas(slug+'_world',4,4)
        idle_path=ART/'masters'/f'{slug}_world_idle.png'
        idle=atlas(slug+'_world_idle',4,4) if idle_path.exists() else None
        for d,dir in enumerate(DIRS):
            extra={'origin':[.5,1],'groundOffset':4,'groundPoint':[32,60],'allowedFlip':{'x':False,'y':False},'facing':dir,'shadowAsset':'shadow_small','artId':'art:'+slug,'sourceAtlas':slug+'_world'}
            emit(f'{prefix}_{slug}_world_walk_{dir}','characters' if slug=='human' else 'monsters',world[d*4:d*4+4],'walk',8,True,extra)
            if idle:
                emit(f'{prefix}_{slug}_world_idle_{dir}','characters' if slug=='human' else 'monsters',idle[d*4:d*4+4],'idle',6,True,dict(extra,sourceAtlas=slug+'_world_idle'))

def npcs():
    for path in sorted((ART/'masters').glob('npc_*.png')):
        slug=path.stem[4:];frames=atlas(path.stem,2,2)
        emit(f'npc_{slug}_world_idle_down','npcs',frames,'idle',6,True,{'origin':[.5,1],'groundOffset':4,'groundPoint':[32,60],'facing':'down','allowedFlip':{'x':False,'y':False},'shadowAsset':'shadow_small','contentId':'npc:'+slug,'contentGroup':'npcs','sourceAtlas':path.stem})

def shadows():
    for name,w,h in [('small',40,12),('large',88,24)]:
        im=Image.new('RGBA',(w,h));d=ImageDraw.Draw(im);d.ellipse((1,2,w-2,h-2),fill=tuple(min(PALETTE,key=lambda c:sum(c)))+ (255,))
        emit('shadow_'+name,'effects',[native(im)],extra={'origin':[.5,.5],'renderAlpha':.28,'note':'Binary-alpha shared sprite; set runtime alpha to .28. Place at actor groundPoint, not frame bottom.'})

def catalog():
    keys=[k for k in CACHE if ('battle_idle' in k or 'npc_' in k)]
    out=Image.new('RGBA',(640,math.ceil(len(keys)/5)*160),'#14121c');d=ImageDraw.Draw(out)
    for i,k in enumerate(keys):
        f=CACHE[k][0][0];f=f.resize((128,128),Image.Resampling.NEAREST)
        x=(i%5)*128;y=(i//5)*160;out.alpha_composite(f,(x+(128-f.width)//2,y));d.text((x+3,y+125),k.replace('mon_','').replace('_battle_idle','').replace('_world_idle_down',''),fill='white')
    out.convert('RGB').save(REVIEW/'cast-preview.png')

def finish():
    index=json.loads((META/'index.json').read_text(encoding='utf-8-sig'))
    index=sorted(set(index+MANIFEST));(META/'index.json').write_text(json.dumps(index,indent=2)+'\n',encoding='utf-8')
    (ART/'source-layouts.json').write_text(json.dumps(SOURCES,indent=2)+'\n')
    (ART/'world-manifest.json').write_text(json.dumps(MANIFEST,indent=2)+'\n')
    catalog()
    print(f'Exported {len(MANIFEST)} assets / {sum(len(v[0]) for v in CACHE.values())} frames')

if __name__=='__main__':
    import sys,environment,weapons
    actors();npcs();shadows();environment.produce(sys.modules[__name__]);weapons.produce(sys.modules[__name__]);finish()
