"""Render real content maps, battle compositions, animation gallery and native QA."""
from pathlib import Path
import json,re,hashlib,math
from PIL import Image,ImageDraw,ImageOps
import build as b

ASSETS={}
for name in json.loads((b.ART/'world-manifest.json').read_text()):
    m=json.loads((b.META/name).read_text());im=Image.open(b.PUBLIC.parent/m['file'].lstrip('/')).convert('RGBA')
    w,h=m['frameWidth'],m['frameHeight'];ASSETS[m['assetId']]=([im.crop((i*w,0,(i+1)*w,h)) for i in range(m['frameCount'])],m)

def sprite(key,f=0):
    fs,m=ASSETS[key];return fs[f%len(fs)]

def actor(im,key,x,y,frame=0,flip=False,weapon=None):
    f=sprite(key,frame).copy();m=ASSETS[key][1]
    if weapon:f.alpha_composite(sprite(weapon,frame))
    if flip:f=ImageOps.mirror(f)
    sh=sprite(m.get('shadowAsset','shadow_small')).copy();sh.putalpha(sh.getchannel('A').point(lambda a:round(a*.28)))
    im.alpha_composite(sh,(round(x-sh.width/2),round(y-sh.height/2)))
    im.alpha_composite(f,(round(x-f.width/2),round(y-f.height+m.get('groundOffset',4))))

def saveproof(im,name):
    im.convert('RGB').save(b.REVIEW/(name+'-1x.png'))
    im.resize((im.width*2,im.height*2),Image.Resampling.NEAREST).convert('RGB').save(b.REVIEW/(name+'-2x.png'))

def battles():
    for scene in ['dawn_field','rift_tower','town_practice']:
        frames=[]
        for frame in range(4):
            im=sprite('bg_'+scene+'_battle').copy();ambient='bg_'+scene+'_ambient'
            for p in ASSETS[ambient][1]['placements']:im.alpha_composite(sprite(ambient,frame+p['phaseOffset']),(p['x'],p['y']))
            for i in range(6):
                x=230+(i//3)*120;y=190+(i%3)*92
                slug=(['human']+b.SPECIES[:5])[i];key=('player_' if slug=='human' else 'mon_')+slug+'_battle_idle'
                actor(im,key,x,y,frame,weapon='weapon_physical_melee_battle_idle' if slug=='human' else None)
            for i in range(10):
                x=620+(i//5)*130;y=125+(i%5)*76
                actor(im,'mon_'+b.SPECIES[i%5]+'_battle_idle',x,y,frame,True)
            # UI proof uses the existing approved asset images, not changes to game source.
            d=ImageDraw.Draw(im);d.rectangle((0,450,959,539),fill='#14121c')
            for i,command in enumerate(['attack','skill','guard','potion','revive','capture','flee','ascend','auto']):
                p=b.SPR/'ui'/f'ui_command_{command}_v002.png'
                if p.exists():im.alpha_composite(Image.open(p).convert('RGBA').crop((0,0,24,24)),(225+i*56,476))
            frames.append(im)
        saveproof(frames[0],'battle-'+scene+'-6v10')
        frames[0].convert('RGB').save(b.REVIEW/('battle-'+scene+'-6v10.gif'),save_all=True,append_images=[x.convert('RGB') for x in frames[1:]],duration=167,loop=0)
    im=sprite('bg_dawn_field_battle').copy();actor(im,'player_human_battle_idle',270,290,weapon='weapon_magic_battle_idle');actor(im,'mon_crystal_crab_lord_battle_idle',690,300,flip=True)
    saveproof(im,'battle-boss-reserved-slots')

def maps():
    text=(b.ROOT/'packages/shared/src/content/maps.ts').read_text(encoding='utf-8-sig')
    blocks=re.split(r'\n    id: "map:(dawn_town|dawn_field)",',text)
    proofdata=[]
    for k in range(1,len(blocks),2):
        slug=blocks[k];part=blocks[k+1];tiles=re.findall(r'"([#.,=T~]+)"',re.search(r'tiles: \[(.*?)\]',part,re.S).group(1))
        width=len(tiles[0]);height=len(tiles);issues=[{'row':i,'length':len(row),'expected':width} for i,row in enumerate(tiles) if len(row)!=width]
        fs,meta=ASSETS['tiles_'+slug+'_base'];order=meta['adjacency']['legendOrder'];legend=meta['legend'];base=Image.new('RGBA',(width*32,height*32),'#14121c');objects=[]
        for y,row in enumerate(tiles):
            for x,char in enumerate(row):
                kind=legend[char];mask=0
                for dx,dy,bit in [(0,-1,1),(1,0,2),(0,1,4),(-1,0,8)]:
                    nx,ny=x+dx,y+dy
                    if ny<0 or ny>=height or nx<0 or nx>=len(tiles[ny]) or tiles[ny][nx]==char:mask|=bit
                idx=order.index(kind)*16+mask
                under='grass' if kind in ['water','tree'] else 'ground'
                base.alpha_composite(fs[order.index(under)*16+15],(x*32,y*32));base.alpha_composite(fs[idx],(x*32,y*32))
                if kind in ['tree','wall']:
                    key='tiles_'+slug+'_'+kind+'_upper';offset=ASSETS[key][1]['tileOffset'];objects.append((y*32+32,'upper',key,x*32+offset[0],y*32+offset[1]))
        npcdata=[]
        for name,x,y in re.findall(r'id: "npc:([a-z_]+)", at: \{ x: (\d+), y: (\d+) \}',part):
            key='npc_'+name+'_world_idle_down';objects.append((int(y)*32+24,'actor',key,int(x)*32+16,int(y)*32+24));npcdata.append(name)
        spawns=[]
        pack_matches=list(re.finditer(r'\n        id: "([a-z_]+)",\s*at: \{ x: (\d+), y: (\d+) \}',part))
        for pi,match in enumerate(pack_matches):
            pack,x,y=match.groups();chunk=part[match.end():pack_matches[pi+1].start() if pi+1<len(pack_matches) else len(part)]
            monster=re.search(r'speciesId: "species:([a-z_]+)"',chunk).group(1)
            spawns.append({'pack':pack,'species':monster,'x':int(x),'y':int(y)});objects.append((int(y)*32+24,'actor','mon_'+monster+'_world_idle_down',int(x)*32+16,int(y)*32+24))
        boss=re.search(r'bossLair: \{ bossId: "boss:([a-z_]+)", at: \{ x: (\d+), y: (\d+) \}',part)
        if boss:
            monster,x,y=boss.groups();objects.append((int(y)*32+24,'actor','mon_'+monster+'_world_idle_down',int(x)*32+16,int(y)*32+24))
        portals=re.findall(r'\{ at: \{ x: (\d+), y: (\d+) \}, to:',part)
        for x,y in portals:objects.append((int(y)*32+24,'actor','portal_world_idle',int(x)*32+16,int(y)*32+24))
        spawn=re.search(r'spawn: \{ x: (\d+), y: (\d+) \}',part);x,y=map(int,spawn.groups());objects.append((y*32+24,'actor','player_human_world_idle_down',x*32+16,y*32+24))
        rendered=[]
        for frame in range(4):
            im=base.copy()
            for _,kind,key,x,y in sorted(objects,key=lambda o:o[0]):
                if kind=='upper':im.alpha_composite(sprite(key),(x,y))
                else:actor(im,key,x,y,frame)
            rendered.append(im)
        saveproof(rendered[0],'map-'+slug)
        rendered[0].convert('RGB').save(b.REVIEW/('map-'+slug+'.gif'),save_all=True,append_images=[x.convert('RGB') for x in rendered[1:]],duration=167,loop=0)
        proofdata.append({'mapId':'map:'+slug,'source':'packages/shared/src/content/maps.ts','sourceSha256':hashlib.sha256(text.encode()).hexdigest(),'width':width,'height':height,'rows':tiles,'rowWidthIssues':issues,'npcIds':npcdata,'packs':spawns,'portals':portals,'note':'EXAMPLE source layout, unchanged. Missing cells remain dark/blocked as tileAt=null; never invented or padded as walkable.'})
    (b.ART/'map-proof-data.json').write_text(json.dumps(proofdata,indent=2)+'\n')
    return proofdata

def qa(mapdata):
    failures=[];warnings=[];entries=[];palette={tuple(c) for c in b.PALETTE};idx=json.loads((b.META/'index.json').read_text())
    if len(idx)!=len(set(idx)):failures.append('duplicate metadata index entries')
    for key,(frames,m) in ASSETS.items():
        err=[];name=Path(m['file']).stem;im=Image.open(b.PUBLIC.parent/m['file'].lstrip('/'))
        if im.size!=(m['frameWidth']*m['columns'],m['frameHeight']):err.append('sheet dimensions')
        if m['columns']!=m['frameCount']:err.append('nonhorizontal grid')
        if m['status']!='grid_ready':err.append('status')
        colors=set(im.convert('RGBA').get_flattened_data());alphas={c[3] for c in colors}
        if not alphas<={0,255}:err.append('nonbinary alpha')
        if any(c[:3] not in palette for c in colors if c[3]):err.append('outside shared palette')
        if name+'.json' not in idx:err.append('not in index')
        if m['animations'] and not (b.REVIEW/(name+'.gif')).exists():err.append('missing GIF')
        bounds=[f.getbbox() for f in frames];edge=[]
        for i,box in enumerate(bounds):
            if not box:err.append('empty frame '+str(i))
            elif box[0]==0 or box[1]==0 or box[2]==m['frameWidth'] or box[3]==m['frameHeight']:edge.append(i)
        isactor=key.startswith(('mon_','player_','npc_'))
        if isactor:
            if m['origin']!=[.5,1] or 'groundOffset' not in m:err.append('actor anchor')
            if edge:err.append('actor touches cell edge')
            if m['frameWidth']==64 and max(box[3]-box[1] for box in bounds)>56:err.append('body taller than56')
            if '_battle_' in key and not m['allowedFlip']['x']:err.append('battle flip')
        if key.startswith('weapon_') and edge:warnings.append({'asset':key,'kind':'equipmentTouchesEdge','frames':edge})
        for clip in m['animations']:
            if clip['frames']!=list(range(m['frameCount'])):err.append('frame sequence')
            if clip['name']=='attack' and m.get('hitFrame')!=3:err.append('hitFrame')
            if clip['name']=='ko' and not m.get('holdLastFrame'):err.append('KO hold')
            if clip['name'] in ['attack','cast','hurt','ko'] and clip['loop']:err.append('action loops')
        if key.startswith('weapon_'):
            body=ASSETS.get(m.get('bodyAsset',''))
            if not body or body[1]['frameCount']!=m['frameCount']:err.append('weapon synchronization')
        if err:failures.append({'asset':key,'errors':err})
        entries.append({'asset':key,'frames':len(frames),'bounds':bounds,'uniqueFrames':len({f.tobytes() for f in frames}),'alpha':sorted(alphas),'sha256':hashlib.sha256((b.PUBLIC.parent/m['file'].lstrip('/')).read_bytes()).hexdigest(),'errors':err})
    for slug in b.SPECIES+['human']:
        prefix='player' if slug=='human' else 'mon'
        for state in b.STATES:
            if f'{prefix}_{slug}_battle_{state}' not in ASSETS:failures.append('missing '+slug+state)
        for direction in b.DIRS:
            for state in ['idle','walk']:
                if f'{prefix}_{slug}_world_{state}_{direction}' not in ASSETS:failures.append('missing '+slug+state+direction)
    npc_expected=set(re.findall(r'id: "npc:([a-z_]+)"',(b.ROOT/'packages/shared/src/content/maps.ts').read_text(encoding='utf-8-sig')))
    for slug in npc_expected:
        if 'npc_'+slug+'_world_idle_down' not in ASSETS:failures.append('missing NPC '+slug)
    for m in mapdata:
        if m['rowWidthIssues']:warnings.append({'map':m['mapId'],'kind':'upstreamRaggedRows','rows':m['rowWidthIssues']})
    report={'status':'pass' if not failures else 'fail','assets':len(ASSETS),'frames':sum(len(f) for f,m in ASSETS.values()),'animations':sum(len(m['animations']) for f,m in ASSETS.values()),'npcCount':len(npc_expected),'paletteColors':len(palette),'failures':failures,'warnings':warnings,'entries':entries,'visualReview':'Native contact sheets, 1x/2x map/battle proofs and synchronized layer GIFs; inspect before publication. Numeric pass is not style approval.'}
    (b.ART/'qa-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['status','assets','frames','animations','failures','warnings']},indent=2))
    if failures:raise SystemExit(1)

def gallery():
    cards=[]
    for key,(fs,m) in ASSETS.items():
        if not m['animations']:continue
        name=Path(m['file']).stem;clip=m['animations'][0]
        cards.append(f'<article><h3>{key}</h3><img loading="lazy" src="review/{name}.gif"><p>{len(fs)} frames · {clip["fps"]} fps · {"loop" if clip["loop"] else "once"}</p><a href="../../apps/client/public{m["file"]}">Native PNG strip</a></article>')
    scenes=''.join(f'<figure><h2>{p.stem}</h2><a href="review/{p.name.replace("-1x","-2x")}">2× PNG</a><img src="review/{p.name}"></figure>' for p in sorted(b.REVIEW.glob('*-1x.png')))
    html='<!doctype html><meta charset="utf-8"><title>Pixel-Game World Sprite Proof</title><style>body{background:#14121c;color:#f7ead1;font:14px system-ui;margin:24px}img{image-rendering:pixelated;max-width:none}figure{overflow:auto;margin:24px 0}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:12px}article{background:#252136;padding:12px;overflow:auto}article img{max-height:256px}h3{font-size:12px;overflow-wrap:anywhere}a{color:#a5dfcc}button{padding:8px}body.light{background:#f7ead1;color:#252136}</style><h1>World sprites · cute v002 palette</h1><p>Native 64px actors / 128px boss · preview only, no game source integration.</p><button onclick="document.body.classList.toggle(\'light\')">Light / dark background</button>'+scenes+'<h2>Every animation</h2><section>'+''.join(cards)+'</section>'
    (b.ART/'preview.html').write_text(html,encoding='utf-8')

def contacts():
    groups={'battle':[k for k in ASSETS if k.startswith(('mon_','player_')) and '_battle_' in k],
            'world':[k for k in ASSETS if k.startswith(('mon_','player_')) and '_world_' in k],
            'npc':[k for k in ASSETS if k.startswith('npc_')],
            'equipment':[k for k in ASSETS if k.startswith('weapon_') and '_battle_' in k]}
    for group,keys in groups.items():
        for start in range(0,len(keys),8):
            page=Image.new('RGBA',(960,8*148),'#14121c');d=ImageDraw.Draw(page)
            for row,key in enumerate(keys[start:start+8]):
                frames,m=ASSETS[key];d.text((4,row*148),key,fill='white')
                for i,frame in enumerate(frames):
                    if group=='equipment':
                        body=sprite(m['bodyAsset'],i).copy();body.alpha_composite(frame);frame=body
                    #128px bosses shown at1x; normal64px at2x. Export never changes size.
                    disp=frame.resize((128,128),Image.Resampling.NEAREST)
                    page.alpha_composite(disp,(i*150,row*148+16))
            page.convert('RGB').save(b.REVIEW/f'contact-{group}-{start//8+1:02d}.png')

if __name__=='__main__':
    battles();data=maps();qa(data);gallery();contacts()
