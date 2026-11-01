"""Terrain adjacency, occlusion layers and battle backgrounds for build.py."""
from PIL import Image, ImageDraw, ImageFilter
import math

def produce(b):
    src=Image.open(b.ART/'masters/terrain_master.png').convert('RGBA')
    quiet=Image.open(b.ART/'masters/terrain_quiet.png').convert('RGBA')
    def tile(i,size=(32,32)):
        x=i%4;y=i//4
        source=quiet if i in [0,1,2,3,4] else src
        im=source.crop(tuple(map(round,(x*source.width/4,y*source.height/2,(x+1)*source.width/4,(y+1)*source.height/2))))
        if i in [4,5,7]:
            # Shared source cell, remove only its known top seam from adjacent texture row.
            ImageDraw.Draw(im).rectangle((0,0,im.width,12),fill=(0,0,0,0))
        if i==4: im=im.crop((0,round(im.height*.15),im.width,round(im.height*.87)))
        return b.native(im.resize(size,Image.Resampling.NEAREST))
    textures={k:tile(i) for i,k in enumerate(['ground','grass','road','water'])}
    # Fill all texture alpha: a terrain base covers the complete native cell.
    for k,im in textures.items():
        color={'ground':'#e8c684','grass':'#8dc9a5','road':'#ead4ac','water':'#65c9c4'}[k]
        bg=Image.new('RGBA',(32,32),color);bg.alpha_composite(im);textures[k]=b.native(bg.filter(ImageFilter.ModeFilter(3)))
    tree=Image.new('RGBA',(64,64));tree.alpha_composite(tile(5,(56,56)),(4,8))
    tree_base=tree.crop((16,32,48,64));tree_upper=tree.copy();ImageDraw.Draw(tree_upper).rectangle((16,32,47,63),fill=(0,0,0,0))
    wall=tile(4,(32,48));wall_base=wall.crop((0,16,32,48));wall_upper=Image.new('RGBA',(32,32));wall_upper.alpha_composite(wall.crop((0,0,32,16)),(0,16))
    legend={'.':'ground',',':'grass','=':'road','#':'wall','T':'tree','~':'water'}
    for theme in ['dawn_town','dawn_field']:
        frames=[];entries=[]
        for char,kind in legend.items():
            for mask in range(16):
                if kind in ['tree','wall']:
                    im=(tree_base if kind=='tree' else wall_base).copy()
                else:
                    im=textures[kind].copy()
                    if kind!='ground':
                        a=Image.new('L',(32,32),0);d=ImageDraw.Draw(a)
                        # N1 E2 S4 W8: absent neighbour of same kind exposes a4px soft stepped edge.
                        left=0 if mask&8 else 4;top=0 if mask&1 else 4;right=31 if mask&2 else 27;bottom=31 if mask&4 else 27
                        d.rounded_rectangle((left,top,right,bottom),radius=3,fill=255)
                        im.putalpha(a)
                index=len(frames);frames.append(im)
                entries.append({'index':index,'kind':kind,'char':char,'neighborMask':mask,'walkable':kind in ['ground','grass','road'],'layer':'base','underlay':'grass' if kind in ['water','tree'] else 'ground'})
        b.emit('tiles_'+theme+'_base','tiles',frames,extra={'contentId':'map:'+theme,'tileWidth':32,'tileHeight':32,'tileEntries':entries,'legend':legend,'adjacency':{'bits':{'up':1,'right':2,'down':4,'left':8},'match':'same TILE_LEGEND kind; outside map treated as same kind','indexFormula':'legendOrderIndex*16+neighborMask','legendOrder':list(legend.values()),'underlayIndex':{'ground':15,'grass':31},'drawOrder':['underlay','base','actors sorted by groundY','upper layers sorted by tile groundY']},'projection':'top-oblique','sourceAtlas':'terrain_master'})
        b.emit('tiles_'+theme+'_tree_upper','tiles',[tree_upper],extra={'origin':[0,0],'tileOffset':[-16,-32],'layer':'occlusion','sortBy':'tileBottomY','companionBaseKind':'tree','contentId':'map:'+theme})
        b.emit('tiles_'+theme+'_wall_upper','tiles',[wall_upper],extra={'origin':[0,0],'tileOffset':[0,-32],'layer':'occlusion','sortBy':'tileBottomY','companionBaseKind':'wall','contentId':'map:'+theme})
    portal=Image.new('RGBA',(32,64));portal.alpha_composite(tile(7,(32,48)),(0,12));pf=[]
    for f in range(4):
        im=portal.copy();d=ImageDraw.Draw(im)
        for j,(x,y) in enumerate([(11,31),(21,38),(15,48)]):
            yy=y+[-1,0,1,0][(f+j)%4];r=[1,2,1,0][(f+j)%4]
            d.line((x-r,yy,x+r,yy),fill='#fdfdeb');d.line((x,yy-r,x,yy+r),fill='#fdfdeb')
        pf.append(b.native(im))
    b.emit('portal_world_idle','tiles',pf,'idle',6,True,{'origin':[.5,1],'groundOffset':4,'tileOffset':[0,-32],'placement':'portal.at; decorative only, preserve gameplay walkability from map','layer':'world-object'})
    for slug in ['dawn_field','rift_tower','town_practice']:
        master=Image.open(b.ART/'masters'/('bg_'+slug+'.png')).convert('RGBA')
        bg=b.native(master.resize((960,540),Image.Resampling.NEAREST));bg.putalpha(255)
        b.emit('bg_'+slug+'_battle','backgrounds',[bg],extra={'safeCombatAreas':[[170,90,240,360],[550,90,280,360]],'uiReservedRect':[0,450,960,90],'sourceAtlas':'bg_'+slug,'sourceSize':list(master.size),'contentGroup':'battle-backgrounds'})
        fx=[]
        for f in range(6):
            im=Image.new('RGBA',(64,64));d=ImageDraw.Draw(im)
            for j,(x,y) in enumerate([(32,32)]):
                phase=(f+j)%6;yy=y+[0,-1,-2,-2,-1,0][phase]
                if slug=='dawn_field':
                    wid=[3,2,1,2,3,3][phase];d.polygon([(x-wid,yy),(x,yy-2),(x+wid,yy),(x,yy+2)],fill='#b4dfb8');d.point((x,yy),fill='#fdfdeb')
                else:
                    r=[0,1,2,1,0,0][phase];d.line((x-r,yy,x+r,yy),fill='#fdfdeb');d.line((x,yy-r,x,yy+r),fill='#fdfdeb')
            fx.append(b.native(im))
        b.emit('bg_'+slug+'_ambient','backgrounds',fx,'ambient',6,True,{'origin':[0,0],'compositeOver':'bg_'+slug+'_battle','reducedMotion':'hide ambient layer','placements':[{'x':x-32,'y':y-32,'phaseOffset':j} for j,(x,y) in enumerate([(80,116),(880,155),(116,410),(853,390)])],'safeCombatAreas':[[170,90,240,360],[550,90,280,360]]})
    b.SOURCES['terrain_master']={'sourceSize':list(src.size),'sourceGrid':[4,2],'sourceCellTopSeamRemoval':12,'nativeTiles':[32,32],'upperTree':[64,64],'upperWall':[32,32]}
    b.SOURCES['terrain_quiet']={'sourceSize':list(quiet.size),'sourceGrid':[4,2],'usedCells':[0,1,2,3,4],'nativeTextureModeFilter':3,'wallSourceYFraction':[.15,.87],'wallExport':[32,48]}
