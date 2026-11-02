"""Four authored equipment designs, registered to per-frame body hand landmarks."""
from PIL import Image, ImageDraw
import math

def produce(b):
    src=Image.open(b.ART/'masters/weapon_master.png').convert('RGBA')
    families=['physical_melee','physical_ranged','magic','support'];weapons=[]
    for i in range(4):
        im=src.crop((round(i*src.width/4),0,round((i+1)*src.width/4),src.height)).resize((20,28),Image.Resampling.NEAREST)
        weapons.append(b.native(im))
    grips=[(10,21),(8,14),(10,20),(10,20)]
    battle={
      'idle':[(27,48,-25),(27,48,-25),(27,48,-25),(27,48,-25)],
      'hurt':[(25,39,15),(29,44,-10)],
      'attack':[(28,42,-20),(29,46,20),(17,31,55),(56,37,20),(50,46,-30),(28,44,-25)],
      'cast':[(31,42,-10),(37,41,0),(54,20,15),(55,29,15),(34,42,-15),(24,46,-25)],
      'ko':[(26,46,-30),(32,53,-75),(39,53,-90),(40,53,-90)]}
    ranged=b.atlas('human_ranged_attack',3,2)
    rm=b.emit('player_human_battle_attack_physical_ranged','characters',ranged,'attack',10,False,{'origin':[.5,1],'groundOffset':4,'groundPoint':[32,60],'hitPoint':[32,16],'castPoint':[54,33],'allowedFlip':{'x':True,'y':False},'facing':'right','hitFrame':3,'events':[{'frame':3,'name':'release-arrow'}],'shadowAsset':'shadow_small','sourceAtlas':'human_ranged_attack','weaponFamily':'physical_ranged'})
    ranged_sockets=[(45,40,0),(54,35,0),(54,35,0),(54,33,0),(54,33,0),(45,40,0)]
    socket_manifest={}
    for family,weapon,grip in zip(families,weapons,grips):
        for bodykey,(bodyframes,meta) in list(b.CACHE.items()):
            if not bodykey.startswith('player_human_') or bodykey.endswith('physical_ranged'):continue
            mode=bodykey.split('_')[2];state=bodykey.split('_')[3];direction=meta.get('facing','right')
            linked=bodykey
            if mode=='battle':
                sockets=battle[state]
                if family=='physical_ranged' and state=='attack':sockets=ranged_sockets;bodyframes=ranged;linked='player_human_battle_attack_physical_ranged'
                if family=='physical_ranged' and state=='cast':sockets=[(x,y,0 if i in [2,3] else a) for i,(x,y,a) in enumerate(sockets)]
            else:
                poses={'up':[(44,42,12),(45,40,10),(42,44,15),(44,42,12)],'right':[(25,45,-20),(42,43,-15),(26,45,-25),(25,45,-20)],'down':[(22,43,-12),(24,41,-8),(20,44,-16),(22,43,-12)],'left':[(39,45,20),(22,43,15),(38,45,25),(39,45,20)]}
                sockets=poses[direction]
                if state=='idle':sockets=[sockets[0]]*4
            frames=[]
            for i,(x,y,angle) in enumerate(sockets):
                # Work on a larger scratch canvas to rotate only the equipment about its grip.
                scratch=Image.new('RGBA',(128,128));scratch.alpha_composite(weapon,(64-grip[0],64-grip[1]))
                scratch=scratch.rotate(angle,resample=Image.Resampling.NEAREST,center=(64,64))
                layer=Image.new('RGBA',(64,64));layer.alpha_composite(scratch,(x-64,y-64))
                # Cut grip pixels only where body is opaque; the base hand remains visible on top.
                for yy in range(max(0,y-1),min(64,y+2)):
                    for xx in range(max(0,x-1),min(64,x+2)):
                        if bodyframes[i].getpixel((xx,yy))[3]:layer.putpixel((xx,yy),(0,0,0,0))
                frames.append(layer)
            stem=bodykey.replace('player_human_',f'weapon_{family}_')
            clip=meta['animations'][0];extra={'origin':[.5,1],'groundOffset':4,'groundPoint':[32,60],'allowedFlip':meta['allowedFlip'],'facing':direction,'bodyAsset':linked,'weaponFamily':family,'layer':'equipment','sync':'same frame index as bodyAsset; no independent animation clock','gripPoints':[[x,y] for x,y,a in sockets],'gripAngles':[a for x,y,a in sockets],'sourceAtlas':'weapon_master'}
            if state=='attack':extra['hitFrame']=3
            if state=='ko':extra.update(holdLastFrame=True,gripMode='released-to-ground after frame0')
            b.emit(stem,'equipment',frames,clip['name'],clip['fps'],clip['loop'],extra)
            socket_manifest[stem]={'bodyAsset':linked,'grips':sockets}
            if mode=='battle':
                proof=[]
                for body,layer in zip(bodyframes,frames):
                    im=Image.new('RGBA',(64,64),'#14121c');im.alpha_composite(body);im.alpha_composite(layer);proof.append(im.convert('RGB').resize((256,256),Image.Resampling.NEAREST))
                opts={'save_all':True,'append_images':proof[1:],'duration':round(1000/clip['fps']),'disposal':2}
                if clip['loop']:opts['loop']=0
                proof[0].save(b.REVIEW/(stem+'_composite.gif'),**opts)
    (b.ART/'weapon-sockets.json').write_text(b.json.dumps(socket_manifest,indent=2)+'\n')
